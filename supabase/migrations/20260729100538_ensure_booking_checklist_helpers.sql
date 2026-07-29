-- CleanUp - ensure public booking checklist helpers
--
-- The smart booking RPC depends on add_public_booking_service_checklist().
-- This small patch is safe to run after smart booking windows because it only
-- creates/replaces the checklist helper functions.

DROP FUNCTION IF EXISTS public.add_public_booking_service_checklist(uuid, text, jsonb);
DROP FUNCTION IF EXISTS public.public_booking_service_checklist_items(text, jsonb);

CREATE OR REPLACE FUNCTION public.public_booking_service_checklist_items(
  p_service_type text,
  p_addons jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE(item_position integer, title text)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_titles text[];
  v_title text;
  v_position integer := 0;
  v_service text := coalesce(nullif(trim(p_service_type), ''), 'standard_cleaning');
  v_addons jsonb := coalesce(p_addons, '{}'::jsonb);
  v_windows boolean := lower(coalesce(v_addons->>'windows', 'false')) IN ('true', '1', 'yes');
  v_oven boolean := lower(coalesce(v_addons->>'oven', 'false')) IN ('true', '1', 'yes');
BEGIN
  v_titles := CASE v_service
    WHEN 'deep_cleaning' THEN ARRAY[
      'Allmant: dammsug och dammtorka golv, mattor och mobler',
      'Allmant: vattorka golv',
      'Allmant: rengor lampor, tavlor, persienner och skap/garderober',
      'Allmant: rengor dorrar, lister, eluttag och strombytare',
      'Allmant: tom papperskorgar',
      'Badrum: rengor dusch/badkar, toalett, handfat, vaggar och golv',
      'Badrum: rengor tvattmaskin/torkskap vid behov',
      'Badrum: rensa golvbrunn och torka ror',
      'Kok: rengor koksbank, spis, kakelvagg och flakt',
      'Kok: torka koksluckor och utsidan av vitvaror'
    ]
    WHEN 'moving_cleaning' THEN ARRAY[
      'Allmant: dammsug golv',
      'Allmant: vattorka golv och lister',
      'Rummen: rengor dorrar, hyllor, skap, garderober och element',
      'Rummen: rengor eluttag och strombytare',
      'Badrum: rengor dusch/badkar, tvattstall, toalett, handfat och vaggar',
      'Badrum: torka duschvaggar, putsa speglar och torka ror',
      'Badrum: rensa golvbrunn',
      'Kok: rengor koksbank, vask, kakelvagg och skap',
      'Kok: rengor spis in- och utvandigt',
      'Kok: rengor spisflakt och filter',
      'Kok: rengor avfrostat kyl och frys in- och utvandigt',
      'Fonsterputs: putsa alla glas, fonsterkant och nedre fonsterkarm'
    ]
    WHEN 'window_cleaning' THEN ARRAY[
      'Fonster: tvatta och torka alla glas in- och utvandigt',
      'Fonster: rengor fonsterkant',
      'Fonster: rengor nedre fonsterkarm'
    ]
    ELSE ARRAY[
      'Rummen: dammsug golv, mattor och synliga ytor',
      'Rummen: dammtorka lister, element, mobler och fria ytor',
      'Badrum: rengor dusch/badkar, toalett, handfat och blandare',
      'Badrum: torka duschvaggar och putsa speglar',
      'Kok: rengor koksbank, spis, kakelvagg och flaktens utsida',
      'Kok: torka koksluckor och utsidan av vitvaror',
      'Avslut: kontrollera golv och synliga ytor innan utcheckning'
    ]
  END;

  FOREACH v_title IN ARRAY v_titles LOOP
    v_position := v_position + 1;
    item_position := v_position;
    title := v_title;
    RETURN NEXT;
  END LOOP;

  IF v_service <> 'moving_cleaning' AND v_windows THEN
    v_position := v_position + 1;
    item_position := v_position;
    title := 'Tillagg: fonsterputs enligt overenskommelse';
    RETURN NEXT;
  END IF;

  IF v_oven THEN
    v_position := v_position + 1;
    item_position := v_position;
    title := 'Tillagg: ugnsrengoring enligt overenskommelse';
    RETURN NEXT;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.add_public_booking_service_checklist(
  p_shift_id uuid,
  p_service_type text,
  p_addons jsonb DEFAULT '{}'::jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  IF p_shift_id IS NULL THEN
    RETURN 0;
  END IF;

  IF auth.uid() IS NOT NULL AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'admin required' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.shift_checklist_items sci
    WHERE sci.shift_id = p_shift_id
  ) THEN
    RETURN 0;
  END IF;

  INSERT INTO public.shift_checklist_items (shift_id, title, position)
  SELECT p_shift_id, i.title, i.item_position
  FROM public.public_booking_service_checklist_items(p_service_type, p_addons) i;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.public_booking_service_checklist_items(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_booking_service_checklist_items(text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.public_booking_service_checklist_items(text, jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.add_public_booking_service_checklist(uuid, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.add_public_booking_service_checklist(uuid, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_public_booking_service_checklist(uuid, text, jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';
