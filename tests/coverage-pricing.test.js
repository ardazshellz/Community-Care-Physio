import test from 'node:test';
import assert from 'node:assert/strict';
import {checkoutQuote} from '../lib/checkout-pricing.js';
import {coverageBand,postcodeDistrict,travelQuote} from '../assets/coverage-policy.js';
test('exact postcode matching prevents SW1/SW15 confusion and handles formatting',()=>{
 assert.equal(postcodeDistrict('sw15 1aa'),'SW15');
 assert.equal(coverageBand('W4 1AA').fee,15);
 assert.equal(coverageBand('SW15 1AA').fee,0);
 assert.equal(coverageBand('CR0 1AA').fee,35);
 assert.equal(coverageBand('M1 1AA').fee,null);
});
test('checkout ignores forged client prices and travel fields',()=>{
 const q=checkoutQuote({appointment:'Initial Assessment',postcode:'W4 1AA',price:1,travelFee:0});
 assert.equal(q.priceInPence,11500);assert.equal(q.treatment,10000);
 assert.equal(q.travel.total,15);
});
test('package travel charges apply to every visit alongside complexity',()=>{
 const q=checkoutQuote({appointment:'Full Programme',postcode:'CR0 1AA',concernAreas:'Neurological / Stroke'});
 assert.equal(q.travel.visits,6);assert.equal(q.travel.total,210);
 assert.equal(q.priceInPence,73500);assert.equal(q.complexityFee,90);
 assert.equal(travelQuote('SW15 1AA','Starter Programme').total,0);
});
test('complex extended sessions add the £15 surcharge',()=>{
 const q=checkoutQuote({appointment:'Extended Session',postcode:'SW15 1AA',concernAreas:'Neurological / Stroke'});
 assert.equal(q.treatment,10500);assert.equal(q.priceInPence,10500);assert.equal(q.complexityFee,15);
});
test('unknown services, incomplete postcodes and outside-map locations cannot create checkout',()=>{
 for(const bd of [{appointment:'fake',postcode:'W4 1AA'},{appointment:'Initial Assessment',postcode:'W4'},{appointment:'Initial Assessment',postcode:'M1 1AA'}])assert.throws(()=>checkoutQuote(bd));
});
