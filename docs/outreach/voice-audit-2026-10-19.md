# Voice audit, 19 Oct 2026

Read only audit. No source file was edited, committed or pushed. Rule from the owner (19 Oct): the practice reads as established with a team behind it. Zakery is lead clinician. Every client has one named clinician from assessment to discharge. An established network of physiotherapists covers extra capacity or a specialism, so capacity is not a barrier. Never "small caseload", "just me", "new practice" or solo novice framing.

Every proposed replacement below follows the standing rules: no dashes or hyphens between words, no semicolons, no NHS post mention (only "NHS community rehabilitation background"), no skin check wording. The "Current" text is quoted as it stands, so it may still hold dashes.

Searched for: small caseload, deliberately small, sole, solo, one physiotherapist, just me, I keep, lone, new or growing practice, get started, get going, accepting new patients, Est. 2026, "run by", "founded by", "the same physiotherapist", "the physiotherapist behind", "I provide the visits myself", plus a read of every visible first person or single clinician line in each file.

## Result by file group

| Group | Result |
|---|---|
| index.html | 9 hits, 3 of them high (A1 to A3) |
| case-managers/index.html | No hits. One optional parity line (B1) |
| 17 area pages | 3 hits, all from one generator, fix once in `tools/build-areas.mjs` (C1 to C3) |
| tools/referral-pack/index.html | 5 hits (D1 to D5) |
| tools/referral-pack/agency.html | 2 hits (E1, E2) |
| tools/referral-pack/terms.html | No hits |
| docs/outreach/case-manager-emails.md | Templates A and B clean. 2 hits in template C (F1, F2) |
| docs/outreach/home-care-agency.md | 6 hits, 1 high (G1 to G6) |
| docs/outreach/linkedin-profile.md | 2 hits (H1, H2) |
| docs/outreach/pipeline-targets.md | No hits. Internal only |
| docs/ other, facebook-organic-poster-local/ | No social copy. Its `index.html` is a stale copy of the live page, same hits as A1, A2, A4 (I1) |
| Instagram and Facebook copy (found in `_local-only/outputs/`, git ignored) | 20 hits, 9 high (J, K, L, M) |

Priority: **High** is explicit solo, small or new framing. **Medium** is a single clinician line that conflicts with the new voice. **Low** is optional polish.

---

## A. index.html

**A1 High, line 956.** Hero badge.
- Current: `Accepting new patients · SW London`
- Proposed: `Home visit physiotherapy · South West London`
- Why: "accepting new patients" reads as spare capacity.

**A2 High, line 1024.** Hero card footer.
- Current: `SW London · Est. 2026`
- Proposed: `Home visits across South West London`
- Why: "Est. 2026" announces a brand new practice.

**A3 High, line 1055.** About blurb.
- Current: `Founded by an NHS-trained community physiotherapist with extensive experience in neurological rehabilitation, elderly care, falls prevention and MSK conditions.`
- Proposed: `Led by Zakery Shelley, an HCPC registered physiotherapist with an NHS community rehabilitation background and extensive experience in neurological rehabilitation, elderly care, falls prevention and MSK conditions. Every client has one named clinician from assessment to discharge, supported by an established network of physiotherapists, so capacity is not a barrier.`

**A4 Medium, line 1148.** Founder lead.
- Current: `I'm Zakery, an HCPC-registered physiotherapist with experience across the NHS.`
- Proposed: `I'm Zakery, lead clinician at Community Care Physio and an HCPC registered physiotherapist with an NHS community rehabilitation background.`

**A5 Low, line 1150.** Founder copy.
- Current: `...by someone who takes the time to understand what matters.`
- Proposed: `...by your named clinician, who takes the time to understand what matters.`

**A6 Medium, lines 10 and 24.** Meta and Open Graph description (keep under 153 characters, set in the 1 Oct SEO pass).
- Current: `Home visit physiotherapy across South West London from an NHS-trained, HCPC registered physio. Putney, Wimbledon, Tooting, Morden. No GP referral needed.`
- Proposed: `Home visit physiotherapy across South West London from an established practice. HCPC registered. Putney, Wimbledon, Tooting. No GP referral needed.` (147 characters)

**A7 Low, line 38.** JSON LD business description.
- Current: `...in your own home. HCPC registered, NHS trained.`
- Proposed: `...in your own home. HCPC registered clinicians with an NHS community rehabilitation background.`

**A8 Low, lines 190 to 193.** JSON LD founder block.
- Current: `"jobTitle": "Physiotherapist"`
- Proposed: `"jobTitle": "Lead Clinician and Physiotherapist"`

**A9 Low, lines 2882 to 2888.** Independent physiotherapists block ("trusted links with independent physiotherapists working in other areas").
- No change needed. It supports the network story. Do not merge it with the Well-Led Physio disclaimer.

Checked and fine: line 959 hero lead, 984 "NHS-trained clinicians", 993 "Book with our clinicians", 1068 "Local clinicians", chatbot lines ("we", "us").

## B. case-managers/index.html

No solo or small hits.

**B1 Low, line 84.** Optional parity with the pack, which now carries the named clinician and network line.
- Current: `...treatment only once you approve funding. HCPC registered physiotherapist (PH132358) across South West London.`
- Proposed: `...treatment only once you approve funding. Every client has one named clinician from assessment to discharge, backed by an established network of physiotherapists. HCPC registered (PH132358) across South West London.`

## C. Area pages (17 pages, one generator)

All 17 `areas/*/index.html` share identical lines 7, 11, 74 and 103. They are built by `tools/build-areas.mjs`, so edit lines 52, 144 and 168 there and regenerate. Do not hand edit 17 files.

**C1 Medium, build-areas.mjs line 144** (page line 74).
- Current: `An NHS-trained, HCPC registered physiotherapist comes to you at home in ${local}. One-to-one care, no waiting room, no GP referral needed.`
- Proposed: `An HCPC registered physiotherapist with an NHS community rehabilitation background comes to you at home in ${local}. One to one care from a named clinician, no waiting room, no GP referral needed.`

**C2 Low, build-areas.mjs line 168** (page line 103).
- Current: `We come to you. Your physiotherapist assesses you in your own home...`
- Proposed: `We come to you. Your named clinician assesses you in your own home...`

**C3 Low, build-areas.mjs line 52** (page lines 7 and 11).
- Current: `Physiotherapist home visits in ${name} and ${districts.join(', ')}. NHS-trained, HCPC registered. Initial assessment £100, follow-ups £75. Book online, no GP referral needed.`
- Proposed: `Physiotherapist home visits in ${name} and ${districts.join(', ')}. One named clinician, HCPC registered. Initial assessment £100, follow-ups £75. Book online, no GP referral needed.`
- Check the length against the 153 character cap for the longest area name before regenerating.

## D. tools/referral-pack/index.html (rebuild `assets/referral-pack.pdf` after any change)

Page 6 note (line 162) already carries the new voice.

**D1 Medium, line 79.**
- Current: `...and treatment from an NHS-trained physiotherapist across South West London.`
- Proposed: `...and treatment from one named HCPC registered clinician across South West London.`

**D2 Medium, line 81.**
- Current: `Contact Zakery Shelley, Physiotherapist`
- Proposed: `Contact Zakery Shelley, Lead Clinician`

**D3 High, lines 90 and 91.** Heading frames the practice as one person against a clinic.
- Current heading: `A community physiotherapist, not a clinic`
- Proposed heading: `Community rehabilitation, at home`
- Current: `Community Care Physio is led by an NHS-trained physiotherapist with experience in neurological rehabilitation, elderly care, falls prevention and musculoskeletal conditions. Every appointment is one-to-one, at the client's home or care home, with the same clinician throughout.`
- Proposed: `Community Care Physio is led by Zakery Shelley, an HCPC registered physiotherapist with an NHS community rehabilitation background and experience in neurological rehabilitation, elderly care, falls prevention and musculoskeletal conditions. Every appointment is one to one, at the client's home or care home, with one named clinician from assessment to discharge. An established network of physiotherapists supports the practice when a case needs extra capacity or a particular specialism.`

**D4 Low, line 269.**
- Current: `NHS-trained in community rehabilitation`
- Proposed: `NHS community rehabilitation background`

**D5 Low, line 299.**
- Current: `Raise any concern with Zakery directly in the first instance...`
- Proposed: `Raise any concern with Zakery, the lead clinician, in the first instance...`

Reviewed and kept: line 284 `Lone-working procedure with check-in and escalation` (standard compliance term case managers look for, leave as is). Line 320 sample report clinician line (a real report credit, leave as is).

## E. tools/referral-pack/agency.html (rebuild `assets/home-care-agencies.pdf` after any change)

**E1 Medium, line 72.**
- Current: `The same physiotherapist at every visit`
- Proposed: `One named clinician from assessment to discharge`

**E2 High, line 102.**
- Current: `Community Care Physio is run by Zakery Shelley, an HCPC registered physiotherapist with an NHS community rehabilitation background.`
- Proposed: `Community Care Physio is led by Zakery Shelley, an HCPC registered physiotherapist with an NHS community rehabilitation background. Every client has one named clinician, and an established network of physiotherapists means capacity is not a barrier.`

`terms.html` line 32 names Zakery Shelley as the contracting party. Leave as is.

## F. docs/outreach/case-manager-emails.md

Templates A and B are already on voice. Template C is a draft and is not among the seven scheduled for 20 Oct.

**F1 High, line 78.** Reads as a clinician who turned work away with no cover.
- Current: `I could not take that case as a female clinician was needed, but I would like to be on your list for home visit physiotherapy across South West London for future cases.`
- Proposed: `That case needed a female clinician, and I would like Community Care Physio on your list for home visit physiotherapy across South West London for future cases. Where a female clinician is requested, I can arrange one through our established network of physiotherapists.`
- Owner to confirm the network can supply a female clinician before this sentence is used.

**F2 Medium, line 80.**
- Current: `I am HCPC registered (PH132358) with an enhanced DBS... with the same clinician throughout.`
- Proposed: `I am the lead clinician at Community Care Physio, HCPC registered (PH132358), with an enhanced DBS... with one named clinician from assessment to discharge.`

## G. docs/outreach/home-care-agency.md

**G1 High, line 62.** Explicit hit ("I keep a small caseload").
- Current: `That is good to hear. I would be glad to be a second name for when they are full or the client is in [area]. I keep a small caseload, so the client always sees me.`
- Proposed: `That is good to hear. I would be glad to be a second name for when they need extra capacity or the client is in [area]. Each client has one named clinician from assessment to discharge, and an established network of physiotherapists means capacity is not a barrier.`

**G2 Medium, line 15.**
- Current: `...and I run Community Care Physio, a home visit service across South West London, including [area].`
- Proposed: `...and the lead clinician at Community Care Physio, a home visit practice across South West London, including [area].`

**G3 Medium, line 25.**
- Current: `Each client keeps the same physiotherapist from the first visit to the last.`
- Proposed: `Each client has one named clinician from assessment to discharge, and an established network of physiotherapists means capacity is not a barrier.`

**G4 Medium, line 37.**
- Current: `...an HCPC registered physiotherapist (PH132358) running Community Care Physio, a home visit service across South West London including [area].`
- Proposed: `...an HCPC registered physiotherapist (PH132358) and the lead clinician at Community Care Physio, a home visit practice across South West London including [area].`

**G5 Low, line 45 (phone script).**
- Current: `My name is Zakery Shelley, I am a local physiotherapist.`
- Proposed: `My name is Zakery Shelley, I am the lead clinician at Community Care Physio.`

**G6 Low, line 75 (voicemail).**
- Current: `My name is Zakery Shelley, a home visit physiotherapist covering [area].`
- Proposed: `My name is Zakery Shelley, lead clinician at Community Care Physio, covering [area].`

## H. docs/outreach/linkedin-profile.md

**H1 Medium, line 3 (headline).**
- Current: `Physiotherapist | I run Community Care Physio | Home visits across South West London | ...`
- Proposed: `Lead clinician, Community Care Physio | Home visits across South West London | ...`

**H2 Medium, line 7 (About).**
- Current: `I run Community Care Physio, providing home visits across South West London, including Wimbledon, Putney, Wandsworth, Kingston and Richmond.`
- Proposed: `I am the lead clinician at Community Care Physio, which provides home visits across South West London, including Wimbledon, Putney, Wandsworth, Kingston and Richmond. Every client has one named clinician, supported by an established network of physiotherapists.`

## I. facebook-organic-poster-local/ and other docs

**I1.** `facebook-organic-poster-local/index.html` is an older copy of the live homepage (lines 925, 992, 1023, 1116 match A1, A2, A3, A4). Its `marketing/` folder holds only a neutral queue example and a README. No edit needed unless this folder is deployed. If it is, apply A1 to A4.

**I2 Internal only.** `HANDOFF.md` line 8 says "Solo home-visit physio practice". Suggest: `Home visit physio practice led by Zakery (lead clinician), with a network of physiotherapists for extra capacity.` `_local-only/outputs/SEO-AUDIT.md` line 39 says "one-person practice". Suggest: `a practice at this stage`. Neither is outward copy.

`docs/outreach/pipeline-targets.md`, `docs/PROJECT_HANDOVER.md`, `docs/COVERAGE_MAP.md`, `docs/clinical/GAS-worksheet.md`: no voice hits. Matches on "independent", "capacity" and "alone" are clinical or tooling terms.

## J. Instagram captions (`_local-only/outputs/INSTAGRAM-CAPTIONS-4WEEK.md`)

**J1 High, line 143.**
- Current: `...a short review or a mention to a friend or neighbour genuinely helps a local, independent practice get started.`
- Proposed: `...a short review or a mention to a friend or neighbour helps people nearby find a home visit physiotherapy practice they can trust.`

**J2 High, line 191.**
- Current: `Community Care Physio is still growing, and word of mouth from people across Wimbledon, Wandsworth, Tooting, Colliers Wood, Merton and Fulham & Putney makes a real difference to a local, independent practice.`
- Proposed: `Thank you to everyone across Wimbledon, Wandsworth, Tooting, Colliers Wood, Merton and Fulham & Putney who has read, shared or reached out. Word of mouth is how neighbours find us.`

**J3 Low, line 99.**
- Current: `...and I'm building this for this community specifically.`
- Proposed: `...and Community Care Physio is rooted in this community specifically.`

**J4 Housekeeping, line 207.** A leftover agent note ("I didn't do this myself...") sits in the caption file. Delete before copying captions out.

## K. Content calendars (`_local-only/outputs/`)

`CONTENT-CALENDAR-4WEEK.md`:
- **K1 High, line 105.** Same sentence as J1. Same replacement.
- **K2 High, line 137.** Same sentence as J2. Same replacement.
- **K3 Medium, line 41.** Current: `...and I trained and worked within the NHS before setting up Community Care Physio.` Proposed: `...and my background is NHS community rehabilitation.`

`CONTENT-CALENDAR-19OCT-13NOV.md`:
- **K4 High, line 122.** Current: `I'm Zakery Shelley, the one physiotherapist behind Community Care Physio.` Proposed: `I'm Zakery Shelley, lead clinician at Community Care Physio, and every resident has one named clinician.`
- **K5 High, lines 158, 164 and 212.** Current: `I'm Zakery Shelley, and I provide the visits myself.` Proposed: `I'm Zakery Shelley, lead clinician at Community Care Physio, and each client has one named clinician from assessment to discharge.`
- **K6 Medium, lines 50 and 56.** Current: `I'm Zakery Shelley, the physiotherapist behind Community Care Physio.` Proposed: `I'm Zakery Shelley, lead clinician at Community Care Physio.`
- **K7 Medium, lines 128 and 218.** Current: `...the physiotherapist behind the service.` and `...the physiotherapist providing the visits.` Proposed for both: `...lead clinician at Community Care Physio.`
- **K8 Low, lines 68, 176, 194 and 230.** Plain `I'm Zakery Shelley,` openers. Optional: add `lead clinician at Community Care Physio` after the name for consistency.

## L. Facebook posts (`_local-only/outputs/facebook/`)

Posts dated before 19 Oct are probably live already. Use these edits only if a post is reused or reposted.

- **L1 High, `week-5-9-oct/2026-10-09-small-ask.md` line 5.** Current: `It's just me, Zakery Shelley, building a local independent practice, and these small bits of support help people nearby hear about what I do.` Proposed: `I'm Zakery Shelley, lead clinician at Community Care Physio, and every review or mention helps people nearby hear about what we do.`
- **L2 High, same file line 17.** Current: `I'm building Community Care Physio as a local independent practice.` Proposed: `Community Care Physio is a local home visit physiotherapy practice.`
- **L3 Low, same file lines 7 and 19.** Current: `...everyone who has supported me so far` Proposed: `...everyone who has supported us so far`
- **L4 High, `week-12-16-oct/2026-10-16-thank-you.md` line 3.** Current: `A mention to a friend or neighbour makes a real difference to a small independent practice like mine.` Proposed: `A mention to a friend or neighbour makes a real difference to a local practice like ours.`
- **L5 High, same file line 5.** Current: `It's just me, Zakery Shelley, visiting people at home across Wimbledon, Wandsworth, Tooting, Colliers Wood, Merton, Fulham and Putney.` Proposed: `I'm Zakery Shelley, lead clinician at Community Care Physio, and our home visits cover Wimbledon, Wandsworth, Tooting, Colliers Wood, Merton, Fulham and Putney.`
- **L6 High, same file line 15.** Current: `...local word of mouth makes a real difference to my small independent practice.` Proposed: `...local word of mouth makes a real difference to our practice.`
- **L7 Medium, `2026-10-02-where-i-cover-group-post.md` line 3.** Current: `I'm Zakery Shelley, the physiotherapist behind Community Care Physio.` Proposed: `I'm Zakery Shelley, lead clinician at Community Care Physio.`
- **L8 Low, `week-5-9-oct/2026-10-05-autumn-footing.md` line 5 and `week-12-16-oct/2026-10-12-neuro-at-home.md` line 5.** Current: `I'm Zakery Shelley, your local home-visit physiotherapist.` Proposed: `I'm Zakery Shelley, lead clinician at Community Care Physio.`

## M. Review request template (`_local-only/outputs/REVIEW-REQUEST-TEMPLATE.md`)

- **M1 High, line 8 (WhatsApp).** Current: `...a quick Google review would really help a small independent practice like mine get going.` Proposed: `...a quick Google review would really help other families find a practice like ours.`
- **M2 High, line 20 (email).** Current: `...would genuinely help a new, independent practice like this one get off the ground — it's one of the main ways people nearby find out I exist.` Proposed: `...would help other families find us. It is one of the main ways people nearby choose a physiotherapist they can trust.`

---

## Notes for the owner

- The strongest remaining solo or new signals on public pages: A1 "Accepting new patients", A2 "Est. 2026", D3 "A community physiotherapist, not a clinic", E2 "run by". Fix those first.
- "NHS-trained" appears across the homepage, pack and 17 area pages. It is not an NHS post mention, but your rule names "NHS community rehabilitation background" as the only wording. The proposals above use that wording where a line is already being edited. Say if you want a full sweep.
- "Evenings and weekends" appears on area pages and the agency sheet. It is a patient benefit, not solo framing, so it is left alone.
- Applying any of this means: edit sources, run `tools/build-areas.mjs`, rebuild both PDFs with `tools/referral-pack/build.mjs`, run the tests, then a commit and deploy that needs your yes.
