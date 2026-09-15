import { cleanEnquiry, validateSent } from './enquiry-model.js';

export function createEnquiryService({ db, stripe }) {
  async function command(id, action, payload = {}, version = null) {
    const { data, error } = await db.rpc('enquiry_command', {p_id:id,p_action:action,p_payload:payload,p_version:version});
    if (error) throw error;
    return data;
  }
  async function get(id) {
    const { data,error } = await db.from('patient_enquiries').select('*').eq('id',id).single();
    if (error) throw error;
    return data;
  }
  function checkoutParams(e) {
    return {
      mode:'payment',
      integration_identifier:'ccp_enquiries_kmzpqvra',
      line_items:[{price_data:{currency:'gbp',unit_amount:Number(e.details.amount)*100,
        product_data:{name:'Community Care Physio — Initial Assessment (60 minutes)'}},quantity:1}],
      ...(e.details.channel==='email' && e.details.email ? {customer_email:e.details.email}:{}),
      metadata:{enquiry_id:e.id,attempt_id:e.attempt_id,booking_id:e.booking_id},
      expires_at:Math.floor(new Date(e.expires_at).getTime()/1000),
      success_url:'https://communitycarephysio.co.uk/?enquiry=received',
      cancel_url:'https://communitycarephysio.co.uk/?enquiry=cancelled'
    };
  }
  async function createSession(e) {
    // Persisted parameters and attempt ID make timeout/retry requests identical.
    const session = await stripe.checkout.sessions.create(checkoutParams(e), {idempotencyKey:'enquiry-'+e.attempt_id});
    const record = await command(e.id,'attach',{attempt_id:e.attempt_id,session_id:session.id,url:session.url});
    return {session,record};
  }
  async function settleSession(session, failed = false) {
    const id=session.metadata?.enquiry_id;
    if (!id) throw new Error('Missing enquiry reference');
    const e=await get(id);
    if (session.metadata.attempt_id!==e.attempt_id) return e; // old, already closed attempt
    if (session.metadata.booking_id!==e.booking_id) throw new Error('Booking reference mismatch');
    if (e.stripe_session_id && e.stripe_session_id!==session.id) throw new Error('Session reference mismatch');
    if (session.payment_status==='paid') {
      return command(id,'settle',{attempt_id:e.attempt_id,session_id:session.id,state:'paid',
        amount_total:session.amount_total,currency:session.currency});
    }
    if (failed || session.status==='expired') {
      return command(id,'release',{attempt_id:e.attempt_id,state:failed?'failed':'expired'});
    }
    if (session.status==='complete') {
      return command(id,'settle',{attempt_id:e.attempt_id,session_id:session.id,state:'processing',
        amount_total:session.amount_total,currency:session.currency});
    }
    return e;
  }
  async function refresh(id) {
    let e=await get(id);
    if (e.payment_state==='paid' || !e.attempt_id) return e;
    if (!['creating','open','processing'].includes(e.payment_state)) return e;
    const session=e.stripe_session_id ? await stripe.checkout.sessions.retrieve(e.stripe_session_id) : (await createSession(e)).session;
    return settleSession(session);
  }
  async function handle(body) {
    const {operation,id,version}=body;
    if (operation==='list') {
      const {data,error}=await db.from('patient_enquiries').select('*').order('updated_at',{ascending:false}).limit(500);
      if(error) throw error;
      return {enquiries:data};
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id||'')) throw new Error('Invalid enquiry reference');
    let enquiry;
    if(operation==='save') enquiry=await command(id,'save',cleanEnquiry(body),version);
    else if(operation==='sent') {
      const e=await get(id);
      validateSent(e,body.kind,body.channel);
      enquiry=await command(id,'sent',{kind:body.kind,channel:body.channel},version);
    } else if(operation==='checkout') {
      const e=await command(id,'reserve',{},version);
      if(e.payment_state==='paid') enquiry=e;
      else if(e.stripe_session_id) enquiry=await refresh(id);
      else enquiry=(await createSession(e)).record;
    } else if(operation==='refresh') enquiry=await refresh(id);
    else if(operation==='cancel') {
      const e=await get(id);
      if(e.payment_state==='paid') throw new Error('This appointment is already paid. Use the patient booking controls.');
      if(!['creating','open','processing'].includes(e.payment_state)) return {enquiry:e};
      let session=e.stripe_session_id ? await stripe.checkout.sessions.retrieve(e.stripe_session_id) : (await createSession(e)).session;
      if(session.status==='open') session=await stripe.checkout.sessions.expire(session.id);
      enquiry=await settleSession(session);
      if(enquiry.payment_state==='processing') throw new Error('Payment is processing. Wait for Stripe to confirm the outcome.');
    } else throw new Error('Unknown enquiry operation');
    return {enquiry};
  }
  return {handle,settleSession};
}
