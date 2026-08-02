import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const DEFAULT_ALLOWED_ORIGINS = [
  "https://cleanup.nu",
  "https://www.cleanup.nu",
  "https://logincleanup.app",
  "https://www.logincleanup.app",
];

type BookingBody = {
  availability_slot_id?: unknown;
  requested_starts_at?: unknown;
  requested_ends_at?: unknown;
  service_type?: unknown;
  customer_name?: unknown;
  customer_email?: unknown;
  customer_phone?: unknown;
  address?: unknown;
  postal_code?: unknown;
  city?: unknown;
  area_sqm?: unknown;
  rooms?: unknown;
  addons?: unknown;
  estimated_price_sek?: unknown;
  message?: unknown;
  website?: unknown;
  company?: unknown;
  form_started_at?: unknown;
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
    "Access-Control-Allow-Methods": "POST, OPTIONS",
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
  if (!origin) return json(req, { error: "Origin not allowed" }, 403);
  if (allowedOrigins().includes(origin)) return null;
  return json(req, { error: "Origin not allowed" }, 403);
}

function asString(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function asOptionalString(value: unknown, maxLength: number): string | null {
  const out = asString(value, maxLength);
  return out || null;
}

function asPositiveInteger(value: unknown, max: number): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > max) return null;
  return parsed;
}

function asNonNegativeInteger(value: unknown, max: number): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > max) return null;
  return parsed;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function asIsoDateString(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function validateSubmissionTiming(value: unknown): string | null {
  const submittedAt = Date.now();
  const startedAtIso = asIsoDateString(value);
  if (!startedAtIso) return "missing_form_started_at";

  const startedAt = new Date(startedAtIso).getTime();
  const ageMs = submittedAt - startedAt;
  if (ageMs < 4000) return "form_submitted_too_fast";
  if (ageMs > 24 * 60 * 60 * 1000) return "form_session_expired";
  return null;
}

function sourceDomain(req: Request): string {
  const origin = req.headers.get("origin");
  if (!origin) return "cleanup.nu";
  try {
    return new URL(origin).hostname.slice(0, 120);
  } catch {
    return "cleanup.nu";
  }
}

async function hashIp(req: Request): Promise<string | null> {
  const forwarded = req.headers.get("x-forwarded-for") ?? "";
  const ip = forwarded.split(",")[0]?.trim();
  if (!ip) return null;
  const data = new TextEncoder().encode(ip);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function validate(body: BookingBody): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  const availabilitySlotId = asString(body.availability_slot_id, 64);
  const requestedStartsAt = asIsoDateString(body.requested_starts_at);
  const requestedEndsAt = asIsoDateString(body.requested_ends_at);
  const serviceType = asString(body.service_type, 80) || "standard_cleaning";
  const customerName = asString(body.customer_name, 120);
  const customerEmail = asString(body.customer_email, 180).toLowerCase();
  const customerPhone = asString(body.customer_phone, 40);
  const address = asString(body.address, 220);
  const postalCode = asOptionalString(body.postal_code, 20);
  const city = asOptionalString(body.city, 80);
  const areaSqm = asPositiveInteger(body.area_sqm, 2000);
  const rooms = asPositiveInteger(body.rooms, 100);
  const estimatedPriceSek = asNonNegativeInteger(body.estimated_price_sek, 200000);
  const message = asString(body.message, 1200);
  const addons = body.addons && typeof body.addons === "object" && !Array.isArray(body.addons)
    ? body.addons
    : {};

  if (!isUuid(availabilitySlotId)) return { ok: false, error: "invalid_slot" };
  if ((body.requested_starts_at || body.requested_ends_at) && (!requestedStartsAt || !requestedEndsAt)) return { ok: false, error: "invalid_requested_time" };
  if (requestedStartsAt && requestedEndsAt && new Date(requestedEndsAt) <= new Date(requestedStartsAt)) return { ok: false, error: "invalid_requested_time" };
  if (!serviceType) return { ok: false, error: "invalid_service_type" };
  if (customerName.length < 2) return { ok: false, error: "invalid_customer_name" };
  if (!isEmail(customerEmail)) return { ok: false, error: "invalid_customer_email" };
  if (customerPhone.length < 6) return { ok: false, error: "invalid_customer_phone" };
  if (address.length < 3) return { ok: false, error: "invalid_address" };

  return {
    ok: true,
    value: {
      availabilitySlotId,
      requestedStartsAt,
      requestedEndsAt,
      serviceType,
      customerName,
      customerEmail,
      customerPhone,
      address,
      postalCode,
      city,
      areaSqm,
      rooms,
      addons,
      estimatedPriceSek,
      message,
    },
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders(req) });
  }

  const badOrigin = rejectBadOrigin(req);
  if (badOrigin) return badOrigin;

  if (req.method !== "POST") {
    return json(req, { error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const orgId = Deno.env.get("PUBLIC_BOOKING_ORG_ID") ?? "";
  const leadCustomerId = Deno.env.get("PUBLIC_BOOKING_LEAD_CUSTOMER_ID") ?? "";

  if (!supabaseUrl || !serviceRoleKey || !orgId || !leadCustomerId) {
    return json(req, { error: "Booking API is not configured" }, 503);
  }

  let body: BookingBody;
  try {
    body = await req.json();
  } catch {
    return json(req, { error: "Invalid JSON" }, 400);
  }

  // Honeypot fields. Return success-shaped response but do not create records.
  if (asString(body.website, 120) || asString(body.company, 120)) {
    return json(req, { ok: true, status: "received" });
  }

  const timingError = validateSubmissionTiming(body.form_started_at);
  if (timingError) {
    return json(req, { error: timingError }, 400);
  }

  const parsed = validate(body);
  if (!parsed.ok) {
    return json(req, { error: parsed.error }, 400);
  }

  const value = parsed.value;
  const sb = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await sb.rpc("create_public_booking_request", {
    p_org_id: orgId,
    p_lead_customer_id: leadCustomerId,
    p_availability_slot_id: value.availabilitySlotId,
    p_requested_starts_at: value.requestedStartsAt,
    p_requested_ends_at: value.requestedEndsAt,
    p_service_type: value.serviceType,
    p_customer_name: value.customerName,
    p_customer_email: value.customerEmail,
    p_customer_phone: value.customerPhone,
    p_address: value.address,
    p_postal_code: value.postalCode,
    p_city: value.city,
    p_area_sqm: value.areaSqm,
    p_rooms: value.rooms,
    p_addons: value.addons,
    p_estimated_price_sek: value.estimatedPriceSek,
    p_message: value.message,
    p_source_domain: sourceDomain(req),
    p_ip_hash: await hashIp(req),
    p_user_agent: req.headers.get("user-agent")?.slice(0, 500) ?? null,
  });

  if (error) {
    console.error("[public-booking-request] rpc:", error.code, error.message);
    if (error.code === "23505") {
      return json(req, { error: "slot_unavailable" }, 409);
    }
    if (error.code === "22023") {
      return json(req, { error: "invalid_request" }, 400);
    }
    if (error.code === "P0002") {
      return json(req, { error: "booking_target_not_found" }, 404);
    }
    return json(req, { error: "Could not create booking request" }, 500);
  }

  return json(req, data ?? { ok: true });
});
