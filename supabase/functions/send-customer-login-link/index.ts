import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type CustomerLoginLinkBody = {
  customer_id?: unknown;
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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildEmail({
  customerName,
  contactName,
  link,
}: {
  customerName: string;
  contactName: string;
  link: string;
}) {
  const title = "Din kundportal är klar";
  const greetingName = contactName || customerName || "kund";
  const lines = [
    `Hej ${greetingName},`,
    "",
    `Du har nu tillgång till CleanUp kundportal för ${customerName || "din kundprofil"}.`,
    "Där kan du se bokningar, objekt, meddelanden och kommande uppdateringar.",
    "",
    "Öppna kundportalen via länken nedan:",
    link,
    "",
    "Länken är personlig och ska inte delas vidare.",
    "",
    "Vänliga hälsningar",
    "CleanUp",
  ];

  const safeTitle = escapeHtml(title);
  const safeGreeting = escapeHtml(greetingName);
  const safeCustomer = escapeHtml(customerName || "din kundprofil");
  const safeLink = escapeHtml(link);

  return {
    subject: `CleanUp: ${title}`,
    text: lines.join("\n"),
    html: `
      <div style="font-family:Inter,Arial,sans-serif;color:#0f172a;line-height:1.55;">
        <h2 style="margin:0 0 12px;">${safeTitle}</h2>
        <p>Hej ${safeGreeting},</p>
        <p>Du har nu tillgång till CleanUp kundportal för ${safeCustomer}.</p>
        <p>Där kan du se bokningar, objekt, meddelanden och kommande uppdateringar.</p>
        <p>
          <a href="${safeLink}" style="display:inline-block;background:#1d4ed8;color:white;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:10px;">
            Öppna kundportalen
          </a>
        </p>
        <p style="color:#64748b;font-size:12px;">Länken är personlig och ska inte delas vidare.</p>
        <p>Vänliga hälsningar<br>CleanUp</p>
      </div>
    `,
  };
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
      .select("id, org_id, role, active")
      .eq("id", authData.user.id)
      .single();

    if (actorErr || actor?.role !== "admin" || !actor.active || !actor.org_id) {
      return json({ error: "Forbidden" }, 403);
    }

    const body = (await req.json().catch(() => ({}))) as CustomerLoginLinkBody;
    const customerId = asUuid(body.customer_id);
    if (!customerId) return json({ error: "Missing customer_id" }, 400);

    const { data: customer, error: customerErr } = await adminClient
      .from("customers")
      .select("id, org_id, name, primary_contact_user_id")
      .eq("id", customerId)
      .eq("org_id", actor.org_id)
      .single();

    if (customerErr || !customer) return json({ error: "Customer not found" }, 404);
    if (!customer.primary_contact_user_id) return json({ error: "Customer has no primary contact" }, 409);

    const { data: contact, error: contactErr } = await adminClient
      .from("users")
      .select("id, org_id, role, active, name, email")
      .eq("id", customer.primary_contact_user_id)
      .eq("org_id", actor.org_id)
      .single();

    if (contactErr || !contact) return json({ error: "Primary contact not found" }, 404);
    if (contact.role !== "customer" || !contact.active) return json({ error: "Primary contact is not an active customer" }, 409);
    if (!contact.email) return json({ error: "Primary contact has no email" }, 409);

    const redirectTo = `${siteUrl}?portalRedirect=${encodeURIComponent("/kund/oversikt")}`;
    const { data: linkData, error: linkErr } = await adminClient.auth.admin.generateLink({
      type: "magiclink",
      email: contact.email,
      options: { redirectTo },
    });

    if (linkErr || !linkData?.properties?.action_link) {
      return json({ error: "Could not generate magic link" }, 502);
    }

    if (!resendKey || !resendFrom) {
      return json({ error: "RESEND not configured" }, 503);
    }

    const content = buildEmail({
      customerName: customer.name,
      contactName: contact.name,
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
        to: [contact.email],
        subject: content.subject,
        text: content.text,
        html: content.html,
        tags: [{ name: "kind", value: "customer_login_link" }],
      }),
    });

    if (!resendRes.ok) {
      const detail = await resendRes.text();
      return json({ error: "Resend failed", detail: detail.slice(0, 500) }, 502);
    }

    return json({ ok: true, status: "sent" });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return json({ error: message }, 500);
  }
});
