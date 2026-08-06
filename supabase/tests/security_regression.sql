-- CleanUp phase 6 security regression checks.
-- Non-destructive: verifies schema/RLS/function contracts only.

do $$
declare
  failures text;
begin
  with expected_rls(tablename) as (
    values
      ('booking_attendance_attempts'),
      ('booking_requests'),
      ('customer_employees'),
      ('customers'),
      ('incidents'),
      ('message_delivery_attempts'),
      ('message_threads'),
      ('messages'),
      ('notifications'),
      ('properties'),
      ('shift_checklist_items'),
      ('shift_finalization_runs'),
      ('shifts'),
      ('users')
  ),
  expected_security_functions(signature, allow_authenticated, allow_service_role) as (
    values
      ('public.admin_adjust_shift_time(uuid, timestamp with time zone, timestamp with time zone)'::regprocedure, true, true),
      ('public.admin_adjust_shift_worked_time(uuid, timestamp with time zone, timestamp with time zone)'::regprocedure, true, true),
      ('public.admin_approve_booking_shift(uuid, uuid)'::regprocedure, true, true),
      ('public.admin_decline_booking_shift(uuid)'::regprocedure, true, true),
      ('public.admin_delete_shift(uuid)'::regprocedure, true, true),
      ('public.admin_swap_shift_cleaner(uuid, uuid)'::regprocedure, true, true),
      ('public.finalize_eligible_shifts(timestamp with time zone)'::regprocedure, false, true),
      ('public.insert_notifications(jsonb)'::regprocedure, true, true),
      ('public.toggle_shift_checklist_item(uuid, boolean)'::regprocedure, true, true),
      ('public.update_own_profile(text, text)'::regprocedure, true, true)
  ),
  expected_security_views(viewname) as (
    values
      ('cleaners_public'),
      ('properties_customer')
  ),
  checks(reason) as (
    select format('missing public table: %s', e.tablename)
    from expected_rls e
    left join pg_class c on c.relname = e.tablename
    left join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    where c.oid is null

    union all
    select format('RLS disabled on public.%s', e.tablename)
    from expected_rls e
    join pg_class c on c.relname = e.tablename
    join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    where not c.relrowsecurity

    union all
    select 'legacy broad policy shifts_cleaner_update still exists'
    where exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and tablename = 'shifts'
        and policyname = 'shifts_cleaner_update'
    )

    union all
    select 'legacy broad policy checklist_items_cleaner_write still exists'
    where exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and tablename = 'shift_checklist_items'
        and policyname = 'checklist_items_cleaner_write'
    )

    union all
    select 'authenticated can still insert directly into public.notifications'
    where has_table_privilege('authenticated', 'public.notifications', 'INSERT')

    union all
    select 'authenticated can still delete directly from public.notifications'
    where has_table_privilege('authenticated', 'public.notifications', 'DELETE')

    union all
    select 'anon can write public.notifications'
    where has_table_privilege('anon', 'public.notifications', 'INSERT')
       or has_table_privilege('anon', 'public.notifications', 'UPDATE')
       or has_table_privilege('anon', 'public.notifications', 'DELETE')

    union all
    select format('%s is not SECURITY DEFINER', f.signature::text)
    from expected_security_functions f
    join pg_proc p on p.oid = f.signature
    where not p.prosecdef

    union all
    select format('%s does not pin search_path=public', f.signature::text)
    from expected_security_functions f
    join pg_proc p on p.oid = f.signature
    where p.proconfig is null
       or not ('search_path=public' = any (p.proconfig))

    union all
    select format('PUBLIC can execute %s', f.signature::text)
    from expected_security_functions f
    where has_function_privilege('public', f.signature, 'EXECUTE')

    union all
    select format('anon can execute %s', f.signature::text)
    from expected_security_functions f
    where has_function_privilege('anon', f.signature, 'EXECUTE')

    union all
    select format('authenticated execute mismatch for %s', f.signature::text)
    from expected_security_functions f
    where has_function_privilege('authenticated', f.signature, 'EXECUTE') is distinct from f.allow_authenticated

    union all
    select format('service_role execute mismatch for %s', f.signature::text)
    from expected_security_functions f
    where has_function_privilege('service_role', f.signature, 'EXECUTE') is distinct from f.allow_service_role

    union all
    select format('view public.%s is not security_invoker=true', v.viewname)
    from expected_security_views v
    join pg_class c on c.relname = v.viewname
    join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    where c.reloptions is null
       or not ('security_invoker=true' = any (c.reloptions))
  )
  select string_agg(reason, '; ' order by reason)
  into failures
  from checks;

  if failures is not null then
    raise exception 'CleanUp security regression failed: %', failures;
  end if;
end $$;

select 'CleanUp security regression passed' as result;
