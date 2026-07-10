// api/send-reminders.js
// Called automatically by Vercel Cron every morning at 8am London time.
// Sends a reminder 24hrs before each appointment — for BOTH standalone bookings
// AND every follow-up session inside a custom/package booking (custom_sessions).

export const config = {
  schedule: '0 8 * * *',
  timezone: 'Europe/London'
};

import { supabase } from '../lib/supabase.js';

export default async function handler(req, res) {
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorised' });
  }

  try {
    const resendKey = process.env.RESEND_API_KEY;
    if (!resendKey) return res.status(200).json({ message: 'No Resend key configured' });

    // Tomorrow's date in London time (YYYY-MM-DD)
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toLocaleDateString('en-CA', { timeZone: 'Europe/London' });

    // Pull all confirmed + paid bookings, then work out which appointments (standalone
    // date OR any package follow-up session) actually fall tomorrow.
    const { data: bookings, error } = await supabase
      .from('bookings')
      .select('*')
      .eq('confirmed', true)
      .eq('paid', true);
    if (error) throw error;

    // Build the list of appointments happening tomorrow.
    const due = [];
    for (const b of bookings || []) {
      if (!b.email) continue;

      // 1) The main booked date
      if (b.booked_date === tomorrowStr) {
        due.push({ b, time: b.booked_time || b.preferred_time || 'your confirmed time', label: b.appointment });
      }

      // 2) Any follow-up sessions inside a custom/package booking
      let sessions = [];
      try {
        sessions = b.custom_sessions
          ? (typeof b.custom_sessions === 'string' ? JSON.parse(b.custom_sessions) : b.custom_sessions)
          : [];
      } catch (e) { sessions = []; }

      (Array.isArray(sessions) ? sessions : []).forEach((s, idx) => {
        const status = (s && s.status) ? String(s.status).toLowerCase() : 'scheduled';
        if (!s || s.date !== tomorrowStr || !s.time) return;
        if (['cancelled', 'dna', 'expired'].includes(status)) return;
        // Respect the admin's per-appointment reminder switch, and never send twice.
        if (s.reminderOff === true) return;
        if (s.reminderSent === true) return;
        // Avoid duplicating the main booked_date if a session mirrors it
        if (b.booked_date === tomorrowStr && s.time === (b.booked_time || '')) return;
        due.push({ b, time: s.time, label: s.label || `Follow-up ${idx + 1}`, sessionIndex: idx, sessions });
      });
    }

    if (!due.length) {
      return res.status(200).json({ message: 'No appointments tomorrow', sent: 0 });
    }

    const formattedDate = new Date(tomorrowStr + 'T12:00:00')
      .toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

    let sent = 0;

    for (const { b, time, label, sessionIndex, sessions } of due) {
      const first = b.name ? b.name.split(' ')[0] : 'there';

      // Patient reminder — formal tone
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'Community Care Physio <onboarding@resend.dev>',
          to: b.email,
          subject: `Appointment reminder — ${formattedDate} at ${time}`,
          html: `
            <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;color:#1a1f1d">
              <div style="background:#1e4d3b;padding:20px;border-radius:10px 10px 0 0">
                <h2 style="color:#fff;margin:0;font-size:18px">Community Care Physio</h2>
                <p style="color:rgba(255,255,255,.6);font-size:11px;margin:4px 0 0">Appointment reminder</p>
              </div>
              <div style="background:#fff;padding:24px;border:1px solid #e8f2ee;border-top:none">
                <p style="font-size:14px;color:#1a1f1d;margin:0 0 12px">Dear ${first},</p>
                <p style="font-size:13px;color:#586860;line-height:1.6;margin:0 0 12px">
                  This is a reminder of your upcoming physiotherapy appointment with Community Care Physio:
                </p>
                <div style="background:#e8f2ee;border-radius:10px;padding:16px;margin:16px 0">
                  <p style="margin:0;font-size:14px;color:#1a1f1d"><strong>${label}</strong></p>
                  <p style="margin:6px 0 0;font-size:13px;color:#1e4d3b"><strong>${formattedDate} · ${time}</strong></p>
                  <p style="margin:6px 0 0;font-size:12px;color:#586860">${b.address || ''}${b.postcode ? ', ' + b.postcode : ''}</p>
                </div>
                <p style="font-size:13px;color:#586860;line-height:1.6">
                  Please wear comfortable clothing, and have any relevant letters, scan results or x-rays to hand.
                </p>
                <p style="font-size:13px;color:#586860;line-height:1.6">
                  Should you need to rearrange, please reply to this email or contact us on WhatsApp on
                  <strong>07508 401627</strong> at your earliest convenience. Please note that cancellations
                  within 24 hours may be subject to a £50 fee.
                </p>
                <p style="font-size:13px;color:#586860;line-height:1.6">We look forward to seeing you.</p>
                <p style="font-size:13px;color:#1a1f1d;line-height:1.6;margin-top:18px">
                  Kind regards,<br>Zakery Shelley<br>Community Care Physio<br>
                  🌐 https://www.communitycarephysio.co.uk/<br>📧 infoccphysio@gmail.com<br>📞 07508 401627
                </p>
              </div>
            </div>
          `
        })
      });

      // Clinician copy
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'CCP Reminders <onboarding@resend.dev>',
          to: 'infoccphysio@gmail.com',
          subject: `Tomorrow: ${label} · ${b.name} · ${time}`,
          html: `
            <div style="font-family:Arial,sans-serif;max-width:520px;color:#1a1f1d">
              <div style="background:#1e4d3b;padding:18px;border-radius:10px 10px 0 0">
                <h3 style="color:#fff;margin:0">Appointment tomorrow</h3>
              </div>
              <div style="background:#fff;padding:20px;border:1px solid #e8f2ee;border-top:none">
                <table style="font-size:13px;width:100%">
                  <tr><td style="padding:5px 0;color:#586860;width:35%">Patient</td><td style="font-weight:600">${b.name}</td></tr>
                  <tr><td style="padding:5px 0;color:#586860">Phone</td><td><a href="tel:${b.phone}">${b.phone}</a></td></tr>
                  <tr><td style="padding:5px 0;color:#586860">Address</td><td>${b.address || '—'}${b.postcode ? ', ' + b.postcode : ''}</td></tr>
                  <tr><td style="padding:5px 0;color:#586860">Appointment</td><td>${label}</td></tr>
                  <tr><td style="padding:5px 0;color:#586860">Time</td><td><strong style="color:#1e4d3b">${time}</strong></td></tr>
                  <tr><td style="padding:5px 0;color:#586860">Reason</td><td>${b.reason || '—'}</td></tr>
                </table>
              </div>
            </div>
          `
        })
      });

      // Tick the reminder as sent so the admin card shows "✓ Reminder sent"
      // and it can never be emailed twice.
      if (typeof sessionIndex === 'number' && Array.isArray(sessions)) {
        try {
          const updated = sessions.map((s, i) => (i === sessionIndex ? { ...s, reminderSent: true } : s));
          await supabase.from('bookings').update({ custom_sessions: updated }).eq('id', b.id);
        } catch (e) {
          console.warn('could not mark reminderSent:', e?.message);
        }
      }

      sent++;
    }

    return res.status(200).json({ message: `Sent ${sent} reminder(s)`, sent });

  } catch (err) {
    console.error('send-reminders error:', err);
    return res.status(500).json({ error: err.message });
  }
}
