// api/send-review-request.js
// Sends a polite Google review request from the protected admin portal.

import nodemailer from 'nodemailer';
import { verifyAdminToken } from '../lib/adminAuth.js';

const FROM_EMAIL = 'infoccphysio@gmail.com';
const REVIEW_LINK = 'https://g.page/r/CTNprE1O874TEBM/review';
const QR_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAXIAAAFyAQAAAADAX2ykAAACZUlEQVR4nO2bQY6kMAxFnwcklkHiAHOUcLU6Ut8AjlIHaIksSwryLJLQTPW0plpD05WRs0CEvMWXItuxHUT5zJh/fAoH44033njjjTf+I17yaIEgwtyDjKFFxlDWxhP1GH8Uj6qq4lVVdWm0jEh+Kd8SMj2bfuMf40O20GK1ncrIKgBkwz5Vj/Ffxbub6KVfhVk6lfHb9Rh/KD9Ll3wxXm/y/XqM/ye+OF6nQABwr4J/6YEwKATYl0CeTb/xD/GziIj0gL92CjRpU2VkTcfnc/UYfxCf7Pd9kXIVcBG9X3s2/cb/ZeTkZwGgUZ1c/POCWn5UIb/Lf8FtCe/S7M3WW/5bOx9a8NcW5p8RkX4VnVyudACg06l6jD+Gz/aLU9XJZYdcqlYR/NJoisTmn2vktzCbHbJO6ds+COtk8bdWvtgv2UyLwWp5gMXfivnNP0fYNjnFWr+1Fuz8XD0futI1erNfQEZgX6l8Vv3GfzB25ytd9uFYp505m/1Wym/5b8ynKq/7kRi/NBZ/6+RLfyEMKtAoc//aKqwtuAX8yxD3TYZn02/8g/wq4G67Jj9+WUWnsnC2HuMP5Z1qql9t+ZFepFORfrvTcaoe44/hUb0PuI3m/OitMF2mFn9r41P8Ld63iUoY0nve1jBEoIkn6TH+S/h0al4gO2Snmm7KppqWRmQ8U4/xB/Pl/iR+WQV/FUkxeRYRCK31j/4bPlc1ZGSVZNiXfrX77XXy7f2HuUcg9GUehihg+W+l/Lv/F9L9HPdb63ey/m+t/NYfBLJrztPS+mXXSbL9rY0X+7/beOONN95440/nfwHaZ+rijIJvEwAAAABJRU5ErkJggg==';

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

  // Bundle the QR code directly with the server function so every review
  // email contains it, even if the public image URL is temporarily cached or unavailable.
  const qrAttachment = {
    filename: 'community-care-physio-review-qr.png',
    content: Buffer.from(QR_BASE64, 'base64'),
    cid: 'ccp-google-review-qr'
  };

  const personalHtml = optionalMessage
    ? `<p style="margin:0 0 18px;color:#586860;line-height:1.65">${htmlEscape(optionalMessage).replace(/\n/g, '<br>')}</p>`
    : '';

  const qrHtml = qrAttachment
    ? `<div style="text-align:center;margin:22px 0 8px">
         <img src="cid:ccp-google-review-qr" width="155" height="155" alt="QR code for the Community Care Physio Google review page" style="display:inline-block;width:155px;height:155px;border:1px solid #e8f2ee;border-radius:10px;padding:8px;background:#ffffff">
         <p style="font-size:12px;color:#8aab97;margin:8px 0 0">Or scan this QR code with your phone.</p>
       </div>`
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
        ${qrHtml}
        <p style="margin:20px 0 0;font-size:12px;color:#8aab97;line-height:1.55">There is no obligation, and please only include information you are comfortable making public.</p>
        <div style="margin-top:24px;padding-top:18px;border-top:1px solid #e8f2ee;color:#586860;font-size:13px;line-height:1.6">
          Kind regards,<br>
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
      html,
      attachments: qrAttachment ? [qrAttachment] : []
    });

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('send-review-request error:', error);
    return res.status(502).json({
      error: `The review email could not be sent: ${error?.message || 'email service error'}`
    });
  }
}
