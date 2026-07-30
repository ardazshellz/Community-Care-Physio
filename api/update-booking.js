// api/update-booking.js
// Admin panel calls this to confirm, mark paid, or delete bookings.
// Protected by a signed admin session token (issued by /api/admin-login.js),
// instead of re-sending the raw password on every call.

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
    return res.status(405).end();
  }

  const {
    token,
    action,
    bookingId,
    sessions,
    packageStatus,
    packageCompletedAt
  } = req.body || {};

  if (!verifyAdminToken(token)) {
    return res.status(401).json({
      error: 'Unauthorised'
    });
  }

  if (!bookingId) {
    return res.status(400).json({
      error: 'Missing bookingId'
    });
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
      // Save the package appointments onto the booking so the same
      // information appears on desktop and mobile.

      if (!Array.isArray(sessions)) {
        return res.status(400).json({
          error: 'sessions must be an array'
        });
      }

      const completedAt =
        packageCompletedAt &&
        !Number.isNaN(Date.parse(packageCompletedAt))
          ? new Date(packageCompletedAt).toISOString()
          : null;

      const clean = sessions.map((session, index) => {
        const row = {
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

          reminderOff: Boolean(
            session && session.reminderOff
          ),

          reminderSent: Boolean(
            session && session.reminderSent
          )
        };

        // Store the completion timestamp in the first session.
        // This avoids needing a new Supabase database column.
        if (index === 0 && completedAt) {
          row.packageCompletedAt = completedAt;
        }

        return row;
      });

      const update = {
        custom_sessions: clean
      };

      if (
        typeof packageStatus === 'string' &&
        packageStatus.trim()
      ) {
        update.status = packageStatus
          .trim()
          .slice(0, 40);
      }

      const { error } = await supabase
        .from('bookings')
        .update(update)
        .eq('id', bookingId);

      if (error) throw error;
    }

    else if (
      action === 'delete' ||
      action === 'purge'
    ) {
      // Permanently remove genuine test or refunded records
      // from the admin area, finance view and future HMRC exports.

      const { data: existing, error: readError } =
        await supabase
          .from('bookings')
          .select('id')
          .eq('id', bookingId)
          .maybeSingle();

      if (readError) throw readError;

      if (!existing) {
        return res.status(404).json({
          error: 'Booking not found'
        });
      }

      // Remove any blocked appointment slots linked to this booking.
      const { error: slotError } = await supabase
        .from('blocked_slots')
        .delete()
        .eq('booking_id', bookingId);

      if (slotError) throw slotError;

      // Remove an older temporary pending-booking record where present.
      const { error: pendingError } = await supabase
        .from('pending_bookings')
        .delete()
        .eq(
          'stripe_session_id',
          `pending_${bookingId}`
        );

      if (pendingError) throw pendingError;

      // Permanently remove the booking record.
      const { data: deleted, error: deleteError } =
        await supabase
          .from('bookings')
          .delete()
          .eq('id', bookingId)
          .select('id');

      if (deleteError) throw deleteError;

      if (!deleted || deleted.length !== 1) {
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
    console.error(
      'update-booking error:',
      error
    );

    return res.status(500).json({
      error: 'Internal server error'
    });
  }
}
