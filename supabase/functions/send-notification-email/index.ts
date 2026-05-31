import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type UserRole = 'admin' | 'cleaner' | 'customer' | 'customer_employee';

interface NotificationRecord {
  id: string;
  recipient_user_id: string;
  kind: string;
  payload: Record<string, unknown>;
  email_sent_at?: string | null;
}

function formatDateTime(iso: string | undefined | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString('sv-SE', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/Stockholm',
  });
}

function buildEmailContent(
  kind: string,
  role: UserRole,
  propertyName: string,
  payload: Record<string, unknown>,
): { subject: string; text: string; html: string } | null {
  const when = formatDateTime(payload.start_at as string);
  const propLine = propertyName ? `${propertyName}` : '';
  const timeLine = when ? ` · ${when}` : '';
  const detail = propLine + timeLine;

  const wrap = (title: string, body: string) => ({
    subject: `CleanUp: ${title}`,
    text: `${title}\n\n${body}\n\n— CleanUp`,
    html: `<p><strong>${title}</strong></p><p>${body.replace(/\n/g, '<br>')}</p><p style="color:#64748b;font-size:12px;">— CleanUp</p>`,
  });

  switch (kind) {
    case 'sick_reported':
      return wrap('Pass sjukanmält', detail || 'Ett pass har sjukanmälts.');
    case 'assigned_shift':
      return wrap('Du har tilldelats ett pass', detail || 'Ett nytt pass har tilldelats.');
    case 'cleaner_swapped':
      if (role === 'customer' || role === 'customer_employee') {
        return wrap('Städare ombokad', detail || 'Städaren för ett pass har bytts.');
      }
      return wrap('Du har tilldelats ett pass', detail || 'Du har tilldelats ett pass.');
    case 'time_adjusted':
      return wrap('Tid justerad', detail || 'Tiden för ett pass har ändrats.');
    case 'customer_cancelled':
      return wrap('Pass avbokat av kund', detail || 'Ett pass har avbokats av kunden.');
    case 'admin_deleted':
      return wrap('Pass borttaget', detail || 'Ett pass har tagits bort.');
    case 'paused_by_holiday':
      return wrap('Pass pausat (kundledighet)', detail || 'Ett pass har pausats på grund av kundledighet.');
    case 'holiday_created': {
      const count = payload.count ?? '?';
      return wrap('Ny kundledighet registrerad', `${count} pass har pausats.`);
    }
    case 'holiday_removed':
      if (payload.shift_id) {
        return wrap('Pausat pass återaktiverat', detail || 'Ett pausat pass är återaktiverat.');
      }
      return wrap('Kundledighet borttagen', `${payload.restored ?? '?'} pass återaktiverade.`);
    case 'incident_created':
      return wrap('Nytt avvikelse-ärende', propLine || 'Ett nytt ärende har registrerats.');
    case 'incident_resolved':
      return wrap('Ditt ärende är åtgärdat', 'Ditt ärende har markerats som åtgärdat.');
    case 'incident_in_progress':
      return wrap('Ditt ärende behandlas', 'Ditt ärende behandlas av admin.');
    case 'shift_will_be_missed':
      return wrap('Pass kommer inte att utföras', detail || 'Ett pass kommer inte att utföras som planerat.');
    default:
      return wrap(kind, detail || 'Du har en ny notis i CleanUp.');
  }
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const resendKey = Deno.env.get('RESEND_API_KEY');
    const resendFrom = Deno.env.get('RESEND_FROM');
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    if (!resendKey || !resendFrom) {
      return new Response(JSON.stringify({ error: 'RESEND not configured' }), {
        status: 503,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json();
    const record = (body.record ?? body) as NotificationRecord;
    const notificationId = record?.id;

    if (!notificationId) {
      return new Response(JSON.stringify({ error: 'Missing notification id' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const sb = createClient(supabaseUrl, serviceRoleKey);

    const { data: notif, error: notifErr } = await sb
      .from('notifications')
      .select('id, recipient_user_id, kind, payload, email_sent_at')
      .eq('id', notificationId)
      .single();

    if (notifErr || !notif) {
      return new Response(JSON.stringify({ error: 'Notification not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (notif.email_sent_at) {
      return new Response(JSON.stringify({ ok: true, skipped: 'already_sent' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: user, error: userErr } = await sb
      .from('users')
      .select('email, role, active')
      .eq('id', notif.recipient_user_id)
      .single();

    if (userErr || !user?.active || !user.email || !isValidEmail(user.email)) {
      await sb
        .from('notifications')
        .update({ email_error: 'No valid recipient email' })
        .eq('id', notificationId);
      return new Response(JSON.stringify({ ok: true, skipped: 'no_email' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const payload = (notif.payload ?? {}) as Record<string, unknown>;
    let propertyName = '';
    const propertyId = payload.property_id as string | undefined;
    if (propertyId) {
      const { data: prop } = await sb.from('properties').select('name').eq('id', propertyId).maybeSingle();
      propertyName = prop?.name ?? '';
    }

    const content = buildEmailContent(notif.kind, user.role as UserRole, propertyName, payload);
    if (!content) {
      return new Response(JSON.stringify({ ok: true, skipped: 'no_template' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: resendFrom,
        to: [user.email],
        subject: content.subject,
        text: content.text,
        html: content.html,
        tags: [{ name: 'kind', value: notif.kind }],
      }),
    });

    if (!resendRes.ok) {
      const errText = await resendRes.text();
      await sb
        .from('notifications')
        .update({ email_error: errText.slice(0, 500) })
        .eq('id', notificationId);
      return new Response(JSON.stringify({ error: 'Resend failed', detail: errText }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    await sb
      .from('notifications')
      .update({ email_sent_at: new Date().toISOString(), email_error: null })
      .eq('id', notificationId);

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
