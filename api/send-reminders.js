// api/send-reminder-now.js
// Admin-triggered "Send reminder now" for a single appointment.
// Sends the SAME patient + clinician reminder emails as the automatic cron
// (send-reminders.js), immediately — useful when an appointment is added/edited
// after the 8am reminder run, so the automatic reminder can no longer fire.
// Protected by the signed admin session token.

import { supabase } from '../lib/supabase.js';
import { verifyAdminToken } from '../lib/adminAuth.js';
import * as nodemailer from 'nodemailer';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://communitycarephysio.co.uk');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    token, bookingId, sessionIndex,
    to, name, label, date, time, address, postcode, phone, reason
  } = req.body || {};

  if (!verifyAdminToken(token)) return res.status(401).json({ error: 'Unauthorised' });
  if (!to)   return res.status(400).json({ error: 'Missing patient email' });
  if (!date || !time) return res.status(400).json({ error: 'Missing appointment date/time' });

  if (!process.env.GMAIL_APP_PASSWORD) {
    return res.status(500).json({ error: 'Email not configured (GMAIL_APP_PASSWORD missing)' });
  }

  try {
    const transporter = nodemailer.default.createTransport({
      service: 'gmail',
      auth: { user: 'infoccphysio@gmail.com', pass: process.env.GMAIL_APP_PASSWORD }
    });

    const first = name ? String(name).split(' ')[0] : 'there';
    const apptLabel = label || 'Physiotherapy appointment';
    const formattedDate = new Date(date + 'T12:00:00')
      .toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

    // Patient reminder — identical template to the automatic cron.
    await transporter.sendMail({
      from: '"Community Care Physio" <infoccphysio@gmail.com>',
      replyTo: 'infoccphysio@gmail.com',
      to,
      subject: `Appointment reminder — ${formattedDate} at ${time}`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;color:#1a1f1d">
          <div style="background:#1e4d3b;padding:20px;border-radius:10px 10px 0 0">
            <h2 style="color:#fff;margin:0;font-size:18px">Community Care Physio</h2>
            <p style="color:rgba(255,255,255,.6);font-size:11px;margin:4px 0 0">Appointment reminder</p>
          </div>
          <div style="background:#fff;padding:24px;border:1px solid #e8f2ee;border-top:none">
            <h3 style="color:#1e4d3b;font-size:17px;margin:0 0 16px">Your upcoming appointment</h3>
            <p style="font-size:14px;color:#1a1f1d;margin:0 0 12px">Dear ${first},</p>
            <p style="font-size:13px;color:#586860;line-height:1.6;margin:0 0 16px">
              This is a reminder of your upcoming physiotherapy appointment. We look forward to seeing you.
            </p>
            <table style="margin:0 0 18px;font-size:13px;color:#586860;line-height:1.9">
              <tr><td style="padding-right:10px"><strong style="color:#1a1f1d">Appointment:</strong></td><td>${apptLabel}</td></tr>
              <tr><td style="padding-right:10px"><strong style="color:#1a1f1d">Date:</strong></td><td>${formattedDate}</td></tr>
              <tr><td style="padding-right:10px"><strong style="color:#1a1f1d">Time:</strong></td><td><strong style="color:#1e4d3b">${time}</strong></td></tr>
              ${address ? `<tr><td style="padding-right:10px;vertical-align:top"><strong style="color:#1a1f1d">Your address:</strong></td><td>${address}${postcode ? ', ' + postcode : ''}</td></tr>` : ''}
            </table>
            <p style="font-size:13px;color:#586860;line-height:1.6">
              Please wear comfortable clothing, and have any relevant letters, scan results or x-rays to hand.
            </p>
            <p style="font-size:13px;color:#586860;line-height:1.6">
              Should you need to rearrange, please reply to this email or contact us on WhatsApp on
              <strong>07508 401627</strong> at your earliest convenience. Please note that cancellations
              within 24 hours may be subject to a £50 fee.
            </p>
            <p style="font-size:13px;color:#1a1f1d;line-height:1.6;margin-top:18px">
              Kind regards,<br>Zakery Shelley<br>Community Care Physio<br>
              🌐 https://www.communitycarephysio.co.uk/<br>📧 infoccphysio@gmail.com<br>📞 07508 401627
            </p>
          </div>
        </div>
      `
    });

    // Clinician copy — same as the cron.
    await transporter.sendMail({
      from: '"CCP Reminders" <infoccphysio@gmail.com>',
      to: 'infoccphysio@gmail.com',
      subject: `Reminder sent: ${apptLabel} · ${name || ''} · ${formattedDate} ${time}`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:520px;color:#1a1f1d">
          <div style="background:#1e4d3b;padding:18px;border-radius:10px 10px 0 0">
            <h3 style="color:#fff;margin:0">Manual reminder sent</h3>
          </div>
          <div style="background:#fff;padding:20px;border:1px solid #e8f2ee;border-top:none">
            <table style="font-size:13px;width:100%">
              <tr><td style="padding:5px 0;color:#586860;width:35%">Patient</td><td style="font-weight:600">${name || '—'}</td></tr>
              <tr><td style="padding:5px 0;color:#586860">Phone</td><td>${phone ? `<a href="tel:${phone}">${phone}</a>` : '—'}</td></tr>
              <tr><td style="padding:5px 0;color:#586860">Address</td><td>${address || '—'}${postcode ? ', ' + postcode : ''}</td></tr>
              <tr><td style="padding:5px 0;color:#586860">Appointment</td><td>${apptLabel}</td></tr>
              <tr><td style="padding:5px 0;color:#586860">Date</td><td>${formattedDate}</td></tr>
              <tr><td style="padding:5px 0;color:#586860">Time</td><td><strong style="color:#1e4d3b">${time}</strong></td></tr>
              <tr><td style="padding:5px 0;color:#586860">Reason</td><td>${reason || '—'}</td></tr>
            </table>
          </div>
        </div>
      `
    });

    // Mark this session's reminder as sent in Supabase so it shows "✓ Reminder sent"
    // and the cron never double-sends it. Best-effort — email already went out.
    if (bookingId && typeof sessionIndex === 'number') {
      try {
        const { data: booking } = await supabase
          .from('bookings').select('custom_sessions').eq('id', bookingId).single();
        let sessions = [];
        if (booking && booking.custom_sessions) {
          sessions = typeof booking.custom_sessions === 'string'
            ? JSON.parse(booking.custom_sessions) : booking.custom_sessions;
        }
        if (Array.isArray(sessions) && sessions[sessionIndex]) {
          sessions = sessions.map((s, i) => (i === sessionIndex ? { ...s, reminderSent: true } : s));
          await supabase.from('bookings').update({ custom_sessions: sessions }).eq('id', bookingId);
        }
      } catch (e) {
        console.warn('send-reminder-now: could not mark reminderSent:', e?.message);
      }
    }

    return res.status(200).json({ success: true, sent: 1 });
  } catch (err) {
    console.error('send-reminder-now error:', err);
    return res.status(500).json({ error: err.message });
  }
}
