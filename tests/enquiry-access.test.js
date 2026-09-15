import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';

// Synthetic configuration only; rejected requests must never reach a service.
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'synthetic-test-key';
process.env.STRIPE_SECRET_KEY = 'sk_test_synthetic';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_synthetic';
const { default: bookings } = await import('../api/get-bookings.js');
const { default: webhook } = await import('../api/stripe-webhook.js');
function response() {
  return { headers: {}, setHeader(k,v){this.headers[k]=v;}, status(s){this.code=s;return this;},
    json(body){this.body=body;return this;}, end(){return this;} };
}
test('enquiry API denies absent and invalid admin credentials before any data access', async () => {
  for (const token of [undefined, 'invalid', 'forged.signature']) {
    const res=response();
    await bookings({method:'POST',body:{action:'enquiries',operation:'list',token}},res);
    assert.equal(res.code,401);
    assert.deepEqual(res.body,{error:'Unauthorised'});
    assert.equal(res.headers['Cache-Control'],'no-store');
  }
});
test('forged payment webhook is rejected before booking promotion', async () => {
  const req=Readable.from([Buffer.from(JSON.stringify({type:'checkout.session.completed',data:{object:{metadata:{enquiry_id:'fake'}}}}))]);
  req.method='POST';req.headers={'stripe-signature':'invalid'};
  const res=response();await webhook(req,res);
  assert.equal(res.code,400);
  assert.match(res.body.error,/Webhook Error/);
});
