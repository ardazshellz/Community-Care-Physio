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

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const rawBody = await getRawBody(req);
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature failed:', err.message);
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
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
        console.error('Booking not found:', bookingId);
        return res.status(200).json({ received: true });
      }

      if (existing.paid) {
        console.log('Already processed (idempotent):', bookingId);
        return res.status(200).json({ received: true });
      }

      await supabase.from('bookings').update({ paid: true, confirmed: true }).eq('id', bookingId);

      if (existing.booked_date && existing.booked_time) {
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
                  Cancellations within 24 hours incur a £50 fee. To reschedule, WhatsApp us on <strong>07508 401627</strong> as soon as possible.
                </p>
                <div style="margin-top:24px;padding-top:20px;border-top:1px solid #e8f2ee;font-size:12px;color:#586860">
                  <p>Any questions — reply to this email or message us on WhatsApp.</p>
                  <p style="margin-top:12px"><strong style="color:#1e4d3b">Community Care Physio</strong><br>
                  communitycarephysio.co.uk · 07508 401627</p>
                </div>
              </div>
            </div>`
          });
          console.log('Patient confirmation email sent to:', existing.email);
        }

        console.log('Gmail emails sent successfully');
      } catch(emailErr) {
        console.error('Gmail email error:', emailErr.message);
      }

      console.log('Booking confirmed:', bookingId, existing.name);
    } catch (err) {
      console.error('Webhook processing error:', err);
    }
  }

  return res.status(200).json({ received: true });
}
