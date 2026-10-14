// Abandoned checkouts: a public booking that reached Stripe but was never paid.
// The row stays in `bookings` (paid false, confirmed false). Once the Checkout hold
// has lapsed we mark it `abandoned`, email the clinician a high-priority alert and
// show it on the admin dashboard as a lead to follow up.
export const ABANDON_AFTER_MS = 45 * 60 * 1000; // Checkout hold is 31 min

export function isAbandonedRow(row, now = Date.now()) {
  if (!row || row.paid || row.confirmed) return false;
  if (row.status && row.status !== 'abandoned') return false;
  if (row.booking_for === 'enquiry') return false;
  const created = Date.parse(row.created_at || row.createdAt || '');
  return Number.isFinite(created) && now - created >= ABANDON_AFTER_MS;
}

const ukDate = (iso) => iso ? new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : 'not chosen';

export function abandonedAlert(row) {
  const lines = [
    'A visitor started a booking on the website and did not complete payment. Worth a follow up.',
    '',
    `Name: ${row.name || '—'}`,
    `Phone: ${row.phone || '—'}`,
    `Email: ${row.email || '—'}`,
    `Address: ${[row.address, row.postcode].filter(Boolean).join(', ') || '—'}`,
    `Booking for: ${row.booking_for || '—'}`,
    `Appointment: ${row.appointment || '—'}${row.price ? ` (£${row.price})` : ''}`,
    `Requested: ${ukDate(row.booked_date)}${row.booked_time ? ` at ${row.booked_time}` : ''}`,
    `Reason: ${row.reason || 'not given'}`,
    `Started: ${row.timestamp || row.created_at || '—'}`,
    '',
    'Follow up from the admin dashboard: https://www.communitycarephysio.co.uk/#admin'
  ];
  return {
    subject: `FOLLOW UP: unpaid booking, ${row.name || 'unknown'}, ${row.appointment || 'booking'}`,
    text: lines.join('\n'),
    html: `<div style="font-family:Arial,sans-serif;max-width:560px;font-size:14px;line-height:1.7">
      <div style="background:#b45309;color:#fff;padding:14px 18px;border-radius:10px 10px 0 0"><strong>Follow up needed: unpaid booking</strong></div>
      <div style="border:1px solid #fcd34d;border-top:none;padding:16px 18px;border-radius:0 0 10px 10px">${lines.map((l) => l ? String(l).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])) : '<br>').join('<br>')}</div></div>`,
    headers: { 'X-Priority': '1', 'Importance': 'high', 'X-MSMail-Priority': 'High' }
  };
}
