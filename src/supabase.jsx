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
})();
