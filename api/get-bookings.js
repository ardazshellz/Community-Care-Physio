// api/get-bookings.js
// Admin panel calls this to fetch all bookings + blocked slots.
// Protected by a signed admin session token (issued once by /api/admin-login.js),
// instead of re-sending the raw password on every call.

import { supabase } from '../lib/supabase.js';
import { verifyAdminToken } from '../lib/adminAuth.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://communitycarephysio.co.uk');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  // Verify admin session token
  const { token } = req.body;
  if (!verifyAdminToken(token)) {
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
        concernAreas: b.concern_areas,
        complexityFee: b.complexity_fee,
        paid: b.paid,
        confirmed: b.confirmed,
        timestamp: b.timestamp || new Date(b.created_at).toLocaleString('en-GB'),
        // Package support: expose the sessions list + created time + status so the
        // admin can render an Episode-of-Care card (one card per package).
        customSessions: (() => { try { return b.custom_sessions ? (typeof b.custom_sessions === 'string' ? JSON.parse(b.custom_sessions) : b.custom_sessions) : null; } catch (e) { return null; } })(),
        createdAt: b.created_at,
        bookingFor: b.booking_for,
        status: b.status || null
      })),
      bookedSlots: bookedSlotsMap
    });
  } catch (err) {
    console.error('get-bookings error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
