/*
 * Supabase-klient + hydrering.
 *
 * Laddas FÖRE mock.jsx. Skapar window.sb (klient) om biblioteket och konfig finns.
 * Hydreringen läser org-datan via RLS och fyller den befintliga in-memory-storen
 * (window.db.replaceAll) så att alla synkrona vyer fungerar oförändrat.
 *
 * Skrivningar speglas stegvis till Supabase i db-mutatorerna (se mock.jsx).
 */
(function () {
  // URL/nyckel från src/config.js (Vercel build) eller fallback för lokal dev.
  const cfg = window.__CLEANUP_CONFIG__ || {};
  const SUPABASE_URL = cfg.url || 'https://bkmnlcdsbvpucpqmaycx.supabase.co';
  const SUPABASE_ANON_KEY = cfg.anonKey || '';

  const lib = window.supabase;
  const enabled = !!(lib && lib.createClient && SUPABASE_URL && SUPABASE_ANON_KEY);

  let sb = null;
  if (enabled) {
    sb = lib.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        storageKey: 'cleanup_sb_auth',
      },
    });
  }

  window.sb = sb;
  window.SUPABASE_ENABLED = enabled;

  /* ---------- datumkonvertering ---------- */
  // timestamptz-kolumner som mocken lagrar som Date-objekt
  const TS_KEYS = {
    organizations: ['created_at'],
    users: ['created_at', 'updated_at'],
    customers: ['created_at', 'updated_at'],
    customer_employees: ['created_at'],
    customer_employee_properties: [],
    properties: ['created_at', 'updated_at'],
    property_cleaners: ['created_at'],
    recurring_schedules: ['created_at'],
    shifts: ['start_at', 'end_at', 'original_start_at', 'original_end_at', 'checked_in_at', 'checked_out_at', 'created_at', 'updated_at'],
    shift_events: ['created_at'],
    cleaning_checklists: ['created_at'],
    shift_checklist_items: ['done_at', 'created_at'],
    customer_holidays: ['created_at'],
    customer_holiday_properties: [],
    incidents: ['resolved_at', 'created_at', 'updated_at'],
    notifications: ['read_at', 'created_at'],
    message_threads: ['created_at', 'last_message_at'],
    messages: ['created_at'],
    thread_reads: ['last_read_at'],
    shift_requests: ['created_at'],
  };

  function convertRow(table, row) {
    const keys = TS_KEYS[table] || [];
    keys.forEach(k => {
      if (row[k] != null) row[k] = new Date(row[k]);
    });
    // Postgres time → 'HH:MM' (mocken använder kort form)
    if (table === 'recurring_schedules') {
      if (typeof row.start_time === 'string') row.start_time = row.start_time.slice(0, 5);
      if (typeof row.end_time === 'string') row.end_time = row.end_time.slice(0, 5);
    }
    return row;
  }

  async function fetchTable(table, { source } = {}) {
    const from = source || table;
    const { data, error } = await sb.from(from).select('*');
    if (error) {
      // Log utan känslig info för debugging
      console.error(`[hydrate] ${from}: Database error`);
      return [];
    }
    return (data || []).map(r => convertRow(table, r));
  }

  /*
   * Läser all data användaren har rätt till (RLS filtrerar) och returnerar
   * ett objekt i samma form som db.state.
   */
  async function loadAllFromSupabase(authUserId) {
    // Hämta först egen profil för att avgöra roll (styr properties-källa)
    const users = await fetchTable('users');
    const me = users.find(u => u.id === authUserId);
    const role = me ? me.role : 'customer';
    const isCustomerRole = role === 'customer' || role === 'customer_employee';

    const [
      organizations,
      customers,
      customer_employees,
      customer_employee_properties,
      propertiesRaw,
      property_cleaners,
      recurring_schedules,
      shifts,
      shift_events,
      cleaning_checklists,
      shift_checklist_items,
      customer_holidays,
      customer_holiday_properties,
      incidents,
      notifications,
      message_threads,
      messages,
      thread_reads,
      shift_requests,
    ] = await Promise.all([
      fetchTable('organizations'),
      fetchTable('customers'),
      fetchTable('customer_employees'),
      fetchTable('customer_employee_properties'),
      // Kundroller läser objekt via vyn (utan access_info)
      isCustomerRole ? fetchTable('properties', { source: 'properties_customer' }) : fetchTable('properties'),
      fetchTable('property_cleaners'),
      fetchTable('recurring_schedules'),
      fetchTable('shifts'),
      fetchTable('shift_events'),
      fetchTable('cleaning_checklists'),
      fetchTable('shift_checklist_items'),
      fetchTable('customer_holidays'),
      fetchTable('customer_holiday_properties'),
      fetchTable('incidents'),
      fetchTable('notifications'),
      fetchTable('message_threads'),
      fetchTable('messages'),
      fetchTable('thread_reads'),
      fetchTable('shift_requests'),
    ]);

    // Vyn saknar access_info – lägg till tom sträng så vy-koden inte kraschar
    const properties = propertiesRaw.map(p => ('access_info' in p ? p : { ...p, access_info: '' }));

    return {
      organizations,
      users,
      customers,
      customer_employees,
      customer_employee_properties,
      properties,
      property_cleaners,
      recurring_schedules,
      shifts,
      shift_events,
      cleaning_checklists,
      shift_checklist_items,
      customer_holidays,
      customer_holiday_properties,
      incidents,
      notifications,
      message_threads,
      messages,
      thread_reads,
      shift_requests,
    };
  }

  // Anropas efter inloggning; window.db finns då (mock.jsx laddas efter).
  window.hydrateFromSupabase = async function (authUserId) {
    if (!enabled) return false;
    const data = await loadAllFromSupabase(authUserId);
    if (window.db && typeof window.db.replaceAll === 'function') {
      window.db.replaceAll(data);
      return true;
    }
    return false;
  };

  /* ---------- persist (skrivningar till Supabase) ---------- */
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  function isUuid(value) {
    return typeof value === 'string' && UUID_RE.test(value);
  }

  function toIso(d) {
    if (d == null) return null;
    if (d instanceof Date) return d.toISOString();
    return d;
  }

  function serializeNotificationPayload(payload) {
    if (!payload || typeof payload !== 'object') return {};
    const out = {};
    Object.keys(payload).forEach((k) => {
      const v = payload[k];
      if (v instanceof Date) out[k] = v.toISOString();
      else if (v != null && typeof v === 'object' && !Array.isArray(v)) out[k] = serializeNotificationPayload(v);
      else out[k] = v;
    });
    return out;
  }

  async function invokeNotificationEmail(notificationId) {
    if (!enabled || !sb || !isUuid(notificationId)) return;
    try {
      await sb.functions.invoke('send-notification-email', {
        body: { record: { id: notificationId } },
      });
    } catch (e) {
      console.warn('[persist] notification email:', e?.message || e);
    }
  }

  /** Persisterar notiser via RPC (samma org) och triggar Resend per rad. */
  async function persistInsertNotifications(rows) {
    if (!enabled || !sb || !rows?.length) {
      return { ok: true, skipped: true };
    }

    const filtered = rows.filter((r) => r.recipient_user_id && isUuid(r.recipient_user_id) && r.kind);
    if (!filtered.length) {
      return { ok: true, skipped: true };
    }

    const p_rows = filtered.map((r) => ({
      recipient_user_id: r.recipient_user_id,
      kind: r.kind,
      payload: serializeNotificationPayload(r.payload),
    }));

    const { data, error } = await sb.rpc('insert_notifications', { p_rows });
    if (error) {
      console.error('[persist] insertNotifications:', error.message);
      return { ok: false, message: error.message };
    }

    const ids = Array.isArray(data) ? data : [];
    ids.forEach((nid) => {
      invokeNotificationEmail(nid);
    });

    return { ok: true, ids };
  }

  /** §7.4 admin tar bort pass – körs endast när id är UUID (hydrerad Supabase-data). */
  async function persistAdminDelete({ shiftId, actorUserId, hoursToStart, shift, primaryContactUserId }) {
    if (!enabled || !sb || !isUuid(shiftId)) {
      return { ok: true, skipped: true };
    }

    const { error: shiftErr } = await sb.from('shifts').update({
      status: 'Borttaget',
      last_modified_by: actorUserId,
    }).eq('id', shiftId);

    if (shiftErr) {
      console.error('[persist] adminDelete shifts:', shiftErr.message);
      return { ok: false, message: shiftErr.message };
    }

    const { error: evErr } = await sb.from('shift_events').insert({
      shift_id: shiftId,
      actor_user_id: actorUserId,
      event_type: 'admin_deleted',
      payload: { hours_to_start: hoursToStart },
    });

    if (evErr) {
      console.error('[persist] adminDelete shift_events:', evErr.message);
      return { ok: false, message: evErr.message };
    }

    return { ok: true };
  }

  /** §7.7 admin redigerar kund + huvudkontakt. */
  async function persistUpdateCustomer({ customerId, customer, contactUserId, contact }) {
    if (!enabled || !sb || !isUuid(customerId)) {
      return { ok: true, skipped: true };
    }

    const { error: custErr } = await sb.from('customers').update({
      name: customer.name,
      org_number: customer.org_number || null,
      notes: customer.notes || '',
    }).eq('id', customerId);

    if (custErr) {
      console.error('[persist] updateCustomer customers:', custErr.message);
      return { ok: false, message: custErr.message };
    }

    if (isUuid(contactUserId)) {
      const { error: userErr } = await sb.from('users').update({
        name: contact.name,
        email: contact.email,
        phone: contact.phone || null,
      }).eq('id', contactUserId);

      if (userErr) {
        console.error('[persist] updateCustomer users:', userErr.message);
        return { ok: false, message: userErr.message };
      }
    }

    return { ok: true };
  }

  /** Admin redigerar objekt (partiell uppdatering). */
  async function persistUpdateProperty({ propertyId, fields }) {
    if (!enabled || !sb || !isUuid(propertyId)) {
      return { ok: true, skipped: true };
    }

    const row = {};
    if ('name' in fields) row.name = fields.name;
    if ('address' in fields) row.address = fields.address ?? '';
    if ('area_sqm' in fields) row.area_sqm = fields.area_sqm;
    if ('access_info' in fields) row.access_info = fields.access_info ?? '';
    if ('notes' in fields) row.notes = fields.notes ?? '';

    const { error } = await sb.from('properties').update(row).eq('id', propertyId);

    if (error) {
      console.error('[persist] updateProperty:', error.message);
      return { ok: false, message: error.message };
    }

    return { ok: true };
  }

  /** Admin tar bort objekt (CASCADE i Postgres tar relaterade rader). */
  async function persistDeleteProperty({ propertyId }) {
    if (!enabled || !sb || !isUuid(propertyId)) {
      return { ok: true, skipped: true };
    }

    const { error } = await sb.from('properties').delete().eq('id', propertyId);

    if (error) {
      console.error('[persist] deleteProperty:', error.message);
      return { ok: false, message: error.message };
    }

    return { ok: true };
  }

  /** Admin tar bort kund (CASCADE) och inaktiverar kundkonton. */
  async function persistDeleteCustomer({ customerId, userIdsToDeactivate = [] }) {
    if (!enabled || !sb || !isUuid(customerId)) {
      return { ok: true, skipped: true };
    }

    const ids = userIdsToDeactivate.filter(isUuid);
    if (ids.length > 0) {
      const { error: userErr } = await sb.from('users').update({ active: false }).in('id', ids);
      if (userErr) {
        console.error('[persist] deleteCustomer deactivate users:', userErr.message);
        return { ok: false, message: userErr.message };
      }
    }

    const { error } = await sb.from('customers').delete().eq('id', customerId);

    if (error) {
      console.error('[persist] deleteCustomer:', error.message);
      return { ok: false, message: error.message };
    }

    return { ok: true };
  }

  /** §8 admin-inställningar – organisation + inloggad admins profil. */
  async function persistUpdateAdminSettings({ orgId, userId, organization, user }) {
    if (!enabled || !sb) {
      return { ok: true, skipped: true };
    }

    if (isUuid(orgId)) {
      const { error: orgErr } = await sb.from('organizations').update({
        name: organization.name,
        theme_round: organization.theme_round,
        accent_color: organization.accent_color,
      }).eq('id', orgId);

      if (orgErr) {
        console.error('[persist] updateAdminSettings organizations:', orgErr.message);
        return { ok: false, message: orgErr.message };
      }
    }

    if (isUuid(userId)) {
      const { error: userErr } = await sb.from('users').update({
        name: user.name,
        email: user.email,
        phone: user.phone || null,
      }).eq('id', userId);

      if (userErr) {
        console.error('[persist] updateAdminSettings users:', userErr.message);
        return { ok: false, message: userErr.message };
      }
    }

    return { ok: true };
  }

  async function persistCreateCustomer({ orgId, contactUser, customer, property }) {
    if (!enabled || !sb || !isUuid(orgId)) {
      return { ok: true, skipped: true };
    }

    if (!isUuid(contactUser.id) || !isUuid(customer.id)) {
      return { ok: true, skipped: true };
    }

    const { error: provErr } = await sb.rpc('admin_provision_user', {
      p_user_id: contactUser.id,
      p_org_id: orgId,
      p_role: 'customer',
      p_name: contactUser.name,
      p_email: contactUser.email,
      p_phone: contactUser.phone || null,
    });

    if (provErr) {
      console.error('[persist] createCustomer provision:', provErr.message);
      return { ok: false, message: provErr.message };
    }

    const { error: custErr } = await sb.from('customers').insert({
      id: customer.id,
      org_id: orgId,
      name: customer.name,
      org_number: customer.org_number || null,
      primary_contact_user_id: contactUser.id,
      notes: customer.notes || '',
    });

    if (custErr) {
      console.error('[persist] createCustomer customers:', custErr.message);
      return { ok: false, message: custErr.message };
    }

    if (property && isUuid(property.id)) {
      const r = await persistCreateProperty({ property, cleanerUserIds: [] });
      if (!r.ok) {
        await sb.from('customers').delete().eq('id', customer.id);
        return r;
      }
    }

    return { ok: true };
  }

  async function persistCreateProperty({ property, cleanerUserIds = [] }) {
    if (!enabled || !sb || !isUuid(property.id)) {
      return { ok: true, skipped: true };
    }

    const { error } = await sb.from('properties').insert({
      id: property.id,
      customer_id: property.customer_id,
      name: property.name,
      address: property.address || '',
      area_sqm: property.area_sqm,
      access_info: property.access_info || '',
      notes: property.notes || '',
    });

    if (error) {
      console.error('[persist] createProperty:', error.message);
      return { ok: false, message: error.message };
    }

    const ids = (cleanerUserIds || []).filter(isUuid);
    if (ids.length > 0) {
      const rows = ids.map(cleaner_user_id => ({ property_id: property.id, cleaner_user_id }));
      const { error: pcErr } = await sb.from('property_cleaners').insert(rows);
      if (pcErr) {
        console.error('[persist] createProperty cleaners:', pcErr.message);
        return { ok: false, message: pcErr.message };
      }
    }

    return { ok: true };
  }

  /* ---------- realtime (live-synk mellan användare) ---------- */
  let realtimeChannel = null;
  let hydrateDebounceTimer = null;
  const HYDRATE_DEBOUNCE_MS = 700;

  function scheduleHydrateFromRealtime(userId) {
    if (!userId || typeof window.hydrateFromSupabase !== 'function') return;
    clearTimeout(hydrateDebounceTimer);
    hydrateDebounceTimer = setTimeout(() => {
      window.hydrateFromSupabase(userId).catch(() => {});
    }, HYDRATE_DEBOUNCE_MS);
  }

  /**
   * Prenumererar på ändringar i shifts, egna notifications och incidents.
   * Vid event: debouncad full hydrering (RLS säkerställer rätt data per roll).
   */
  window.subscribeRealtimeSync = function subscribeRealtimeSync(userId) {
    if (!enabled || !sb || !userId) {
      return () => {};
    }

    if (realtimeChannel) {
      sb.removeChannel(realtimeChannel);
      realtimeChannel = null;
    }

    realtimeChannel = sb
      .channel(`cleanup-sync-${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'shifts' },
        () => scheduleHydrateFromRealtime(userId),
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notifications',
          filter: `recipient_user_id=eq.${userId}`,
        },
        () => scheduleHydrateFromRealtime(userId),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'incidents' },
        () => scheduleHydrateFromRealtime(userId),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'messages' },
        () => scheduleHydrateFromRealtime(userId),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'message_threads' },
        () => scheduleHydrateFromRealtime(userId),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'shift_requests' },
        () => scheduleHydrateFromRealtime(userId),
      )
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR') {
          console.error('[realtime] channel error');
        }
      });

    return () => {
      clearTimeout(hydrateDebounceTimer);
      if (realtimeChannel) {
        sb.removeChannel(realtimeChannel);
        realtimeChannel = null;
      }
    };
  };

  async function persistMarkNotificationsRead(userId) {
    if (!enabled || !sb || !isUuid(userId)) {
      return { ok: true, skipped: true };
    }

    const now = new Date().toISOString();
    const { error } = await sb
      .from('notifications')
      .update({ read_at: now })
      .eq('recipient_user_id', userId)
      .is('read_at', null);

    if (error) {
      console.error('[persist] markNotificationsRead:', error.message);
      return { ok: false, message: error.message };
    }

    return { ok: true };
  }

  async function persistApproveShift({ shiftId, actorUserId, shift, primaryContactUserId }) {
    if (!enabled || !sb || !isUuid(shiftId)) {
      return { ok: true, skipped: true };
    }

    const { error: shiftErr } = await sb.from('shifts').update({
      status: 'Godkänt',
      last_modified_by: actorUserId,
    }).eq('id', shiftId);

    if (shiftErr) {
      console.error('[persist] approveShift:', shiftErr.message);
      return { ok: false, message: shiftErr.message };
    }

    const { error: evErr } = await sb.from('shift_events').insert({
      shift_id: shiftId,
      actor_user_id: actorUserId,
      event_type: 'shift_approved',
      payload: {},
    });

    if (evErr) {
      return { ok: false, message: evErr.message };
    }

    return { ok: true };
  }

  async function persistDeclineShift({ shiftId, actorUserId, hoursToStart, shift, primaryContactUserId }) {
    if (!enabled || !sb || !isUuid(shiftId)) {
      return { ok: true, skipped: true };
    }

    const { error: shiftErr } = await sb.from('shifts').update({
      status: 'Borttaget',
      last_modified_by: actorUserId,
    }).eq('id', shiftId);

    if (shiftErr) {
      return { ok: false, message: shiftErr.message };
    }

    await sb.from('shift_events').insert({
      shift_id: shiftId,
      actor_user_id: actorUserId,
      event_type: 'shift_declined',
      payload: { hours_to_start: hoursToStart },
    });

    return { ok: true };
  }

  async function persistCheckIn({ shiftId, cleanerUserId, checkedInAt }) {
    if (!enabled || !sb || !isUuid(shiftId)) {
      return { ok: true, skipped: true };
    }

    const { error: shiftErr } = await sb.from('shifts').update({
      status: 'Pågående',
      checked_in_at: toIso(checkedInAt),
      last_modified_by: cleanerUserId,
    }).eq('id', shiftId);

    if (shiftErr) {
      console.error('[persist] checkIn:', shiftErr.message);
      return { ok: false, message: shiftErr.message };
    }

    const { error: evErr } = await sb.from('shift_events').insert({
      shift_id: shiftId,
      actor_user_id: cleanerUserId,
      event_type: 'check_in',
      payload: {},
    });

    if (evErr) return { ok: false, message: evErr.message };
    return { ok: true };
  }

  async function persistCheckOut({ shiftId, cleanerUserId, shift, checkedOutAt }) {
    if (!enabled || !sb || !isUuid(shiftId)) {
      return { ok: true, skipped: true };
    }

    const { error: shiftErr } = await sb.from('shifts').update({
      status: 'Utfört',
      checked_in_at: toIso(shift.checked_in_at),
      checked_out_at: toIso(checkedOutAt),
      start_at: toIso(shift.start_at),
      end_at: toIso(shift.end_at),
      original_start_at: toIso(shift.original_start_at),
      original_end_at: toIso(shift.original_end_at),
      last_modified_by: cleanerUserId,
    }).eq('id', shiftId);

    if (shiftErr) {
      console.error('[persist] checkOut:', shiftErr.message);
      return { ok: false, message: shiftErr.message };
    }

    const { error: evErr } = await sb.from('shift_events').insert({
      shift_id: shiftId,
      actor_user_id: cleanerUserId,
      event_type: 'check_out',
      payload: {
        planned: {
          start_at: toIso(shift.original_start_at),
          end_at: toIso(shift.original_end_at),
        },
        actual: { start_at: toIso(shift.start_at), end_at: toIso(shift.end_at) },
      },
    });

    if (evErr) return { ok: false, message: evErr.message };
    return { ok: true };
  }

  function isoWeekdayFromDate(d) {
    return (d.getDay() + 6) % 7;
  }

  function isLastWeekdayOfMonthDate(d, weekday) {
    if (isoWeekdayFromDate(d) !== weekday) return false;
    const next = new Date(d);
    next.setDate(next.getDate() + 7);
    return next.getMonth() !== d.getMonth();
  }

  function matchesRecurringDateClient(d, rs) {
    const wd = isoWeekdayFromDate(d);
    if (wd !== rs.weekday) return false;
    const kind = rs.recurrence_kind || 'weekly';
    if (kind === 'monthly_last') return isLastWeekdayOfMonthDate(d, rs.weekday);
    return true;
  }

  async function snapshotChecklistForShiftClient(shiftId, propertyId) {
    if (!isUuid(shiftId) || !isUuid(propertyId)) return;
    const { data: items } = await sb
      .from('cleaning_checklists')
      .select('title, position')
      .eq('property_id', propertyId)
      .eq('active', true)
      .order('position');
    if (!items?.length) return;
    const rows = items.map(c => ({
      shift_id: shiftId,
      title: c.title,
      position: c.position,
    }));
    await sb.from('shift_checklist_items').insert(rows);
  }

  async function persistCreateRecurringSchedule({ rs, generateWeeks, actorUserId }) {
    if (!enabled || !sb || !isUuid(rs.property_id)) {
      return { ok: true, skipped: true };
    }

    const insertRow = {
      property_id: rs.property_id,
      weekday: rs.weekday,
      start_time: rs.start_time.length === 5 ? `${rs.start_time}:00` : rs.start_time,
      end_time: rs.end_time.length === 5 ? `${rs.end_time}:00` : rs.end_time,
      default_cleaner_user_id: isUuid(rs.default_cleaner_user_id) ? rs.default_cleaner_user_id : null,
      valid_from: rs.valid_from ? toIso(rs.valid_from).slice(0, 10) : null,
      valid_to: rs.valid_to ? toIso(rs.valid_to).slice(0, 10) : null,
      active: true,
      recurrence_kind: rs.recurrence_kind || 'weekly',
      label: rs.label || null,
    };
    if (isUuid(rs.id)) insertRow.id = rs.id;

    const { data: inserted, error } = await sb
      .from('recurring_schedules')
      .insert(insertRow)
      .select()
      .single();

    if (error) {
      console.error('[persist] createRecurringSchedule:', error.message);
      return { ok: false, message: error.message };
    }

    const scheduleRow = inserted;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const rangeEnd = new Date(today);
    rangeEnd.setDate(rangeEnd.getDate() + generateWeeks * 7);

    for (let cursor = new Date(today); cursor <= rangeEnd; cursor.setDate(cursor.getDate() + 1)) {
      const day = new Date(cursor);
      if (!matchesRecurringDateClient(day, scheduleRow)) continue;

      const [sh, sm] = rs.start_time.split(':').map(Number);
      const [eh, em] = rs.end_time.split(':').map(Number);
      const startAt = new Date(day);
      startAt.setHours(sh, sm, 0, 0);
      const endAt = new Date(day);
      endAt.setHours(eh, em, 0, 0);
      if (endAt.getTime() < Date.now()) continue;

      const dayStart = new Date(day);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(day);
      dayEnd.setHours(23, 59, 59, 999);

      const { data: dayShifts } = await sb
        .from('shifts')
        .select('id, start_at, end_at, status')
        .eq('property_id', rs.property_id)
        .gte('start_at', toIso(dayStart))
        .lte('start_at', toIso(dayEnd));

      const active = (dayShifts || []).filter(s => !['Borttaget', 'Avbokat'].includes(s.status));
      const newMins = (endAt - startAt) / 60000;
      if (active.length > 0) {
        const longest = active.reduce((a, b) => {
          const aM = (new Date(a.end_at) - new Date(a.start_at)) / 60000;
          const bM = (new Date(b.end_at) - new Date(b.start_at)) / 60000;
          return bM > aM ? b : a;
        });
        const oldMins = (new Date(longest.end_at) - new Date(longest.start_at)) / 60000;
        if (newMins <= oldMins) continue;
        if (new Date(longest.start_at).getTime() < Date.now()) continue;
        await sb.from('shifts').delete().eq('id', longest.id);
      }

      const { data: dup } = await sb
        .from('shifts')
        .select('id')
        .eq('property_id', rs.property_id)
        .eq('recurring_id', scheduleRow.id)
        .eq('start_at', toIso(startAt))
        .maybeSingle();

      if (dup) continue;

      const { data: newShift, error: shiftErr } = await sb
        .from('shifts')
        .insert({
          property_id: rs.property_id,
          cleaner_user_id: isUuid(rs.default_cleaner_user_id) ? rs.default_cleaner_user_id : null,
          start_at: toIso(startAt),
          end_at: toIso(endAt),
          status: 'Godkänt',
          source: 'recurring',
          recurring_id: scheduleRow.id,
          last_modified_by: isUuid(actorUserId) ? actorUserId : null,
        })
        .select('id')
        .single();

      if (shiftErr) {
        console.error('[persist] createRecurringSchedule shift:', shiftErr.message);
        return { ok: false, message: shiftErr.message };
      }

      await snapshotChecklistForShiftClient(newShift.id, rs.property_id);
    }

    return { ok: true, rs: { id: scheduleRow.id } };
  }

  async function persistDeleteRecurringSchedule({ scheduleId }) {
    if (!enabled || !sb || !isUuid(scheduleId)) {
      return { ok: true, skipped: true };
    }

    const now = new Date().toISOString();
    const { error: shiftErr } = await sb
      .from('shifts')
      .delete()
      .eq('recurring_id', scheduleId)
      .gte('start_at', now);

    if (shiftErr) {
      console.error('[persist] deleteRecurringSchedule shifts:', shiftErr.message);
      return { ok: false, message: shiftErr.message };
    }

    const { error } = await sb.from('recurring_schedules').delete().eq('id', scheduleId);
    if (error) {
      console.error('[persist] deleteRecurringSchedule:', error.message);
      return { ok: false, message: error.message };
    }

    return { ok: true };
  }

  /** Skapar tråd vid behov + infogar meddelande och bumpar last_message_at. */
  async function persistSendMessage({ threadId, customerId, orgId, senderUserId, senderRole, body }) {
    if (!enabled || !sb || !isUuid(senderUserId) || !isUuid(customerId)) {
      return { ok: true, skipped: true };
    }

    let resolvedThreadId = isUuid(threadId) ? threadId : null;

    if (!resolvedThreadId) {
      // Hämta befintlig tråd för kunden eller skapa en ny (en tråd per kund).
      const { data: existing } = await sb
        .from('message_threads')
        .select('id')
        .eq('customer_id', customerId)
        .maybeSingle();

      if (existing) {
        resolvedThreadId = existing.id;
      } else {
        if (!isUuid(orgId)) return { ok: true, skipped: true };
        const { data: created, error: threadErr } = await sb
          .from('message_threads')
          .insert({ org_id: orgId, customer_id: customerId })
          .select('id')
          .single();
        if (threadErr) {
          console.error('[persist] sendMessage thread:', threadErr.message);
          return { ok: false, message: threadErr.message };
        }
        resolvedThreadId = created.id;
      }
    }

    const { data: msg, error: msgErr } = await sb
      .from('messages')
      .insert({
        thread_id: resolvedThreadId,
        sender_user_id: senderUserId,
        sender_role: senderRole,
        body,
      })
      .select('id, created_at')
      .single();

    if (msgErr) {
      console.error('[persist] sendMessage message:', msgErr.message);
      return { ok: false, message: msgErr.message };
    }

    await sb
      .from('message_threads')
      .update({ last_message_at: toIso(msg.created_at) })
      .eq('id', resolvedThreadId);

    return { ok: true, threadId: resolvedThreadId, messageId: msg.id };
  }

  /** Sätter/uppdaterar användarens läsmarkör för en tråd. */
  async function persistMarkThreadRead({ threadId, userId }) {
    if (!enabled || !sb || !isUuid(threadId) || !isUuid(userId)) {
      return { ok: true, skipped: true };
    }

    const { error } = await sb
      .from('thread_reads')
      .upsert(
        { thread_id: threadId, user_id: userId, last_read_at: new Date().toISOString() },
        { onConflict: 'thread_id,user_id' },
      );

    if (error) {
      console.error('[persist] markThreadRead:', error.message);
      return { ok: false, message: error.message };
    }

    return { ok: true };
  }

  /** Kundens önskemål per pass (engångs) eller stående (objekt). */
  async function persistCreateShiftRequest({ request }) {
    if (!enabled || !sb || !isUuid(request.id) || !isUuid(request.property_id)) {
      return { ok: true, skipped: true };
    }

    const { error } = await sb.from('shift_requests').insert({
      id: request.id,
      org_id: request.org_id,
      property_id: request.property_id,
      shift_id: request.scope === 'single' && isUuid(request.shift_id) ? request.shift_id : null,
      scope: request.scope,
      body: request.body,
      created_by_user_id: request.created_by_user_id,
      created_by_role: request.created_by_role,
    });

    if (error) {
      console.error('[persist] createShiftRequest:', error.message);
      return { ok: false, message: error.message };
    }

    return { ok: true };
  }

  async function persistDeleteShiftRequest({ requestId }) {
    if (!enabled || !sb || !isUuid(requestId)) {
      return { ok: true, skipped: true };
    }

    const { error } = await sb.from('shift_requests').delete().eq('id', requestId);

    if (error) {
      console.error('[persist] deleteShiftRequest:', error.message);
      return { ok: false, message: error.message };
    }

    return { ok: true };
  }

  window.dbPersist = {
    insertNotifications: persistInsertNotifications,
    adminDelete: persistAdminDelete,
    updateCustomer: persistUpdateCustomer,
    updateProperty: persistUpdateProperty,
    deleteProperty: persistDeleteProperty,
    deleteCustomer: persistDeleteCustomer,
    updateAdminSettings: persistUpdateAdminSettings,
    createCustomer: persistCreateCustomer,
    createProperty: persistCreateProperty,
    markNotificationsRead: persistMarkNotificationsRead,
    approveShift: persistApproveShift,
    declineShift: persistDeclineShift,
    checkIn: persistCheckIn,
    checkOut: persistCheckOut,
    createRecurringSchedule: persistCreateRecurringSchedule,
    deleteRecurringSchedule: persistDeleteRecurringSchedule,
    sendMessage: persistSendMessage,
    markThreadRead: persistMarkThreadRead,
    createShiftRequest: persistCreateShiftRequest,
    deleteShiftRequest: persistDeleteShiftRequest,
  };
})();
