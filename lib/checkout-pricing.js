import {fullPostcode,travelQuote} from '../assets/coverage-policy.js';
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
  'Extended Session':     9000,   // 60-min extended already includes the extra time — no complex surcharge
  'Starter Programme':    35500,
  'Full Programme':       52500,
  'Block of 4 Sessions':  34000,
  'Block of 6 Sessions':  51000,
};

const COMPLEX_CATS = ['Neurological / Stroke','Respiratory Issue','Post-Surgical / Post-Op Recovery','Falls Prevention & Management'];

function isComplexBooking(concernAreas) {
  if (!concernAreas) return false;
  return COMPLEX_CATS.some(cat => concernAreas.includes(cat));
}


export function checkoutQuote(bd){
  if(!Object.hasOwn(PRICES,bd.appointment))throw new Error('Please select a valid appointment.');
  if(!fullPostcode(bd.postcode))throw new Error('Please enter a full UK postcode.');
  const travel=travelQuote(bd.postcode,bd.appointment);
  if(travel.fee===null)throw new Error('Please contact us to arrange a visit outside our coverage map.');
  const complex=isComplexBooking(bd.concernAreas);
  const treatment=complex?COMPLEX_PRICES[bd.appointment]:PRICES[bd.appointment];
  return {treatment,travel,priceInPence:treatment+travel.total*100,complexityFee:(treatment-PRICES[bd.appointment])/100};
}
