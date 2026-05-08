// api/get-bookings.js
// Admin panel calls this to fetch all bookings + blocked slots
// Protected by admin password check

import { supabase } from '../lib/supabase.js';
import crypto from 'crypto';

const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH;

function hashPassword(pw) {
  return crypto.createHash('sha256').update(pw + process.env.ADMIN_SALT).digest('hex');
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://communitycarephysio.co.uk');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  // Verify admin password
  const { password } = req.body;
  if (!password || hashPassword(password) !== ADMIN_PASSWORD_HASH) {
    return res.status(401).json({ error: 'Unauthorised' });
  }

  try {
    // Fetch all bookings
    const { data: bookings, error: bookingsErr } = await supabase
      .from('bookings')
      .select('*')
      .order('created_at', { ascending: false });

    if (bookingsErr) throw bookingsErr;

    // Fetch blocked slots
    const { data: blockedSlots, error: slotsErr } = await supabase
      .from('blocked_slots')
      .select('booking_date, slot_time');

    if (slotsErr) throw slotsErr;

    // Build bookedSlots map { 'YYYY-MM-DD': ['HH:MM', ...] }
    const bookedSlotsMap = {};
    blockedSlots.forEach(({ booking_date, slot_time }) => {
      const key = booking_date;
      if (!bookedSlotsMap[key]) bookedSlotsMap[key] = [];
      if (!bookedSlotsMap[key].includes(slot_time)) bookedSlotsMap[key].push(slot_time);
    });

    return res.status(200).json({
      bookings: bookings.map(b => ({
        id: b.id,
        name: b.name,
        phone: b.phone,
        email: b.email,
        address: b.address,
        postcode: b.postcode,
        appointment: b.appointment,
        duration: b.duration,
        price: b.price,
        bookedDate: b.booked_date,
        bookedTime: b.booked_time,
        preferredTime: b.preferred_time,
        area: b.area,
        patientType: b.patient_type,
        bookingFor: b.booking_for,
        reason: b.reason,
        preferredDays: b.preferred_days,
        paid: b.paid,
        confirmed: b.confirmed,
        timestamp: b.timestamp || new Date(b.created_at).toLocaleString('en-GB')
      })),
      bookedSlots: bookedSlotsMap
    });

  } catch (err) {
    console.error('get-bookings error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
