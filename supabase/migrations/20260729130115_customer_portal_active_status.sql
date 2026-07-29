-- CleanUp - customer portal phase 4
--
-- Lets a customer mark their portal invite as active after they arrive through
-- a magic link. The function is callable by authenticated users, but it only
-- updates booking requests explicitly linked to auth.uid().

CREATE OR REPLACE FUNCTION public.mark_customer_portal_active(
  p_shift_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_request_id uuid;
  v_status text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  UPDATE public.booking_requests
  SET portal_access_status = 'active'
  WHERE shift_id = p_shift_id
    AND portal_user_id = v_user_id
    AND portal_access_status IN ('created', 'invited', 'active')
  RETURNING id, portal_access_status
  INTO v_request_id, v_status;

  IF v_request_id IS NULL THEN
    RAISE EXCEPTION 'portal booking not found' USING ERRCODE = 'P0002';
  END IF;

  RETURN jsonb_build_object(
    'booking_request_id', v_request_id,
    'portal_access_status', v_status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.mark_customer_portal_active(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_customer_portal_active(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.mark_customer_portal_active(uuid) IS
  'Customer-only portal activation marker for magic-link landings.';
