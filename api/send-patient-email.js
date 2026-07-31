import nodemailer from 'nodemailer';
import { verifyAdminToken } from '../lib/adminAuth.js';

const FROM_EMAIL = 'infoccphysio@gmail.com';
const REVIEW_LINK = 'https://www.communitycarephysio.co.uk/review';

function esc(value) {
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

function money(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n.toFixed(2).replace(/\.00$/, '') : '0';
}

function dateLabel(date) {
  if (!date) return 'the scheduled date';
  const d = new Date(`${date}T12:00:00`);
  return Number.isNaN(d.getTime())
    ? String(date)
    : d.toLocaleDateString('en-GB', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      });
}

function firstNameFrom(name) {
  const fullName = String(name || 'there').trim() || 'there';
  return fullName === 'there' ? 'there' : fullName.split(/\s+/)[0];
}

function reviewEmail(body) {
  const firstName = firstNameFrom(body.name);
  const optionalMessage = String(body.personalMessage || '').trim().slice(0, 1200);
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
    ? `<p style="margin:0 0 18px;color:#586860;line-height:1.65">${esc(optionalMessage).replace(/\n/g, '<br>')}</p>`
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
        <p style="margin:0 0 18px;font-size:15px">Dear ${esc(firstName)},</p>
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

  return { subject, text, html };
}

function dnaEmail(body) {
  const firstName = firstNameFrom(body.name);
  const appointment = String(body.label || 'physiotherapy appointment').trim().slice(0, 180);
  const when = `${dateLabel(body.date)}${body.time ? ` at ${String(body.time).slice(0, 5)}` : ''}`;
  const requestedKind = ['package', 'single_paid', 'unpaid'].includes(body.type) ? body.type : 'single_paid';
  const looksLikePackageFollowUp = /\b(?:package|programme|block)\b/i.test(appointment)
    || /\bfollow[\s-]*up\s*(?:appointment|session)?\s*#?\d+\b/i.test(appointment)
    || /\bsession\s*#?\d+\s*(?:of|\/)\s*\d+\b/i.test(appointment);
  const kind = requestedKind === 'single_paid' && looksLikePackageFollowUp ? 'package' : requestedKind;
  const extraText = String(body.extra || '').trim().slice(0, 1200);

  let detail;
  if (kind === 'package') {
    detail = 'As this appointment formed part of your prepaid follow-up block or programme, no refund or additional charge applies. The missed appointment has been counted as a used follow-up appointment within the block and cannot be carried over.';
  } else if (kind === 'unpaid') {
    detail = `In line with the cancellation and missed-appointment policy, a fee of £${money(body.fee || 50)} is due for the reserved appointment time. Please contact us so that payment or any exceptional circumstances can be discussed.`;
  } else {
    const refundText = body.refundStatus === 'completed'
      ? `a partial refund of £${money(body.refund)} has been returned to the original payment method`
      : `a partial refund of £${money(body.refund)} will be returned to the original payment method`;
    detail = `In line with the cancellation and missed-appointment policy, a fee of £${money(body.fee || 50)} applies. As £${money(body.gross)} was originally paid, ${refundText}. Refunds processed through Stripe may take 5–10 working days to appear, depending on your bank.`;
  }

  const consideration = extraText || 'Please get in touch if there were exceptional circumstances that you would like us to consider.';
  const subject = 'Missed physiotherapy appointment — Community Care Physio';
  const text = `Dear ${firstName},

I’m writing regarding your ${appointment} scheduled for ${when}, which was recorded as a missed appointment.

${detail}

${consideration}

Kind regards,

Zakery Shelley
Community Care Physio
https://www.communitycarephysio.co.uk/
infoccphysio@gmail.com
07508 401627`;

  const html = `<!doctype html><html lang="en"><body style="margin:0;padding:24px;background:#f8f5f0;font-family:Arial,sans-serif;color:#1a1f1d"><div style="max-width:580px;margin:0 auto;background:#fff;border:1px solid #e8f2ee;border-radius:14px;overflow:hidden"><div style="background:#1e4d3b;padding:24px 28px"><h1 style="margin:0;color:#fff;font-size:22px">Community Care Physio</h1><p style="margin:5px 0 0;color:#b9d0c5;font-size:12px;letter-spacing:.08em;text-transform:uppercase">Missed appointment notice</p></div><div style="padding:28px"><p>Dear ${esc(firstName)},</p><p style="color:#586860;line-height:1.65">I’m writing regarding your ${esc(appointment)} scheduled for ${esc(when)}, which was recorded as a missed appointment.</p><div style="margin:20px 0;padding:14px 16px;background:#fffbeb;border:1px solid #fde68a;border-radius:10px;color:#92400e;line-height:1.65">${esc(detail)}</div><p style="color:#586860;line-height:1.65">${esc(consideration).replace(/\n/g, '<br>')}</p><div style="margin-top:24px;padding-top:18px;border-top:1px solid #e8f2ee;color:#586860;font-size:13px;line-height:1.6">Kind regards,<br><br><strong style="color:#1e4d3b">Zakery Shelley</strong><br>Community Care Physio<br><a href="https://www.communitycarephysio.co.uk/" style="color:#1e4d3b">communitycarephysio.co.uk</a><br><a href="mailto:infoccphysio@gmail.com" style="color:#1e4d3b">infoccphysio@gmail.com</a><br>07508 401627</div></div></div></body></html>`;

  return { subject, text, html };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://communitycarephysio.co.uk');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = req.body || {};
  if (!verifyAdminToken(body.token)) return res.status(401).json({ error: 'Unauthorised' });

  const recipient = String(body.to || '').trim();
  if (!validEmail(recipient)) {
    return res.status(400).json({ error: 'Please provide a valid recipient email address.' });
  }

  if (!process.env.GMAIL_APP_PASSWORD) {
    return res.status(500).json({ error: 'Email is not configured on the server. GMAIL_APP_PASSWORD is missing.' });
  }

  const emailType = body.emailType === 'dna' ? 'dna' : body.emailType === 'review' ? 'review' : '';
  if (!emailType) {
    return res.status(400).json({ error: 'Unknown email type.' });
  }

  const message = emailType === 'dna' ? dnaEmail(body) : reviewEmail(body);

  try {
    const transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user: FROM_EMAIL, pass: process.env.GMAIL_APP_PASSWORD }
    });

    await transporter.sendMail({
      from: `Community Care Physio <${FROM_EMAIL}>`,
      to: recipient,
      replyTo: FROM_EMAIL,
      subject: message.subject,
      text: message.text,
      html: message.html
    });

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('send-patient-email error:', {
      emailType,
      message: error?.message || String(error)
    });
    return res.status(502).json({
      error: emailType === 'dna'
        ? `The DNA notice could not be sent: ${error?.message || 'email service error'}`
        : `The review email could not be sent: ${error?.message || 'email service error'}`
    });
  }
}
