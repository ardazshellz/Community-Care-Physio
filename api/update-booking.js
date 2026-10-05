// api/update-booking.js
// Admin panel calls this to confirm, mark paid, or delete bookings.
// Protected by a signed admin session token (issued by /api/admin-login.js),
// instead of re-sending the raw password on every call.

import { supabase } from '../lib/supabase.js';
import { verifyAdminToken } from '../lib/adminAuth.js';
import { reconcilePackageCompletion } from '../lib/package-completion.js';
import { durationMins, occupiedSlots, shiftSlots } from '../lib/slots.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://communitycarephysio.co.uk');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { token, action, bookingId, sessions, packageStatus, packageCompletedAt, booking } = req.body || {};
  if (!verifyAdminToken(token)) {
    return res.status(401).json({ error: 'Unauthorised' });
  }

  // Invoiced work (case managers, insurers, care homes): a booking with no Stripe
  // checkout. Status 'invoiced' shows as confirmed in the admin; payment is tracked
  // through the Referrals & invoices tab. Slots are blocked under the booking id so
  // cancelling or deleting it frees them. blockUntil (HH:MM) reserves the rest of
  // the day too, e.g. for report writing after the visit.
  if (action === 'create') {
    const b = booking && typeof booking === 'object' ? booking : {};
    const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
    const name = str(b.name, 200), bookedDate = str(b.bookedDate, 10), bookedTime = str(b.bookedTime, 5);
    const price = Number(b.price);
    if (!name) return res.status(400).json({ error: 'Name is required' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(bookedDate) || !/^([01]\d|2[0-3]):(00|30)$/.test(bookedTime)) {
      return res.status(400).json({ error: 'Date (YYYY-MM-DD) and a half-hour time (HH:MM) are required' });
    }
    if (!Number.isFinite(price) || price < 0 || price > 5000) return res.status(400).json({ error: 'Invalid price' });
    const appointment = str(b.appointment, 100) || 'Initial Assessment';
    const mins = durationMins(appointment);
    try {
      const { data: row, error } = await supabase.from('bookings').insert({
        name, phone: str(b.phone, 50), email: str(b.email, 200), address: str(b.address, 500), postcode: str(b.postcode, 12),
        appointment, duration: `${mins} mins`, price, booked_date: bookedDate, booked_time: bookedTime,
        preferred_time: bookedTime, patient_type: str(b.patientType, 20) || 'new', booking_for: str(b.bookingFor, 40) || 'referral',
        reason: str(b.reason, 4000), concern_areas: str(b.concernAreas, 500) || null, complexity_fee: Number(b.complexityFee) || 0,
        paid: false, confirmed: true, status: 'invoiced',
        timestamp: new Date().toLocaleString('en-GB', { timeZone: 'Europe/London' })
      }).select().single();
      if (error) throw error;
      const slots = new Set(occupiedSlots(bookedTime, mins));
      const until = str(b.blockUntil, 5);
      if (/^([01]\d|2[0-3]):(00|30)$/.test(until)) {
        const [h, m] = bookedTime.split(':').map(Number);
        for (let t = h * 60 + m; t < Number(until.slice(0, 2)) * 60 + Number(until.slice(3)); t += 30) {
          slots.add(`${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`);
        }
      }
      const { error: slotError } = await supabase.from('blocked_slots').upsert(
        [...slots].map(slot_time => ({ booking_date: bookedDate, slot_time, booking_id: row.id })),
        { onConflict: 'booking_date,slot_time', ignoreDuplicates: true });
      if (slotError) throw slotError;
      return res.status(200).json({ success: true, bookingId: row.id, blocked: [...slots] });
    } catch (err) {
      console.error('update-booking', { action: 'create', code: err?.code || 'unknown' });
      return res.status(500).json({ error: 'Could not create the booking' });
    }
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

      const {data: current, error: readError}=await supabase.from('bookings')
        .select('appointment,paid,status').eq('id',bookingId).single();
      if(readError)throw readError;
      reconcilePackageCompletion(update,current);

      const { error } = await supabase
        .from('bookings')
        .update(update)
        .eq('id', bookingId);
      if (error) throw error;
    } else if (action === 'reschedule') {
      // Move a single (non-package) booking to a new date and time and carry its
      // blocked slots with it. Sends nothing to the patient.
      const date = String(booking?.bookedDate || ''), time = String(booking?.bookedTime || '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):(00|30)$/.test(time)) {
        return res.status(400).json({ error: 'Date (YYYY-MM-DD) and a half-hour time (HH:MM) are required' });
      }
      const { data: current, error: readError } = await supabase.from('bookings')
        .select('appointment,booked_date,booked_time').eq('id', bookingId).single();
      if (readError) throw readError;
      const { data: own, error: ownError } = await supabase.from('blocked_slots')
        .select('slot_time').eq('booking_id', bookingId);
      if (ownError) throw ownError;
      const slots = own?.length && current.booked_time
        ? shiftSlots(own.map(r => String(r.slot_time).slice(0, 5)), String(current.booked_time).slice(0, 5), time)
        : occupiedSlots(time, durationMins(current.appointment));
      const { data: taken, error: takenError } = await supabase.from('blocked_slots')
        .select('slot_time,booking_id').eq('booking_date', date);
      if (takenError) throw takenError;
      if ((taken || []).some(r => r.booking_id !== bookingId && slots.includes(String(r.slot_time).slice(0, 5)))) {
        return res.status(409).json({ error: 'That time overlaps another booking or blocked slot' });
      }
      // ponytail: three writes, not one transaction. One admin user; move to a
      // Postgres function if bookings are ever rescheduled concurrently.
      const { error: freeError } = await supabase.from('blocked_slots').delete().eq('booking_id', bookingId);
      if (freeError) throw freeError;
      const { error: slotError } = await supabase.from('blocked_slots').upsert(
        slots.map(slot_time => ({ booking_date: date, slot_time, booking_id: bookingId })),
        { onConflict: 'booking_date,slot_time', ignoreDuplicates: true });
      if (slotError) throw slotError;
      const { error } = await supabase.from('bookings')
        .update({ booked_date: date, booked_time: time, preferred_time: time }).eq('id', bookingId);
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
