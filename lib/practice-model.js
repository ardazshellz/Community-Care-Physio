import { coverageBand } from '../assets/coverage-policy.js';
// Pure validation: only explicitly allowed fields cross the public boundary.
function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value;
}

function text(value, label, max = 200, required = false) {
  if (value == null) value = '';
  if (typeof value !== 'string') throw new Error(`${label} must be text.`);
  value = value.trim();
  if (required && !value) throw new Error(`Please provide ${label}.`);
  if (value.length > max) throw new Error(`${label} must be ${max} characters or fewer.`);
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) throw new Error(`${label} contains invalid characters.`);
  return value;
}

function email(value, label, required = false) {
  const result = text(value, label, 200, required);
  if (result && !/^[^\s@<>,;"\\]+@[^\s@<>,;"\\]+\.[^\s@<>,;"\\]+$/.test(result)) throw new Error(`Please provide a valid ${label}.`);
  return result;
}

function date(value, label, required = false) {
  const result = text(value, label, 10, required);
  if (!result) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || result.startsWith('0000') ||
    !Number.isFinite(Date.parse(`${result}T00:00:00Z`)) ||
    new Date(`${result}T00:00:00Z`).toISOString().slice(0, 10) !== result) {
    throw new Error(`Please provide a valid ${label} (YYYY-MM-DD).`);
  }
  return result;
}

function choice(value, values, label, fallback) {
  if (value == null || value === '') value = fallback;
  if (!values.includes(value)) throw new Error(`Please choose a valid ${label}.`);
  return value;
}

function fields(value, names, label, max = 200) {
  return Object.fromEntries(names.map(name => [name, text(value[name], `${label} ${name}`, max)]));
}

// Same areas of concern and complexity rule as the online booking triage (index.html COMPLEX_CATS).
export const CONCERN_AREAS = ['Neurological / Stroke', 'MSK Issue', 'Respiratory Issue', 'Falls Prevention & Management', 'Sports Rehab', 'Post-Surgical / Post-Op Recovery'];
export const COMPLEX_AREAS = ['Neurological / Stroke', 'Respiratory Issue', 'Post-Surgical / Post-Op Recovery', 'Falls Prevention & Management'];
// Extra triage questions on the referral form. Any of these (except livesAlone,
// which is recorded for safety planning) makes the case complex.
export const TRIAGE_FLAGS = {
  helpToMove: 'Needs help from another person to walk, stand or get up',
  recentHospital: 'Home from hospital in the last 6 weeks',
  falls: 'Two or more falls in the last year',
  memory: 'Memory problems or confusion',
  conditions: 'Several long-term health conditions',
  livesAlone: 'Lives alone'
};
const NOT_COMPLEX = ['livesAlone'];

export function cleanReferral(data) {
  object(data, 'Referral');
  const referrer = object(data.referrer, 'Referrer');
  const client = object(data.client, 'Client');
  const clinical = object(data.clinical, 'Clinical details');
  const service = object(data.service ?? {}, 'Service');
  const funding = object(data.funding ?? {}, 'Funding');
  if (data.consent !== true) throw new Error('Consent is required to submit a referral.');
  const sessions = funding.authorisedSessions ?? null;
  if (sessions !== null && (!Number.isSafeInteger(sessions) || sessions < 0)) throw new Error('Authorised sessions must be a non-negative whole number.');
  return {
    referrer: {
      ...fields(referrer, ['organisation', 'role', 'phone'], 'Referrer'),
      name: text(referrer.name, 'referrer name', 200, true),
      email: email(referrer.email, 'referrer email', true)
    },
    client: {
      ...fields(client, ['phone', 'postcode', 'contactName', 'contactPhone', 'contactRelation'], 'Client'),
      name: text(client.name, 'client name', 200, true),
      email: email(client.email, 'client email'),
      dob: date(client.dob, 'date of birth'),
      address: text(client.address, 'client address', 4000)
    },
    clinical: {
      condition: text(clinical.condition, 'clinical condition', 4000, true),
      precautions: text(clinical.precautions, 'precautions', 4000)
    },
    service: {
      type: choice(service.type, ['assessment-report', 'assessment-treatment', 'other'], 'service', 'other'),
      urgency: choice(service.urgency, ['routine', 'urgent'], 'urgency', 'routine'),
      notes: text(service.notes, 'service notes', 4000)
    },
    funding: {
      ...fields(funding, ['caseRef', 'payerName', 'poNumber'], 'Funding'),
      invoiceEmail: email(funding.invoiceEmail, 'invoice email'),
      invoiceAddress: text(funding.invoiceAddress, 'invoice address', 4000),
      authorisedSessions: sessions,
      reportDue: date(funding.reportDue, 'report due date')
    },
    consent: true,
    ...triage(data)
  };
}

// Family/friend referrals carry the booking-style triage. Complexity is decided here,
// never taken from the browser.
function triage(data) {
  const source = choice(data.source, ['clinician', 'family'], 'referral type', 'clinician');
  if (source === 'clinician') return { source };
  const areas = data.triage?.areas ?? [];
  if (!Array.isArray(areas) || !areas.length || areas.some(a => !CONCERN_AREAS.includes(a))) {
    throw new Error('Please choose at least one area of concern.');
  }
  const unique = [...new Set(areas)];
  const raw = data.triage?.flags ?? {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid triage answers.');
  const flags = Object.keys(TRIAGE_FLAGS).filter(k => raw[k] === true);
  const reasons = [...unique.filter(a => COMPLEX_AREAS.includes(a)), ...flags.filter(f => !NOT_COMPLEX.includes(f)).map(f => TRIAGE_FLAGS[f])];
  const complex = reasons.length > 0;
  const band = coverageBand(data.client?.postcode);
  const travel = band.fee === null ? 'travel to be confirmed' : band.fee === 0 ? 'travel included' : `+£${band.fee} travel`;
  return { source, triage: {
    areas: unique, flags, complex, reasons, travelTier: band.tier, travelFee: band.fee,
    suggested: `${complex ? 'Initial assessment (complex needs) £130' : 'Initial assessment £100'}, ${travel}`
  } };
}

export function cleanIntake(data) {
  object(data, 'Intake');
  const result = { fullName: text(data.fullName, 'full name for your signature', 200, true) };
  for (const field of ['consentAssessment', 'consentData', 'policyAcknowledged']) {
    if (data[field] !== true) throw new Error('Assessment consent, data consent and policy acknowledgement are required.');
    result[field] = true;
  }
  for (const field of ['consentShareGp', 'consentShareReferrer', 'consentPhotos', 'signedOnBehalf']) {
    if (data[field] !== undefined && typeof data[field] !== 'boolean') throw new Error(`${field} must be true or false.`);
    result[field] = data[field] ?? false;
  }
  for (const field of ['conditions', 'redFlags']) {
    const items = data[field] ?? [];
    if (!Array.isArray(items) || items.length > 40) throw new Error(`${field} must contain up to 40 items.`);
    result[field] = items.map(item => text(item, field, 100, true));
  }
  Object.assign(result, fields(data, ['medications', 'allergies', 'surgeries', 'gp', 'emergencyName',
    'emergencyPhone', 'goals', 'mobilityAids', 'homeAccess', 'otherInfo', 'relationship'], 'Intake', 4000));
  if (result.signedOnBehalf && !result.relationship) throw new Error('Please provide your relationship to the patient.');
  // signedAt is added by the server; never accept a client-supplied timestamp.
  return result;
}

export function formatInvoiceNumber(n, year) {
  if (!Number.isSafeInteger(n) || n < 1) throw new Error('Invalid invoice sequence.');
  if (!Number.isInteger(year) || year < 1000 || year > 9999) throw new Error('Invalid invoice year.');
  return `CCP-${year}-${String(n).padStart(4, '0')}`;
}

// Decimal integer arithmetic avoids binary float errors at half-penny boundaries.
function decimal(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error('Invoice quantities and prices must be non-negative finite numbers.');
  const [mantissa, exponent = '0'] = String(value).toLowerCase().split('e');
  const [whole, fraction = ''] = mantissa.split('.');
  const scale = fraction.length - Number(exponent);
  const digits = BigInt(whole + fraction);
  return scale < 0 ? [digits * 10n ** BigInt(-scale), 0] : [digits, scale];
}

export function invoiceTotals(lines) {
  if (!Array.isArray(lines) || lines.length > 100) throw new Error('Provide up to 100 invoice lines.');
  let pence = 0n;
  for (const line of lines) {
    object(line, 'Invoice line');
    const [qty, qtyScale] = decimal(line.qty);
    const [unit, unitScale] = decimal(line.unit);
    const divisor = 10n ** BigInt(qtyScale + unitScale);
    pence += (qty * unit * 100n + divisor / 2n) / divisor;
    if (pence > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Invoice total is too large.');
  }
  const total = Number(pence) / 100;
  return { subtotal: total, total };
}

export function invoiceStatus(inv, todayISO) {
  object(inv, 'Invoice');
  const status = choice(inv.status, ['draft', 'sent', 'paid'], 'invoice status');
  const today = date(todayISO, 'today', true);
  const dueDate = date(inv.dueDate, 'due date', true);
  return status === 'sent' && dueDate < today ? 'overdue' : status;
}

export function cleanInvoice(value) {
  object(value, 'Invoice');
  const payer = object(value.payer, 'Payer');
  const client = object(value.client, 'Client');
  if (!Array.isArray(value.lines) || !value.lines.length) throw new Error('Please provide at least one invoice line.');
  invoiceTotals(value.lines);
  const referralKey = text(value.referralKey, 'referral key');
  if (referralKey && !/^referral:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(referralKey)) throw new Error('Invalid referral key.');
  return {
    payer: {
      name: text(payer.name, 'payer name', 200, true),
      email: email(payer.email, 'payer email'),
      address: text(payer.address, 'payer address', 4000)
    },
    client: { name: text(client.name, 'client name', 200, true) },
    ...fields(value, ['caseRef', 'poNumber'], 'Invoice'),
    issueDate: date(value.issueDate, 'issue date', true),
    dueDate: date(value.dueDate, 'due date', true),
    lines: value.lines.map(line => ({
      date: date(line.date, 'line date'),
      description: text(line.description, 'line description', 4000, true),
      qty: line.qty,
      unit: line.unit
    })),
    notes: text(value.notes, 'invoice notes', 4000),
    status: choice(value.status, ['draft', 'sent', 'paid'], 'invoice status', 'draft'),
    paidDate: date(value.paidDate, 'paid date'),
    referralKey: referralKey || null
  };
}

// ── Outcomes register ──
// One row per measurement: a patient, a measure, a dated score with a timepoint label.
// Lower-is-better measures are listed so audits can say "improved" correctly.
export const OUTCOME_MEASURES = {
  tug: { name: 'Timed Up and Go', unit: 's', max: null, lowerBetter: true },
  tenmwt: { name: '10-metre walk test', unit: 'm/s', max: null, lowerBetter: false },
  tinetti: { name: 'Tinetti (POMA)', unit: '', max: 28, lowerBetter: false },
  berg: { name: 'Berg Balance Scale', unit: '', max: 56, lowerBetter: false },
  ems: { name: 'Elderly Mobility Scale', unit: '', max: 20, lowerBetter: false },
  edmonton: { name: 'Edmonton Frail Scale', unit: '', max: 17, lowerBetter: true },
  sixcit: { name: '6CIT', unit: '', max: 28, lowerBetter: true },
  news2: { name: 'NEWS2', unit: '', max: 20, lowerBetter: true },
  barthel: { name: 'Barthel Index', unit: '', max: 20, lowerBetter: false },
  pain: { name: 'Pain (0–10)', unit: '', max: 10, lowerBetter: true },
  gas: { name: 'Goal Attainment Scaling', unit: '', max: 2, lowerBetter: false }
};
export const OUTCOME_TIMEPOINTS = ['initial', 'review', 'discharge', 'other'];
export function patientKeyFromName(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
export function cleanOutcome(value) {
  object(value, 'Outcome');
  const name = text(value.name, 'patient name', 200, true);
  const measure = choice(value.measure, Object.keys(OUTCOME_MEASURES), 'measure');
  const numeric = Number(value.numeric);
  if (!Number.isFinite(numeric)) throw new Error('Please provide a numeric score.');
  const def = OUTCOME_MEASURES[measure];
  if (def.max != null && (numeric < -2 || numeric > def.max)) throw new Error(`${def.name} must be between 0 and ${def.max}.`);
  if (def.max == null && numeric < 0) throw new Error(`${def.name} cannot be negative.`);
  return {
    patientKey: patientKeyFromName(name),
    name,
    bookingId: text(value.bookingId, 'booking id', 80),
    measure,
    numeric,
    score: text(value.score, 'score text', 80) || String(numeric),
    interp: text(value.interp, 'interpretation', 300),
    date: date(value.date, 'measurement date', true),
    timepoint: choice(value.timepoint, OUTCOME_TIMEPOINTS, 'timepoint', 'other'),
    note: text(value.note, 'note', 1000)
  };
}
