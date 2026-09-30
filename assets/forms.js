// Public forms: case-manager referral form and the pre-visit intake & consent form
// (opened from a personal link: /?intake=<token>). Both post to /api/practice.
(function () {
  const post = async (payload) => {
    const r = await fetch('/api/practice', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(data.error || 'Something went wrong. Please try again or email infoccphysio@gmail.com.'), { status: r.status });
    return data;
  };
  // Turn inputs named "a.b" into nested objects; checkboxes become booleans.
  const collect = (form) => {
    const out = {};
    form.querySelectorAll('input[name],input[data-list],select[name],textarea[name]').forEach((el) => {
      if (['website', 'area', 'flag', 'forWhom'].includes(el.name) || el.disabled) return;
      if (el.type === 'checkbox' && el.dataset.list) {
        if (!el.checked) return;
        const list = (out[el.dataset.list] = out[el.dataset.list] || []);
        list.push(el.value);
        return;
      }
      const value = el.type === 'checkbox' ? el.checked : el.value.trim();
      const path = el.name.split('.');
      let node = out;
      path.slice(0, -1).forEach((k) => { node = node[k] = node[k] || {}; });
      node[path[path.length - 1]] = value;
    });
    return out;
  };
  const firstInvalid = (form) => Array.from(form.querySelectorAll('[required]')).find((el) =>
    el.type === 'checkbox' ? !el.checked : !el.value.trim() || (el.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(el.value.trim())));

  // ── Referral form ──
  const rf = document.getElementById('referralForm');
  if (rf) {
    const status = document.getElementById('referralStatus');
    rf.addEventListener('submit', async (e) => {
      e.preventDefault();
      const bad = firstInvalid(rf);
      if (bad) { status.textContent = 'Please complete the required fields marked *.'; status.className = 'rf-status err'; bad.focus(); return; }
      const btn = rf.querySelector('.rf-submit');
      btn.disabled = true; status.className = 'rf-status'; status.textContent = 'Sending…';
      const data = collect(rf);
      const n = parseInt(data.funding.authorisedSessions, 10);
      data.funding.authorisedSessions = Number.isFinite(n) ? n : null;
      data.funding.reportDue = data.funding.reportDue || null;
      try {
        const res = await post({ action: 'referral', data, website: rf.website.value });
        rf.reset();
        status.className = 'rf-status ok';
        status.textContent = `Thank you — referral received${res.ref ? ` (reference ${res.ref})` : ''}. We've emailed you a confirmation and will reply within one working day.`;
      } catch (err) {
        status.className = 'rf-status err'; status.textContent = err.message;
      } finally { btn.disabled = false; }
    });
  }

  // ── Referral type toggle: family/friend (default) or clinician ──
  const tabs = document.querySelectorAll('[data-rf-mode]');
  const intro = document.getElementById('rfIntro');
  const INTRO = {
    family: "Worried about a parent, relative or friend? Tell us a little about them and we'll get in touch to talk it through. Clinicians and case managers can use the clinician form.",
    clinician: "For rehabilitation case managers, solicitors, insurers, GPs and care teams. Chartered, HCPC-registered physiotherapy in the client's own home, with clear reporting and invoicing to your organisation."
  };
  const setMode = (mode) => {
    tabs.forEach((t) => t.setAttribute('aria-selected', String(t.dataset.rfMode === mode)));
    document.getElementById('rfFamily').hidden = mode !== 'family';
    document.getElementById('rfClinician').hidden = mode !== 'clinician';
    if (intro) intro.textContent = INTRO[mode];
  };
  tabs.forEach((t) => t.addEventListener('click', () => setMode(t.dataset.rfMode)));
  // Deep link for case managers: /#referrals-clinician
  if (location.hash === '#referrals-clinician') setMode('clinician');

  // ── Self / family / friend referral with booking-style triage ──
  const ff = document.getElementById('familyForm');
  if (ff) {
    // Same rules as the server (lib/practice-model.js), which recalculates independently.
    const COMPLEX = typeof COMPLEX_CATS !== 'undefined' ? COMPLEX_CATS : ['Neurological / Stroke', 'Respiratory Issue', 'Post-Surgical / Post-Op Recovery', 'Falls Prevention & Management'];
    const FLAG_TEXT = { helpToMove: 'needs help from another person to move', recentHospital: 'recently home from hospital', falls: 'repeated falls', memory: 'memory problems or confusion', conditions: 'several long-term conditions' };
    const checked = (name) => Array.from(ff.querySelectorAll(`input[name=${name}]:checked`)).map((i) => i.value);
    const isSelf = () => ff.querySelector('input[name=forWhom]:checked')?.value === 'me';
    const aboutYou = document.getElementById('rfAboutYou');
    const clientPhone = ff.querySelector('[name="client.phone"]');
    const clientEmail = ff.querySelector('[name="client.email"]');
    ff.querySelectorAll('[data-self]').forEach((el) => { el.dataset.other = el.textContent; });

    const applyWho = () => {
      const self = isSelf();
      aboutYou.hidden = self;
      aboutYou.querySelectorAll('input').forEach((i) => { i.disabled = self; });
      document.getElementById('rfClientLegend').textContent = self ? 'Your details' : "About the person you're referring";
      ff.querySelectorAll('[data-self]').forEach((el) => { el.textContent = self ? el.dataset.self : el.dataset.other; });
      // When referring yourself we need a way to reach you.
      clientPhone.required = self; clientEmail.required = self;
    };

    // Travel charge from the coverage map, shown next to the postcode.
    const travelEl = document.getElementById('rfTravel');
    const travelBand = () => (window.CCPCoverage ? window.CCPCoverage.coverageBand(ff.querySelector('[name="client.postcode"]').value) : null);
    const showTravel = () => {
      const pc = ff.querySelector('[name="client.postcode"]').value.trim();
      const band = travelBand();
      if (!pc || !band) { travelEl.textContent = ''; return; }
      travelEl.className = 'rf-travel ' + band.tier;
      travelEl.textContent = band.fee === null ? 'Outside our usual map — we’ll confirm travel with you.'
        : band.fee === 0 ? '✓ Travel included in this area.'
        : `+ £${band.fee} travel charge per visit for this area.`;
    };

    const triageBox = document.getElementById('rfTriage');
    const showTriage = () => {
      const a = checked('area');
      triageBox.hidden = !a.length;
      if (!a.length) return;
      const flags = checked('flag').filter((f) => FLAG_TEXT[f]);
      const why = [...a.filter((x) => COMPLEX.includes(x)).map((x) => x.toLowerCase()), ...flags.map((f) => FLAG_TEXT[f])];
      const complex = why.length > 0;
      const band = travelBand();
      const travel = band && band.fee ? ` plus £${band.fee} travel` : '';
      triageBox.className = 'rf-triage' + (complex ? ' complex' : '');
      triageBox.textContent = complex
        ? `This looks like a complex case (${why.join(', ')}), which needs a longer, more thorough first visit. Initial assessment: £130${travel} (60 minutes).`
        : `Initial assessment: £100${travel} (60 minutes).`;
    };

    ff.addEventListener('change', (e) => {
      if (e.target.name === 'forWhom') applyWho();
      if (['area', 'flag'].includes(e.target.name)) showTriage();
    });
    ff.querySelector('[name="client.postcode"]').addEventListener('input', () => { showTravel(); showTriage(); });

    const status = document.getElementById('familyStatus');
    const dialog = document.getElementById('rfSent');
    ff.addEventListener('submit', async (e) => {
      e.preventDefault();
      const bad = Array.from(ff.querySelectorAll('[required]')).find((el) => !el.disabled && (el.type === 'checkbox' ? !el.checked : !el.value.trim() || (el.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(el.value.trim()))));
      if (bad) { status.className = 'rf-status err'; status.textContent = 'Please complete the required fields marked *.'; bad.focus(); return; }
      if (!checked('area').length) { status.className = 'rf-status err'; status.textContent = 'Please tick at least one area of concern.'; ff.querySelector('input[name=area]').focus(); return; }
      const d = collect(ff);
      const self = isSelf();
      const you = self ? { name: d.client.name, role: 'self-referral', phone: d.client.phone, email: d.client.email } : d.referrer;
      const data = {
        source: 'family',
        referrer: { name: you.name, role: you.role || '', phone: you.phone, email: you.email, organisation: '' },
        client: { name: d.client.name, dob: d.client.dob || '', phone: d.client.phone, email: d.client.email, address: d.client.address, postcode: d.client.postcode, contactName: '', contactPhone: '', contactRelation: '' },
        clinical: { condition: d.reason + (d.history ? `\n\nRelevant history: ${d.history}` : ''), precautions: '' },
        service: { type: 'assessment-treatment', urgency: 'routine', notes: `${self ? 'Self-referral. ' : ''}Best way to reach the referrer: ${d.contactPref}` },
        funding: { caseRef: '', payerName: '', invoiceEmail: '', poNumber: '', authorisedSessions: null, reportDue: null, invoiceAddress: '' },
        triage: { areas: checked('area'), flags: Object.fromEntries(checked('flag').map((f) => [f, true])) },
        consent: d.consent === true
      };
      const btn = ff.querySelector('.rf-submit');
      btn.disabled = true; status.className = 'rf-status'; status.textContent = 'Sending…';
      try {
        const res = await post({ action: 'referral', data, website: ff.website.value });
        ff.reset(); applyWho(); showTravel(); showTriage();
        const msg = `Thank you — we've received your referral${res.ref ? ` (reference ${res.ref})` : ''} and will be in touch within one working day.`;
        status.className = 'rf-status ok'; status.textContent = msg;
        document.getElementById('rfSentText').textContent = msg;
        if (dialog?.showModal) dialog.showModal();
      } catch (err) {
        status.className = 'rf-status err'; status.textContent = err.message;
      } finally { btn.disabled = false; }
    });
    applyWho();
  }

  // ── Intake & consent form ──
  const token = new URLSearchParams(location.search).get('intake');
  if (!token || !/^[0-9a-f-]{36}$/i.test(token)) return;

  const CONDITIONS = ['Heart condition', 'High or low blood pressure', 'Stroke or TIA', 'Diabetes', 'Osteoporosis', 'Arthritis', 'Lung condition (e.g. COPD, asthma)', 'Epilepsy', 'Cancer (current or past)', 'Neurological condition (e.g. MS, Parkinson\'s)', 'Dementia or memory problems', 'Joint replacement', 'Pacemaker or implant'];
  const RED_FLAGS = ['Chest pain on exertion', 'Unexplained weight loss', 'Dizziness or fainting', 'New numbness or weakness', 'Changes in bladder or bowel control', 'Two or more falls in the last year'];
  const chk = (name, items) => items.map((t) => `<label class="if-chk"><input type="checkbox" data-list="${name}" value="${t.replace(/"/g, '&quot;')}"><span>${t}</span></label>`).join('');

  const shell = document.createElement('div');
  shell.className = 'if-overlay';
  shell.setAttribute('role', 'dialog');
  shell.setAttribute('aria-modal', 'true');
  shell.setAttribute('aria-labelledby', 'ifTitle');
  shell.innerHTML = `<div class="if-card"><p class="if-brand">Community Care Physio</p><h1 id="ifTitle">Before your first visit</h1><div id="ifBody"><p>Loading your form…</p></div></div>`;
  document.body.appendChild(shell);
  document.body.style.overflow = 'hidden';
  // Keep keyboard and screen-reader focus inside the form.
  Array.from(document.body.children).forEach((el) => { if (el !== shell && el.tagName !== 'SCRIPT') el.inert = true; });
  const body = shell.querySelector('#ifBody');
  const done = (html) => { body.innerHTML = html; };

  post({ action: 'intake-get', token }).then(({ firstName, status }) => {
    if (status === 'completed') return done('<p>Thank you — this form has already been completed. There is nothing more to do.</p><p><a href="/">Return to the website</a></p>');
    body.innerHTML = `
      <p>Hello ${String(firstName || '').replace(/[<>&"]/g, '')}, please complete this short form before your appointment. It takes about 5 minutes and helps us prepare for your visit safely. If someone is completing it for you, that's fine — please say so at the end.</p>
      <form id="intakeForm" novalidate>
        <fieldset><legend>Your health</legend>
          <p class="if-q">Do you have, or have you had, any of the following?</p>
          <div class="if-chks">${chk('conditions', CONDITIONS)}</div>
          <label>Other conditions or recent operations<textarea name="surgeries" rows="2"></textarea></label>
          <label>Current medications<textarea name="medications" rows="2" placeholder="Or say 'list available at visit'"></textarea></label>
          <label>Allergies<input name="allergies"></label>
          <p class="if-q">Do any of these apply to you at the moment?</p>
          <div class="if-chks">${chk('redFlags', RED_FLAGS)}</div>
          <p class="if-warn">If you have chest pain, sudden weakness, or feel very unwell, call 999. For urgent advice, call NHS 111.</p>
        </fieldset>
        <fieldset><legend>Getting around and your home</legend>
          <label>Walking aids or equipment you use<input name="mobilityAids" placeholder="e.g. stick, frame, none"></label>
          <label>Access to your home<input name="homeAccess" placeholder="e.g. 2nd floor, lift, key safe, parking"></label>
          <label>What would you most like physiotherapy to help with?<textarea name="goals" rows="3"></textarea></label>
        </fieldset>
        <fieldset><legend>Contacts</legend>
          <label>GP name and practice<input name="gp"></label>
          <div class="if-row"><label>Emergency contact name<input name="emergencyName"></label><label>Emergency contact phone<input name="emergencyPhone" type="tel"></label></div>
          <label>Anything else we should know?<textarea name="otherInfo" rows="2"></textarea></label>
        </fieldset>
        <fieldset><legend>Consent</legend>
          <label class="if-chk"><input type="checkbox" name="consentAssessment" required><span>I consent to a physiotherapy assessment and treatment, which may include hands-on techniques and exercise. The physiotherapist will explain each part and I can stop at any time. *</span></label>
          <label class="if-chk"><input type="checkbox" name="consentData" required><span>I agree to Community Care Physio keeping records of my care, including health information, as described in the <a href="#" data-policy="privacy">privacy policy</a>. *</span></label>
          <label class="if-chk"><input type="checkbox" name="policyAcknowledged" required><span>I have read the <a href="#" data-policy="terms">cancellation policy</a> (£50 for cancellations within 24 hours or missed appointments). *</span></label>
          <label class="if-chk"><input type="checkbox" name="consentShareGp"><span>I'm happy for updates to be shared with my GP if clinically useful.</span></label>
          <label class="if-chk"><input type="checkbox" name="consentShareReferrer"><span>If I was referred by a case manager or insurer, I'm happy for reports to be shared with them.</span></label>
          <label class="if-chk"><input type="checkbox" name="consentPhotos"><span>I'm happy for photos or videos to be taken for my clinical record only (never shared or published).</span></label>
          <label class="if-chk"><input type="checkbox" name="signedOnBehalf" id="ifBehalf"><span>I am completing this on behalf of the patient.</span></label>
          <label id="ifRel" hidden>Your relationship to the patient<input name="relationship"></label>
          <label>Type your full name to sign *<input name="fullName" required autocomplete="name"></label>
        </fieldset>
        <input class="rf-hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
        <button type="submit" class="btn-p">Submit form</button>
        <p class="rf-status" id="intakeStatus" role="status" aria-live="polite"></p>
      </form>`;
    const f = body.querySelector('#intakeForm');
    // Policies open inside this dialog (the site's legal modal sits behind it).
    f.insertAdjacentHTML('afterbegin', '<div id="ifPolicy" class="if-policy" hidden><button type="button" class="btn-p" id="ifPolicyClose">Back to the form</button><div id="ifPolicyText"></div></div>');
    f.addEventListener('click', (e) => {
      const link = e.target.closest('[data-policy]');
      if (!link) return;
      e.preventDefault();
      f.querySelector('#ifPolicyText').innerHTML = (typeof LEGAL !== 'undefined' && LEGAL[link.dataset.policy]) || '';
      f.querySelector('#ifPolicy').hidden = false;
      f.querySelector('#ifPolicy').scrollIntoView({ block: 'start' });
    });
    f.querySelector('#ifPolicyClose').addEventListener('click', () => { f.querySelector('#ifPolicy').hidden = true; f.querySelector('[name=policyAcknowledged]').scrollIntoView({ block: 'center' }); });
    f.querySelector('#ifBehalf').addEventListener('change', (e) => { f.querySelector('#ifRel').hidden = !e.target.checked; });
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const st = f.querySelector('#intakeStatus');
      const bad = firstInvalid(f);
      if (bad) { st.className = 'rf-status err'; st.textContent = 'Please tick the required consent boxes and type your name.'; bad.focus(); return; }
      const btn = f.querySelector('button[type=submit]'); btn.disabled = true; st.className = 'rf-status'; st.textContent = 'Sending…';
      try {
        await post({ action: 'intake-submit', token, data: collect(f), website: f.website.value });
        done('<p><strong>Thank you — your form has been received.</strong></p><p>We look forward to seeing you. If anything changes before your visit, call or WhatsApp 07508 401627.</p><p><a href="/">Return to the website</a></p>');
      } catch (err) { st.className = 'rf-status err'; st.textContent = err.message; btn.disabled = false; }
    });
  }).catch((err) => {
    done(err.status === 410
      ? '<p>This link has expired. Please contact us on 07508 401627 or infoccphysio@gmail.com for a new one.</p>'
      : err.status === 404 ? '<p>This link is not valid. Please check you used the full link from your email, or contact us on 07508 401627.</p>'
      : `<p>${String(err.message).replace(/[<>&"]/g, '')}</p>`);
  });
})();
