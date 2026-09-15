// api/create-checkout.js
// Creates a dynamic Stripe Checkout Session with booking data in metadata
// This is the proper way to integrate Stripe with a booking system

import Stripe from 'stripe';
import {checkoutQuote} from '../lib/checkout-pricing.js';
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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const bd = req.body;

    // Work out the price the SERVER will actually charge (never trust the client's
    // number). We compute it up-front so the booking record and the confirmation
    // email always match exactly what Stripe takes — important for HMRC records.
    let quote;
    try { quote=checkoutQuote(bd); }
    catch(error){return res.status(400).json({error:error.message});}
    const {priceInPence,travel}=quote;
    const chargedPrice=priceInPence/100;
    const serverComplexityFee=quote.complexityFee;

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
        price: chargedPrice,
        booked_date: bd.bookedDate || null,
        booked_time: bd.bookedTime || null,
        preferred_time: bd.preferredTime,
        area: bd.area,
        patient_type: bd.patientType,
        booking_for: bd.bookingFor,
        reason: bd.reason,
        preferred_days: bd.preferredDays,
        concern_areas: bd.concernAreas || null,
        complexity_fee: serverComplexityFee,
        paid: false,
        confirmed: false,
        timestamp: new Date().toLocaleString('en-GB', { timeZone: 'Europe/London' })
      })
      .select()
      .single();

    if (bookingErr) throw bookingErr;

    // Keep the hold until Checkout expires, with a small settlement buffer.
    const checkoutExpiresAt = Math.floor(Date.now() / 1000) + 31 * 60;
    // 3. Reserve the slot before creating a payable Checkout session.
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

      const { error: holdErr } = await supabase
        .from('pending_bookings')
        .upsert({
          stripe_session_id: `pending_${booking.id}`,
          booking_data: bd,
          booked_date: bd.bookedDate,
          booked_time: bd.bookedTime,
          expires_at: new Date((checkoutExpiresAt + 60) * 1000).toISOString()
        }, { onConflict: 'stripe_session_id' });
      if (holdErr) {
        await supabase.from('bookings').delete().eq('id', booking.id);
        return res.status(409).json({ error: 'This appointment could not be reserved. Please choose another time.', code: 'SLOT_HELD' });
      }
    }

    // 4. Create Stripe Checkout Session with booking ID in metadata.
    // priceInPence was computed up-front (server-authoritative) and stored on the record.
    const session = await stripe.checkout.sessions.create({
      line_items: [{
        price_data: {
          currency: 'gbp',
          product_data: {
            name: `Community Care Physio — ${bd.appointment}`,
            description: bd.bookedDate
              ? `${new Date(bd.bookedDate + 'T12:00:00').toLocaleDateString('en-GB', { weekday:'long', day:'numeric', month:'long' })} at ${bd.bookedTime || bd.preferredTime}`
              : bd.preferredTime || 'Home visit appointment',
          },
          unit_amount: quote.treatment,
        },
        quantity: 1,
      }, ...(travel.total ? [{price_data:{currency:'gbp',product_data:{name:'Travel fee',description:'Travel per home visit · '+bd.postcode.toUpperCase()},unit_amount:travel.fee*100},quantity:travel.visits}] : [])],
      mode: 'payment',
      expires_at: checkoutExpiresAt,
      customer_email: bd.email || undefined,
      // 5. Return URLs - back to your site
      success_url: `https://communitycarephysio.co.uk/?booking=success&id=${booking.id}`,
      cancel_url: `https://communitycarephysio.co.uk/?booking=cancelled`,
      // 6. Booking data in metadata - this is what the webhook reads
      metadata: {
        booking_id: booking.id,
        travel_fee_per_visit: String(travel.fee),
        travel_visits: String(travel.visits),
        travel_total: String(travel.total),
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
