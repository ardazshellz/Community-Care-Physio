// api/stripe-webhook.js
// Receives checkout.session.completed from Stripe
// Reads booking_id from metadata → confirms booking → blocks slot → sends emails

import Stripe from 'stripe';
import { supabase } from '../lib/supabase.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export const config = { api: { bodyParser: false } };

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function getBlockedSlots(timeStr, durationMins) {
  const [h, m] = timeStr.split(':').map(Number);
  const startMins = h * 60 + m;
  const totalBlock = durationMins + 45;
  const blocked = [];
  for (let t = 0; t < totalBlock; t += 30) {
    const slotMins = startMins + t;
    const sh = Math.floor(slotMins / 60);
    const sm = slotMins % 60;
    if (sh < 24) blocked.push(`${String(sh).padStart(2,'0')}:${String(sm).padStart(2,'0')}`);
  }
  return blocked;
}

function getDurationMins(appt) {
  const map = {
    'Initial Assessment':60,'Standard Session':45,'Extended Session':60,
    'Starter Programme':60,'Full Programme':60,
    'Block of 4 Sessions':45,'Block of 6 Sessions':45
  };
  return map[appt] || 60;
}

async function saveCard(session, bookingId) {
  // Payment-link and enquiry flows keep their existing behaviour.
  if (session.payment_link || !session.payment_intent) return;
  try {
    const intent = await stripe.paymentIntents.retrieve(
      typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent.id,
      { expand: ['payment_method'] }
    );
    const method = intent.payment_method;
    const customer = typeof intent.customer === 'string' ? intent.customer : intent.customer?.id;
    // Cards and Stripe Link can both be reused off-session.
    if (!customer || !method?.id || !(method.card || method.type === 'link')) return;
    const key = `card:${bookingId}`;
    const details = {
      customer, paymentMethod: method.id, brand: method.card?.brand || method.type, last4: method.card?.last4 || '',
      expMonth: method.card?.exp_month || null, expYear: method.card?.exp_year || null, savedAt: new Date().toISOString()
    };
    for (let attempt = 0; attempt < 5; attempt++) {
      const { data: existing, error: readError } = await supabase.from('practice_records')
        .select('value,updated_at').eq('key', key).maybeSingle();
      if (readError) throw readError;
      const row = { key, kind: 'card', value: { ...details, charges: existing?.value.charges || [] }, updated_at: new Date().toISOString() };
      // Preserve charges even if a fee is recorded while this webhook runs.
      const query = existing
        ? supabase.from('practice_records').update({ value: row.value, updated_at: row.updated_at })
          .eq('key', key).eq('updated_at', existing.updated_at)
        : supabase.from('practice_records').upsert(row, { onConflict: 'key', ignoreDuplicates: true });
      const { data: saved, error } = await query.select('key').maybeSingle();
      if (error) throw error;
      if (saved) return;
    }
    throw Object.assign(new Error('Card record changed'), { code: 'record_conflict' });
  } catch (error) {
    console.error('stripe-webhook', { action: 'save-card', code: safeCode(error) });
  }
}

function safeCode(error) {
  return typeof error?.code === 'string' && /^[a-z0-9_]{1,40}$/i.test(error.code) ? error.code : 'unknown';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const rawBody = await getRawBody(req);
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('stripe-webhook', { action: 'verify-signature', code: safeCode(err) });
    return res.status(400).json({ error: 'Invalid webhook signature.' });
  }

  // The enquiry branch has transactional, retry-safe promotion and no draft sends.
  if (event.data.object.metadata?.enquiry_id && [
    'checkout.session.completed', 'checkout.session.async_payment_succeeded',
    'checkout.session.async_payment_failed', 'checkout.session.expired'
  ].includes(event.type)) {
    try {
      const { createEnquiryService } = await import('../lib/enquiries.js');
      const session = await stripe.checkout.sessions.retrieve(event.data.object.id);
      await createEnquiryService({db:supabase,stripe}).settleSession(
        session, event.type === 'checkout.session.async_payment_failed');
      return res.status(200).json({received:true});
    } catch {
      return res.status(500).json({error:'Enquiry confirmation failed; retry required'});
    }
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const bookingId = session.metadata?.booking_id;

    if (!bookingId) {
      console.log('No booking_id in metadata - skipping');
      return res.status(200).json({ received: true });
    }

    try {
      const { data: existing } = await supabase
        .from('bookings')
        .select('*')
        .eq('id', bookingId)
        .single();

      if (!existing) {
        console.error('stripe-webhook', { action: 'confirm-booking', code: 'not_found' });
        return res.status(200).json({ received: true });
      }

      if (existing.paid) {
        // A Stripe retry after a partial failure still gets a chance to save the card.
        await saveCard(session, bookingId);
        return res.status(200).json({ received: true });
      }

      await supabase.from('bookings').update({ paid: true, confirmed: true }).eq('id', bookingId);

      await saveCard(session, bookingId);

      // Custom bookings carry a list of sessions — block every one of their slots.
      let customSessions = null;
      if (existing.custom_sessions) {
        try { customSessions = JSON.parse(existing.custom_sessions); } catch(e) { customSessions = null; }
      }

      if (Array.isArray(customSessions) && customSessions.length) {
        const rows = [];
        customSessions.forEach(s => {
          if (!s.date || !s.time) return;
          const durationMins = s.length === '60' ? 60 : 45;
          getBlockedSlots(s.time, durationMins).forEach(slot => {
            rows.push({ booking_date: s.date, slot_time: slot, booking_id: existing.id });
          });
        });
        if (rows.length) {
          await supabase.from('blocked_slots').upsert(rows, { onConflict: 'booking_date,slot_time', ignoreDuplicates: true });
        }
      } else if (existing.booked_date && existing.booked_time) {
        const durationMins = getDurationMins(existing.appointment);
        const slotsToBlock = getBlockedSlots(existing.booked_time, durationMins);
        await supabase.from('blocked_slots').upsert(
          slotsToBlock.map(slot => ({ booking_date: existing.booked_date, slot_time: slot, booking_id: existing.id })),
          { onConflict: 'booking_date,slot_time', ignoreDuplicates: true }
        );
      }

      await supabase.from('pending_bookings').delete().eq('stripe_session_id', `pending_${bookingId}`);

      const formattedDate = existing.booked_date
        ? new Date(existing.booked_date + 'T12:00:00').toLocaleDateString('en-GB', { weekday:'long', day:'numeric', month:'long', year:'numeric' })
        : 'TBC';
      const formattedTime = existing.booked_time || 'TBC';

      // Send via Gmail SMTP
      try {
        const nodemailer = await import('nodemailer');
        const transporter = nodemailer.default.createTransport({
          service: 'gmail',
          auth: {
            user: 'infoccphysio@gmail.com',
            pass: process.env.GMAIL_APP_PASSWORD
          }
        });

        // Email to Zakery (clinician)
        await transporter.sendMail({
          from: '"CCP Bookings" <infoccphysio@gmail.com>',
          to: 'infoccphysio@gmail.com',
          subject: `New booking — ${existing.appointment} · ${existing.name} · ${formattedDate}`,
          html: `<div style="font-family:Arial,sans-serif;max-width:560px">
            <div style="background:#1e4d3b;padding:20px;border-radius:10px 10px 0 0">
              <h2 style="color:#fff;margin:0">New booking confirmed</h2>
              <p style="color:rgba(255,255,255,.6);font-size:12px;margin:4px 0 0">Payment received via Stripe</p>
            </div>
            <div style="background:#fff;padding:24px;border:1px solid #e8f2ee;border-top:none;font-size:13px;line-height:2">
              <p><strong>Name:</strong> ${existing.name}</p>
              <p><strong>Phone:</strong> ${existing.phone}</p>
              <p><strong>Email:</strong> ${existing.email || '—'}</p>
              <p><strong>Address:</strong> ${existing.address || '—'}, ${existing.postcode || ''}</p>
              <p><strong>Appointment:</strong> ${existing.appointment}</p>
              <p><strong>Date:</strong> ${formattedDate}</p>
              <p><strong>Time:</strong> ${formattedTime}</p>
              <p><strong>Patient type:</strong> ${existing.patient_type === 'new' ? 'New patient' : 'Returning patient'}</p>
              <p><strong>Reason/notes:</strong> ${existing.reason || 'Not provided'}</p>
              <p><strong>Amount paid:</strong> £${existing.price}</p>
              <div style="margin-top:16px;padding:12px;background:#e8f2ee;border-radius:8px">
                <a href="https://communitycarephysio.co.uk/#admin" style="color:#1e4d3b;font-weight:600">View in admin panel →</a>
              </div>
            </div>
          </div>`
        });

        // Email to patient (only if they provided an email)
        if (existing.email) {
          await transporter.sendMail({
            from: '"Community Care Physio" <infoccphysio@gmail.com>',
            to: existing.email,
            subject: `Your booking is confirmed — ${existing.appointment} on ${formattedDate}`,
            html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto">
              <div style="background:#1e4d3b;padding:24px;border-radius:12px 12px 0 0">
                <h1 style="color:#fff;font-size:20px;margin:0">Community Care Physio</h1>
                <p style="color:rgba(255,255,255,.6);font-size:12px;margin:4px 0 0">South West London</p>
              </div>
              <div style="background:#fff;padding:28px;border:1px solid #e8f2ee;border-top:none">
                <h2 style="color:#1e4d3b;font-size:18px;margin:0 0 16px">Your appointment is confirmed</h2>
                <p style="font-size:14px;color:#586860;line-height:1.6">Hi ${existing.name?.split(' ')[0] || 'there'},<br><br>
                Payment received and your booking is confirmed. See you soon.</p>
                <div style="background:#e8f2ee;border-radius:10px;padding:18px;margin:20px 0;font-size:13px">
                  <p style="margin:0 0 8px"><strong>Appointment:</strong> ${existing.appointment}</p>
                  <p style="margin:0 0 8px"><strong>Date:</strong> ${formattedDate}</p>
                  <p style="margin:0 0 8px"><strong>Time:</strong> ${formattedTime}</p>
                  <p style="margin:0 0 8px"><strong>Your address:</strong> ${existing.address || ''}, ${existing.postcode || ''}</p>
                  <p style="margin:0"><strong>Amount paid:</strong> £${existing.price}</p>
                </div>
                <p style="font-size:13px;color:#586860;line-height:1.6">
                  Please wear comfortable clothing. If you have any relevant medical letters, X-rays or scan results, these can be really helpful for your assessment — though not essential, so no need to worry if you don't have them to hand.
                </p>
                <p style="font-size:13px;color:#586860;line-height:1.6">
                  A £50 fee applies for cancellations within 24 hours. To cancel or rearrange, please message us on WhatsApp as early as you can on <a href="https://wa.me/447508401627?text=Hi%2C%20I%20need%20to%20cancel%20or%20reschedule%20my%20appointment%20on%20${encodeURIComponent(formattedDate)}" style="color:#1e4d3b;font-weight:600">07508 401627</a> — if something urgent has come up we'll always do our best to help.
                  If a refund is applicable, please allow 5–10 working days for it to appear back on your card via Stripe.
                </p>
                <div style="margin-top:24px;padding-top:20px;border-top:1px solid #e8f2ee;font-size:12px;color:#586860">
                  <p>Any questions — reply to this email or message us on WhatsApp.</p>
                  <p style="margin-top:12px"><strong style="color:#1e4d3b">Community Care Physio</strong><br>
                  communitycarephysio.co.uk · 07508 401627</p>
                </div>
              </div>
            </div>`
          });
        }

        console.log('Gmail emails sent successfully');
      } catch(emailErr) {
        console.error('stripe-webhook', { action: 'confirmation-email', code: safeCode(emailErr) });
      }

    } catch (err) {
      console.error('stripe-webhook', { action: 'confirm-booking', code: safeCode(err) });
    }
  }

  return res.status(200).json({ received: true });
}
