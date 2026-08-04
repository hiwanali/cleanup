import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { formatDateTimeSE, renderCleanUpEmail, serviceLabel } from "../_shared/email-template.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type BookingInviteBody = {
  shift_id?: unknown;
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function asUuid(value: unknown): string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : "";
}

function buildEmail({
  customerName,
  serviceType,
  startsAt,
  endsAt,
  address,
  link,
}: {
  customerName: string;
  serviceType: string;
  startsAt: string;
  endsAt: string;
  address: string;
  link: string;
}) {
  const title = "Din bokning är bekräftad";
  const service = serviceLabel(serviceType);
  const starts = formatDateTimeSE(startsAt);
  const ends = formatDateTimeSE(endsAt).split(" ").pop() || "";
  const when = starts && ends ? `${starts}-${ends}` : starts;

  return renderCleanUpEmail({
    subject: `CleanUp: ${title}`,
    preheader: `Din ${service.toLowerCase()} är bekräftad${when ? `, ${when}` : ""}.`,
    eyebrow: "Bokningsbekräftelse",
    title,
    greeting: `Hej ${customerName || "kund"},`,
    intro: `Din ${service.toLowerCase()} är bekräftad. Här finns de viktigaste detaljerna för bokningen.`,
    body: [
      "I kundportalen kan du se bokningen, följa uppdateringar och hantera kommande information från CleanUp.",
    ],
    details: [
      { label: "Tjänst", value: service },
      { label: "Tid", value: when },
      { label: "Adress", value: address },
    ],
    ctaLabel: "Öppna kundportalen",
    ctaUrl: link,
    note: "Länken är personlig och ska inte delas vidare.",
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const resendKey = Deno.env.get("RESEND_API_KEY") ?? "";
    const resendFrom = Deno.env.get("RESEND_FROM") ?? "";
    const siteUrl = (Deno.env.get("CUSTOMER_PORTAL_SITE_URL") ?? "https://www.logincleanup.app/CleanUp.html").replace(/\/$/, "");

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return json({ error: "Supabase env not configured" }, 503);
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: authData, error: authErr } = await userClient.auth.getUser();
    if (authErr || !authData.user) return json({ error: "Unauthorized" }, 401);

    const { data: actor, error: actorErr } = await adminClient
      .from("users")
      .select("id, role, active")
      .eq("id", authData.user.id)
      .single();

    if (actorErr || actor?.role !== "admin" || !actor.active) {
      return json({ error: "Forbidden" }, 403);
    }

    const body = (await req.json().catch(() => ({}))) as BookingInviteBody;
    const shiftId = asUuid(body.shift_id);
    if (!shiftId) return json({ error: "Missing shift_id" }, 400);

    const { data: booking, error: bookingErr } = await adminClient
      .from("booking_requests")
      .select("id, shift_id, status, service_type, customer_name, customer_email, address, requested_starts_at, requested_ends_at, portal_user_id, portal_access_status, portal_redirect_path")
      .eq("shift_id", shiftId)
      .single();

    if (bookingErr || !booking) return json({ error: "Booking request not found" }, 404);
    if (booking.status !== "approved") return json({ error: "Booking is not approved" }, 409);
    if (!booking.portal_user_id || !booking.portal_redirect_path) return json({ error: "Portal access is not prepared" }, 409);

    const redirectTo = `${siteUrl}?portalRedirect=${encodeURIComponent(booking.portal_redirect_path)}`;
    const { data: linkData, error: linkErr } = await adminClient.auth.admin.generateLink({
      type: "magiclink",
      email: booking.customer_email,
      options: { redirectTo },
    });

    if (linkErr || !linkData?.properties?.action_link) {
      return json({ error: "Could not generate magic link" }, 502);
    }

    if (!resendKey || !resendFrom) {
      return json({ error: "RESEND not configured" }, 503);
    }

    const content = buildEmail({
      customerName: booking.customer_name,
      serviceType: booking.service_type,
      startsAt: booking.requested_starts_at,
      endsAt: booking.requested_ends_at,
      address: booking.address,
      link: linkData.properties.action_link,
    });

    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: resendFrom,
        to: [booking.customer_email],
        subject: content.subject,
        text: content.text,
        html: content.html,
        tags: [{ name: "kind", value: "customer_portal_invite" }],
      }),
    });

    if (!resendRes.ok) {
      const detail = await resendRes.text();
      return json({ error: "Resend failed", detail: detail.slice(0, 500) }, 502);
    }

    const now = new Date().toISOString();
    const inviteUpdate: Record<string, string> = {
      portal_access_status: "invited",
      portal_last_magic_link_sent_at: now,
    };
    if (booking.portal_access_status !== "invited") {
      inviteUpdate.portal_invited_at = now;
    }

    const { error: updateErr } = await adminClient
      .from("booking_requests")
      .update(inviteUpdate)
      .eq("id", booking.id);

    if (updateErr) return json({ error: "Could not update invite status" }, 500);

    return json({ ok: true, status: "invited" });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return json({ error: message }, 500);
  }
});
