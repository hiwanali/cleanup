-- CleanUp · Auto-klarmarkera passerade pass varje minut (istället för var 2:e timme)

DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'finalize-eligible-shifts') THEN
      PERFORM cron.unschedule((SELECT jobid FROM cron.job WHERE jobname = 'finalize-eligible-shifts' LIMIT 1));
    END IF;
    PERFORM cron.schedule(
      'finalize-eligible-shifts',
      '* * * * *',
      $job$SELECT public.finalize_eligible_shifts();$job$
    );
  END IF;
END;
$cron$;
