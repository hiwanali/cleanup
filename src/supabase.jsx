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

    const notifPayload = {
      shift_id: shiftId,
      property_id: shift.property_id,
      start_at: toIso(shift.start_at),
    };

    const rows = [];
    if (shift.cleaner_user_id && isUuid(shift.cleaner_user_id)) {
      rows.push({
        recipient_user_id: shift.cleaner_user_id,
        channel: 'in_app',
        kind: 'admin_deleted',
        payload: notifPayload,
      });
    }
    if (primaryContactUserId && isUuid(primaryContactUserId)) {
      rows.push({
        recipient_user_id: primaryContactUserId,
        channel: 'in_app',
        kind: 'admin_deleted',
        payload: notifPayload,
      });
    }

    if (rows.length > 0) {
      const { error: nErr } = await sb.from('notifications').insert(rows);
      if (nErr) {
        console.error('[persist] adminDelete notifications:', nErr.message);
        return { ok: false, message: nErr.message };
      }
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

  window.dbPersist = {
    adminDelete: persistAdminDelete,
    updateCustomer: persistUpdateCustomer,
    updateProperty: persistUpdateProperty,
    deleteProperty: persistDeleteProperty,
    deleteCustomer: persistDeleteCustomer,
    updateAdminSettings: persistUpdateAdminSettings,
    createCustomer: persistCreateCustomer,
    createProperty: persistCreateProperty,
  };
})();
