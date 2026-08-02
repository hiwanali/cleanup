-- CleanUp - enrich public booking checklist addons
--
-- Keeps the same public_booking_service_checklist_items(text, jsonb) interface,
-- but carries more customer-selected addon detail into the shift checklist.

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
  v_window_count integer := greatest(1, coalesce(nullif(v_addons->>'window_count', '')::integer, 1));
  v_oven boolean := lower(coalesce(v_addons->>'oven', 'false')) IN ('true', '1', 'yes');
  v_bed_linen boolean := lower(coalesce(v_addons->>'home_bed_linen', 'false')) IN ('true', '1', 'yes');
  v_bed_count integer := greatest(1, coalesce(nullif(v_addons->>'home_bed_count', '')::integer, 1));
  v_ironing boolean := lower(coalesce(v_addons->>'home_ironing', 'false')) IN ('true', '1', 'yes');
  v_ironing_count integer := greatest(0, coalesce(nullif(v_addons->>'home_ironing_item_count', '')::integer, 0));
  v_ironing_items jsonb := coalesce(v_addons->'home_ironing_items', '{}'::jsonb);
  v_ironing_parts text[] := ARRAY[]::text[];
  v_ironing_summary text := '';
  v_shirts integer := 0;
  v_tshirts integer := 0;
  v_pants integer := 0;
  v_suit_pants integer := 0;
BEGIN
  IF coalesce(v_ironing_items->>'shirts', '') ~ '^[0-9]+$' THEN
    v_shirts := (v_ironing_items->>'shirts')::integer;
  END IF;
  IF coalesce(v_ironing_items->>'tshirts', '') ~ '^[0-9]+$' THEN
    v_tshirts := (v_ironing_items->>'tshirts')::integer;
  END IF;
  IF coalesce(v_ironing_items->>'pants', '') ~ '^[0-9]+$' THEN
    v_pants := (v_ironing_items->>'pants')::integer;
  END IF;
  IF coalesce(v_ironing_items->>'suitPants', '') ~ '^[0-9]+$' THEN
    v_suit_pants := (v_ironing_items->>'suitPants')::integer;
  END IF;

  IF v_shirts > 0 THEN
    v_ironing_parts := array_append(v_ironing_parts, format('%s skjortor', v_shirts));
  END IF;
  IF v_tshirts > 0 THEN
    v_ironing_parts := array_append(v_ironing_parts, format('%s T-shirts', v_tshirts));
  END IF;
  IF v_pants > 0 THEN
    v_ironing_parts := array_append(v_ironing_parts, format('%s byxor', v_pants));
  END IF;
  IF v_suit_pants > 0 THEN
    v_ironing_parts := array_append(v_ironing_parts, format('%s kostymbyxor', v_suit_pants));
  END IF;
  v_ironing_summary := array_to_string(v_ironing_parts, '; ');

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

  IF v_service = 'standard_cleaning' AND v_bed_linen THEN
    v_position := v_position + 1;
    item_position := v_position;
    title := format('Tillagg: byt sangklader (%s sang%s)', v_bed_count, CASE WHEN v_bed_count = 1 THEN '' ELSE 'ar' END);
    RETURN NEXT;
  END IF;

  IF v_service = 'standard_cleaning' AND v_ironing THEN
    v_position := v_position + 1;
    item_position := v_position;
    title := CASE
      WHEN v_ironing_summary <> '' AND v_ironing_count > 0 THEN format('Tillagg: stryk klader (%s plagg: %s)', v_ironing_count, v_ironing_summary)
      WHEN v_ironing_summary <> '' THEN format('Tillagg: stryk klader (%s)', v_ironing_summary)
      WHEN v_ironing_count > 0 THEN format('Tillagg: stryk klader (%s plagg)', v_ironing_count)
      ELSE 'Tillagg: stryk klader'
    END;
    RETURN NEXT;
  END IF;

  IF v_windows AND v_service <> 'moving_cleaning' THEN
    v_position := v_position + 1;
    item_position := v_position;
    title := format('Tillagg: fonsterputs enligt overenskommelse (%s fonster)', v_window_count);
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

REVOKE ALL ON FUNCTION public.public_booking_service_checklist_items(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_booking_service_checklist_items(text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.public_booking_service_checklist_items(text, jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';
