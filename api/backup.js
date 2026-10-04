// api/backup.js
// ---------------------------------------------------------------------------
// Nightly export of the practice data (vercel.json cron, 03:00 UTC).
// Dumps practice_records, bookings and blocked_slots to JSON, encrypts it with
// AES-256-GCM under BACKUP_SECRET, and emails the file to the practice inbox so
// a Supabase problem cannot lose the outcomes register, referrals or invoices.
// Restore: node tools/decrypt-backup.mjs <file.json.enc>  (needs BACKUP_SECRET).
//
// Required env: CRON_SECRET (Vercel sends it as a Bearer token), BACKUP_SECRET
// (any long passphrase; the same value decrypts), GMAIL_APP_PASSWORD (mailer).
// ---------------------------------------------------------------------------
import { supabase } from '../lib/supabase.js';
import { sendMail, FROM_EMAIL } from '../lib/mailer.js';
import { encrypt } from '../lib/backup-crypto.js';

const TABLES = ['practice_records', 'bookings', 'blocked_slots'];

async function dump(table) {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase.from(table).select('*').range(offset, offset + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...data);
    if (data.length < 1000) break;
  }
  return rows;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!process.env.CRON_SECRET) return res.status(503).json({ error: 'CRON_SECRET is not configured' });
  if ((req.headers['authorization'] || '') !== `Bearer ${process.env.CRON_SECRET}`) return res.status(401).json({ error: 'Unauthorised' });
  if (!process.env.BACKUP_SECRET || process.env.BACKUP_SECRET.length < 16) return res.status(503).json({ error: 'BACKUP_SECRET is not configured (16+ characters)' });

  try {
    const tables = {};
    for (const t of TABLES) tables[t] = await dump(t);
    const date = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
    const json = JSON.stringify({ exportedAt: new Date().toISOString(), counts: Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.length])), tables });
    const file = encrypt(json, process.env.BACKUP_SECRET);
    const counts = Object.entries(tables).map(([k, v]) => `${k}: ${v.length}`).join(', ');
    await sendMail({
      to: FROM_EMAIL,
      subject: `Practice backup ${date}`,
      text: `Encrypted export of ${counts}.\n\nTo restore: node tools/decrypt-backup.mjs ccp-backup-${date}.json.enc (needs BACKUP_SECRET).\n\nAutomated message from the nightly cron.`,
      attachments: [{ filename: `ccp-backup-${date}.json.enc`, content: file, contentType: 'application/octet-stream' }]
    });
    return res.status(200).json({ ok: true, date, counts: Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.length])), bytes: file.length });
  } catch (error) {
    console.error('backup failed', error);
    return res.status(500).json({ error: 'Backup failed' });
  }
}
