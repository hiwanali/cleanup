import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { renderCleanUpEmail } from "../_shared/email-template.ts";

const DEFAULT_ALLOWED_ORIGINS = [
  "https://cleanup.nu",
  "https://www.cleanup.nu",
  "https://logincleanup.app",
  "https://www.logincleanup.app",
  "http://localhost:3000",
  "http://localhost:5173",
  "http://localhost:8080",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:8080",
];

type LoginLinkBody = {
  email?: unknown;
};

type CustomerLookup =
  | { ok: true; user: { id: string; org_id: string; role: string; name: string; email: string }; customerName: string }
  | { ok: false };

function allowedOrigins(): string[] {
  const raw = Deno.env.get("CUSTOMER_LOGIN_ALLOWED_ORIGINS");
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

function genericAccepted(req: Request): Response {
  return json(req, { ok: true, status: "accepted" });
}

function rejectBadOrigin(req: Request): Response | null {
  const origin = req.headers.get("origin");
  if (!origin) return null;
  if (allowedOrigins().includes(origin)) return null;
  return json(req, { error: "Origin not allowed" }, 403);
}

function normalizeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase().slice(0, 180) : "";
}

function isEmail(value: string): boolean {
  return /^[^\s@%]+@[^\s@%]+\.[^\s@%]+$/.test(value);
}

function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for") ?? "";
  const cf = req.headers.get("cf-connecting-ip") ?? "";
  return (forwarded.split(",")[0]?.trim() || cf.trim()).slice(0, 120);
}

async function hmacHex(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function recordRequest(
  adminClient: ReturnType<typeof createClient>,
  row: { emailHash: string; ipHash: string | null; userAgent: string; status: string },
): Promise<void> {
  const { error } = await adminClient.from("customer_login_requests").insert({
    email_hash: row.emailHash,
    ip_hash: row.ipHash,
    user_agent: row.userAgent,
    status: row.status,
  });
  if (error) console.warn("[request-customer-login-link] audit insert:", error.message);
}

async function isRateLimited(
  adminClient: ReturnType<typeof createClient>,
  emailHash: string,
  ipHash: string | null,
): Promise<boolean | "unavailable"> {
  const since = new Date(Date.now() - 15 * 60 * 1000).toISOString();

  const { count: emailCount, error: emailErr } = await adminClient
    .from("customer_login_requests")
    .select("id", { count: "exact", head: true })
    .eq("email_hash", emailHash)
    .gte("created_at", since);

  if (emailErr) {
    console.warn("[request-customer-login-link] email rate limit:", emailErr.message);
    return "unavailable";
  }

  if ((emailCount ?? 0) >= 3) return true;

  if (!ipHash) return false;

  const { count: ipCount, error: ipErr } = await adminClient
    .from("customer_login_requests")
    .select("id", { count: "exact", head: true })
    .eq("ip_hash", ipHash)
    .gte("created_at", since);

  if (ipErr) {
    console.warn("[request-customer-login-link] ip rate limit:", ipErr.message);
    return "unavailable";
  }

  return (ipCount ?? 0) >= 20;
}

async function lookupCustomer(
  adminClient: ReturnType<typeof createClient>,
  email: string,
): Promise<CustomerLookup> {
  const { data: users, error: userErr } = await adminClient
    .from("users")
    .select("id, org_id, role, active, name, email")
    .eq("email", email)
    .in("role", ["customer", "customer_employee"])
    .limit(2);

  if (userErr) {
    console.warn("[request-customer-login-link] user lookup:", userErr.message);
    return { ok: false };
  }

  const user = users?.find((u) => u.active && u.email && String(u.email).toLowerCase() === email);
  if (!user) return { ok: false };

  if (user.role === "customer") {
    const { data: customer, error } = await adminClient
      .from("customers")
      .select("id, name")
      .eq("org_id", user.org_id)
      .eq("primary_contact_user_id", user.id)
      .limit(1)
      .maybeSingle();

    if (error) console.warn("[request-customer-login-link] customer lookup:", error.message);
    if (!customer) return { ok: false };
    return { ok: true, user, customerName: customer.name || "CleanUp" };
  }

  const { data: employeeRows, error: employeeErr } = await adminClient
    .from("customer_employees")
    .select("customer_id")
    .eq("user_id", user.id)
    .limit(1);

  if (employeeErr) console.warn("[request-customer-login-link] employee lookup:", employeeErr.message);
  const customerId = employeeRows?.[0]?.customer_id;
  if (!customerId) return { ok: false };

  const { data: customer, error: customerErr } = await adminClient
    .from("customers")
    .select("id, name")
    .eq("id", customerId)
    .eq("org_id", user.org_id)
    .maybeSingle();

  if (customerErr) console.warn("[request-customer-login-link] employee customer lookup:", customerErr.message);
  if (!customer) return { ok: false };
  return { ok: true, user, customerName: customer.name || "CleanUp" };
}

function buildEmail({ contactName, link }: { contactName: string; link: string }) {
  return renderCleanUpEmail({
    subject: "CleanUp: Logga in i kundportalen",
    preheader: "Anv\u00e4nd den h\u00e4r personliga eng\u00e5ngsl\u00e4nken f\u00f6r att \u00f6ppna CleanUp kundportal.",
    eyebrow: "Kundportal",
    title: "Logga in i kundportalen",
    greeting: `Hej ${contactName || "kund"},`,
    intro: "Vi har f\u00e5tt en beg\u00e4ran om att skicka en inloggningsl\u00e4nk till CleanUp kundportal.",
    body: [
      "L\u00e4nken \u00e4r personlig och fungerar bara f\u00f6r ditt konto.",
      "N\u00e4r du \u00e4r inloggad kan du se dina bokningar, meddelanden och uppgifter som h\u00f6r till kundportalen.",
    ],
    ctaLabel: "\u00d6ppna kundportalen",
    ctaUrl: link,
    note: "Om du inte bad om den h\u00e4r l\u00e4nken kan du ignorera mejlet.",
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(req) });

  const badOrigin = rejectBadOrigin(req);
  if (badOrigin) return badOrigin;

  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  try {
    const body = (await req.json().catch(() => ({}))) as LoginLinkBody;
    const email = normalizeEmail(body.email);
    if (!isEmail(email)) return genericAccepted(req);

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const resendKey = Deno.env.get("RESEND_API_KEY") ?? "";
    const resendFrom = Deno.env.get("RESEND_FROM") ?? "";
    const siteUrl = (Deno.env.get("CUSTOMER_PORTAL_SITE_URL") ?? "https://www.logincleanup.app/CleanUp.html").replace(/\/$/, "");

    if (!supabaseUrl || !serviceRoleKey) {
      console.warn("[request-customer-login-link] Supabase env not configured");
      return genericAccepted(req);
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const hashSecret = Deno.env.get("CUSTOMER_LOGIN_HASH_SECRET") || serviceRoleKey;
    const emailHash = await hmacHex(hashSecret, email);
    const ip = clientIp(req);
    const ipHash = ip ? await hmacHex(hashSecret, ip) : null;
    const userAgent = req.headers.get("user-agent")?.slice(0, 500) ?? "";

    const limited = await isRateLimited(adminClient, emailHash, ipHash);
    if (limited === "unavailable") {
      await recordRequest(adminClient, { emailHash, ipHash, userAgent, status: "config_error" }).catch(() => {});
      return genericAccepted(req);
    }
    if (limited) {
      await recordRequest(adminClient, { emailHash, ipHash, userAgent, status: "rate_limited" }).catch(() => {});
      return genericAccepted(req);
    }

    const match = await lookupCustomer(adminClient, email);
    if (!match.ok) {
      await recordRequest(adminClient, { emailHash, ipHash, userAgent, status: "skipped" });
      return genericAccepted(req);
    }

    if (!resendKey || !resendFrom) {
      console.warn("[request-customer-login-link] Resend env not configured");
      await recordRequest(adminClient, { emailHash, ipHash, userAgent, status: "config_error" });
      return genericAccepted(req);
    }

    const redirectTo = `${siteUrl}?portalRedirect=${encodeURIComponent("/kund/oversikt")}`;
    const { data: linkData, error: linkErr } = await adminClient.auth.admin.generateLink({
      type: "magiclink",
      email: match.user.email,
      options: { redirectTo },
    });

    if (linkErr || !linkData?.properties?.action_link) {
      console.warn("[request-customer-login-link] generate link:", linkErr?.message || "missing action link");
      await recordRequest(adminClient, { emailHash, ipHash, userAgent, status: "send_error" });
      return genericAccepted(req);
    }

    const content = buildEmail({
      contactName: match.user.name,
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
        to: [match.user.email],
        subject: content.subject,
        text: content.text,
        html: content.html,
        tags: [{ name: "kind", value: "customer_self_service_login" }],
      }),
    });

    if (!resendRes.ok) {
      const detail = await resendRes.text();
      console.warn("[request-customer-login-link] resend:", detail.slice(0, 500));
      await recordRequest(adminClient, { emailHash, ipHash, userAgent, status: "send_error" });
      return genericAccepted(req);
    }

    await recordRequest(adminClient, { emailHash, ipHash, userAgent, status: "sent" });
    return genericAccepted(req);
  } catch (e) {
    console.warn("[request-customer-login-link] unexpected:", e instanceof Error ? e.message : String(e));
    return genericAccepted(req);
  }
});
