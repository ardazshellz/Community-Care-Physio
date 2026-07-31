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

  const { token, action, bookingId, sessions, packageStatus, packageCompletedAt } = req.body || {};
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
    } else if (action === 'saveSessions') {
      // Persist a package's follow-up appointments (dates, times, statuses) onto the
      // booking itself. This makes them REAL server records, so they survive across
      // devices and are picked up by the 24-hour reminder cron (send-reminders.js).
      if (!Array.isArray(sessions)) {
        return res.status(400).json({ error: 'sessions must be an array' });
      }
      const completedAt = packageCompletedAt && !Number.isNaN(Date.parse(packageCompletedAt))
        ? new Date(packageCompletedAt).toISOString()
        : null;

      const clean = sessions.map((s, i) => {
        const row = {
          label: (s && s.label) ? String(s.label) : `Follow-up ${i + 1}`,
          date: (s && s.date) ? String(s.date) : null,
          time: (s && s.time) ? String(s.time) : null,
          length: (s && s.length) ? Number(s.length) : 45,
          status: (s && s.status) ? String(s.status) : 'scheduled',
          // Reminder tracking: reminderOff = admin cancelled it; reminderSent = cron has emailed it.
          reminderOff: !!(s && s.reminderOff),
          reminderSent: !!(s && s.reminderSent),
          // DNA / missed-appointment metadata is stored in the session JSON so
          // finance, exports and communication status remain in sync across devices.
          dnaType: (s && s.dnaType) ? String(s.dnaType).slice(0, 30) : null,
          dnaFee: Number(s && s.dnaFee ? s.dnaFee : 0),
          refundDue: Number(s && s.refundDue ? s.refundDue : 0),
          refundCompleted: !!(s && s.refundCompleted),
          refundDate: (s && s.refundDate && !Number.isNaN(Date.parse(s.refundDate)))
            ? new Date(s.refundDate).toISOString() : null,
          dnaNoticeSent: !!(s && s.dnaNoticeSent),
          dnaNoticeSentAt: (s && s.dnaNoticeSentAt && !Number.isNaN(Date.parse(s.dnaNoticeSentAt)))
            ? new Date(s.dnaNoticeSentAt).toISOString() : null
        };
        // Store the package completion timestamp inside the JSON session list.
        // This avoids a database migration while keeping desktop and mobile in sync.
        if (i === 0 && completedAt) row.packageCompletedAt = completedAt;
        return row;
      });

      const update = { custom_sessions: clean };
      if (typeof packageStatus === 'string' && packageStatus.trim()) {
        update.status = packageStatus.trim().slice(0, 40);
      }

      const { error } = await supabase
        .from('bookings')
        .update(update)
        .eq('id', bookingId);
      if (error) throw error;
    } else if (action === 'delete' || action === 'purge') {
      // A purge is intentionally permanent and is used for genuine test/refunded
      // records that must disappear from the admin, finance view and HMRC export.
      // Delete reserved slots first, then the booking row itself.
      const { data: existing, error: readError } = await supabase
        .from('bookings')
        .select('id')
        .eq('id', bookingId)
        .maybeSingle();
      if (readError) throw readError;
      if (!existing) return res.status(404).json({ error: 'Booking not found' });

      const { error: slotError } = await supabase
        .from('blocked_slots')
        .delete()
        .eq('booking_id', bookingId);
      if (slotError) throw slotError;

      // Older temporary rows may have used this local identifier. This is safe if
      // no matching pending row exists.
      const { error: pendingError } = await supabase
        .from('pending_bookings')
        .delete()
        .eq('stripe_session_id', `pending_${bookingId}`);
      if (pendingError) throw pendingError;

      const { data: deleted, error } = await supabase
        .from('bookings')
        .delete()
        .eq('id', bookingId)
        .select('id');
      if (error) throw error;
      if (!deleted || deleted.length !== 1) {
        return res.status(500).json({ error: 'Booking could not be deleted' });
      }
    } else {
      return res.status(400).json({ error: 'Unknown action' });
    }
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('update-booking error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
