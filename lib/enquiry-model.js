export const DETAIL_KEYS = ['name','address','postcode','email','phone','channel','needs','goals','approach','date','time','amount'];
export const DRAFT_KEYS = ['subject','intro','payment','confirmation'];
export function cleanEnquiry(input) {
  const details = {}, drafts = {};
  for (const key of DETAIL_KEYS) {
    const raw = input.details?.[key] ?? '';
    if (typeof raw !== 'string' || raw.length > 2500) throw new Error('Check the enquiry details (maximum 2,500 characters per field).');
    details[key] = raw.trim();
  }
  for (const key of DRAFT_KEYS) {
    const raw = input.drafts?.[key] ?? '';
    if (typeof raw !== 'string' || raw.length > 8000) throw new Error('Drafts must be shorter than 8,000 characters.');
    drafts[key] = raw.trim();
  }
  if (!details.name || details.name.length > 150) throw new Error('Enter a patient name (up to 150 characters).');
  if (!['email','whatsapp'].includes(details.channel)) throw new Error('Choose email or WhatsApp.');
  if (details.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(details.email)) throw new Error('Check the email address.');
  if (details.phone && !normalisePhone(details.phone)) throw new Error('Check the mobile number, including its country code.');
  if (details.date && (!/^\d{4}-\d{2}-\d{2}$/.test(details.date) || !Number.isFinite(Date.parse(details.date)) || new Date(details.date).toISOString().slice(0,10) !== details.date)) throw new Error('Check the appointment date.');
  if (details.time && (!/^([01]\d|2[0-2]):(00|30)$/.test(details.time) || details.time > '22:00')) throw new Error('Choose a half-hour appointment start no later than 22:00.');
  if (details.amount && (!/^\d+$/.test(details.amount) || +details.amount < 10 || +details.amount > 5000)) throw new Error('Enter a whole-pound fee between £10 and £5,000.');
  return { details, drafts };
}
export function normalisePhone(value) {
  let n = String(value || '').replace(/[\s().-]/g, '');
  if (n.startsWith('00')) n = '+' + n.slice(2);
  if (/^07\d{9}$/.test(n)) n = '+44' + n.slice(1);
  if (/^44\d{10}$/.test(n)) n = '+' + n;
  return /^\+[1-9]\d{7,14}$/.test(n) ? n.slice(1) : '';
}
export function validateSent(record, kind, channel) {
  if (!DRAFT_KEYS.slice(1).includes(kind) || !['email','whatsapp'].includes(channel)) throw new Error('Choose a valid message and channel.');
  if (!record.drafts?.[kind]) throw new Error('Save a message draft first.');
  if (channel === 'email' && !record.details.email) throw new Error('Enter an email address first.');
  if (channel === 'whatsapp' && !normalisePhone(record.details.phone)) throw new Error('Enter a mobile number first.');
  if (kind === 'payment' && (!record.payment_url || !record.drafts.payment.includes(record.payment_url))) throw new Error('The message must contain the current payment link.');
}
