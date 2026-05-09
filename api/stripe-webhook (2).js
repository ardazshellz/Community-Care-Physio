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

      await fetch('https://formspree.io/f/xdablveq', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({
          _subject: `✅ PAID — ${existing.appointment} · ${existing.name} · ${formattedDate}`,
          name: existing.name, phone: existing.phone, email: existing.email || '—',
          address: `${existing.address || '—'}, ${existing.postcode || ''}`,
          appointment: existing.appointment, date: formattedDate, time: existing.booked_time || 'TBC',
          patient_type: existing.patient_type === 'new' ? 'New patient' : 'Returning patient',
          reason: existing.reason || '—', amount: `£${existing.price}`,
          status: '✅ PAYMENT CONFIRMED', admin: 'communitycarephysio.co.uk/#admin'
        })
      }).catch(e => console.error('Formspree error:', e));

      console.log('Booking confirmed:', bookingId, existing.name);
    } catch (err) {
      console.error('Webhook processing error:', err);
    }
  }

  return res.status(200).json({ received: true });
}
