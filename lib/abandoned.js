// Abandoned checkouts: a public booking that reached Stripe but was never paid.
// The row stays in `bookings` (paid false, confirmed false). Once the Checkout hold
// has lapsed we mark it `abandoned`, email the clinician a high-priority alert and
// show it on the admin dashboard as a lead to follow up.
export const ABANDON_AFTER_MS = 45 * 60 * 1000; // Checkout hold is 31 min
export const SECOND_EMAIL_AFTER_MS = 2 * 86400000; // "pick up where you left off" again on day 2
export const LEAD_AFTER_MS = 7 * 86400000;         // day 7: off the dashboard, into "No completed payments"
export const BOOK_URL = 'https://www.communitycarephysio.co.uk/?book=1';

// What the 08:00 cron should do with an abandoned row: 'second-email', 'lead' or null.
// Idempotent: lead_emails 2 blocks a repeat send, status 'lead' never comes back here.
export function leadStage(row, now = Date.now()) {
  if (!row || row.status !== 'abandoned' || row.booking_for === 'enquiry') return null;
  const age = now - Date.parse(row.created_at || '');
  if (!Number.isFinite(age)) return null;
  if (age >= LEAD_AFTER_MS) return 'lead';
  if (age >= SECOND_EMAIL_AFTER_MS && (row.lead_emails || 0) < 2) return 'second-email';
  return null;
}

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

// Email to the person who started the booking, sent when the Checkout expires and
// again on day 2. `url` is Stripe's recovery link (same details prefilled, valid 30
// days) or, when the webhook never gave us one, the plain booking page.
export function recoveryEmail(row, url, { followUp = false } = {}) {
  const first = String(row.name || '').trim().split(/\s+/)[0] || 'there';
  const what = `${row.appointment || 'a home visit'}${row.booked_date ? ` on ${ukDate(row.booked_date)}${row.booked_time ? ` at ${row.booked_time}` : ''}` : ''}`;
  const prefilled = url !== BOOK_URL;
  const finish = prefilled ? 'you can finish the booking here with your details already filled in:' : 'you can finish the booking here:';
  const validity = prefilled ? 'The link works for 30 days. ' : '';
  const text = `Hi ${first},

A booking was started on the Community Care Physio website for ${what} but the payment was not completed, so the appointment is not yet reserved.

If you would still like the visit, ${finish}
${url}

${validity}If the time no longer suits, or you would rather talk it through first, reply to this email or call or WhatsApp me on 07508 401627 and I will find a time that works.

If you would rather not hear from me about this booking, reply to this email with the word unsubscribe and I will remove your details. Our privacy policy is at www.communitycarephysio.co.uk/#privacy.

Kind regards,

Zakery Shelley
Physiotherapist
Community Care Physio
Home Visit Physiotherapy · South West London
T: 07508 401627
E: infoccphysio@gmail.com
W: www.communitycarephysio.co.uk`;
  const e = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const html = `<div style="font-family:Arial,sans-serif;max-width:560px;font-size:14px;line-height:1.7;color:#1a1f1d">
    <p>Hi ${e(first)},</p>
    <p>A booking was started on the Community Care Physio website for <strong>${e(what)}</strong> but the payment was not completed, so the appointment is not yet reserved.</p>
    <p>If you would still like the visit, ${finish}</p>
    <p><a href="${e(url)}" style="display:inline-block;background:#1e4d3b;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:bold">Finish my booking</a></p>
    <p>${validity}If the time no longer suits, or you would rather talk it through first, reply to this email or call or WhatsApp me on 07508 401627 and I will find a time that works.</p>
    <p style="font-size:12px;color:#5a6560">If you would rather not hear from me about this booking, reply to this email with the word unsubscribe and I will remove your details. Our <a href="https://www.communitycarephysio.co.uk/#privacy" style="color:#1e4d3b">privacy policy</a> explains how we use your details.</p>
    <p>Kind regards,<br><br><strong>Zakery Shelley</strong><br>Physiotherapist<br>Community Care Physio<br>Home Visit Physiotherapy · South West London<br>T: 07508 401627<br>E: infoccphysio@gmail.com<br>W: www.communitycarephysio.co.uk</p></div>`;
  const subject = followUp ? 'Still thinking about your booking? Community Care Physio' : 'Would you like to finish your booking? Community Care Physio';
  // Gmail and Apple Mail show their own Unsubscribe link from this header (UK PECR opt out).
  const headers = { 'List-Unsubscribe': '<mailto:infoccphysio@gmail.com?subject=unsubscribe>' };
  return { subject, text, html, headers };
}
