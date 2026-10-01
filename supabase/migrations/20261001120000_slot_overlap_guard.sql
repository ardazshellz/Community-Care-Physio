-- Atomic slot reservation for public checkouts.
-- create-checkout.js checks availability, then inserts a hold into pending_bookings.
-- Two checkouts in the same second could both pass the check. This trigger makes the
-- hold insert itself the authority: it serialises holds per transaction with table
-- locks and rejects any hold whose visit + 45-minute travel buffer overlaps a blocked
-- slot or another live hold. The API turns the raised error into a 409.
begin;

-- Same durations as lib/slots.js durationMins().
create or replace function public.slot_duration_mins(appointment text) returns integer
language sql immutable set search_path = '' as $$
  select case appointment
    when 'Standard Session' then 45
    when 'Block of 4 Sessions' then 45
    when 'Block of 6 Sessions' then 45
    else 60 end
$$;
revoke all on function public.slot_duration_mins(text) from public,anon,authenticated;
grant execute on function public.slot_duration_mins(text) to service_role;

create or replace function public.protect_slot_overlap() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare
  starts time; ends time;
begin
  if new.booked_date is null or new.booked_time is null or new.expires_at <= now() then return new; end if;
  -- Serialise with other holds and with enquiry reservations (enquiry_command locks the same tables).
  lock table public.blocked_slots in share row exclusive mode;
  lock table public.pending_bookings in share row exclusive mode;
  starts := new.booked_time::time;
  -- ponytail: time arithmetic wraps at midnight; the rota never runs past 22:00.
  ends := starts + make_interval(mins => public.slot_duration_mins(new.booking_data->>'appointment') + 45);
  if exists (
    select 1 from public.blocked_slots b
    where b.booking_date = new.booked_date and b.slot_time::time >= starts and b.slot_time::time < ends
  ) then raise exception 'This appointment overlaps a booked slot'; end if;
  if exists (
    select 1 from public.pending_bookings p
    where p.booked_date = new.booked_date
      and p.stripe_session_id is distinct from new.stripe_session_id
      and p.expires_at > now()
      and p.booked_time::time < ends
      and p.booked_time::time + make_interval(mins => public.slot_duration_mins(p.booking_data->>'appointment') + 45) > starts
  ) then raise exception 'This appointment overlaps a reserved slot'; end if;
  return new;
end $$;
revoke all on function public.protect_slot_overlap() from public,anon,authenticated;
grant execute on function public.protect_slot_overlap() to service_role;

drop trigger if exists protect_slot_overlap on public.pending_bookings;
create trigger protect_slot_overlap before insert or update on public.pending_bookings
  for each row execute function public.protect_slot_overlap();

commit;
