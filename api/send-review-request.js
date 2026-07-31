// api/send-review-request.js
// Sends a polite Google review request from the protected admin portal.

import nodemailer from 'nodemailer';
import { verifyAdminToken } from '../lib/adminAuth.js';

const FROM_EMAIL = 'infoccphysio@gmail.com';
const REVIEW_LINK = 'https://www.communitycarephysio.co.uk/review';

function htmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://communitycarephysio.co.uk');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { token, to, name, personalMessage } = req.body || {};

  if (!verifyAdminToken(token)) {
    return res.status(401).json({ error: 'Unauthorised' });
  }

  const recipient = String(to || '').trim();
  if (!validEmail(recipient)) {
    return res.status(400).json({ error: 'Please provide a valid recipient email address.' });
  }

  if (!process.env.GMAIL_APP_PASSWORD) {
    return res.status(500).json({
      error: 'Email is not configured on the server. GMAIL_APP_PASSWORD is missing.'
    });
  }

  const fullName = String(name || 'there').trim() || 'there';
  const firstName = fullName === 'there' ? 'there' : fullName.split(/\s+/)[0];
  const optionalMessage = String(personalMessage || '').trim().slice(0, 1200);
  const subject = 'Could you share your experience with Community Care Physio?';

  const text = `Dear ${firstName},

Thank you for choosing Community Care Physio. I hope you found the support you received helpful.${optionalMessage ? `\n\n${optionalMessage}` : ''}

If you have a moment, I would be very grateful if you could leave a short Google review. Your feedback helps other people find the service and helps us continue to improve.

Leave a review here:
${REVIEW_LINK}

There is no obligation, and please only include information you are comfortable making public.

Kind regards,

Zakery Shelley
Community Care Physio
https://www.communitycarephysio.co.uk/
infoccphysio@gmail.com
07508 401627`;

  const personalHtml = optionalMessage
    ? `<p style="margin:0 0 18px;color:#586860;line-height:1.65">${htmlEscape(optionalMessage).replace(/\n/g, '<br>')}</p>`
    : '';

  const html = `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:24px;background:#f8f5f0;font-family:Arial,sans-serif;color:#1a1f1d">
    <div style="max-width:580px;margin:0 auto;background:#ffffff;border:1px solid #e8f2ee;border-radius:14px;overflow:hidden">
      <div style="background:#1e4d3b;padding:24px 28px">
        <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:600">Community Care Physio</h1>
        <p style="margin:5px 0 0;color:#b9d0c5;font-size:12px;letter-spacing:.08em;text-transform:uppercase">South West London</p>
      </div>
      <div style="padding:28px">
        <p style="margin:0 0 18px;font-size:15px">Dear ${htmlEscape(firstName)},</p>
        <p style="margin:0 0 18px;color:#586860;line-height:1.65">Thank you for choosing Community Care Physio. I hope you found the support you received helpful.</p>
        ${personalHtml}
        <p style="margin:0 0 20px;color:#586860;line-height:1.65">If you have a moment, I would be very grateful if you could leave a short Google review. Your feedback helps other people find the service and helps us continue to improve.</p>
        <div style="text-align:center;margin:24px 0">
          <a href="${REVIEW_LINK}" style="display:inline-block;background:#1e4d3b;color:#ffffff;text-decoration:none;padding:13px 24px;border-radius:999px;font-size:14px;font-weight:600">Leave a Google review</a>
        </div>
        <p style="margin:20px 0 0;font-size:12px;color:#8aab97;line-height:1.55">There is no obligation, and please only include information you are comfortable making public.</p>
        <div style="margin-top:24px;padding-top:18px;border-top:1px solid #e8f2ee;color:#586860;font-size:13px;line-height:1.6">
          Kind regards,<br><br>
          <strong style="color:#1e4d3b">Zakery Shelley</strong><br>
          Community Care Physio<br>
          <a href="https://www.communitycarephysio.co.uk/" style="color:#1e4d3b">communitycarephysio.co.uk</a><br>
          <a href="mailto:infoccphysio@gmail.com" style="color:#1e4d3b">infoccphysio@gmail.com</a><br>
          07508 401627
        </div>
      </div>
    </div>
  </body>
</html>`;

  try {
    const transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: {
        user: FROM_EMAIL,
        pass: process.env.GMAIL_APP_PASSWORD
      }
    });

    await transporter.sendMail({
      from: `Community Care Physio <${FROM_EMAIL}>`,
      to: recipient,
      replyTo: FROM_EMAIL,
      subject,
      text,
      html
    });

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('send-review-request error:', error);
    return res.status(502).json({
      error: `The review email could not be sent: ${error?.message || 'email service error'}`
    });
  }
}
