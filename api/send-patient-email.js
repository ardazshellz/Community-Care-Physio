import { FROM_EMAIL, SIGNATURE_TEXT, SIGNATURE_HTML, sendMail, wrapHtml, textToHtml } from '../lib/mailer.js';
import { verifyAdminToken } from '../lib/adminAuth.js';

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

${SIGNATURE_TEXT}`;

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
          ${SIGNATURE_HTML}
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

${SIGNATURE_TEXT}`;

  const html = `<!doctype html><html lang="en"><body style="margin:0;padding:24px;background:#f8f5f0;font-family:Arial,sans-serif;color:#1a1f1d"><div style="max-width:580px;margin:0 auto;background:#fff;border:1px solid #e8f2ee;border-radius:14px;overflow:hidden"><div style="background:#1e4d3b;padding:24px 28px"><h1 style="margin:0;color:#fff;font-size:22px">Community Care Physio</h1><p style="margin:5px 0 0;color:#b9d0c5;font-size:12px;letter-spacing:.08em;text-transform:uppercase">Missed appointment notice</p></div><div style="padding:28px"><p>Dear ${esc(firstName)},</p><p style="color:#586860;line-height:1.65">I’m writing regarding your ${esc(appointment)} scheduled for ${esc(when)}, which was recorded as a missed appointment.</p><div style="margin:20px 0;padding:14px 16px;background:#fffbeb;border:1px solid #fde68a;border-radius:10px;color:#92400e;line-height:1.65">${esc(detail)}</div><p style="color:#586860;line-height:1.65">${esc(consideration).replace(/\n/g, '<br>')}</p><div style="margin-top:24px;padding-top:18px;border-top:1px solid #e8f2ee;color:#586860;font-size:13px;line-height:1.6">${SIGNATURE_HTML}</div></div></div></body></html>`;

  return { subject, text, html };
}

// Any admin-generated email (confirmation, payment link, cancellation, reminder,
// exercise programme, enquiry replies). The admin drafts the plain text; the
// sign-off is replaced with the branded signature so every email matches.
export function customEmail(body) {
  const subject = String(body.subject || '').trim();
  let text = String(body.body || '').replace(/\r\n/g, '\n').trim();
  if (!subject || subject.length > 200) return { error: 'Please provide a subject (max 200 characters).' };
  if (!text || text.length > 20000) return { error: 'Please provide an email body (max 20,000 characters).' };

  // Optional attachments (e.g. home exercise programme). Vercel caps request
  // bodies at ~4.5 MB, so keep the decoded total under 3 MB.
  const files = Array.isArray(body.attachments) ? body.attachments : [];
  if (files.length > 5) return { error: 'Attach up to 5 files.' };
  const allowed = /^(application\/pdf|image\/(png|jpeg)|application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document|application\/msword)$/;
  let total = 0;
  const attachments = [];
  for (const f of files) {
    const filename = String(f?.filename || '').replace(/[\\/\r\n]/g, '').slice(0, 120);
    const contentType = String(f?.contentType || '');
    const data = String(f?.data || '');
    if (!filename || !allowed.test(contentType) || !/^[A-Za-z0-9+/=]+$/.test(data)) {
      return { error: `Unsupported attachment: ${filename || 'unnamed file'}. Use PDF, Word, PNG or JPG.` };
    }
    const content = Buffer.from(data, 'base64');
    total += content.length;
    attachments.push({ filename, contentType, content });
  }
  if (total > 3 * 1024 * 1024) return { error: 'Attachments are too large (3 MB total maximum).' };

  // Drop any plain-text sign-off the draft already carries; the formal one is added below.
  const cut = text.lastIndexOf('Kind regards,');
  if (cut !== -1 && /Zakery/.test(text.slice(cut))) text = text.slice(0, cut).trim();

  const paragraphs = textToHtml(text);

  return {
    subject,
    attachments,
    text: `${text}\n\n${SIGNATURE_TEXT}`,
    html: wrapHtml(paragraphs)
  };
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
    return res.status(500).json({ error: 'Email is not configured on the server.' });
  }

  const emailType = ['dna', 'review', 'custom'].includes(body.emailType) ? body.emailType : '';
  if (!emailType) {
    return res.status(400).json({ error: 'Unknown email type.' });
  }

  const message = emailType === 'dna' ? dnaEmail(body) : emailType === 'review' ? reviewEmail(body) : customEmail(body);
  if (message.error) return res.status(400).json({ error: message.error });

  try {
    await sendMail({
      to: recipient,
      replyTo: FROM_EMAIL,
      subject: message.subject,
      text: message.text,
      html: message.html,
      ...(message.attachments?.length ? { attachments: message.attachments } : {})
    });

    return res.status(200).json({ success: true });
  } catch (error) {
    const code = typeof error?.code === 'string' && /^[a-z0-9_]{1,40}$/i.test(error.code) ? error.code : 'unknown';
    console.error('send-patient-email', { action: emailType, code });
    return res.status(502).json({
      error: `The ${emailType === 'dna' ? 'DNA notice' : emailType === 'review' ? 'review email' : 'email'} could not be sent. Please try again.`
    });
  }
}
