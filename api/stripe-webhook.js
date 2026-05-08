// api/hold-slot.js
// Called when patient clicks "Pay securely via Stripe"
// Saves booking data and holds the slot while they pay

import { supabase } from '../lib/supabase.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { stripeSessionId, bookingData, bookedDate, bookedTime } = req.body;

    if (!stripeSessionId) {
      return res.status(400).json({ error: 'Missing stripeSessionId' });
    }

    // Check slot isn't already confirmed-booked
    if (bookedDate && bookedTime) {
      const { data: existingBlock } = await supabase
        .from('blocked_slots')
        .select('id')
        .eq('booking_date', bookedDate)
        .eq('slot_time', bookedTime)
        .single();

      if (existingBlock) {
        return res.status(409).json({ error: 'Slot already booked', code: 'SLOT_TAKEN' });
      }

      // Check not already pending by another customer
      const { data: existingPending } = await supabase
        .from('pending_bookings')
        .select('id, stripe_session_id')
        .eq('booked_date', bookedDate)
        .eq('booked_time', bookedTime)
        .gt('expires_at', new Date().toISOString())
        .neq('stripe_session_id', stripeSessionId)
        .single();

      if (existingPending) {
        return res.status(409).json({ error: 'Slot held by another customer', code: 'SLOT_HELD' });
      }
    }

    // Save/update pending booking
    const { error } = await supabase
      .from('pending_bookings')
      .upsert({
        stripe_session_id: stripeSessionId,
        booking_data: bookingData,
        booked_date: bookedDate || null,
        booked_time: bookedTime || null,
        expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString()
      }, { onConflict: 'stripe_session_id' });

    if (error) throw error;

    return res.status(200).json({ success: true });

  } catch (err) {
    console.error('hold-slot error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}


export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', 'https://communitycarephysio.co.uk');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { stripeSessionId, bookingData, bookedDate, bookedTime } = req.body;

    if (!stripeSessionId || !bookedDate || !bookedTime) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Check slot isn't already taken
    const { data: existingBlock } = await supabase
      .from('blocked_slots')
      .select('id')
      .eq('booking_date', bookedDate)
      .eq('slot_time', bookedTime)
      .single();

    if (existingBlock) {
      return res.status(409).json({ error: 'Slot already booked', code: 'SLOT_TAKEN' });
    }

    // Check not already pending
    const { data: existingPending } = await supabase
      .from('pending_bookings')
      .select('id')
      .eq('booked_date', bookedDate)
      .eq('booked_time', bookedTime)
      .gt('expires_at', new Date().toISOString())
      .single();

    if (existingPending) {
      return res.status(409).json({ error: 'Slot held by another customer', code: 'SLOT_HELD' });
    }

    // Hold the slot
    const { error } = await supabase
      .from('pending_bookings')
      .upsert({
        stripe_session_id: stripeSessionId,
        booking_data: bookingData,
        booked_date: bookedDate,
        booked_time: bookedTime,
        expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString()
      }, { onConflict: 'stripe_session_id' });

    if (error) throw error;

    return res.status(200).json({ success: true, message: 'Slot held for 30 minutes' });

  } catch (err) {
    console.error('hold-slot error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
