// api/send-reminders.js
// ---------------------------------------------------------------------------
// ONE function, TWO jobs (keeps you within Vercel Hobby's 12-function limit):
//
//   • GET  → the automated daily reminder cron (vercel.json runs this at 08:00).
//            Finds every appointment scheduled for TOMORROW (UK time) — both
//            standalone bookings and package follow-ups inside custom_sessions —
//            emails the patient, marks package sessions reminderSent=true so they
//            are never double-sent, and emails Zakery a short digest of the day.
//
//   • POST → the admin "Send now" button (single reminder, on demand). Requires
//            a valid admin session token. The website's button posts here.
//
// Stack: ES module · Supabase (../lib/supabase.js) · Gmail SMTP via Nodemailer
//        using process.env.GMAIL_APP_PASSWORD · sends from infoccphysio@gmail.com.
//
// Optional security: if you add a CRON_SECRET environment variable in Vercel,
// this file will require it on the GET cron (Vercel sends it automatically as a
// Bearer token). If CRON_SECRET is not set, the cron still runs (open GET).
// ---------------------------------------------------------------------------

import { supabase } from '../lib/supabase.js';
import { verifyAdminToken } from '../lib/adminAuth.js';
import nodemailer from 'nodemailer';

const FROM_EMAIL = 'infoccphysio@gmail.com';
const ADMIN_EMAIL = 'infoccphysio@gmail.com';

const SIGNATURE =
`Kind regards,

Zakery Shelley
Community Care Physio
🌐 https://www.communitycarephysio.co.uk/
📧 infoccphysio@gmail.com
📞 07508 401627`;

const ACTIVE = ['scheduled', 'confirmed', 'pending', 'paid', 'prepaid'];
const DEAD = ['cancelled', 'expired', 'completed', 'dna', 'rescheduled', 'refunded'];

function ukDate(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(d);
}
function fmtTime(t) {
  if (!t) return '';
  const [h, m] = String(t).split(':').map(Number);
  if (Number.isNaN(h)) return String(t);
  const ap = h >= 12 ? 'pm' : 'am';
  const h12 = h % 12 || 12;
  return m ? `${h12}:${String(m).padStart(2, '0')}${ap}` : `${h12}${ap}`;
}
function fmtDate(dstr) {
  const d = new Date(`${dstr}T12:00:00`);
  return Number.isNaN(d.getTime())
    ? String(dstr)
    : d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
}
function firstName(name) {
  return String(name || 'there').trim().split(/\s+/)[0] || 'there';
}
function makeTransport() {
  return nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 465, secure: true,
    auth: { user: FROM_EMAIL, pass: process.env.GMAIL_APP_PASSWORD }
  });
}
function patientText(first, whenLine, address, postcode) {
  return `Dear ${first},

This is a reminder of your upcoming physiotherapy appointment with Community Care Physio:

${whenLine}${address ? `

Address on file: ${address}${postcode ? ', ' + postcode : ''}` : ''}

Please wear comfortable clothing, and have any relevant letters, scan results or x-rays to hand.

Should you need to rearrange, please reply to this email or contact us on WhatsApp at your earliest convenience. Please note that cancellations within 24 hours may be subject to a £50 fee.

We look forward to seeing you.

${SIGNATURE}`;
}
async function sendMail(to, subject, text) {
  await makeTransport().sendMail({
    from: `Community Care Physio <${FROM_EMAIL}>`,
    to, replyTo: FROM_EMAIL, subject, text
  });
}
function parseSessions(raw) {
  if (!raw) return null;
  try { return typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (_) { return null; }
}

async function handleManual(req, res, body) {
  if (!verifyAdminToken(body.token)) {
    return res.status(401).json({ error: 'Unauthorised — admin session invalid or expired. Sign out and back in, then try again.' });
  }
  const { to, name, label, date, time, address, postcode } = body;
  if (!to) return res.status(400).json({ error: 'No recipient email address was provided for this patient.' });
  if (!process.env.GMAIL_APP_PASSWORD) {
    return res.status(500).json({ error: 'Email is not configured on the server (GMAIL_APP_PASSWORD is missing).' });
  }
  const whenLine = date
    ? `• ${fmtDate(date)}${time ? ' at ' + fmtTime(time) : ''}${label ? ' — ' + label : ''}`
    : (label || 'your upcoming appointment');
  try {
    await sendMail(to, 'Appointment reminder — Community Care Physio',
      patientText(firstName(name), whenLine, address, postcode));
    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(502).json({ error: 'Email send failed: ' + (err && err.message ? err.message : 'unknown SMTP error') + '. Check GMAIL_APP_PASSWORD.' });
  }
}

async function handleCron(req, res) {
  if (!process.env.GMAIL_APP_PASSWORD) {
    return res.status(500).json({ error: 'GMAIL_APP_PASSWORD is missing in Vercel environment variables.' });
  }
  const today = ukDate(0);
  const tomorrow = ukDate(1);

  let bookings;
  try {
    const { data, error } = await supabase.from('bookings').select('*');
    if (error) throw error;
    bookings = data || [];
  } catch (err) {
    console.error('send-reminders cron: DB read failed', err);
    return res.status(500).json({ error: 'Database read failed' });
  }

  const tomorrowDigest = []; // for Zakery: name / time / type
  const noEmail = [];        // patients we could not email
  const errors = [];
  let patientsSent = 0;

  // ---- TOMORROW: send the patient their reminder (day before, outside the
  //      24-hour window), mark it sent, and collect a line for Zakery. ----
  for (const b of bookings) {
    try {
      const name = b.name || 'there';
      const email = String(b.email || '').trim();
      const address = b.address || '';
      const postcode = b.postcode || '';
      const status = String(b.status || '').toLowerCase();

      const hits = [];
      if (b.booked_date === tomorrow && !DEAD.includes(status)) {
        hits.push({ label: b.appointment || 'Appointment', time: b.booked_time || b.preferred_time || '', sessionIndex: null });
      }
      const sessions = parseSessions(b.custom_sessions);
      if (Array.isArray(sessions)) {
        sessions.forEach((s, idx) => {
          if (!s) return;
          const st = String(s.status || '').toLowerCase();
          if (s.date === tomorrow && ACTIVE.includes(st) && !s.reminderOff && !s.reminderSent) {
            hits.push({ label: s.label || 'Follow-up appointment', time: s.time || '', sessionIndex: idx });
          }
        });
      }
      if (!hits.length) continue;

      const marked = [];
      for (const h of hits) {
        if (email) {
          const whenLine = `• ${fmtDate(tomorrow)}${h.time ? ' at ' + fmtTime(h.time) : ''} — ${h.label}`;
          await sendMail(email, 'Appointment reminder — Community Care Physio',
            patientText(firstName(name), whenLine, address, postcode));
          patientsSent++;
          if (h.sessionIndex != null) marked.push(h.sessionIndex);
        } else {
          noEmail.push(`${name} — ${fmtTime(h.time) || 'time TBC'} (${h.label})`);
        }
        tomorrowDigest.push(`${name} · ${fmtTime(h.time) || 'time TBC'} · ${h.label}`);
      }

      if (Array.isArray(sessions) && marked.length) {
        marked.forEach(i => { if (sessions[i]) sessions[i].reminderSent = true; });
        try {
          const { error } = await supabase.from('bookings').update({ custom_sessions: sessions }).eq('id', b.id);
          if (error) throw error;
        } catch (e) {
          errors.push(`mark ${b.id}: ${e && e.message ? e.message : e}`);
        }
      }
    } catch (err) {
      errors.push(`${b && b.id}: ${err && err.message ? err.message : err}`);
    }
  }

  // ---- TODAY: heads-up for Zakery only (patients were reminded yesterday). ----
  const todayDigest = [];
  for (const b of bookings) {
    const name = b.name || 'there';
    const status = String(b.status || '').toLowerCase();
    if (b.booked_date === today && !DEAD.includes(status)) {
      todayDigest.push(`${name} · ${fmtTime(b.booked_time || b.preferred_time || '') || 'time TBC'} · ${b.appointment || 'Appointment'}`);
    }
    const sessions = parseSessions(b.custom_sessions);
    if (Array.isArray(sessions)) {
      sessions.forEach(s => {
        if (!s) return;
        const st = String(s.status || '').toLowerCase();
        if (s.date === today && ACTIVE.includes(st)) {
          todayDigest.push(`${name} · ${fmtTime(s.time) || 'time TBC'} · ${s.label || 'Follow-up appointment'}`);
        }
      });
    }
  }

  // ---- Email Zakery ONLY when there is actually something on (no empty spam). ----
  try {
    if (tomorrowDigest.length) {
      const lines = [`You have ${tomorrowDigest.length} appointment${tomorrowDigest.length > 1 ? 's' : ''} tomorrow (${fmtDate(tomorrow)}):`, ''];
      tomorrowDigest.forEach(x => lines.push('  • ' + x));
      if (noEmail.length) { lines.push('', 'No email on file — please remind these patients manually:'); noEmail.forEach(x => lines.push('  • ' + x)); }
      if (errors.length) { lines.push('', 'Errors during the run:'); errors.forEach(x => lines.push('  • ' + x)); }
      lines.push('', '— Community Care Physio reminder system');
      await sendMail(ADMIN_EMAIL, `Tomorrow's appointments — ${fmtDate(tomorrow)}`, lines.join('\n'));
    }
  } catch (e) { console.error('send-reminders: tomorrow digest failed', e && e.message); }

  try {
    if (todayDigest.length) {
      const lines = [`You have ${todayDigest.length} appointment${todayDigest.length > 1 ? 's' : ''} today (${fmtDate(today)}):`, ''];
      todayDigest.forEach(x => lines.push('  • ' + x));
      lines.push('', '— Community Care Physio reminder system');
      await sendMail(ADMIN_EMAIL, `Today's appointments — ${fmtDate(today)}`, lines.join('\n'));
    }
  } catch (e) { console.error('send-reminders: today digest failed', e && e.message); }

  return res.status(200).json({
    ok: true, today, tomorrow,
    patientsSent, tomorrowCount: tomorrowDigest.length, todayCount: todayDigest.length,
    missingEmail: noEmail.length, errors: errors.length
  });
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    if (process.env.CRON_SECRET) {
      const auth = req.headers['authorization'] || '';
      if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
        return res.status(401).json({ error: 'Unauthorised cron request' });
      }
    }
    return handleCron(req, res);
  }

  if (req.method === 'POST') {
    let body = req.body;
    if (!body || typeof body === 'string') {
      try { body = JSON.parse(body || '{}'); } catch (_) { body = {}; }
    }
    return handleManual(req, res, body || {});
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
}
