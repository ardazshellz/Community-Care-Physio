/**
 * Community Care Physio — Google Drive session notes.
 *
 * Deployed as a web app in the clinic's own Google account. The admin page POSTs
 * (patient, programme, session, date, time, secret); this finds or creates
 *   Drive › CC Physio – Patient notes › <Patient> — <Programme> › <date time — session>
 * as a Google Doc with a SOAP template and returns the patient's folder URL, which
 * the admin page opens so every note for that patient is in one place.
 *
 * Setup: see README.md. Set the script property SECRET to the same value as in
 * the admin page (Referrals & invoices › Settings › Google Drive notes).
 */
const ROOT_FOLDER = 'CC Physio – Patient notes';

function createSecret() {
  const props = PropertiesService.getScriptProperties();
  let secret = props.getProperty('SECRET');
  if (!secret) {
    secret = Utilities.getUuid().replace(/-/g, '');
    props.setProperty('SECRET', secret);
  }
  Logger.log(secret + ' — paste this into admin > Referrals & invoices > Settings > Google Drive notes');
}

function doPost(e) {
  const p = (e && e.parameter) || {};
  const secret = PropertiesService.getScriptProperties().getProperty('SECRET');
  if (!secret || p.secret !== secret) return json_({ error: 'Not authorised. Check the shared secret in the admin Settings matches the script property SECRET.' });

  const clean = (s, max) => String(s || '').replace(/[\\/:*?"<>|\r\n]+/g, ' ').trim().slice(0, max || 120);
  const patient = clean(p.patient);
  if (!patient) return json_({ error: 'Missing patient name.' });
  const programme = clean(p.programme) || 'Physiotherapy';
  const session = clean(p.session) || 'Session';

  const root = folder_(DriveApp.getRootFolder(), ROOT_FOLDER);
  const patientFolder = patientFolder_(root, String(p.bookingId || ''), patient + ' — ' + programme);
  const title = when_(p.date, p.time) + ' — ' + session;

  firstLive_(patientFolder.getFilesByName(title)) || createNote_(patientFolder, title, patient, programme, session, when_(p.date, p.time));
  // JSON back to the admin page, which opens the folder itself. (A page returned
  // from here runs in Google's sandbox and cannot redirect the tab on its own.)
  return json_({ url: patientFolder.getUrl() });
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doGet() { return page_('This link works from the Community Care Physio admin page only.'); }

function folder_(parent, name) {
  return firstLive_(parent.getFoldersByName(name)) || parent.createFolder(name);
}

// One folder per booking, remembered by booking ID, so two patients with the same
// name never share notes. The folder keeps a readable name.
function patientFolder_(root, bookingId, name) {
  const props = PropertiesService.getScriptProperties();
  const key = 'folder:' + bookingId.replace(/[^\w-]/g, '').slice(0, 64);
  const id = bookingId && props.getProperty(key);
  if (id) {
    try { const f = DriveApp.getFolderById(id); if (!f.isTrashed()) return f; } catch (e) { /* deleted: recreate */ }
  }
  let folderName = name, n = 2;
  while (firstLive_(root.getFoldersByName(folderName))) folderName = name + ' (' + n++ + ')';
  const folder = root.createFolder(folderName);
  if (bookingId) props.setProperty(key, folder.getId());
  return folder;
}

function firstLive_(it) {
  while (it.hasNext()) { const f = it.next(); if (!f.isTrashed()) return f; }
  return null;
}

function when_(date, time) {
  const tz = 'Europe/London';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) return Utilities.formatDate(new Date(), tz, 'EEE d MMM yyyy');
  const hasTime = /^\d{1,2}:\d{2}/.test(String(time || ''));
  // Parse in UK time whatever the script project's own timezone is.
  const d = Utilities.parseDate(date + ' ' + (hasTime ? String(time).slice(0, 5) : '12:00'), tz, 'yyyy-MM-dd H:mm');
  return Utilities.formatDate(d, tz, hasTime ? 'EEE d MMM yyyy, h.mma' : 'EEE d MMM yyyy').replace('AM', 'am').replace('PM', 'pm');
}

function createNote_(folder, title, patient, programme, session, when) {
  const doc = DocumentApp.create(title);
  const body = doc.getBody();
  body.appendParagraph(patient).setHeading(DocumentApp.ParagraphHeading.TITLE);
  body.appendParagraph(session + ' · ' + programme + ' · ' + when).setHeading(DocumentApp.ParagraphHeading.SUBTITLE);
  body.appendParagraph('Clinician: Zakery Shelley, Physiotherapist (HCPC PH132358). Consent confirmed: ☐ verbal ☐ written.');
  ['S — Subjective', 'O — Objective', 'A — Assessment', 'P — Plan'].forEach(function (h) {
    body.appendParagraph(h).setHeading(DocumentApp.ParagraphHeading.HEADING2);
    body.appendParagraph('');
  });
  body.appendParagraph('Outcome measures').setHeading(DocumentApp.ParagraphHeading.HEADING2);
  body.appendParagraph('');
  doc.saveAndClose();
  const file = DriveApp.getFileById(doc.getId());
  file.moveTo(folder);
  return file;
}

function page_(msg) {
  return HtmlService.createHtmlOutput('<p style="font-family:Arial">' + String(msg).replace(/[<>&]/g, '') + '</p>').setTitle('CC Physio notes');
}
