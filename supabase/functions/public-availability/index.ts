import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const DEFAULT_ALLOWED_ORIGINS = [
  "https://cleanup.nu",
  "https://www.cleanup.nu",
  "https://logincleanup.app",
];

const ACTIVE_REQUEST_STATUSES = ["new", "linked_to_shift", "approved"];

type AvailabilitySlot = {
  id: string;
  starts_at: string;
  ends_at: string;
  capacity: number;
  service_type: string;
};

type BookingRequest = {
  availability_slot_id: string | null;
};

function allowedOrigins(): string[] {
  const raw = Deno.env.get("PUBLIC_BOOKING_ALLOWED_ORIGINS");
  if (!raw) return DEFAULT_ALLOWED_ORIGINS;
  return raw.split(",").map((x) => x.trim()).filter(Boolean);
}

function corsHeaders(req: Request): HeadersInit {
  const origin = req.headers.get("origin");
  const allowed = allowedOrigins();
  const allowOrigin = origin && allowed.includes(origin) ? origin : allowed[0] ?? "*";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Vary": "Origin",
  };
}

function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json" },
  });
}

function rejectBadOrigin(req: Request): Response | null {
  const origin = req.headers.get("origin");
  if (!origin) return null;
  if (allowedOrigins().includes(origin)) return null;
  return json(req, { error: "Origin not allowed" }, 403);
}

function parseDate(value: string | null, fallback: Date): Date {
  if (!value) return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders(req) });
  }

  const badOrigin = rejectBadOrigin(req);
  if (badOrigin) return badOrigin;

  if (req.method !== "GET") {
    return json(req, { error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const orgId = Deno.env.get("PUBLIC_BOOKING_ORG_ID") ?? "";

  if (!supabaseUrl || !serviceRoleKey || !orgId) {
    return json(req, { error: "Booking API is not configured" }, 503);
  }

  const url = new URL(req.url);
  const now = new Date();
  const from = parseDate(url.searchParams.get("from"), now);
  const requestedTo = parseDate(url.searchParams.get("to"), new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000));
  const maxTo = new Date(from.getTime() + 90 * 24 * 60 * 60 * 1000);
  const to = requestedTo > maxTo ? maxTo : requestedTo;
  const serviceType = url.searchParams.get("service_type")?.trim();

  if (to <= from) {
    return json(req, { error: "Invalid date range" }, 400);
  }

  const sb = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let query = sb
    .from("booking_availability_slots")
    .select("id, starts_at, ends_at, capacity, service_type")
    .eq("org_id", orgId)
    .eq("active", true)
    .gte("starts_at", from.toISOString())
    .lte("starts_at", to.toISOString())
    .order("starts_at", { ascending: true });

  if (serviceType) {
    query = query.eq("service_type", serviceType);
  }

  const { data: slots, error: slotsError } = await query;
  if (slotsError) {
    console.error("[public-availability] slots:", slotsError.message);
    return json(req, { error: "Could not load availability" }, 500);
  }

  const typedSlots = (slots ?? []) as AvailabilitySlot[];
  if (typedSlots.length === 0) {
    return json(req, { slots: [] });
  }

  const slotIds = typedSlots.map((slot) => slot.id);
  const { data: requests, error: requestsError } = await sb
    .from("booking_requests")
    .select("availability_slot_id")
    .in("availability_slot_id", slotIds)
    .in("status", ACTIVE_REQUEST_STATUSES);

  if (requestsError) {
    console.error("[public-availability] requests:", requestsError.message);
    return json(req, { error: "Could not load availability" }, 500);
  }

  const reservedBySlot = new Map<string, number>();
  for (const request of (requests ?? []) as BookingRequest[]) {
    if (!request.availability_slot_id) continue;
    reservedBySlot.set(
      request.availability_slot_id,
      (reservedBySlot.get(request.availability_slot_id) ?? 0) + 1,
    );
  }

  const availableSlots = typedSlots
    .map((slot) => {
      const reserved = reservedBySlot.get(slot.id) ?? 0;
      return {
        id: slot.id,
        starts_at: slot.starts_at,
        ends_at: slot.ends_at,
        service_type: slot.service_type,
        available_capacity: Math.max(0, slot.capacity - reserved),
      };
    })
    .filter((slot) => slot.available_capacity > 0);

  return json(req, { slots: availableSlots });
});
