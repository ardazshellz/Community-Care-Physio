// api/stripe-webhook.js
// Stripe calls this when payment is completed
// This is the source of truth for confirmed bookings

import Stripe from 'stripe';
import { supabase } from '../lib/supabase.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

export const config = { api: { bodyParser: false } };

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// Travel buffer: block surrounding slots after a booking
function getBlockedSlots(timeStr, durationMins) {
  const [h, m] = timeStr.split(':').map(Number);
  const startMins = h * 60 + m;
  const travelBuffer = 45;
  const totalBlock = durationMins + travelBuffer;
  const blocked = [];
  for (let t = 0; t < totalBlock; t += 30) {
    const slotMins = startMins + t;
    const sh = Math.floor(slotMins / 60);
    const sm = slotMins % 60;
    if (sh < 24) blocked.push(`${String(sh).padStart(2,'0')}:${String(sm).padStart(2,'0')}`);
  }
  return blocked;
}

function getDurationMins(appointmentName) {
  const map = {
    'Initial Assessment': 60, 'Standard Session': 45,
    'Extended Session': 60, 'Starter Programme': 60,
    'Full Programme': 60, 'Block of 4 Sessions': 45, 'Block of 6 Sessions': 45
  };
  return map[appointmentName] || 60;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const rawBody = await getRawBody(req);
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    console.error('Webhook signature failed:', err.message);
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const sessionId = session.id;

    try {
      // Get the pending booking data
      const { data: pending, error: pendingErr } = await supabase
        .from('pending_bookings')
        .select('*')
        .eq('stripe_session_id', sessionId)
        .single();

      if (pendingErr || !pending) {
        console.error('No pending booking found for session:', sessionId);
        // Still return 200 so Stripe doesn't retry
        return res.status(200).json({ received: true, warning: 'No pending booking found' });
      }

      const bd = pending.booking_data;
      const bookedDate = pending.booked_date;
      const bookedTime = pending.booked_time;

      // Save confirmed booking to database
      const { data: booking, error: bookingErr } = await supabase
        .from('bookings')
        .insert({
          name: bd.name,
          phone: bd.phone,
          email: bd.email,
          address: bd.address,
          postcode: bd.postcode,
          appointment: bd.appointment,
          duration: bd.duration,
          price: bd.price,
          booked_date: bookedDate,
          booked_time: bookedTime,
          preferred_time: bd.preferredTime,
          area: bd.area,
          patient_type: bd.patientType,
          booking_for: bd.bookingFor,
          reason: bd.reason,
          preferred_days: bd.preferredDays,
          paid: true,
          confirmed: false,
          stripe_session_id: sessionId,
          timestamp: new Date().toLocaleString('en-GB', { timeZone: 'Europe/London' })
        })
        .select()
        .single();

      if (bookingErr) throw bookingErr;

      // Block the slot + travel buffer slots
      if (bookedDate && bookedTime) {
        const durationMins = getDurationMins(bd.appointment);
        const slotsToBlock = getBlockedSlots(bookedTime, durationMins);

        const blockInserts = slotsToBlock.map(slot => ({
          booking_date: bookedDate,
          slot_time: slot,
          booking_id: booking.id
        }));

        await supabase
          .from('blocked_slots')
          .upsert(blockInserts, { onConflict: 'booking_date,slot_time', ignoreDuplicates: true });
      }

      // Clean up pending booking
      await supabase
        .from('pending_bookings')
        .delete()
        .eq('stripe_session_id', sessionId);

      // Send confirmation emails
      await sendConfirmationEmails(bd, bookedDate, bookedTime);

      console.log('Booking confirmed:', booking.id, bd.name);

    } catch (err) {
      console.error('Error processing webhook:', err);
      // Still return 200 - don't want Stripe to retry
      return res.status(200).json({ received: true, error: err.message });
    }
  }

  return res.status(200).json({ received: true });
}

async function sendConfirmationEmails(bd, bookedDate, bookedTime) {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) return;

  const formattedDate = bookedDate
    ? new Date(bookedDate + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    : 'TBC';

  const formattedTime = bookedTime
    ? bookedTime.replace(/^0/, '').replace(':00', '') + (parseInt(bookedTime) >= 12 ? 'pm' : 'am')
    : 'TBC';

  // Email to patient
  if (bd.email) {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Community Care Physio <onboarding@resend.dev>',
        to: bd.email,
        subject: `Booking confirmed — ${bd.appointment} on ${formattedDate}`,
        html: `
          <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#1a1f1d">
            <div style="background:#1e4d3b;padding:24px;border-radius:12px 12px 0 0">
              <h1 style="color:#fff;font-size:20px;margin:0">Community Care Physio</h1>
              <p style="color:rgba(255,255,255,.6);font-size:12px;margin:4px 0 0">South West London</p>
            </div>
            <div style="background:#fff;padding:28px;border:1px solid #e8f2ee;border-top:none">
              <h2 style="color:#1e4d3b;font-size:18px;margin:0 0 16px">Your booking is confirmed 🎉</h2>
              <p style="font-size:14px;color:#586860;line-height:1.6">Hi ${bd.name?.split(' ')[0] || 'there'},<br><br>
              Your appointment is booked and payment received. Here are your details:</p>
              
              <div style="background:#e8f2ee;border-radius:10px;padding:18px;margin:20px 0">
                <table style="width:100%;font-size:13px;color:#1a1f1d">
                  <tr><td style="padding:5px 0;color:#586860;width:40%">Appointment</td><td style="font-weight:600">${bd.appointment}</td></tr>
                  <tr><td style="padding:5px 0;color:#586860">Date</td><td style="font-weight:600">${formattedDate}</td></tr>
                  <tr><td style="padding:5px 0;color:#586860">Time</td><td style="font-weight:600">${formattedTime}</td></tr>
                  <tr><td style="padding:5px 0;color:#586860">Address</td><td style="font-weight:600">${bd.address || ''}, ${bd.postcode || ''}</td></tr>
                  <tr><td style="padding:5px 0;color:#586860">Amount paid</td><td style="font-weight:600">£${bd.price}</td></tr>
                </table>
              </div>
              
              <p style="font-size:13px;color:#586860;line-height:1.6">
                <strong style="color:#1a1f1d">What to expect:</strong> Your physiotherapist will arrive at your address at the confirmed time. 
                Please wear comfortable clothing. If you have any relevant medical letters or scan results, have them ready.
              </p>
              <p style="font-size:13px;color:#586860;line-height:1.6">
                You'll receive a reminder 24 hours before your appointment. If you need to reschedule, please give us 
                at least 24 hours' notice to avoid the cancellation fee.
              </p>
              
              <div style="margin-top:24px;padding-top:20px;border-top:1px solid #e8f2ee">
                <p style="font-size:12px;color:#586860;margin:0">Questions? WhatsApp us on <strong>07508 401627</strong> or email <strong>infoccphysio@gmail.com</strong></p>
                <p style="font-size:11px;color:#8aab97;margin:8px 0 0">Community Care Physio · communitycarephysio.co.uk</p>
              </div>
            </div>
          </div>
        `
      })
    }).catch(e => console.error('Patient email failed:', e));
  }

  // Email to Zakery
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'CCP Bookings <onboarding@resend.dev>',
      to: 'infoccphysio@gmail.com',
      subject: `🗓 New booking — ${bd.appointment} · ${bd.name} · ${formattedDate}`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#1a1f1d">
          <div style="background:#1e4d3b;padding:20px;border-radius:10px 10px 0 0">
            <h2 style="color:#fff;margin:0;font-size:18px">New booking confirmed ✅</h2>
            <p style="color:rgba(255,255,255,.6);font-size:11px;margin:4px 0 0">Payment received via Stripe</p>
          </div>
          <div style="background:#fff;padding:24px;border:1px solid #e8f2ee;border-top:none">
            <table style="width:100%;font-size:13px;color:#1a1f1d;border-collapse:collapse">
              <tr style="background:#e8f2ee"><td style="padding:8px 12px;font-weight:600">Name</td><td style="padding:8px 12px">${bd.name}</td></tr>
              <tr><td style="padding:8px 12px;font-weight:600">Phone</td><td style="padding:8px 12px"><a href="tel:${bd.phone}">${bd.phone}</a></td></tr>
              <tr style="background:#f8f5f0"><td style="padding:8px 12px;font-weight:600">Email</td><td style="padding:8px 12px">${bd.email || '—'}</td></tr>
              <tr><td style="padding:8px 12px;font-weight:600">Address</td><td style="padding:8px 12px">${bd.address || '—'}, ${bd.postcode || ''}</td></tr>
              <tr style="background:#f8f5f0"><td style="padding:8px 12px;font-weight:600">Appointment</td><td style="padding:8px 12px">${bd.appointment} (${bd.duration})</td></tr>
              <tr><td style="padding:8px 12px;font-weight:600">Date & Time</td><td style="padding:8px 12px"><strong style="color:#1e4d3b">${formattedDate} at ${formattedTime}</strong></td></tr>
              <tr style="background:#f8f5f0"><td style="padding:8px 12px;font-weight:600">Patient type</td><td style="padding:8px 12px">${bd.patientType === 'new' ? '🆕 New patient' : '🔄 Returning patient'}</td></tr>
              <tr><td style="padding:8px 12px;font-weight:600">Reason</td><td style="padding:8px 12px">${bd.reason || '—'}</td></tr>
              <tr style="background:#f8f5f0"><td style="padding:8px 12px;font-weight:600">Amount paid</td><td style="padding:8px 12px"><strong style="color:#1e4d3b">£${bd.price}</strong></td></tr>
            </table>
            <div style="margin-top:16px;padding:12px;background:#e8f2ee;border-radius:8px;font-size:12px;color:#1e4d3b">
              View in admin: <a href="https://communitycarephysio.co.uk/#admin" style="color:#1e4d3b;font-weight:600">communitycarephysio.co.uk/#admin</a>
            </div>
          </div>
        </div>
      `
    })
  }).catch(e => console.error('Admin email failed:', e));
}
