// api/send-reminders.js
// Called automatically by Vercel Cron every morning at 8am London time
// Sends reminder emails to patients 24hrs before their appointment

export const config = {
  schedule: '0 8 * * *', // 8am every day (UTC — adjust for BST if needed)
  timezone: 'Europe/London'
};

import { supabase } from '../lib/supabase.js';

export default async function handler(req, res) {
  // Vercel cron sends a GET with a special header
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorised' });
  }

  try {
    const resendKey = process.env.RESEND_API_KEY;
    if (!resendKey) return res.status(200).json({ message: 'No Resend key configured' });

    // Find appointments tomorrow (London time)
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toLocaleDateString('en-CA', { timeZone: 'Europe/London' }); // YYYY-MM-DD

    const { data: appointments, error } = await supabase
      .from('bookings')
      .select('*')
      .eq('booked_date', tomorrowStr)
      .eq('confirmed', true)
      .eq('paid', true);

    if (error) throw error;
    if (!appointments?.length) {
      return res.status(200).json({ message: 'No appointments tomorrow', sent: 0 });
    }

    let sent = 0;

    for (const appt of appointments) {
      if (!appt.email) continue;

      const formattedDate = new Date(appt.booked_date + 'T12:00:00')
        .toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

      const timeStr = appt.booked_time || appt.preferred_time || 'your confirmed time';

      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'Community Care Physio <onboarding@resend.dev>',
          to: appt.email,
          subject: `Reminder — your appointment is tomorrow at ${timeStr}`,
          html: `
            <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;color:#1a1f1d">
              <div style="background:#1e4d3b;padding:20px;border-radius:10px 10px 0 0">
                <h2 style="color:#fff;margin:0;font-size:18px">Community Care Physio</h2>
                <p style="color:rgba(255,255,255,.6);font-size:11px;margin:4px 0 0">Appointment reminder</p>
              </div>
              <div style="background:#fff;padding:24px;border:1px solid #e8f2ee;border-top:none">
                <p style="font-size:15px;font-weight:600;color:#1e4d3b;margin:0 0 12px">Hi ${appt.name?.split(' ')[0] || 'there'} — see you tomorrow! 👋</p>
                <p style="font-size:13px;color:#586860;line-height:1.6">Just a reminder that your physiotherapy appointment is tomorrow:</p>
                <div style="background:#e8f2ee;border-radius:10px;padding:16px;margin:16px 0">
                  <p style="margin:0;font-size:14px;color:#1a1f1d"><strong>${appt.appointment}</strong></p>
                  <p style="margin:6px 0 0;font-size:13px;color:#1e4d3b"><strong>${formattedDate} · ${timeStr}</strong></p>
                  <p style="margin:6px 0 0;font-size:12px;color:#586860">${appt.address || ''}, ${appt.postcode || ''}</p>
                </div>
                <p style="font-size:13px;color:#586860;line-height:1.6">
                  Please wear comfortable clothing. If you have any relevant letters, x-rays or scan results, have them handy.
                </p>
                <p style="font-size:12px;color:#8aab97;margin-top:20px;padding-top:16px;border-top:1px solid #e8f2ee">
                  Need to reschedule? WhatsApp us ASAP on <strong>07508 401627</strong>. 
                  Note: cancellations within 24 hours incur a £50 fee.
                </p>
              </div>
            </div>
          `
        })
      });

      // Also remind Zakery
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'CCP Reminders <onboarding@resend.dev>',
          to: 'infoccphysio@gmail.com',
          subject: `📅 Tomorrow: ${appt.appointment} · ${appt.name} · ${timeStr}`,
          html: `
            <div style="font-family:Arial,sans-serif;max-width:520px;color:#1a1f1d">
              <div style="background:#1e4d3b;padding:18px;border-radius:10px 10px 0 0">
                <h3 style="color:#fff;margin:0">Appointment tomorrow</h3>
              </div>
              <div style="background:#fff;padding:20px;border:1px solid #e8f2ee;border-top:none">
                <table style="font-size:13px;width:100%">
                  <tr><td style="padding:5px 0;color:#586860;width:35%">Patient</td><td style="font-weight:600">${appt.name}</td></tr>
                  <tr><td style="padding:5px 0;color:#586860">Phone</td><td><a href="tel:${appt.phone}">${appt.phone}</a></td></tr>
                  <tr><td style="padding:5px 0;color:#586860">Address</td><td>${appt.address || '—'}, ${appt.postcode || ''}</td></tr>
                  <tr><td style="padding:5px 0;color:#586860">Appointment</td><td>${appt.appointment}</td></tr>
                  <tr><td style="padding:5px 0;color:#586860">Time</td><td><strong style="color:#1e4d3b">${timeStr}</strong></td></tr>
                  <tr><td style="padding:5px 0;color:#586860">Reason</td><td>${appt.reason || '—'}</td></tr>
                </table>
              </div>
            </div>
          `
        })
      });

      sent++;
    }

    return res.status(200).json({ message: `Sent ${sent} reminder(s)`, sent });

  } catch (err) {
    console.error('send-reminders error:', err);
    return res.status(500).json({ error: err.message });
  }
}
