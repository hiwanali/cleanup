import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { formatDateTimeSE, renderCleanUpEmail } from '../_shared/email-template.ts';

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

function roleArea(role: UserRole): 'admin' | 'stadare' | 'kund' {
  if (role === 'cleaner') return 'stadare';
  if (role === 'customer' || role === 'customer_employee') return 'kund';
  return 'admin';
}

function portalUrl(appBaseUrl: string, role: UserRole, shiftId: string, targetPath?: string): string {
  const base = appBaseUrl.replace(/\/$/, '');
  const area = roleArea(role);
  const target = String(targetPath || '').trim();

  if (/^https?:\/\//i.test(target)) {
    return target;
  }

  if (target.startsWith('#/')) {
    return `${base}${target}`;
  }

  if (target.startsWith('/')) {
    return `${base}#${target}`;
  }

  if ((role === 'customer' || role === 'customer_employee') && shiftId) {
    return `${base}#/kund/pass/${encodeURIComponent(shiftId)}`;
  }

  return `${base}#/${area}/schema`;
}

function notificationCopy(kind: string, role: UserRole, detail: string): { title: string; intro: string; body?: string[]; eyebrow?: string } {
  const isCustomer = role === 'customer' || role === 'customer_employee';

  switch (kind) {
    case 'sick_reported':
      return isCustomer
        ? {
          title: 'Vi hanterar ditt bokade pass',
          intro: detail ? `${detail} är påverkat av sjukfrånvaro.` : 'Ett bokat pass är påverkat av sjukfrånvaro.',
          body: ['CleanUp hanterar bemanningen och återkommer om något behöver ändras.'],
          eyebrow: 'Uppdatering',
        }
        : {
          title: 'Pass sjukanmält',
          intro: detail ? `${detail} har sjukanmälts.` : 'Ett pass har sjukanmälts.',
          body: ['Öppna portalen för att se passet och planera nästa steg.'],
          eyebrow: 'Åtgärd behövs',
        };
    case 'assigned_shift':
      return isCustomer
        ? {
          title: 'Din bokning är bekräftad',
          intro: detail ? `${detail} är bekräftat av CleanUp.` : 'Din bokning är bekräftad av CleanUp.',
          body: ['Du kan se detaljerna i kundportalen.'],
          eyebrow: 'Bokning',
        }
        : {
          title: 'Du har tilldelats ett pass',
          intro: detail ? `${detail} har lagts på ditt schema.` : 'Ett nytt pass har lagts på ditt schema.',
          body: ['Öppna portalen för att se adress, tid och checklista.'],
          eyebrow: 'Schema',
        };
    case 'shift_approved':
      return {
        title: 'Pass godkänt',
        intro: detail ? `${detail} är godkänt.` : 'Ett pass är godkänt.',
        body: ['Statusen är uppdaterad i CleanUp-portalen.'],
        eyebrow: 'Bekräftelse',
      };
    case 'unassigned_shift':
      return {
        title: 'Du togs bort från ett pass',
        intro: detail ? `${detail} finns inte längre på ditt schema.` : 'Ett pass finns inte längre på ditt schema.',
        eyebrow: 'Schema',
      };
    case 'cleaner_swapped':
      return isCustomer
        ? {
          title: 'Din städning är uppdaterad',
          intro: detail ? `${detail} har fått uppdaterad bemanning.` : 'CleanUp har uppdaterat bemanningen för ett pass.',
          body: ['Tiden och bokningsdetaljerna är oförändrade om inget annat anges.'],
          eyebrow: 'Uppdatering',
        }
        : {
          title: 'Du har tilldelats ett pass',
          intro: detail ? `${detail} har lagts på ditt schema.` : 'Du har tilldelats ett pass.',
          eyebrow: 'Schema',
        };
    case 'time_adjusted':
      return {
        title: 'Tid justerad',
        intro: detail ? `${detail} har uppdaterad tid.` : 'Tiden för ett pass har ändrats.',
        body: ['Öppna portalen för att se den aktuella tiden.'],
        eyebrow: 'Tidsändring',
      };
    case 'customer_cancelled':
      return {
        title: 'Pass avbokat av kund',
        intro: detail ? `${detail} har avbokats av kunden.` : 'Ett pass har avbokats av kunden.',
        body: ['Statusen är uppdaterad i CleanUp.'],
        eyebrow: 'Avbokning',
      };
    case 'admin_deleted':
      return isCustomer
        ? {
          title: 'Pass borttaget',
          intro: detail ? `${detail} har tagits bort av CleanUp.` : 'CleanUp har tagit bort ett pass.',
          body: ['Kontakta CleanUp om något verkar fel.'],
          eyebrow: 'Uppdatering',
        }
        : {
          title: 'Pass borttaget',
          intro: detail ? `${detail} har tagits bort.` : 'Ett pass har tagits bort.',
          eyebrow: 'Schema',
        };
    case 'paused_by_holiday':
      return {
        title: 'Pass pausat',
        intro: detail ? `${detail} har pausats på grund av kundledighet.` : 'Ett pass har pausats på grund av kundledighet.',
        eyebrow: 'Kundledighet',
      };
    case 'holiday_created':
      return {
        title: 'Ny kundledighet registrerad',
        intro: 'Kundledighet har registrerats och berörda pass har pausats.',
        body: ['Berörda pass har pausats i schemat.'],
        eyebrow: 'Kundledighet',
      };
    case 'holiday_removed':
      return {
        title: 'Kundledighet borttagen',
        intro: detail ? `${detail} är uppdaterat.` : 'Kundledigheten är borttagen och berörda pass är uppdaterade.',
        eyebrow: 'Kundledighet',
      };
    case 'incident_created':
      return {
        title: 'Nytt avvikelseärende',
        intro: detail ? `Ett nytt ärende har registrerats för ${detail}.` : 'Ett nytt avvikelseärende har registrerats.',
        body: ['Öppna portalen för att läsa detaljerna och följa hanteringen.'],
        eyebrow: 'Avvikelse',
      };
    case 'incident_resolved':
      return {
        title: 'Ditt ärende är åtgärdat',
        intro: 'Ärendet har markerats som åtgärdat i CleanUp.',
        body: ['Tack för att du hjälper oss hålla kvaliteten tydlig.'],
        eyebrow: 'Ärende',
      };
    case 'incident_in_progress':
      return {
        title: 'Ditt ärende behandlas',
        intro: 'CleanUp har börjat hantera ärendet.',
        body: ['Du kan följa statusen i portalen.'],
        eyebrow: 'Ärende',
      };
    case 'shift_will_be_missed':
      return {
        title: 'Pass kommer inte att utföras',
        intro: detail ? `${detail} kommer inte att utföras som planerat.` : 'Ett pass kommer inte att utföras som planerat.',
        body: ['CleanUp hanterar uppföljningen i portalen.'],
        eyebrow: 'Viktig uppdatering',
      };
    case 'shift_request_created':
      return {
        title: 'Nytt önskemål från kund',
        intro: detail ? `Ett nytt önskemål har kommit in för ${detail}.` : 'En kund har lämnat ett nytt önskemål.',
        body: ['Öppna portalen för att läsa och hantera önskemålet.'],
        eyebrow: 'Kundönskemål',
      };
    case 'customer_booking_request':
      return {
        title: 'Ny bokningsförfrågan',
        intro: detail ? `En ny publik bokningsförfrågan har kommit in för ${detail}.` : 'En ny publik bokningsförfrågan har kommit in.',
        body: ['Granska förfrågan i adminportalen och bekräfta nästa steg.'],
        eyebrow: 'Ny förfrågan',
      };
    case 'new_message':
      return {
        title: 'Nytt meddelande',
        intro: 'Du har fått ett nytt meddelande i CleanUp-portalen.',
        body: ['Öppna portalen för att läsa och svara.'],
        eyebrow: 'Meddelande',
      };
    default:
      return {
        title: 'Ny notis i CleanUp',
        intro: detail || 'Du har en ny notis i CleanUp-portalen.',
        eyebrow: 'Notis',
      };
  }
}

function buildEmailContent(
  kind: string,
  role: UserRole,
  propertyName: string,
  payload: Record<string, unknown>,
  appBaseUrl: string,
): { subject: string; text: string; html: string } {
  const when = formatDateTimeSE(payload.start_at as string);
  const propLine = propertyName ? `${propertyName}` : '';
  const detail = [propLine, when].filter(Boolean).join(' · ');
  const shiftId = typeof payload.shift_id === 'string' ? payload.shift_id : '';
  const targetPath = typeof payload.target_path === 'string' ? payload.target_path : '';
  const copy = notificationCopy(kind, role, detail);
  const isCustomer = role === 'customer' || role === 'customer_employee';

  let intro = copy.intro;
  if (kind === 'holiday_created') {
    intro = `${payload.count ?? '?'} pass har pausats.`;
  }
  if (kind === 'holiday_removed' && !payload.shift_id) {
    intro = `${payload.restored ?? '?'} pass har återaktiverats.`;
  }

  return renderCleanUpEmail({
    subject: `CleanUp: ${copy.title}`,
    preheader: copy.intro,
    eyebrow: copy.eyebrow,
    title: copy.title,
    intro,
    body: copy.body,
    details: [
      { label: 'Objekt', value: propertyName },
      { label: 'Tid', value: when },
    ],
    ctaLabel: kind === 'new_message' ? 'Öppna meddelanden' : isCustomer ? 'Öppna kundportalen' : 'Öppna CleanUp-portalen',
    ctaUrl: portalUrl(appBaseUrl, role, shiftId, targetPath),
    note: isCustomer
      ? 'Det här är ett automatiskt meddelande från CleanUp. Svara via portalen om du behöver återkoppla.'
      : 'Det här är ett automatiskt arbetsmeddelande från CleanUp.',
  });
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
