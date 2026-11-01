# HANDOFF (Claude to Claude), written 1 Nov 2026 about 20:00

Do not push, merge, deploy, publish, or send anything without the user's explicit yes.

## Goal
Community Care Physio: the first HCML case managed client (ref 26074807, "the HCML client", never her name in commits or handovers), Harrison Associates provider onboarding, day to day admin. Owner Zakery, lead clinician, sole trader.

## Gmail filters (done 1 Nov, evening)
- infoccphysio Gmail now has two filters, owner approved the list: "Vercel" (`from:(vercel.com) -{sign-in OR "security code"}`, skip inbox, 11 conversations moved; sign-in and security code mails stay in the inbox) and "Backups" (`from:(infoccphysio@gmail.com) subject:("Practice backup")`, skip inbox, 15 conversations moved). Both labels are new. Verified in Settings, Filters and Blocked Addresses.
- Owner declined for now: GitHub notifications, Nextdoor digests (recent ones carry a physio enquiry), Calendly and Resend newsletters. Offer again only if asked.
- Method that worked: open mail.google.com/mail/u/1/#create-filter/from=...&hasnot=... (first time opens the panel; later times click the "Advanced search options" button, aria-label exactly that), click the "Create filter" span, tick the action rows by clicking their text, "Choose label..." then "New label...", focus the first text input inside [role=alertdialog], Input.insertText, click the dialog's Create button, then the "Create filter" span. Clicks must be Input.dispatchMouseEvent with buttons:1 in CSS pixels (viewport 1200 wide, devicePixelRatio 2). Script gm.mjs lived in the scratchpad (wiped daily).

## HCML client state (all done and verified 1 Nov)
- Session 4 (Fri 30/10/2026 17:00) note: ~/Downloads/LM-26074807/LM 26074807 Treatment session 4 30-10-2026.txt and a Google Doc of the same title in the client's Drive folder (folder id 1bbvX2o4iyH9qqIXGRbvclXi2kktjSu40, Doc id 17RS_X4hWzxwVJr9LtmiML2h7nGaTAln4FJSTlnwqC-I), export matched the txt line for line. Header assumes 17:00 to 18:00, 60 minutes.
- Contact log: txt and Drive Doc (id 1XMRUQtFRn07n_An-Q9lpj2SSJ1-fHYppVQJk1LDsxNE) match, 26 entries, last four: 29/10 text from Denise and reply, 30/10 visit, 31/10 texts (GP ECG and bloods Fri 06/11/2026; clinician to move session 5 to Saturday morning 07/11/2026 where able, time not set).
- Admin: booking a8b29b37 (30 Oct) completed. Session 5 booked as booking 20ac4d65, Fri 06/11/2026 17:00, Extended Session, £125 internal price, slots 17:00 to 18:30 blocked, no email. Reschedule it to the Saturday time once agreed with Denise (action 'reschedule' on /api/update-booking from a signed in admin tab, token in sessionStorage ccp_admin_token). Funded: 8 authorised, 4 done, session 5 booked.
- Funding and invoices checked 1 Nov against the Jemma threads: rates agreed 21 Sep (IA £130, extended session £105, report £50, travel £35), plan £1,220 (8 x £105, 8 x £35, progress report £50, discharge report £50), funding 14 Oct for three sessions and one report, 21 Oct for the full £1,220. Invoice CCP-2026-0002 £470 (sessions 1 to 3, travel, progress report) matches; £750 left to invoice at the end (5 sessions, travel, discharge report). HCML terms: paid within 30 days of invoice, no end of block rule. Jemma has not replied to the 26 Oct progress email; chase when sending the remaining dates.
- GP sheet: blank "Request for GP Advice" form, _local-only/documents/gp-request.html printed to _local-only/outputs/gp-request-blank.pdf (one page: patient details with address not NHS number, physiotherapist concern box, GP advice box, patient consent box). Emailed 1 Nov from infoccphysio to the owner's personal Gmail. A client specific typed version also exists in ~/Downloads/LM-26074807 (src/gp-summary-request-01-11-2026.html and the PDF), unused.
- From the session 4 plan: NEWS2 at subsequent visits; obtain ECG and bloods outcome after 06/11 and update the case manager with consent; occasional HEP reminder texts agreed; possible weekend daytime outdoor session once medically appropriate; after session 8 the discharge report and final invoice.

## Methods that work (shared Chrome, raw CDP from node)
- Scratchpad is wiped daily; recreate cdp.mjs (WebSocket to ws://127.0.0.1:9222/devtools/page/<id>, Runtime.evaluate with awaitPromise and returnByValue). New tab: PUT http://127.0.0.1:9222/json/new?<url>. Bring to front: Page.bringToFront plus Emulation.setFocusEmulationEnabled before typing.
- Google Docs: open as /document/u/1/d/<id>/edit (authuser 0 is the wrong account and a click there sends a Request access email). New Doc in a folder: /document/u/1/create?folder=<id>; title via JS focus and select on .docs-title-input then Input.insertText and Enter; body via a trusted click low in the editor (left+300, top+420) then Input.insertText. Append to an existing Doc: Cmd+F, Input.insertText the last words of the previous entry, Escape, ArrowLeft, ArrowRight past the match, Enter Enter, Input.insertText. Cmd+End does not move the caret. Verify with fetch('/document/d/<id>/export?format=txt&_='+Date.now()) from the Doc tab; the export can lag 10 to 20 s, re-export before judging.
- Gmail: compose URL mail.google.com/mail/u/1/?view=cm&fs=1&to=...; attach with DOM.setFileInputFiles on input[type=file]; a view=cm tab closes itself and leaves a draft if the send click is late; open a draft by a real click at its list position (screenshot with Page.captureScreenshot to find it), then click the Send button; "Message sent" toast confirms. Base64 attachments through chat are too big, never do that.
- Admin: /api/get-bookings POST with {token}; /api/update-booking actions complete, reschedule, create; CCPPractice.bookSession('referral:21adfb0c-de49-47c4-920f-60d3756a29f0', {bookedDate, bookedTime, appointment:'Extended Session', price:125}) for funded sessions. Owner signs in; Claude never types passwords.
- PDFs: headless Chrome as in tools/referral-pack/build.mjs (--headless=new --print-to-pdf). Page count: count /Type /Page in the file. Preview page 1 with sips, later pages with pdftoppm.

## Rules and preferences
- Owner's writing: no dashes between words, no semicolons, no hyphens in prose. Session notes in the session 2 and 3 house style (header lines, S O Rx A P, bullet Rx).
- Recommendation first, then act. Gate for sends, submissions, payments: READY list, one yes, then act. Never send anything to the GP without the owner's yes.
- Quote fees, prices, deadlines only after a live check.
- Never patient names in commits or handovers. Never patient data under the repo. Delete .playwright-mcp/page-*.yml snapshots if any appear.
- One browser job at a time in the shared Chrome. Built in browser pane is a different Google account.
- Owner approves pushes himself. docs/PROJECT_HANDOVER.md has entries up to 26 Oct; add 29 Oct to 1 Nov after approval. Nothing committed since 25 Oct (HANDOFF.md, docs/PROJECT_HANDOVER.md, rebuilt assets/*.pdf uncommitted).

## Watch list
- Vercel "New sign-in detected" email to infoccphysio on 1 Nov 17:49 and an earlier security code email on 29 Oct (Addlestone): owner to confirm both were him; if not, change the Vercel password and enable two factor.
- Vercel free tier image optimisation near its limit.
- Gmail attachment uploads fail for files with the macOS com.apple.quarantine xattr; strip with xattr -d.
- Harrison Associates: due diligence form submitted 26 Oct, no reply yet. ICO registration ZC284192.
