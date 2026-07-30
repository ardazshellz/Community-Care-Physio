// api/update-booking.js
// Admin panel calls this to confirm, mark paid, save sessions, or permanently delete bookings.
// Protected by a signed admin session token issued by /api/admin-login.js.

import { supabase } from '../lib/supabase.js';
import { verifyAdminToken } from '../lib/adminAuth.js';

export default async function handler(req, res) {
  res.setHeader(
    'Access-Control-Allow-Origin',
    'https://communitycarephysio.co.uk'
  );
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { token, action, bookingId, sessions } = req.body || {};

  if (!verifyAdminToken(token)) {
    return res.status(401).json({ error: 'Unauthorised' });
  }

  if (!bookingId) {
    return res.status(400).json({ error: 'Missing bookingId' });
  }

  try {
    if (action === 'confirm') {
      const { error } = await supabase
        .from('bookings')
        .update({ confirmed: true })
        .eq('id', bookingId);

      if (error) throw error;
    }

    else if (action === 'markPaid') {
      const { data: booking, error: readError } = await supabase
        .from('bookings')
        .select('paid')
        .eq('id', bookingId)
        .single();

      if (readError) throw readError;

      const { error } = await supabase
        .from('bookings')
        .update({ paid: !booking.paid })
        .eq('id', bookingId);

      if (error) throw error;
    }

    else if (action === 'saveSessions') {
      if (!Array.isArray(sessions)) {
        return res.status(400).json({
          error: 'sessions must be an array'
        });
      }

      const cleanSessions = sessions.map((session, index) => ({
        label:
          session && session.label
            ? String(session.label)
            : `Follow-up ${index + 1}`,

        date:
          session && session.date
            ? String(session.date)
            : null,

        time:
          session && session.time
            ? String(session.time)
            : null,

        length:
          session && session.length
            ? Number(session.length)
            : 45,

        status:
          session && session.status
            ? String(session.status)
            : 'scheduled',

        reminderOff: Boolean(session && session.reminderOff),
        reminderSent: Boolean(session && session.reminderSent)
      }));

      const { error } = await supabase
        .from('bookings')
        .update({ custom_sessions: cleanSessions })
        .eq('id', bookingId);

      if (error) throw error;
    }

    else if (action === 'delete' || action === 'purge') {
      // This permanently removes genuine test or refunded records
      // from Patients, Bookings, Finance and future Excel exports.

      const { data: existingBooking, error: readError } = await supabase
        .from('bookings')
        .select('id')
        .eq('id', bookingId)
        .maybeSingle();

      if (readError) throw readError;

      if (!existingBooking) {
        return res.status(404).json({
          error: 'Booking not found'
        });
      }

      // Remove appointment slots connected to this booking.
      const { error: slotError } = await supabase
        .from('blocked_slots')
        .delete()
        .eq('booking_id', bookingId);

      if (slotError) throw slotError;

      // Remove any temporary pending record associated with this booking.
      const { error: pendingError } = await supabase
        .from('pending_bookings')
        .delete()
        .eq('stripe_session_id', `pending_${bookingId}`);

      if (pendingError) throw pendingError;

      // Permanently remove the main booking record.
      const { data: deletedBookings, error: deleteError } = await supabase
        .from('bookings')
        .delete()
        .eq('id', bookingId)
        .select('id');

      if (deleteError) throw deleteError;

      if (!deletedBookings || deletedBookings.length !== 1) {
        return res.status(500).json({
          error: 'Booking could not be deleted'
        });
      }
    }

    else {
      return res.status(400).json({
        error: 'Unknown action'
      });
    }

    return res.status(200).json({
      success: true
    });
  }

  catch (error) {
    console.error('update-booking error:', error);

    return res.status(500).json({
      error: 'Internal server error'
    });
  }
}
