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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildEmailContent(
  kind: string,
  role: UserRole,
  propertyName: string,
  payload: Record<string, unknown>,
  appBaseUrl: string,
): { subject: string; text: string; html: string } | null {
  const when = formatDateTime(payload.start_at as string);
  const propLine = propertyName ? `${propertyName}` : '';
  const timeLine = when ? ` · ${when}` : '';
  const detail = propLine + timeLine;
  const shiftId = typeof payload.shift_id === 'string' ? payload.shift_id : '';
  const shiftUrl = shiftId
    ? `${appBaseUrl.replace(/\/$/, '')}#/kund/pass/${encodeURIComponent(shiftId)}`
    : `${appBaseUrl.replace(/\/$/, '')}#/kund/schema`;
  const staffUrl = `${appBaseUrl.replace(/\/$/, '')}#/${role === 'cleaner' ? 'stadare/schema' : 'admin/schema'}`;

  const actionLine = role === 'customer' || role === 'customer_employee'
    ? `\n\nDu kan se detaljerna i kundportalen: ${shiftUrl}`
    : `\n\nLogga in i CleanUp-portalen för att hantera detta: ${staffUrl}`;
  const actionHtml = role === 'customer' || role === 'customer_employee'
    ? `<p><a href="${shiftUrl}" style="display:inline-block;background:#2557c7;color:#ffffff;text-decoration:none;border-radius:10px;padding:10px 14px;font-weight:700;">Öppna i kundportalen</a></p>`
    : `<p><a href="${staffUrl}" style="display:inline-block;background:#2557c7;color:#ffffff;text-decoration:none;border-radius:10px;padding:10px 14px;font-weight:700;">Öppna CleanUp-portalen</a></p>`;

  const wrap = (title: string, body: string) => ({
    subject: `CleanUp: ${title}`,
    text: `${title}\n\n${body}${actionLine}\n\n— CleanUp`,
    html: `<p><strong>${escapeHtml(title)}</strong></p><p>${escapeHtml(body).replace(/\n/g, '<br>')}</p>${actionHtml}<p style="color:#64748b;font-size:12px;">— CleanUp</p>`,
  });

  switch (kind) {
    case 'sick_reported':
      if (role === 'customer' || role === 'customer_employee') {
        return wrap('Vi hanterar ditt bokade pass', detail ? `${detail}\n\nStädaren har sjukanmält passet. CleanUp hanterar detta och återkommer vid behov.` : 'Städaren har sjukanmält ett pass. CleanUp hanterar detta och återkommer vid behov.');
      }
      return wrap('Pass sjukanmält', detail || 'Ett pass har sjukanmälts.');
    case 'assigned_shift':
      if (role === 'customer' || role === 'customer_employee') {
        return wrap('Din bokning är bekräftad', detail || 'Din bokning är bekräftad av CleanUp.');
      }
      return wrap('Du har tilldelats ett pass', detail || 'Ett nytt pass har tilldelats.');
    case 'unassigned_shift':
      return wrap('Du togs bort från ett pass', detail || 'Du togs bort från ett pass.');
    case 'cleaner_swapped':
      if (role === 'customer' || role === 'customer_employee') {
        return wrap('Din städning är uppdaterad', detail ? `${detail}\n\nCleanUp har uppdaterat bemanningen för passet.` : 'CleanUp har uppdaterat bemanningen för ett pass.');
      }
      return wrap('Du har tilldelats ett pass', detail || 'Du har tilldelats ett pass.');
    case 'time_adjusted':
      return wrap('Tid justerad', detail || 'Tiden för ett pass har ändrats.');
    case 'customer_cancelled':
      return wrap('Pass avbokat av kund', detail || 'Ett pass har avbokats av kunden.');
    case 'admin_deleted':
      if (role === 'customer' || role === 'customer_employee') {
        return wrap('Pass borttaget', detail ? `${detail}\n\nCleanUp har tagit bort passet. Kontakta oss om något verkar fel.` : 'CleanUp har tagit bort ett pass. Kontakta oss om något verkar fel.');
      }
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
    case 'shift_request_created':
      return wrap('Nytt önskemål från kund', propLine || 'En kund har lämnat ett nytt önskemål.');
    case 'customer_booking_request':
      return wrap('Ny bokningsförfrågan', detail || 'En ny publik bokningsförfrågan har kommit in.');
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
    const appBaseUrl = Deno.env.get('CUSTOMER_PORTAL_SITE_URL') ?? 'https://www.logincleanup.app/CleanUp.html';

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

    const content = buildEmailContent(notif.kind, user.role as UserRole, propertyName, payload, appBaseUrl);
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
