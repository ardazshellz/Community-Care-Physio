-- Admin-only enquiry workflow. Apply to an isolated development database first.
begin;
create table public.patient_enquiries (
 id uuid primary key, details jsonb not null default '{}'::jsonb,
 drafts jsonb not null default '{}'::jsonb, communications jsonb not null default '[]'::jsonb,
 version integer not null default 1,
 payment_state text not null default 'none' check(payment_state in ('none','creating','open','processing','paid','expired','failed')),
 booking_id uuid references public.bookings(id), attempt_id uuid,
 stripe_session_id text unique, payment_url text, expires_at timestamptz, paid_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.patient_enquiries enable row level security;
revoke all on public.patient_enquiries from public, anon, authenticated;
grant select, insert, update on public.patient_enquiries to service_role;
create index patient_enquiries_updated on public.patient_enquiries(updated_at desc);

-- Row locks and versions prevent lost edits; booking promotion is transactional.
create function public.enquiry_command(p_id uuid,p_action text,p_payload jsonb default '{}'::jsonb,p_version integer default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
 e public.patient_enquiries;
 d jsonb; dt date; tm time; appointment_at timestamptz; slot text; offset_mins integer; new_booking uuid;
begin
 if p_action='save' and p_version=0 then
  insert into public.patient_enquiries(id,details,drafts)
   values(p_id,p_payload->'details',p_payload->'drafts') on conflict do nothing;
  if found then return (select to_jsonb(x) from public.patient_enquiries x where id=p_id); end if;
 end if;
 select * into e from public.patient_enquiries where id=p_id for update;
 if not found then raise exception 'Enquiry not found'; end if;
 if p_action in ('save','sent','reserve') and e.version is distinct from p_version then
  raise exception 'This enquiry changed. Reload before saving.';
 end if;
 d := e.details;
 if p_action='save' then
  if e.payment_state in ('creating','open','processing','paid') and d is distinct from p_payload->'details' then
   raise exception 'Appointment and contact details are locked while payment is active or confirmed.';
  end if;
  e.details:=p_payload->'details'; e.drafts:=p_payload->'drafts';
 elsif p_action='sent' then
  if p_payload->>'kind' not in ('intro','payment','confirmation') then raise exception 'Invalid message'; end if;
  if p_payload->>'kind'='payment' and (e.payment_state<>'open' or e.expires_at<=now()) then raise exception 'An active payment link is required'; end if;
  if p_payload->>'kind'='confirmation' and e.payment_state<>'paid' then raise exception 'Payment is not confirmed'; end if;
  e.communications:=e.communications || jsonb_build_array(jsonb_build_object(
   'kind',p_payload->>'kind','channel',p_payload->>'channel','sent_at',now(),
   'body',e.drafts->>(p_payload->>'kind'),'attempt_id',e.attempt_id,'subject',e.drafts->>'subject','recorded_by','clinician'));
 elsif p_action='reserve' then
  if e.payment_state in ('creating','open','processing','paid') then return to_jsonb(e); end if;
  if not exists(select 1 from jsonb_array_elements(e.communications) x where x->>'kind'='intro') then raise exception 'Record the introduction as sent first'; end if;
  if coalesce(d->>'address','')='' or coalesce(d->>'postcode','')='' then raise exception 'Enter the visit address and postcode'; end if;
  dt:=(d->>'date')::date; tm:=(d->>'time')::time;
  if dt is null or tm is null then raise exception 'Agree an appointment date and time first'; end if;
  appointment_at:=(dt+tm) at time zone 'Europe/London';
  if appointment_at < now()+interval '50 minutes' then raise exception 'Choose an appointment at least 50 minutes ahead'; end if;
  if extract(minute from tm)::integer % 30 <> 0 or tm > time '22:00' then raise exception 'Choose a half-hour start before 22:30'; end if;
  if (d->>'amount')::integer not between 10 and 5000 then raise exception 'Enter a whole-pound fee between 10 and 5000'; end if;
  lock table public.blocked_slots in share row exclusive mode;
  lock table public.pending_bookings in share row exclusive mode;
  for offset_mins in 0..3 loop
   slot:=to_char(tm+make_interval(mins=>offset_mins*30),'HH24:MI');
   if exists(select 1 from public.blocked_slots where booking_date=dt and slot_time=slot)
    or exists(select 1 from public.pending_bookings where booked_date=dt and expires_at>now()
     and abs(extract(epoch from (booked_time::time-tm))) < 7200) then
    raise exception 'This appointment overlaps a booked or reserved slot';
   end if;
  end loop;
  insert into public.bookings(name,email,phone,address,postcode,appointment,duration,price,
   booked_date,booked_time,patient_type,booking_for,reason,paid,confirmed,status)
  values(d->>'name',d->>'email',d->>'phone',d->>'address',d->>'postcode','Initial Assessment','60',
   (d->>'amount')::integer,dt,to_char(tm,'HH24:MI'),'new','enquiry',d->>'needs',false,false,'enquiry_pending')
  returning id into new_booking;
  for offset_mins in 0..3 loop
   insert into public.blocked_slots(booking_date,slot_time,booking_id)
   values(dt,to_char(tm+make_interval(mins=>offset_mins*30),'HH24:MI'),new_booking);
  end loop;
  e.booking_id:=new_booking; e.attempt_id:=gen_random_uuid(); e.payment_state:='creating';
  e.stripe_session_id:=null; e.payment_url:=null;
  e.expires_at:=least(now()+interval '23 hours',appointment_at-interval '15 minutes');
 elsif p_action='attach' then
  if e.attempt_id::text is distinct from p_payload->>'attempt_id' then raise exception 'Payment attempt changed'; end if;
  if e.payment_state not in ('creating','open') then return to_jsonb(e); end if;
  e.stripe_session_id:=p_payload->>'session_id'; e.payment_url:=p_payload->>'url'; e.payment_state:='open';
  update public.bookings set stripe_session_id=e.stripe_session_id where id=e.booking_id;
 elsif p_action='settle' then
  if e.attempt_id::text is distinct from p_payload->>'attempt_id' then raise exception 'Payment attempt changed'; end if;
  if e.stripe_session_id is not null and e.stripe_session_id is distinct from p_payload->>'session_id' then raise exception 'Wrong payment session'; end if;
  if (p_payload->>'amount_total')::integer is distinct from (d->>'amount')::integer*100
   or p_payload->>'currency' is distinct from 'gbp' then raise exception 'Payment total mismatch'; end if;
  if e.payment_state='paid' then return to_jsonb(e); end if;
  if e.payment_state not in ('creating','open','processing') then raise exception 'Payment requires manual review'; end if;
  if p_payload->>'state'='paid' then
   update public.bookings set paid=true,confirmed=true,status='confirmed',stripe_session_id=p_payload->>'session_id' where id=e.booking_id;
   e.payment_state:='paid'; e.paid_at:=now(); e.stripe_session_id:=p_payload->>'session_id';
  elsif p_payload->>'state'='processing' then
   e.payment_state:='processing'; e.stripe_session_id:=p_payload->>'session_id';
  else raise exception 'Invalid settlement state'; end if;
 elsif p_action='release' then
  if e.attempt_id::text is distinct from p_payload->>'attempt_id' then return to_jsonb(e); end if;
  if e.payment_state='paid' then return to_jsonb(e); end if;
  if p_payload->>'state' not in ('expired','failed') then raise exception 'Invalid release'; end if;
  delete from public.blocked_slots where booking_id=e.booking_id;
  update public.bookings set status='enquiry_expired' where id=e.booking_id and not paid;
  e.payment_state:=p_payload->>'state'; e.payment_url:=null;
 else raise exception 'Unknown enquiry action'; end if;
 e.version:=e.version+1; e.updated_at:=now();
 update public.patient_enquiries set details=e.details,drafts=e.drafts,communications=e.communications,
  version=e.version,payment_state=e.payment_state,booking_id=e.booking_id,attempt_id=e.attempt_id,
  stripe_session_id=e.stripe_session_id,payment_url=e.payment_url,expires_at=e.expires_at,
  paid_at=e.paid_at,updated_at=e.updated_at where id=p_id;
 return to_jsonb(e);
end $$;
revoke all on function public.enquiry_command(uuid,text,jsonb,integer) from public,anon,authenticated;
grant execute on function public.enquiry_command(uuid,text,jsonb,integer) to service_role;

-- A public checkout may have read availability just before an enquiry reserved
-- it. Its pending-hold insert must recheck before any payable link is created.
-- INSERT takes a pending_bookings table lock that conflicts with reserve's
-- table lock above, serialising these two booking paths.
create function public.protect_enquiry_reservation() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare start_time time;
begin
 if new.booked_date is not null and new.booked_time is not null and new.expires_at>now() then
  start_time:=new.booked_time::time;
  if exists(
   select 1 from public.blocked_slots s
   join public.patient_enquiries e on e.booking_id=s.booking_id
   where s.booking_date=new.booked_date
    and s.slot_time::time >= start_time
    and s.slot_time::time-start_time < interval '2 hours'
  ) then raise exception 'This appointment overlaps an enquiry reservation'; end if;
 end if;
 return new;
end $$;
revoke all on function public.protect_enquiry_reservation() from public,anon,authenticated;
grant execute on function public.protect_enquiry_reservation() to service_role;
create trigger protect_enquiry_reservation before insert or update on public.pending_bookings
 for each row execute function public.protect_enquiry_reservation();
commit;
