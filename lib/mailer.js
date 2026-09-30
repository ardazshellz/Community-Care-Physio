export const FROM_EMAIL = 'infoccphysio@gmail.com';

// Formal Community Care Physio sign-off, shared by every email this endpoint sends.
export const SIGNATURE_TEXT = `Kind regards,

Zakery Shelley
Physiotherapist
Community Care Physio
Home Visit Physiotherapy · South West London
T: 07508 401627
E: infoccphysio@gmail.com
W: www.communitycarephysio.co.uk`;
export const SIGNATURE_HTML = 'Kind regards,<br><br><strong style="color:#1e4d3b;font-size:15px">Zakery Shelley</strong><br><strong>Physiotherapist</strong><br>Community Care Physio<br><span style="color:#8aab97">Home Visit Physiotherapy · South West London</span><br><br><strong>T:</strong> 07508 401627<br><strong>E:</strong> <a href="mailto:infoccphysio@gmail.com" style="color:#1e4d3b">infoccphysio@gmail.com</a><br><strong>W:</strong> <a href="https://www.communitycarephysio.co.uk/" style="color:#1e4d3b">www.communitycarephysio.co.uk</a><br><br><img src="https://www.communitycarephysio.co.uk/assets/email-signature.png" width="300" height="100" alt="Community Care Physio" style="display:block;border:0;border-radius:6px">';

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function textToHtml(text) {
  const linkify = (html) => html.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#1e4d3b">$1</a>');
  return String(text ?? '').split(/\n{2,}/)
    .map(p => `<p style="margin:0 0 16px;line-height:1.65">${linkify(esc(p)).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

export function wrapHtml(innerHtml) {
  return `<!doctype html><html lang="en"><body style="margin:0;padding:24px;background:#ffffff;font-family:Arial,sans-serif;font-size:14px;color:#1a1f1d"><div style="max-width:600px">${innerHtml}<div style="margin-top:24px;color:#586860;font-size:13px;line-height:1.6">${SIGNATURE_HTML}</div></div></body></html>`;
}

export async function sendMail({ to, subject, text, html, attachments, replyTo = FROM_EMAIL }) {
  const { default: nodemailer } = await import('nodemailer');
  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user: FROM_EMAIL, pass: process.env.GMAIL_APP_PASSWORD }
  });
  return transporter.sendMail({
    from: `Community Care Physio <${FROM_EMAIL}>`,
    to, subject, text, html, replyTo,
    ...(attachments?.length ? { attachments } : {})
  });
}
