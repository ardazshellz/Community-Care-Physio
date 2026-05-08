// api/get-slots.js
// Public endpoint — returns blocked slots so frontend can grey them out
// No auth needed as it only exposes dates/times, not patient data

import { supabase } from '../lib/supabase.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://communitycarephysio.co.uk');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  // Cache for 60 seconds
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // Get confirmed blocked slots
    const { data: blocked, error: blockedErr } = await supabase
      .from('blocked_slots')
      .select('booking_date, slot_time')
      .gte('booking_date', new Date().toISOString().split('T')[0]);

    if (blockedErr) throw blockedErr;

    // Get pending slots (someone is mid-checkout right now)
    const { data: pending, error: pendingErr } = await supabase
      .from('pending_bookings')
      .select('booked_date, booked_time')
      .gt('expires_at', new Date().toISOString())
      .not('booked_date', 'is', null);

    if (pendingErr) throw pendingErr;

    // Combine into map
    const bookedSlots = {};

    blocked.forEach(({ booking_date, slot_time }) => {
      if (!booking_date) return;
      const key = booking_date;
      if (!bookedSlots[key]) bookedSlots[key] = [];
      if (!bookedSlots[key].includes(slot_time)) bookedSlots[key].push(slot_time);
    });

    pending.forEach(({ booked_date, booked_time }) => {
      if (!booked_date || !booked_time) return;
      const key = booked_date;
      if (!bookedSlots[key]) bookedSlots[key] = [];
      if (!bookedSlots[key].includes(booked_time)) bookedSlots[key].push(booked_time);
    });

    return res.status(200).json({ bookedSlots });

  } catch (err) {
    console.error('get-slots error:', err);
    return res.status(500).json({ error: 'Internal server error', bookedSlots: {} });
  }
}
