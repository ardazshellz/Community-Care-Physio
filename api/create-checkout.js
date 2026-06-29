// api/create-checkout.js
// Creates a dynamic Stripe Checkout Session with booking data in metadata
// This is the proper way to integrate Stripe with a booking system

import Stripe from 'stripe';
import { supabase } from '../lib/supabase.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

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

const PRICES = {
  'Initial Assessment':   10000,
  'Standard Session':     7500,
  'Extended Session':     9000,
  'Starter Programme':    29500,
  'Full Programme':       43500,
  'Block of 4 Sessions':  28000,
  'Block of 6 Sessions':  42000,
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const bd = req.body;

    // 1. Check slot isn't already taken
    if (bd.bookedDate && bd.bookedTime) {
      const { data: existing } = await supabase
        .from('blocked_slots')
        .select('id')
        .eq('booking_date', bd.bookedDate)
        .eq('slot_time', bd.bookedTime)
        .single();

      if (existing) {
        return res.status(409).json({ error: 'Slot already booked', code: 'SLOT_TAKEN' });
      }
    }

    // 2. Create pending booking in Supabase
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
        booked_date: bd.bookedDate || null,
        booked_time: bd.bookedTime || null,
        preferred_time: bd.preferredTime,
        area: bd.area,
        patient_type: bd.patientType,
        booking_for: bd.bookingFor,
        reason: bd.reason,
        preferred_days: bd.preferredDays,
        paid: false,
        confirmed: false,
        timestamp: new Date().toLocaleString('en-GB', { timeZone: 'Europe/London' })
      })
      .select()
      .single();

    if (bookingErr) throw bookingErr;

    // 3. Hold the slot for 5 minutes while payment is in progress
    // NOTE: slot only gets BLOCKED in blocked_slots after payment confirmed via webhook
    if (bd.bookedDate && bd.bookedTime) {
      // Check if slot is currently held by another pending booking
      const { data: existingPending } = await supabase
        .from('pending_bookings')
        .select('id')
        .eq('booked_date', bd.bookedDate)
        .eq('booked_time', bd.bookedTime)
        .gt('expires_at', new Date().toISOString())
        .single();

      if (existingPending) {
        // Clean up the unpaid booking we just created
        await supabase.from('bookings').delete().eq('id', booking.id);
        return res.status(409).json({ error: 'Slot temporarily held', code: 'SLOT_HELD' });
      }

      await supabase
        .from('pending_bookings')
        .upsert({
          stripe_session_id: `pending_${booking.id}`,
          booking_data: bd,
          booked_date: bd.bookedDate,
          booked_time: bd.bookedTime,
          expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString() // 5 minutes only
        }, { onConflict: 'stripe_session_id' });
    }

    // 4. Create Stripe Checkout Session with booking ID in metadata
    const priceInPence = PRICES[bd.appointment] || (bd.price * 100);

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'gbp',
          product_data: {
            name: `Community Care Physio — ${bd.appointment}`,
            description: bd.bookedDate
              ? `${new Date(bd.bookedDate + 'T12:00:00').toLocaleDateString('en-GB', { weekday:'long', day:'numeric', month:'long' })} at ${bd.bookedTime || bd.preferredTime}`
              : bd.preferredTime || 'Home visit appointment',
          },
          unit_amount: priceInPence,
        },
        quantity: 1,
      }],
      mode: 'payment',
      customer_email: bd.email || undefined,
      // 5. Return URLs - back to your site
      success_url: `https://communitycarephysio.co.uk/?booking=success&id=${booking.id}`,
      cancel_url: `https://communitycarephysio.co.uk/?booking=cancelled`,
      // 6. Booking data in metadata - this is what the webhook reads
      metadata: {
        booking_id: booking.id,
        patient_name: bd.name,
        appointment: bd.appointment,
        booked_date: bd.bookedDate || '',
        booked_time: bd.bookedTime || '',
        phone: bd.phone,
        address: `${bd.address || ''}, ${bd.postcode || ''}`,
      }
    });

    // 5. Return the Stripe checkout URL
    return res.status(200).json({ 
      success: true, 
      checkoutUrl: session.url,
      bookingId: booking.id 
    });

  } catch (err) {
    console.error('create-checkout error:', err);
    return res.status(500).json({ error: err.message });
  }
}
