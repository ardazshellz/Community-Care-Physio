// api/update-booking.js
// Admin panel calls this to confirm, mark paid, or delete bookings.
// Protected by a signed admin session token (issued by /api/admin-login.js),
// instead of re-sending the raw password on every call.

import { supabase } from '../lib/supabase.js';
import { verifyAdminToken } from '../lib/adminAuth.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://communitycarephysio.co.uk');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { token, action, bookingId } = req.body;
  if (!verifyAdminToken(token)) {
    return res.status(401).json({ error: 'Unauthorised' });
  }
  if (!bookingId) return res.status(400).json({ error: 'Missing bookingId' });

  try {
    if (action === 'confirm') {
      const { error } = await supabase
        .from('bookings')
        .update({ confirmed: true })
        .eq('id', bookingId);
      if (error) throw error;
    } else if (action === 'markPaid') {
      const { data: booking } = await supabase
        .from('bookings').select('paid').eq('id', bookingId).single();
      const { error } = await supabase
        .from('bookings')
        .update({ paid: !booking.paid })
        .eq('id', bookingId);
      if (error) throw error;
    } else if (action === 'delete') {
      // Explicitly delete blocked slots first then booking
      await supabase.from('blocked_slots').delete().eq('booking_id', bookingId);
      await supabase.from('pending_bookings').delete().eq('stripe_session_id', `pending_${bookingId}`);
      const { error } = await supabase.from('bookings').delete().eq('id', bookingId);
      if (error) throw error;
    } else {
      return res.status(400).json({ error: 'Unknown action' });
    }
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('update-booking error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
