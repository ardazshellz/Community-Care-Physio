// api/send-reminder-now.js
// ---------------------------------------------------------------------------
// Sends a single appointment-reminder email on demand (the admin "Send now"
// button). This is the endpoint the site was calling at /api/send-reminder-now
// which returned 404 because the file did not exist. Upload this file into your
// existing `api/` folder (alongside get-bookings.js etc.) and redeploy.
//
// Stack match:
//   • Node serverless function on Vercel
//   • Gmail SMTP via Nodemailer, using process.env.GMAIL_APP_PASSWORD
//   • Sends from infoccphysio@gmail.com
//
// ⚠ AUTH — READ THIS:
// Your other admin endpoints (e.g. get-bookings.js) verify the admin session
// `token`. This file ships with a common HMAC verification, but if your
// admin-login.js signs tokens differently it will reject with 401. The safest
// move: copy the EXACT token-check block from your get-bookings.js into
// `verifyAdminToken()` below so it matches byte-for-byte. If you paste me your
// get-bookings.js / admin-login.js I will align it for you in seconds.
// ---------------------------------------------------------------------------

const crypto = require('crypto');
const nodemailer = require('nodemailer');

const FROM_EMAIL = 'infoccphysio@gmail.com';

const SIGNATURE =
`Kind regards,
Zakery Shelley
Community Care Physio
🌐 https://www.communitycarephysio.co.uk/
📧 infoccphysio@gmail.com
📞 07508 401627`;

// --- Admin token verification --------------------------------------------
// Tries a stateless HMAC check against a few likely secret env vars and the two
// most common token layouts ("sig.expiry" and "expiry.sig"). Replace the body
// with your real check if your login signs tokens another way.
function verifyAdminToken(token) {
  if (!token || typeof token !== 'string' || token.indexOf('.') === -1) return false;
  const secrets = [
    process.env.ADMIN_TOKEN_SECRET,
    process.env.ADMIN_PASSWORD_HASH,
    process.env.SESSION_SECRET,
    process.env.ADMIN_PASSWORD
  ].filter(Boolean);
  if (!secrets.length) return false;

  const parts = token.split('.');
  // Candidate (payload, signature) pairs for the two common orderings.
  const candidates = [
    { payload: parts[0], sig: parts[1] },
    { payload: parts[1], sig: parts[0] }
  ];
  for (const secret of secrets) {
    for (const c of candidates) {
      if (!c.payload || !c.sig) continue;
      // Expiry check when the payload is a millisecond timestamp.
      const asNum = Number(c.payload);
      if (!Number.isNaN(asNum) && asNum > 1000000000000 && asNum < Date.now()) continue; // expired
      const expected = crypto.createHmac('sha256', secret).update(String(c.payload)).digest('hex');
      try {
        if (expected.length === c.sig.length &&
            crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(c.sig))) {
          return true;
        }
      } catch (_) { /* length mismatch → not this format */ }
    }
  }
  return false;
}

function esc(s) { return String(s == null ? '' : s); }

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed — use POST.' });
    return;
  }

  // Vercel usually parses JSON bodies; fall back to manual parse just in case.
  let body = req.body;
  if (!body || typeof body === 'string') {
    try { body = JSON.parse(body || '{}'); } catch (_) { body = {}; }
  }

  const { token, to, name, label, date, time, address, postcode, phone, reason } = body || {};

  if (!verifyAdminToken(token)) {
    res.status(401).json({ error: 'Unauthorised — admin session invalid or expired. Sign out and back in, then try again.' });
    return;
  }
  if (!to) {
    res.status(400).json({ error: 'No recipient email address was provided for this patient.' });
    return;
  }
  if (!process.env.GMAIL_APP_PASSWORD) {
    res.status(500).json({ error: 'Email is not configured on the server (GMAIL_APP_PASSWORD is missing in Vercel environment variables).' });
    return;
  }

  const first = (name || 'there').split(' ')[0];
  const whenLine = date
    ? `• ${date}${time ? ' at ' + time : ''}`
    : (label || 'your upcoming appointment');

  const subject = 'Appointment reminder — Community Care Physio';
  const text =
`Dear ${first},

This is a reminder of your upcoming physiotherapy appointment with Community Care Physio:

${whenLine}${address ? `

Address on file: ${esc(address)}${postcode ? ', ' + esc(postcode) : ''}` : ''}

Please wear comfortable clothing, and have any relevant letters, scan results or x-rays to hand.

Should you need to rearrange, please reply to this email or contact us on WhatsApp at your earliest convenience. Please note that cancellations within 24 hours may be subject to a £50 fee.

We look forward to seeing you.

${SIGNATURE}`;

  try {
    const transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user: FROM_EMAIL, pass: process.env.GMAIL_APP_PASSWORD }
    });

    await transporter.sendMail({
      from: `Community Care Physio <${FROM_EMAIL}>`,
      to,
      replyTo: FROM_EMAIL,
      subject,
      text
    });

    res.status(200).json({ ok: true });
  } catch (err) {
    // Surface a useful message to the admin UI instead of a bare 500.
    res.status(502).json({ error: 'Email send failed: ' + (err && err.message ? err.message : 'unknown SMTP error') + '. Check GMAIL_APP_PASSWORD and that the Gmail account allows app passwords.' });
  }
};
