-- CleanUp - polish customer-facing public booking copy.
--
-- Fixes three customer-visible issues:
-- 1. Public booking object/pass notes should read like Swedish copy, not code.
-- 2. Public booking checklist labels should preserve å/ä/ö.
-- 3. Existing rows created with older ASCII labels should be normalized.

CREATE OR REPLACE FUNCTION public.cleanup_public_booking_service_label(p_service_type text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE coalesce(nullif(trim(p_service_type), ''), '')
    WHEN 'standard_cleaning' THEN 'Hemstädning'
    WHEN 'deep_cleaning' THEN 'Storstädning'
    WHEN 'moving_cleaning' THEN 'Flyttstädning'
    WHEN 'window_cleaning' THEN 'Fönsterputs'
    WHEN 'office_cleaning' THEN 'Kontorsstädning'
    WHEN 'stair_cleaning' THEN 'Trappstädning'
    WHEN 'construction_cleaning' THEN 'Byggstädning'
    WHEN 'construction_services' THEN 'Byggtjänster'
    ELSE coalesce(nullif(trim(p_service_type), ''), 'Städning')
  END;
$$;

CREATE OR REPLACE FUNCTION public.cleanup_format_public_booking_note(p_note text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_raw text := trim(coalesce(p_note, ''));
  v_line text;
  v_service text := '';
  v_postal_code text := '';
  v_city text := '';
  v_message text := '';
BEGIN
  IF v_raw = '' THEN
    RETURN '';
  END IF;

  IF lower(v_raw) NOT LIKE 'public booking request%' THEN
    RETURN p_note;
  END IF;

  FOREACH v_line IN ARRAY string_to_array(replace(v_raw, E'\r\n', E'\n'), E'\n') LOOP
    IF v_line LIKE 'Service:%' THEN
      v_service := trim(substr(v_line, length('Service:') + 1));
    ELSIF v_line LIKE 'Postal code:%' THEN
      v_postal_code := trim(substr(v_line, length('Postal code:') + 1));
    ELSIF v_line LIKE 'City:%' THEN
      v_city := trim(substr(v_line, length('City:') + 1));
    ELSIF v_line LIKE 'Message:%' THEN
      v_message := trim(substr(v_line, length('Message:') + 1));
    END IF;
  END LOOP;

  RETURN concat_ws(
    E'\n',
    'Bokad via publika bokningsformuläret.',
    CASE WHEN v_service <> '' THEN 'Tjänst: ' || public.cleanup_public_booking_service_label(v_service) END,
    CASE WHEN v_postal_code <> '' THEN 'Postnummer: ' || v_postal_code END,
    CASE WHEN v_city <> '' THEN 'Ort: ' || v_city END,
    CASE WHEN v_message <> '' THEN 'Meddelande: ' || v_message END
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.cleanup_normalize_public_booking_note_trigger()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.notes := public.cleanup_format_public_booking_note(NEW.notes);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS properties_normalize_public_booking_note
  ON public.properties;

CREATE TRIGGER properties_normalize_public_booking_note
  BEFORE INSERT OR UPDATE OF notes ON public.properties
  FOR EACH ROW
  WHEN (NEW.notes IS NOT NULL AND lower(NEW.notes) LIKE 'public booking request%')
  EXECUTE FUNCTION public.cleanup_normalize_public_booking_note_trigger();

DROP TRIGGER IF EXISTS shifts_normalize_public_booking_note
  ON public.shifts;

CREATE TRIGGER shifts_normalize_public_booking_note
  BEFORE INSERT OR UPDATE OF notes ON public.shifts
  FOR EACH ROW
  WHEN (NEW.notes IS NOT NULL AND lower(NEW.notes) LIKE 'public booking request%')
  EXECUTE FUNCTION public.cleanup_normalize_public_booking_note_trigger();

UPDATE public.properties
SET notes = public.cleanup_format_public_booking_note(notes)
WHERE notes IS NOT NULL
  AND lower(notes) LIKE 'public booking request%';

UPDATE public.shifts
SET notes = public.cleanup_format_public_booking_note(notes)
WHERE notes IS NOT NULL
  AND lower(notes) LIKE 'public booking request%';

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
      'Allmänt: dammsug och dammtorka golv, mattor och möbler',
      'Allmänt: våttorka golv',
      'Allmänt: rengör lampor, tavlor, persienner och skåp/garderober',
      'Allmänt: rengör dörrar, lister, eluttag och strömbrytare',
      'Allmänt: töm papperskorgar',
      'Badrum: rengör dusch/badkar, toalett, handfat, väggar och golv',
      'Badrum: rengör tvättmaskin/torkskåp vid behov',
      'Badrum: rensa golvbrunn och torka rör',
      'Kök: rengör köksbänk, spis, kakelvägg och fläkt',
      'Kök: torka köksluckor och utsidan av vitvaror'
    ]
    WHEN 'moving_cleaning' THEN ARRAY[
      'Allmänt: dammsug golv',
      'Allmänt: våttorka golv och lister',
      'Rummen: rengör dörrar, hyllor, skåp, garderober och element',
      'Rummen: rengör eluttag och strömbrytare',
      'Badrum: rengör dusch/badkar, tvättställ, toalett, handfat och väggar',
      'Badrum: torka duschväggar, putsa speglar och torka rör',
      'Badrum: rensa golvbrunn',
      'Kök: rengör köksbänk, vask, kakelvägg och skåp',
      'Kök: rengör spis in- och utvändigt',
      'Kök: rengör spisfläkt och filter',
      'Kök: rengör avfrostat kyl och frys in- och utvändigt',
      'Fönsterputs: putsa alla glas, fönsterkant och nedre fönsterkarm'
    ]
    WHEN 'window_cleaning' THEN ARRAY[
      'Fönster: tvätta och torka alla glas in- och utvändigt',
      'Fönster: rengör fönsterkant',
      'Fönster: rengör nedre fönsterkarm'
    ]
    ELSE ARRAY[
      'Rummen: dammsug golv, mattor och synliga ytor',
      'Rummen: dammtorka lister, element, möbler och fria ytor',
      'Badrum: rengör dusch/badkar, toalett, handfat och blandare',
      'Badrum: torka duschväggar och putsa speglar',
      'Kök: rengör köksbänk, spis, kakelvägg och fläktens utsida',
      'Kök: torka köksluckor och utsidan av vitvaror',
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
    title := format('Tillägg: byt sängkläder (%s säng%s)', v_bed_count, CASE WHEN v_bed_count = 1 THEN '' ELSE 'ar' END);
    RETURN NEXT;
  END IF;

  IF v_service = 'standard_cleaning' AND v_ironing THEN
    v_position := v_position + 1;
    item_position := v_position;
    title := CASE
      WHEN v_ironing_summary <> '' AND v_ironing_count > 0 THEN format('Tillägg: stryk kläder (%s plagg: %s)', v_ironing_count, v_ironing_summary)
      WHEN v_ironing_summary <> '' THEN format('Tillägg: stryk kläder (%s)', v_ironing_summary)
      WHEN v_ironing_count > 0 THEN format('Tillägg: stryk kläder (%s plagg)', v_ironing_count)
      ELSE 'Tillägg: stryk kläder'
    END;
    RETURN NEXT;
  END IF;

  IF v_windows AND v_service <> 'moving_cleaning' THEN
    v_position := v_position + 1;
    item_position := v_position;
    title := format('Tillägg: fönsterputs enligt överenskommelse (%s fönster)', v_window_count);
    RETURN NEXT;
  END IF;

  IF v_oven THEN
    v_position := v_position + 1;
    item_position := v_position;
    title := 'Tillägg: ugnsrengöring enligt överenskommelse';
    RETURN NEXT;
  END IF;
END;
$$;

WITH label_map(old_title, new_title) AS (
  VALUES
    ('Allmant: dammsug och dammtorka golv, mattor och mobler', 'Allmänt: dammsug och dammtorka golv, mattor och möbler'),
    ('Allmant: vattorka golv', 'Allmänt: våttorka golv'),
    ('Allmant: rengor lampor, tavlor, persienner och skap/garderober', 'Allmänt: rengör lampor, tavlor, persienner och skåp/garderober'),
    ('Allmant: rengor dorrar, lister, eluttag och strombytare', 'Allmänt: rengör dörrar, lister, eluttag och strömbrytare'),
    ('Allmant: tom papperskorgar', 'Allmänt: töm papperskorgar'),
    ('Badrum: rengor dusch/badkar, toalett, handfat, vaggar och golv', 'Badrum: rengör dusch/badkar, toalett, handfat, väggar och golv'),
    ('Badrum: rengor tvattmaskin/torkskap vid behov', 'Badrum: rengör tvättmaskin/torkskåp vid behov'),
    ('Badrum: rensa golvbrunn och torka ror', 'Badrum: rensa golvbrunn och torka rör'),
    ('Kok: rengor koksbank, spis, kakelvagg och flakt', 'Kök: rengör köksbänk, spis, kakelvägg och fläkt'),
    ('Kok: torka koksluckor och utsidan av vitvaror', 'Kök: torka köksluckor och utsidan av vitvaror'),
    ('Allmant: dammsug golv', 'Allmänt: dammsug golv'),
    ('Allmant: vattorka golv och lister', 'Allmänt: våttorka golv och lister'),
    ('Rummen: rengor dorrar, hyllor, skap, garderober och element', 'Rummen: rengör dörrar, hyllor, skåp, garderober och element'),
    ('Rummen: rengor eluttag och strombytare', 'Rummen: rengör eluttag och strömbrytare'),
    ('Badrum: rengor dusch/badkar, tvattstall, toalett, handfat och vaggar', 'Badrum: rengör dusch/badkar, tvättställ, toalett, handfat och väggar'),
    ('Badrum: torka duschvaggar, putsa speglar och torka ror', 'Badrum: torka duschväggar, putsa speglar och torka rör'),
    ('Kok: rengor koksbank, vask, kakelvagg och skap', 'Kök: rengör köksbänk, vask, kakelvägg och skåp'),
    ('Kok: rengor spis in- och utvandigt', 'Kök: rengör spis in- och utvändigt'),
    ('Kok: rengor spisflakt och filter', 'Kök: rengör spisfläkt och filter'),
    ('Kok: rengor avfrostat kyl och frys in- och utvandigt', 'Kök: rengör avfrostat kyl och frys in- och utvändigt'),
    ('Fonsterputs: putsa alla glas, fonsterkant och nedre fonsterkarm', 'Fönsterputs: putsa alla glas, fönsterkant och nedre fönsterkarm'),
    ('Fonster: tvatta och torka alla glas in- och utvandigt', 'Fönster: tvätta och torka alla glas in- och utvändigt'),
    ('Fonster: rengor fonsterkant', 'Fönster: rengör fönsterkant'),
    ('Fonster: rengor nedre fonsterkarm', 'Fönster: rengör nedre fönsterkarm'),
    ('Rummen: dammtorka lister, element, mobler och fria ytor', 'Rummen: dammtorka lister, element, möbler och fria ytor'),
    ('Badrum: rengor dusch/badkar, toalett, handfat och blandare', 'Badrum: rengör dusch/badkar, toalett, handfat och blandare'),
    ('Badrum: torka duschvaggar och putsa speglar', 'Badrum: torka duschväggar och putsa speglar'),
    ('Kok: rengor koksbank, spis, kakelvagg och flaktens utsida', 'Kök: rengör köksbänk, spis, kakelvägg och fläktens utsida'),
    ('Tillagg: byt sangklader', 'Tillägg: byt sängkläder'),
    ('Tillagg: stryk klader', 'Tillägg: stryk kläder'),
    ('Tillagg: fonsterputs enligt overenskommelse', 'Tillägg: fönsterputs enligt överenskommelse'),
    ('Tillagg: ugnsrengoring enligt overenskommelse', 'Tillägg: ugnsrengöring enligt överenskommelse')
)
UPDATE public.shift_checklist_items sci
SET title = replace(sci.title, label_map.old_title, label_map.new_title)
FROM label_map
WHERE sci.title LIKE label_map.old_title || '%';

WITH label_map(old_title, new_title) AS (
  VALUES
    ('Allmant: dammsug och dammtorka golv, mattor och mobler', 'Allmänt: dammsug och dammtorka golv, mattor och möbler'),
    ('Allmant: vattorka golv', 'Allmänt: våttorka golv'),
    ('Allmant: rengor lampor, tavlor, persienner och skap/garderober', 'Allmänt: rengör lampor, tavlor, persienner och skåp/garderober'),
    ('Allmant: rengor dorrar, lister, eluttag och strombytare', 'Allmänt: rengör dörrar, lister, eluttag och strömbrytare'),
    ('Allmant: tom papperskorgar', 'Allmänt: töm papperskorgar'),
    ('Badrum: rengor dusch/badkar, toalett, handfat, vaggar och golv', 'Badrum: rengör dusch/badkar, toalett, handfat, väggar och golv'),
    ('Badrum: rengor tvattmaskin/torkskap vid behov', 'Badrum: rengör tvättmaskin/torkskåp vid behov'),
    ('Badrum: rensa golvbrunn och torka ror', 'Badrum: rensa golvbrunn och torka rör'),
    ('Kok: rengor koksbank, spis, kakelvagg och flakt', 'Kök: rengör köksbänk, spis, kakelvägg och fläkt'),
    ('Kok: torka koksluckor och utsidan av vitvaror', 'Kök: torka köksluckor och utsidan av vitvaror'),
    ('Allmant: dammsug golv', 'Allmänt: dammsug golv'),
    ('Allmant: vattorka golv och lister', 'Allmänt: våttorka golv och lister'),
    ('Rummen: rengor dorrar, hyllor, skap, garderober och element', 'Rummen: rengör dörrar, hyllor, skåp, garderober och element'),
    ('Rummen: rengor eluttag och strombytare', 'Rummen: rengör eluttag och strömbrytare'),
    ('Badrum: rengor dusch/badkar, tvattstall, toalett, handfat och vaggar', 'Badrum: rengör dusch/badkar, tvättställ, toalett, handfat och väggar'),
    ('Badrum: torka duschvaggar, putsa speglar och torka ror', 'Badrum: torka duschväggar, putsa speglar och torka rör'),
    ('Kok: rengor koksbank, vask, kakelvagg och skap', 'Kök: rengör köksbänk, vask, kakelvägg och skåp'),
    ('Kok: rengor spis in- och utvandigt', 'Kök: rengör spis in- och utvändigt'),
    ('Kok: rengor spisflakt och filter', 'Kök: rengör spisfläkt och filter'),
    ('Kok: rengor avfrostat kyl och frys in- och utvandigt', 'Kök: rengör avfrostat kyl och frys in- och utvändigt'),
    ('Fonsterputs: putsa alla glas, fonsterkant och nedre fonsterkarm', 'Fönsterputs: putsa alla glas, fönsterkant och nedre fönsterkarm'),
    ('Fonster: tvatta och torka alla glas in- och utvandigt', 'Fönster: tvätta och torka alla glas in- och utvändigt'),
    ('Fonster: rengor fonsterkant', 'Fönster: rengör fönsterkant'),
    ('Fonster: rengor nedre fonsterkarm', 'Fönster: rengör nedre fönsterkarm'),
    ('Rummen: dammtorka lister, element, mobler och fria ytor', 'Rummen: dammtorka lister, element, möbler och fria ytor'),
    ('Badrum: rengor dusch/badkar, toalett, handfat och blandare', 'Badrum: rengör dusch/badkar, toalett, handfat och blandare'),
    ('Badrum: torka duschvaggar och putsa speglar', 'Badrum: torka duschväggar och putsa speglar'),
    ('Kok: rengor koksbank, spis, kakelvagg och flaktens utsida', 'Kök: rengör köksbänk, spis, kakelvägg och fläktens utsida'),
    ('Tillagg: byt sangklader', 'Tillägg: byt sängkläder'),
    ('Tillagg: stryk klader', 'Tillägg: stryk kläder'),
    ('Tillagg: fonsterputs enligt overenskommelse', 'Tillägg: fönsterputs enligt överenskommelse'),
    ('Tillagg: ugnsrengoring enligt overenskommelse', 'Tillägg: ugnsrengöring enligt överenskommelse')
)
UPDATE public.cleaning_checklists cc
SET title = replace(cc.title, label_map.old_title, label_map.new_title)
FROM label_map
WHERE cc.title LIKE label_map.old_title || '%';

REVOKE ALL ON FUNCTION public.public_booking_service_checklist_items(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_booking_service_checklist_items(text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.public_booking_service_checklist_items(text, jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';
