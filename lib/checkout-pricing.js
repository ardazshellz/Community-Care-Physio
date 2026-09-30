import {fullPostcode,travelQuote} from '../assets/coverage-policy.js';
import {COMPLEX_AREAS,TRIAGE_FLAGS} from './practice-model.js';
const PRICES = {
  'Initial Assessment':   10000,
  'Standard Session':     7500,
  'Extended Session':     9000,
  'Starter Programme':    29500,
  'Full Programme':       43500,
  'Block of 4 Sessions':  28000,
  'Block of 6 Sessions':  42000,
};

// Complex pricing (in pence). A booking is "complex" when the client selected one
// or more clinically complex areas of concern. The server recomputes complexity
// from the concern categories itself — it never trusts the client's price directly.
const COMPLEX_PRICES = {
  'Initial Assessment':   13000,
  'Standard Session':     9000,
  'Extended Session':    10500,
  'Starter Programme':    35500,
  'Full Programme':       52500,
  'Block of 4 Sessions':  34000,
  'Block of 6 Sessions':  51000,
};

// Triage questions that also make a booking complex (same list as the referral form;
// 'livesAlone' is recorded for safety planning only).
export const COMPLEX_FLAGS = Object.keys(TRIAGE_FLAGS).filter(f => f !== 'livesAlone');

// Only known flag keys are kept, so the booking record stays clean.
export function bookingFlags(flags) {
  return Array.isArray(flags) ? [...new Set(flags.filter(f => Object.hasOwn(TRIAGE_FLAGS, f)))] : [];
}

function isComplexBooking(concernAreas, flags) {
  const areas = Array.isArray(concernAreas) ? concernAreas.join(', ') : String(concernAreas || '');
  return COMPLEX_AREAS.some(cat => areas.includes(cat)) || bookingFlags(flags).some(f => COMPLEX_FLAGS.includes(f));
}


export function checkoutQuote(bd){
  if(!Object.hasOwn(PRICES,bd.appointment))throw new Error('Please select a valid appointment.');
  if(!fullPostcode(bd.postcode))throw new Error('Please enter a full UK postcode.');
  const travel=travelQuote(bd.postcode,bd.appointment);
  if(travel.fee===null)throw new Error('Please contact us to arrange a visit outside our coverage map.');
  const complex=isComplexBooking(bd.concernAreas,bd.triageFlags);
  const treatment=complex?COMPLEX_PRICES[bd.appointment]:PRICES[bd.appointment];
  return {treatment,travel,priceInPence:treatment+travel.total*100,complexityFee:(treatment-PRICES[bd.appointment])/100};
}
