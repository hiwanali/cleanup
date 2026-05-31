/*
 * Mock-databas i minnet.
 * Speglar §5-datamodellen i mvpfinal.md så att vi senare kan byta till Supabase
 * genom att ersätta selektorer/mutatorer 1:1.
 *
 * Exporterar: window.db (singleton), window.useDb (hook)
 */
(function () {
  const { useSyncExternalStore, useMemo } = React;

  /* ============================================================
   * Reaktiv store
   * ============================================================ */
  let version = 0;
  const listeners = new Set();
  function bump() {
    version++;
    listeners.forEach(l => l());
  }

  /* ============================================================
   * ID-generatorer
   * ============================================================ */
  const counters = {};
  function id(prefix) {
    counters[prefix] = (counters[prefix] || 0) + 1;
    return `${prefix}_${counters[prefix]}`;
  }
  function uuid() {
    return `${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
  }
  function newId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return uuid();
  }

  /* ============================================================
   * Datum-helpers
   * ============================================================ */
  function startOfDay(d) {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  }
  function addDays(d, n) {
    const x = new Date(d);
    x.setDate(x.getDate() + n);
    return x;
  }
  function setTime(d, hh, mm) {
    const x = new Date(d);
    x.setHours(hh, mm, 0, 0);
    return x;
  }
  function isoDay(d) {
    // sv-vecka: må=0 ... sö=6
    const js = new Date(d).getDay();
    return (js + 6) % 7;
  }
  function sameDay(a, b) {
    a = new Date(a); b = new Date(b);
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }
  /** Sista förekomsten av veckodag weekday (0=mån … 6=sön) i månaden för datum d. */
  function isLastWeekdayOfMonth(d, weekday) {
    if (isoDay(d) !== weekday) return false;
    const next = addDays(d, 7);
    return next.getMonth() !== new Date(d).getMonth();
  }
  function durationMinutes(startTime, endTime) {
    const [sh, sm] = startTime.split(':').map(Number);
    const [eh, em] = endTime.split(':').map(Number);
    return (eh * 60 + em) - (sh * 60 + sm);
  }
  function matchesRecurringDate(d, rs) {
    const kind = rs.recurrence_kind || 'weekly';
    if (isoDay(d) !== rs.weekday) return false;
    if (kind === 'monthly_last') return isLastWeekdayOfMonth(d, rs.weekday);
    return true;
  }

  /* ============================================================
   * Tabeller
   * ============================================================ */
  const state = {
    organizations: [],
    users: [],
    customers: [],
    customer_employees: [],
    customer_employee_properties: [],
    properties: [],
    property_cleaners: [],
    recurring_schedules: [],
    shifts: [],
    shift_events: [],
    cleaning_checklists: [],
    shift_checklist_items: [],
    customer_holidays: [],
    customer_holiday_properties: [],
    incidents: [],
    notifications: [],
  };

  /* ============================================================
   * SEED
   * ============================================================ */
  function seed() {
    // Organization
    const org = { id: id('org'), name: 'CleanUp', slug: 'cleanup', accent_color: '#f2603c', theme_round: 'Standard' };
    state.organizations.push(org);

    // Users
    const admin = { id: id('u'), org_id: org.id, role: 'admin', name: 'Sara Lindqvist', email: 'sara@cleanup.se', phone: '+46 70 123 45 67', active: true };
    const cleanerAnna = { id: id('u'), org_id: org.id, role: 'cleaner', name: 'Anna Berg', email: 'anna@cleanup.se', phone: '+46 70 222 11 00', active: true };
    const cleanerDavid = { id: id('u'), org_id: org.id, role: 'cleaner', name: 'David Nilsson', email: 'david@cleanup.se', phone: '+46 70 222 22 11', active: true };
    const cleanerMaria = { id: id('u'), org_id: org.id, role: 'cleaner', name: 'Maria Karlsson', email: 'maria@cleanup.se', phone: '+46 70 222 33 22', active: true };
    const custErik = { id: id('u'), org_id: org.id, role: 'customer', name: 'Erik Holm', email: 'erik@acme.se', phone: '+46 70 555 11 11', active: true };
    const custLisa = { id: id('u'), org_id: org.id, role: 'customer_employee', name: 'Lisa Ek', email: 'lisa@acme.se', phone: '+46 70 555 22 22', active: true };
    const custPer = { id: id('u'), org_id: org.id, role: 'customer', name: 'Per Sundberg', email: 'per@northco.se', phone: '+46 70 666 11 11', active: true };
    state.users.push(admin, cleanerAnna, cleanerDavid, cleanerMaria, custErik, custLisa, custPer);

    // Customers
    const acme = { id: id('c'), org_id: org.id, name: 'Acme AB', org_number: '556677-1122', primary_contact_user_id: custErik.id, notes: 'Föredrar morgonstädning före kontorsöppning.' };
    const north = { id: id('c'), org_id: org.id, name: 'NorthCo AB', org_number: '556677-3344', primary_contact_user_id: custPer.id, notes: '' };
    state.customers.push(acme, north);

    // Properties
    const acmeHQ = { id: id('p'), customer_id: acme.id, name: 'Acme HQ', address: 'Sveavägen 10, 111 57 Stockholm', area_sqm: 320, access_info: 'Nyckel finns i kodlåda 1234 vid huvudentrén. Larm kod 5588.', notes: '' };
    const acmeLab = { id: id('p'), customer_id: acme.id, name: 'Acme Labb', address: 'Vasagatan 3, 111 20 Stockholm', area_sqm: 110, access_info: 'Tagg till reception lämnas av Erik dagen innan. Larm avstängt under arbetspass.', notes: 'Använd ej parfymerade produkter.' };
    const northOffice = { id: id('p'), customer_id: north.id, name: 'NorthCo Office', address: 'Birger Jarlsgatan 5, 114 34 Stockholm', area_sqm: 180, access_info: 'Reception lämnar ut bricka 06:30–07:00.', notes: '' };
    const northWH = { id: id('p'), customer_id: north.id, name: 'NorthCo Lager', address: 'Industrigatan 8, 117 36 Stockholm', area_sqm: 220, access_info: 'Larm kod 9911. Nyckel hänger i lådan inne i städskrubben.', notes: 'Använd skyddsskor.' };
    state.properties.push(acmeHQ, acmeLab, northOffice, northWH);

    // Customer employees
    const ce = { id: id('ce'), customer_id: acme.id, user_id: custLisa.id, scope: 'selected', created_by_admin_id: admin.id };
    state.customer_employees.push(ce);
    state.customer_employee_properties.push({ customer_employee_id: ce.id, property_id: acmeHQ.id });

    // Property cleaners (baspool)
    [
      [acmeHQ.id, cleanerAnna.id], [acmeHQ.id, cleanerDavid.id],
      [acmeLab.id, cleanerAnna.id],
      [northOffice.id, cleanerDavid.id], [northOffice.id, cleanerMaria.id],
      [northWH.id, cleanerMaria.id],
    ].forEach(([pid, uid]) => state.property_cleaners.push({ property_id: pid, cleaner_user_id: uid }));

    // Cleaning checklists per property
    const checklists = {
      [acmeHQ.id]: ['Receptionen damtorkas', 'Konferensrum – torka bord & stolar', 'Pentry – diska & torka bänk', 'Toaletter – sanering & påfyllning', 'Golv – damsugning & moppning', 'Soptömning'],
      [acmeLab.id]: ['Labbänkar avtorkning (alkohol)', 'Diskbänk & vask', 'Golv – moppning', 'Avfallshantering', 'Påfyllning handsprit'],
      [northOffice.id]: ['Reception – damning', 'Mötesrum 1–3 – torka bord', 'Pentry – diska', 'Toaletter', 'Golv – moppning', 'Soptömning'],
      [northWH.id]: ['Lagergångar – sopning', 'Pausrum – torka bord & diska', 'Toalett – sanering', 'Påfyllning material', 'Soptömning'],
    };
    Object.entries(checklists).forEach(([pid, items]) => {
      items.forEach((title, i) => {
        state.cleaning_checklists.push({ id: id('cl'), property_id: pid, title, position: i + 1, active: true });
      });
    });

    // Recurring schedules
    const rs = [];
    function rec(propertyId, weekdays, startH, startM, endH, endM, cleanerId) {
      weekdays.forEach(w => {
        rs.push({
          id: id('rs'),
          property_id: propertyId,
          weekday: w,
          start_time: `${String(startH).padStart(2, '0')}:${String(startM).padStart(2, '0')}`,
          end_time: `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`,
          default_cleaner_user_id: cleanerId,
          valid_from: null, valid_to: null, active: true,
          recurrence_kind: 'weekly',
          label: null,
        });
      });
    }
    rec(acmeHQ.id, [0, 2, 4], 8, 0, 10, 30, cleanerAnna.id);
    rec(acmeLab.id, [1, 3], 13, 0, 15, 0, cleanerAnna.id);
    rec(northOffice.id, [0, 3], 7, 0, 9, 0, cleanerDavid.id);
    rec(northWH.id, [4], 6, 0, 8, 0, cleanerMaria.id);
    state.recurring_schedules.push(...rs);

    // Generera pass (4 v bakåt + 12 v framåt)
    const today = startOfDay(new Date());
    const start = addDays(today, -28);
    const end = addDays(today, 168); // 24 veckor framåt
    for (let d = new Date(start); d <= end; d = addDays(d, 1)) {
      rs.filter(r => r.active && matchesRecurringDate(d, r)).forEach(r => {
        const [sh, sm] = r.start_time.split(':').map(Number);
        const [eh, em] = r.end_time.split(':').map(Number);
        const start_at = setTime(d, sh, sm);
        const end_at = setTime(d, eh, em);
        const past = end_at.getTime() < Date.now();
        const today_now = sameDay(d, new Date());
        const status = past ? 'Utfört' : today_now ? 'Godkänt' : 'Godkänt';
        state.shifts.push({
          id: id('s'),
          property_id: r.property_id,
          cleaner_user_id: r.default_cleaner_user_id,
          start_at, end_at,
          status,
          source: 'recurring',
          recurring_id: r.id,
          original_start_at: null,
          original_end_at: null,
          last_modified_by: admin.id,
          notes: '',
          checked_in_at: past ? new Date(start_at.getTime() + 5 * 60000) : null,
          checked_out_at: past ? new Date(end_at.getTime() - 2 * 60000) : null,
        });
      });
    }

    // §7.2 demo: ett extra "akut" pass inom 48h för Acme HQ (kund kan EJ avboka själv)
    {
      const t9 = new Date();
      t9.setDate(t9.getDate() + 1);
      t9.setHours(9, 0, 0, 0);
      const t11 = new Date(t9); t11.setHours(11, 0, 0, 0);
      state.shifts.push({
        id: id('s'), property_id: acmeHQ.id, cleaner_user_id: cleanerAnna.id,
        start_at: t9, end_at: t11,
        status: 'Godkänt',
        source: 'one_off',
        recurring_id: null,
        original_start_at: null, original_end_at: null,
        last_modified_by: admin.id,
        notes: '',
        checked_in_at: null, checked_out_at: null,
      });
    }

    // Demo: pass som väntar på admin-godkännande (Planerat → Godkänt)
    {
      const t14 = new Date();
      t14.setDate(t14.getDate() + 3);
      t14.setHours(14, 0, 0, 0);
      const t16 = new Date(t14); t16.setHours(16, 0, 0, 0);
      state.shifts.push({
        id: id('s'), property_id: acmeHQ.id, cleaner_user_id: cleanerAnna.id,
        start_at: t14, end_at: t16,
        status: 'Planerat',
        source: 'one_off',
        recurring_id: null,
        original_start_at: null, original_end_at: null,
        last_modified_by: admin.id,
        notes: 'Demo – väntar på godkännande',
        checked_in_at: null, checked_out_at: null,
      });
    }

    // Snapshot av checklist-mallpunkter till varje pass
    state.shifts.forEach(s => {
      const items = state.cleaning_checklists.filter(c => c.property_id === s.property_id && c.active);
      items.forEach(c => {
        const done = s.status === 'Utfört';
        state.shift_checklist_items.push({
          id: id('sci'),
          shift_id: s.id,
          title: c.title,
          position: c.position,
          done_at: done ? new Date(s.end_at.getTime() - (items.length - c.position + 1) * 60000) : null,
          done_by_cleaner_user_id: done ? s.cleaner_user_id : null,
        });
      });
    });

    // Lite variation: sjukanmäl ett pass nästa vecka
    const sickShift = state.shifts.find(s => {
      const h = (s.start_at - Date.now()) / 36e5;
      return h > 72 && h < 200 && s.cleaner_user_id === cleanerAnna.id;
    });
    if (sickShift) {
      sickShift.status = 'Sjukanmäld';
      state.shift_events.push({
        id: id('se'), shift_id: sickShift.id, actor_user_id: cleanerAnna.id,
        event_type: 'sick_reported',
        payload: { reason: 'Förkyld, hög feber.' },
        created_at: new Date(Date.now() - 2 * 3600 * 1000),
      });
      // Notifiera admin
      pushNotification(admin.id, 'sick_reported', {
        shift_id: sickShift.id, cleaner_name: cleanerAnna.name, property_name: state.properties.find(p => p.id === sickShift.property_id).name,
        start_at: sickShift.start_at,
      });
      // Notifiera kund (huvudkontakt + ev. anställd)
      const cust = state.customers.find(c => c.id === state.properties.find(p => p.id === sickShift.property_id).customer_id);
      pushNotification(cust.primary_contact_user_id, 'sick_reported', { shift_id: sickShift.id, property_id: sickShift.property_id, start_at: sickShift.start_at });
    }

    // Seed-incidents
    const sampleShiftAcme = state.shifts.find(s => s.property_id === acmeHQ.id && s.status === 'Utfört');
    const sampleShiftNorth = state.shifts.find(s => s.property_id === northOffice.id && s.status === 'Utfört');
    if (sampleShiftAcme) {
      state.incidents.push({
        id: id('inc'), org_id: org.id,
        shift_id: sampleShiftAcme.id, property_id: acmeHQ.id,
        reported_by_user_id: cleanerAnna.id, reporter_role: 'cleaner',
        kind: 'cleaner_issue', category: 'missing_supplies',
        title: 'Toalettpapper slut',
        description: 'Slut på toalettpapper på herrtoaletten. Fyllde på med reservpaket från städskrubben.',
        attachments: [],
        status: 'open',
        resolved_by_admin_id: null, resolved_at: null, resolution_note: null,
        created_at: new Date(Date.now() - 18 * 3600 * 1000),
      });
    }
    if (sampleShiftNorth) {
      state.incidents.push({
        id: id('inc'), org_id: org.id,
        shift_id: sampleShiftNorth.id, property_id: northOffice.id,
        reported_by_user_id: custPer.id, reporter_role: 'customer',
        kind: 'customer_complaint', category: 'missed_area',
        title: 'Mötesrum 2 ostädat',
        description: 'Mötesrum 2 verkar inte ha städats – bord ej avtorkat och papperskorgen full.',
        attachments: [],
        status: 'open',
        resolved_by_admin_id: null, resolved_at: null, resolution_note: null,
        created_at: new Date(Date.now() - 6 * 3600 * 1000),
      });
    }

    // Seed-kundledighet (4 dagar framåt om 14 dagar) - bara förslag, inte registrerad än
    // (skapas i UI:n istället)
  }

  /* ============================================================
   * Notiser
   * ============================================================ */
  function pushNotification(recipientUserId, kind, payload) {
    state.notifications.push({
      id: id('n'),
      recipient_user_id: recipientUserId,
      channel: 'in_app',
      kind,
      payload,
      read_at: null,
      created_at: new Date(),
    });
  }

  // Snapshot av mall-checklistan till ett pass i state.shifts (index i state.shifts)
  function snapshotChecklistToShift(shiftIndex) {
    const s = state.shifts[shiftIndex];
    if (!s) return;
    const items = state.cleaning_checklists.filter(c => c.property_id === s.property_id && c.active);
    items.forEach(c => {
      state.shift_checklist_items.push({
        id: id('sci'),
        shift_id: s.id,
        title: c.title,
        position: c.position,
        done_at: null,
        done_by_cleaner_user_id: null,
      });
    });
  }

  /* ============================================================
   * Selektorer
   * ============================================================ */
  const db = {
    /* —— rå-tabeller —— */
    state,

    /* —— reactive —— */
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    version() { return version; },

    /* —— grundläggande lookups —— */
    userById(uid) { return state.users.find(u => u.id === uid); },
    propertyById(pid) { return state.properties.find(p => p.id === pid); },
    customerById(cid) { return state.customers.find(c => c.id === cid); },
    shiftById(sid) { return state.shifts.find(s => s.id === sid); },
    incidentById(iid) { return state.incidents.find(i => i.id === iid); },

    /* —— vyer per roll —— */

    // Visningsnamn på städare baserat på vem som tittar
    displayCleaner(cleanerUserId, viewerRole) {
      if (viewerRole === 'customer' || viewerRole === 'customer_employee') return 'Städare';
      const u = db.userById(cleanerUserId);
      return u ? u.name : 'Städare';
    },

    // Pass för en städare (separation)
    shiftsForCleaner(cleanerId, opts = {}) {
      let list = state.shifts.filter(s => s.cleaner_user_id === cleanerId);
      if (opts.from) list = list.filter(s => new Date(s.end_at) >= new Date(opts.from));
      if (opts.to) list = list.filter(s => new Date(s.start_at) <= new Date(opts.to));
      if (opts.statuses) list = list.filter(s => opts.statuses.includes(s.status));
      return list.sort((a, b) => new Date(a.start_at) - new Date(b.start_at));
    },
    todayForCleaner(cleanerId) {
      const today = startOfDay(new Date());
      return db.shiftsForCleaner(cleanerId, { from: today, to: addDays(today, 1) });
    },

    // Tillåtna objekt för en städare (har minst ett pass)
    propertiesForCleaner(cleanerId) {
      const propIds = new Set(state.shifts.filter(s => s.cleaner_user_id === cleanerId).map(s => s.property_id));
      return state.properties.filter(p => propIds.has(p.id));
    },

    // Pass för en kund (huvudkontakt = alla objekt)
    shiftsForCustomerUser(userId, opts = {}) {
      const user = db.userById(userId);
      if (!user) return [];
      let propIds = [];
      if (user.role === 'customer') {
        const cust = state.customers.find(c => c.primary_contact_user_id === userId);
        if (!cust) return [];
        propIds = state.properties.filter(p => p.customer_id === cust.id).map(p => p.id);
      } else if (user.role === 'customer_employee') {
        const ce = state.customer_employees.find(c => c.user_id === userId);
        if (!ce) return [];
        if (ce.scope === 'all_properties') {
          propIds = state.properties.filter(p => p.customer_id === ce.customer_id).map(p => p.id);
        } else {
          propIds = state.customer_employee_properties.filter(x => x.customer_employee_id === ce.id).map(x => x.property_id);
        }
      } else return [];

      let list = state.shifts.filter(s => propIds.includes(s.property_id));
      if (opts.from) list = list.filter(s => new Date(s.end_at) >= new Date(opts.from));
      if (opts.to) list = list.filter(s => new Date(s.start_at) <= new Date(opts.to));
      if (opts.statuses) list = list.filter(s => opts.statuses.includes(s.status));
      return list.sort((a, b) => new Date(a.start_at) - new Date(b.start_at));
    },

    // Kunden/användarens kund-id (för länkning)
    customerForUser(userId) {
      const user = db.userById(userId);
      if (!user) return null;
      if (user.role === 'customer') return state.customers.find(c => c.primary_contact_user_id === userId) || null;
      if (user.role === 'customer_employee') {
        const ce = state.customer_employees.find(c => c.user_id === userId);
        if (!ce) return null;
        return state.customers.find(c => c.id === ce.customer_id) || null;
      }
      return null;
    },
    propertiesForUser(userId) {
      const user = db.userById(userId);
      if (!user) return [];
      if (user.role === 'admin') return state.properties;
      if (user.role === 'cleaner') return db.propertiesForCleaner(userId);
      if (user.role === 'customer') {
        const c = db.customerForUser(userId);
        return c ? state.properties.filter(p => p.customer_id === c.id) : [];
      }
      if (user.role === 'customer_employee') {
        const ce = state.customer_employees.find(x => x.user_id === userId);
        if (!ce) return [];
        if (ce.scope === 'all_properties') return state.properties.filter(p => p.customer_id === ce.customer_id);
        const allowed = state.customer_employee_properties.filter(x => x.customer_employee_id === ce.id).map(x => x.property_id);
        return state.properties.filter(p => allowed.includes(p.id));
      }
      return [];
    },

    // Pass i objekt (admin / generellt)
    shiftsForProperty(pid, opts = {}) {
      let list = state.shifts.filter(s => s.property_id === pid);
      if (opts.from) list = list.filter(s => new Date(s.end_at) >= new Date(opts.from));
      if (opts.to) list = list.filter(s => new Date(s.start_at) <= new Date(opts.to));
      return list.sort((a, b) => new Date(a.start_at) - new Date(b.start_at));
    },

    // Checklist på pass
    checklistForShift(sid) {
      return state.shift_checklist_items
        .filter(c => c.shift_id === sid)
        .sort((a, b) => a.position - b.position);
    },

    /**
     * Planerad vs faktisk tid. Efter utcheckning ligger faktisk tid i start_at/end_at;
     * planerad i original_* om den skiljer sig. 48h-regler ska använda planned.start.
     */
    shiftTimes(shift) {
      if (!shift) {
        return {
          planned: { start: null, end: null },
          effective: { start: null, end: null },
          showsPlannedNote: false,
        };
      }
      const hasOriginal = shift.original_start_at != null && shift.original_end_at != null;
      const plannedStart = hasOriginal ? shift.original_start_at : shift.start_at;
      const plannedEnd = hasOriginal ? shift.original_end_at : shift.end_at;
      const effectiveStart = shift.start_at;
      const effectiveEnd = shift.end_at;
      const showsPlannedNote = hasOriginal && (
        new Date(plannedStart).getTime() !== new Date(effectiveStart).getTime()
        || new Date(plannedEnd).getTime() !== new Date(effectiveEnd).getTime()
      );
      return {
        planned: { start: plannedStart, end: plannedEnd },
        effective: { start: effectiveStart, end: effectiveEnd },
        showsPlannedNote,
      };
    },
    shiftPlannedStart(shift) {
      return db.shiftTimes(shift).planned.start;
    },

    // Avvikelser
    incidents(opts = {}) {
      let list = [...state.incidents];
      if (opts.viewerUserId) {
        const u = db.userById(opts.viewerUserId);
        if (u.role === 'cleaner') {
          // egna ärenden ELLER ärenden på egna pass
          const myShifts = new Set(state.shifts.filter(s => s.cleaner_user_id === opts.viewerUserId).map(s => s.id));
          list = list.filter(i => i.reported_by_user_id === opts.viewerUserId || myShifts.has(i.shift_id));
        } else if (u.role === 'customer' || u.role === 'customer_employee') {
          // Kund/kundanställd ser endast reklamationer på sina objekt – inte städarens interna avvikelser
          const props = new Set(db.propertiesForUser(opts.viewerUserId).map(p => p.id));
          list = list.filter(i => props.has(i.property_id) && i.kind === 'customer_complaint');
        }
      }
      if (opts.status) list = list.filter(i => i.status === opts.status);
      // open först
      const order = { open: 0, in_progress: 1, resolved: 2 };
      return list.sort((a, b) => (order[a.status] - order[b.status]) || (new Date(b.created_at) - new Date(a.created_at)));
    },

    // Kundledigheter
    holidaysForCustomer(customerId) {
      return state.customer_holidays.filter(h => h.customer_id === customerId).sort((a, b) => new Date(b.start_date) - new Date(a.start_date));
    },

    // Notiser för användare
    notificationsForUser(uid) {
      return state.notifications
        .filter(n => n.recipient_user_id === uid)
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    },
    unreadCountForUser(uid) {
      return state.notifications.filter(n => n.recipient_user_id === uid && !n.read_at).length;
    },
    async markAllRead(uid) {
      const readSnapshots = state.notifications
        .filter(n => n.recipient_user_id === uid)
        .map(n => ({ id: n.id, read_at: n.read_at }));

      const now = new Date();
      state.notifications.forEach(n => {
        if (n.recipient_user_id === uid) n.read_at = now;
      });
      bump();

      const persist = window.dbPersist && window.dbPersist.markNotificationsRead;
      if (persist) {
        const r = await persist(uid);
        if (!r.ok) {
          readSnapshots.forEach(({ id, read_at }) => {
            const n = state.notifications.find(x => x.id === id);
            if (n) n.read_at = read_at;
          });
          bump();
          return { error: 'PERSIST_FAILED', message: r.message };
        }
      }

      return { ok: true };
    },

    /* —— "Kräver din åtgärd" för admin —— */
    adminActionables() {
      const sick = state.shifts.filter(s => s.status === 'Sjukanmäld' && !s.sick_finalized_at);
      const openIncidents = state.incidents.filter(i => i.status === 'open');
      const todayShifts = state.shifts.filter(s => sameDay(s.start_at, new Date()) && s.status === 'Godkänt' && new Date(s.start_at) < new Date() && !s.checked_in_at);
      const planned = state.shifts
        .filter(s => s.status === 'Planerat')
        .sort((a, b) => new Date(a.start_at) - new Date(b.start_at));
      return { sick, openIncidents, todayShifts, planned };
    },

    /* —— Förhandsvisning kundledighet —— */
    previewPausedShifts({ customerId, scope, propertyIds, startDate, endDate }) {
      const start = startOfDay(startDate);
      const end = startOfDay(endDate);
      let propIds;
      if (scope === 'all_properties') {
        propIds = state.properties.filter(p => p.customer_id === customerId).map(p => p.id);
      } else {
        propIds = propertyIds || [];
      }
      return state.shifts.filter(s => {
        if (!propIds.includes(s.property_id)) return false;
        if (!['Planerat', 'Godkänt'].includes(s.status)) return false;
        const sd = startOfDay(s.start_at);
        return sd >= start && sd <= end;
      }).sort((a, b) => new Date(a.start_at) - new Date(b.start_at));
    },

    /* —— Tillgängliga städare för ett pass —— */
    availableCleanersFor(shiftId) {
      const shift = db.shiftById(shiftId);
      if (!shift) return [];
      const cleaners = state.users.filter(u => u.role === 'cleaner' && u.active);
      return cleaners.map(c => {
        const conflict = state.shifts.some(s =>
          s.id !== shiftId &&
          s.cleaner_user_id === c.id &&
          ['Godkänt', 'Planerat', 'Pågående'].includes(s.status) &&
          new Date(s.start_at) < new Date(shift.end_at) &&
          new Date(s.end_at) > new Date(shift.start_at),
        );
        const inPool = state.property_cleaners.some(pc => pc.property_id === shift.property_id && pc.cleaner_user_id === c.id);
        return { user: c, conflict, inPool };
      });
    },

    /* ============================================================
     * MUTATORER (alla loggar shift_events + notiser per §7.8)
     * ============================================================ */

    // §7.1 sjukanmälan
    reportSick(shiftId, actorUserId, reason = '') {
      const s = db.shiftById(shiftId);
      if (!s) return;
      s.status = 'Sjukanmäld';
      s.last_modified_by = actorUserId;
      state.shift_events.push({ id: id('se'), shift_id: shiftId, actor_user_id: actorUserId, event_type: 'sick_reported', payload: { reason }, created_at: new Date() });
      const prop = db.propertyById(s.property_id);
      const cust = state.customers.find(c => c.id === prop.customer_id);
      // Notiser
      state.users.filter(u => u.role === 'admin').forEach(a => pushNotification(a.id, 'sick_reported', { shift_id: s.id, property_id: s.property_id, start_at: s.start_at }));
      if (cust) {
        pushNotification(cust.primary_contact_user_id, 'sick_reported', { shift_id: s.id, property_id: s.property_id, start_at: s.start_at });
        state.customer_employees.filter(ce => ce.customer_id === cust.id).forEach(ce => {
          if (ce.scope === 'all_properties' || state.customer_employee_properties.some(x => x.customer_employee_id === ce.id && x.property_id === s.property_id)) {
            pushNotification(ce.user_id, 'sick_reported', { shift_id: s.id, property_id: s.property_id, start_at: s.start_at });
          }
        });
      }
      bump();
    },

    // §7.1 ombokning (byt städare)
    swapCleaner(shiftId, newCleanerId, actorUserId) {
      const s = db.shiftById(shiftId);
      if (!s) return;
      const oldCleanerId = s.cleaner_user_id;
      s.cleaner_user_id = newCleanerId;
      if (s.status === 'Sjukanmäld') s.status = 'Godkänt';
      s.last_modified_by = actorUserId;
      state.shift_events.push({ id: id('se'), shift_id: shiftId, actor_user_id: actorUserId, event_type: 'cleaner_swapped', payload: { from: oldCleanerId, to: newCleanerId }, created_at: new Date() });
      pushNotification(newCleanerId, 'assigned_shift', { shift_id: s.id, property_id: s.property_id, start_at: s.start_at });
      const prop = db.propertyById(s.property_id);
      const cust = state.customers.find(c => c.id === prop.customer_id);
      if (cust) pushNotification(cust.primary_contact_user_id, 'cleaner_swapped', { shift_id: s.id, property_id: s.property_id, start_at: s.start_at });
      bump();
    },

    // §7.4 justera tid
    adjustTime(shiftId, newStart, newEnd, actorUserId) {
      const s = db.shiftById(shiftId);
      if (!s) return;
      if (!s.original_start_at) {
        s.original_start_at = s.start_at;
        s.original_end_at = s.end_at;
      }
      s.start_at = new Date(newStart);
      s.end_at = new Date(newEnd);
      if (s.status === 'Sjukanmäld') s.status = 'Godkänt';
      s.last_modified_by = actorUserId;
      state.shift_events.push({ id: id('se'), shift_id: shiftId, actor_user_id: actorUserId, event_type: 'time_adjusted', payload: { start_at: s.start_at, end_at: s.end_at }, created_at: new Date() });
      if (s.cleaner_user_id) pushNotification(s.cleaner_user_id, 'time_adjusted', { shift_id: s.id, start_at: s.start_at, end_at: s.end_at });
      const prop = db.propertyById(s.property_id);
      const cust = state.customers.find(c => c.id === prop.customer_id);
      if (cust) pushNotification(cust.primary_contact_user_id, 'time_adjusted', { shift_id: s.id, property_id: s.property_id, start_at: s.start_at });
      bump();
    },

    // §7.2 kundavbokning (48h räknas från planerad start, inte faktisk utcheckningstid)
    cancelByCustomer(shiftId, actorUserId, reason = '') {
      const s = db.shiftById(shiftId);
      if (!s) return;
      const hours = (new Date(db.shiftPlannedStart(s)) - Date.now()) / 36e5;
      if (hours <= 48) return { error: 'INSIDE_48H' };
      s.status = 'Avbokat';
      s.cancel_reason = reason.trim() || null;
      s.last_modified_by = actorUserId;
      state.shift_events.push({ id: id('se'), shift_id: shiftId, actor_user_id: actorUserId, event_type: 'customer_cancelled', payload: { hours_to_start: hours, reason: s.cancel_reason }, created_at: new Date() });
      state.users.filter(u => u.role === 'admin').forEach(a => pushNotification(a.id, 'customer_cancelled', { shift_id: s.id, property_id: s.property_id, start_at: s.start_at }));
      if (s.cleaner_user_id) pushNotification(s.cleaner_user_id, 'customer_cancelled', { shift_id: s.id, property_id: s.property_id, start_at: s.start_at });
      bump();
      return { ok: true };
    },

    organizationForUser(userId) {
      const u = db.userById(userId);
      if (!u) return null;
      return state.organizations.find(o => o.id === u.org_id) || null;
    },

    // §7.2 hämtar supportkontakt (vald admin i inställningar, annars första aktiva admin)
    orgSupportContact() {
      const org = state.organizations[0];
      if (org?.support_contact_user_id) {
        const designated = db.userById(org.support_contact_user_id);
        if (designated?.active && designated.role === 'admin') {
          return { name: designated.name, email: designated.email, phone: designated.phone || '' };
        }
      }
      const admin = state.users.find(u => u.role === 'admin' && u.active);
      if (!admin) return { name: 'CleanUp Support', email: 'support@cleanup.se', phone: '' };
      return { name: admin.name, email: admin.email, phone: admin.phone || '' };
    },

    // §7.1 admin markerar sjukanmält pass som "hanterat" (ingen ersättare hittas)
    markSickAsFinal(shiftId, adminUserId) {
      const s = db.shiftById(shiftId);
      if (!s || s.status !== 'Sjukanmäld') return;
      s.sick_finalized_at = new Date();
      s.last_modified_by = adminUserId;
      state.shift_events.push({ id: id('se'), shift_id: shiftId, actor_user_id: adminUserId, event_type: 'sick_finalized', payload: {}, created_at: new Date() });
      // Notis till kund + admin: passet uteblir
      const prop = db.propertyById(s.property_id);
      const cust = state.customers.find(c => c.id === prop.customer_id);
      state.users.filter(u => u.role === 'admin').forEach(a => pushNotification(a.id, 'shift_will_be_missed', { shift_id: s.id, property_id: s.property_id, start_at: s.start_at }));
      if (cust) {
        pushNotification(cust.primary_contact_user_id, 'shift_will_be_missed', { shift_id: s.id, property_id: s.property_id, start_at: s.start_at });
        state.customer_employees.filter(ce => ce.customer_id === cust.id).forEach(ce => {
          if (ce.scope === 'all_properties' || state.customer_employee_properties.some(x => x.customer_employee_id === ce.id && x.property_id === s.property_id)) {
            pushNotification(ce.user_id, 'shift_will_be_missed', { shift_id: s.id, property_id: s.property_id, start_at: s.start_at });
          }
        });
      }
      bump();
    },

    // §7.4 admin tar bort pass (optimistic + Supabase-persist)
    async adminDelete(shiftId, actorUserId) {
      const s = db.shiftById(shiftId);
      if (!s) return { error: 'NOT_FOUND' };
      if (s.status === 'Borttaget') return { error: 'ALREADY_DELETED' };

      const snapshot = {
        status: s.status,
        last_modified_by: s.last_modified_by,
        shift_eventsLen: state.shift_events.length,
        notificationsLen: state.notifications.length,
      };

      const hoursToStart = (new Date(s.start_at) - Date.now()) / 36e5;
      s.status = 'Borttaget';
      s.last_modified_by = actorUserId;
      state.shift_events.push({
        id: id('se'),
        shift_id: shiftId,
        actor_user_id: actorUserId,
        event_type: 'admin_deleted',
        payload: { hours_to_start: hoursToStart },
        created_at: new Date(),
      });
      if (s.cleaner_user_id) {
        pushNotification(s.cleaner_user_id, 'admin_deleted', { shift_id: s.id, property_id: s.property_id, start_at: s.start_at });
      }
      const prop = db.propertyById(s.property_id);
      const cust = prop ? state.customers.find(c => c.id === prop.customer_id) : null;
      if (cust) {
        pushNotification(cust.primary_contact_user_id, 'admin_deleted', { shift_id: s.id, property_id: s.property_id, start_at: s.start_at });
      }
      bump();

      const persist = window.dbPersist && window.dbPersist.adminDelete;
      if (persist) {
        const r = await persist({
          shiftId,
          actorUserId,
          hoursToStart,
          shift: s,
          primaryContactUserId: cust ? cust.primary_contact_user_id : null,
        });
        if (!r.ok) {
          s.status = snapshot.status;
          s.last_modified_by = snapshot.last_modified_by;
          state.shift_events.length = snapshot.shift_eventsLen;
          state.notifications.length = snapshot.notificationsLen;
          bump();
          return { error: 'PERSIST_FAILED', message: r.message };
        }
      }

      return { ok: true };
    },

    // Planerat → Godkänt (admin godkänner förfrågan)
    async approveShift(shiftId, actorUserId) {
      const s = db.shiftById(shiftId);
      if (!s) return { error: 'NOT_FOUND' };
      if (s.status !== 'Planerat') return { error: 'INVALID_STATUS' };

      const snapshot = {
        status: s.status,
        last_modified_by: s.last_modified_by,
        shift_eventsLen: state.shift_events.length,
        notificationsLen: state.notifications.length,
      };

      s.status = 'Godkänt';
      s.last_modified_by = actorUserId;
      state.shift_events.push({
        id: id('se'),
        shift_id: shiftId,
        actor_user_id: actorUserId,
        event_type: 'shift_approved',
        payload: {},
        created_at: new Date(),
      });
      if (s.cleaner_user_id) {
        pushNotification(s.cleaner_user_id, 'assigned_shift', { shift_id: s.id, property_id: s.property_id, start_at: s.start_at });
      }
      const prop = db.propertyById(s.property_id);
      const cust = prop ? state.customers.find(c => c.id === prop.customer_id) : null;
      if (cust?.primary_contact_user_id) {
        pushNotification(cust.primary_contact_user_id, 'assigned_shift', { shift_id: s.id, property_id: s.property_id, start_at: s.start_at });
      }
      bump();

      const persist = window.dbPersist && window.dbPersist.approveShift;
      if (persist) {
        const r = await persist({
          shiftId,
          actorUserId,
          shift: s,
          primaryContactUserId: cust ? cust.primary_contact_user_id : null,
        });
        if (!r.ok) {
          s.status = snapshot.status;
          s.last_modified_by = snapshot.last_modified_by;
          state.shift_events.length = snapshot.shift_eventsLen;
          state.notifications.length = snapshot.notificationsLen;
          bump();
          return { error: 'PERSIST_FAILED', message: r.message };
        }
      }

      return { ok: true };
    },

    // Planerat → Borttaget (admin avslår förfrågan)
    async declineShift(shiftId, actorUserId) {
      const s = db.shiftById(shiftId);
      if (!s) return { error: 'NOT_FOUND' };
      if (s.status !== 'Planerat') return { error: 'INVALID_STATUS' };

      const snapshot = {
        status: s.status,
        last_modified_by: s.last_modified_by,
        shift_eventsLen: state.shift_events.length,
        notificationsLen: state.notifications.length,
      };

      const hoursToStart = (new Date(s.start_at) - Date.now()) / 36e5;
      s.status = 'Borttaget';
      s.last_modified_by = actorUserId;
      state.shift_events.push({
        id: id('se'),
        shift_id: shiftId,
        actor_user_id: actorUserId,
        event_type: 'shift_declined',
        payload: { hours_to_start: hoursToStart },
        created_at: new Date(),
      });
      if (s.cleaner_user_id) {
        pushNotification(s.cleaner_user_id, 'admin_deleted', { shift_id: s.id, property_id: s.property_id, start_at: s.start_at });
      }
      const prop = db.propertyById(s.property_id);
      const cust = prop ? state.customers.find(c => c.id === prop.customer_id) : null;
      if (cust?.primary_contact_user_id) {
        pushNotification(cust.primary_contact_user_id, 'admin_deleted', { shift_id: s.id, property_id: s.property_id, start_at: s.start_at });
      }
      bump();

      const persist = window.dbPersist && window.dbPersist.declineShift;
      if (persist) {
        const r = await persist({
          shiftId,
          actorUserId,
          hoursToStart,
          shift: s,
          primaryContactUserId: cust ? cust.primary_contact_user_id : null,
        });
        if (!r.ok) {
          s.status = snapshot.status;
          s.last_modified_by = snapshot.last_modified_by;
          state.shift_events.length = snapshot.shift_eventsLen;
          state.notifications.length = snapshot.notificationsLen;
          bump();
          return { error: 'PERSIST_FAILED', message: r.message };
        }
      }

      return { ok: true };
    },

    // §7.3 kundledighet – registrera
    createHoliday({ customerId, createdByUserId, scope, propertyIds, startDate, endDate, reason }) {
      const holiday = {
        id: id('ch'), customer_id: customerId,
        created_by_user_id: createdByUserId,
        scope, start_date: new Date(startDate), end_date: new Date(endDate), reason,
        created_at: new Date(),
      };
      state.customer_holidays.push(holiday);
      if (scope === 'selected') {
        (propertyIds || []).forEach(pid => state.customer_holiday_properties.push({ customer_holiday_id: holiday.id, property_id: pid }));
      }
      const paused = db.previewPausedShifts({ customerId, scope, propertyIds, startDate, endDate });
      paused.forEach(s => {
        s.pre_pause_status = s.status;
        s.paused_by_holiday_id = holiday.id;
        s.status = 'Pausat (kundledighet)';
        s.last_modified_by = createdByUserId;
        state.shift_events.push({ id: id('se'), shift_id: s.id, actor_user_id: createdByUserId, event_type: 'paused_by_holiday', payload: { holiday_id: holiday.id }, created_at: new Date() });
        if (s.cleaner_user_id) pushNotification(s.cleaner_user_id, 'paused_by_holiday', { shift_id: s.id, property_id: s.property_id, start_at: s.start_at });
      });
      state.users.filter(u => u.role === 'admin').forEach(a => pushNotification(a.id, 'holiday_created', { customer_id: customerId, count: paused.length }));
      bump();
      return { holiday, pausedCount: paused.length };
    },

    // §7.3 kundledighet – ta bort (admin)
    deleteHoliday(holidayId, actorUserId) {
      const h = state.customer_holidays.find(x => x.id === holidayId);
      if (!h) return { error: 'NOT_FOUND' };
      // Återställ alla framtida pausade pass
      const now = Date.now();
      let restoredCount = 0;
      state.shifts.forEach(s => {
        if (s.paused_by_holiday_id !== holidayId) return;
        if (new Date(s.end_at).getTime() < now) return; // datum har passerat – rör inte
        s.status = s.pre_pause_status || 'Godkänt';
        s.pre_pause_status = null;
        s.paused_by_holiday_id = null;
        s.last_modified_by = actorUserId;
        state.shift_events.push({ id: id('se'), shift_id: s.id, actor_user_id: actorUserId, event_type: 'holiday_removed', payload: { holiday_id: holidayId }, created_at: new Date() });
        if (s.cleaner_user_id) pushNotification(s.cleaner_user_id, 'holiday_removed', { shift_id: s.id, property_id: s.property_id, start_at: s.start_at });
        restoredCount++;
      });
      // Notiser till kund + admin
      pushNotification(h.created_by_user_id, 'holiday_removed', { customer_id: h.customer_id, restored: restoredCount });
      state.users.filter(u => u.role === 'admin' && u.id !== actorUserId).forEach(a => pushNotification(a.id, 'holiday_removed', { customer_id: h.customer_id, restored: restoredCount }));
      // Ta bort radern
      state.customer_holidays = state.customer_holidays.filter(x => x.id !== holidayId);
      state.customer_holiday_properties = state.customer_holiday_properties.filter(x => x.customer_holiday_id !== holidayId);
      bump();
      return { ok: true, restoredCount };
    },

    // §7.3 selektor med ledigheter inkl. metadata
    holidaysWithSummary(customerId) {
      return db.holidaysForCustomer(customerId).map(h => {
        const props = h.scope === 'all_properties'
          ? state.properties.filter(p => p.customer_id === customerId)
          : state.customer_holiday_properties
              .filter(chp => chp.customer_holiday_id === h.id)
              .map(chp => state.properties.find(p => p.id === chp.property_id))
              .filter(Boolean);
        const pausedCount = state.shifts.filter(s => s.paused_by_holiday_id === h.id).length;
        const creator = state.users.find(u => u.id === h.created_by_user_id);
        return { ...h, properties: props, pausedCount, creator };
      });
    },

    // §7.5 checklist-bockning
    toggleChecklistItem(itemId, cleanerUserId, done) {
      const item = state.shift_checklist_items.find(c => c.id === itemId);
      if (!item) return;
      if (done) {
        item.done_at = new Date();
        item.done_by_cleaner_user_id = cleanerUserId;
      } else {
        item.done_at = null;
        item.done_by_cleaner_user_id = null;
      }
      bump();
    },

    // §7.4 återkommande scheman – list
    listRecurringSchedules(propertyId) {
      return state.recurring_schedules
        .filter(r => r.property_id === propertyId)
        .map(r => ({ ...r, cleaner: state.users.find(u => u.id === r.default_cleaner_user_id) }))
        .sort((a, b) => (a.weekday - b.weekday) || a.start_time.localeCompare(b.start_time));
    },

    // §7.4 återkommande scheman – skapa
    _tryAddRecurringShift({ propertyId, recurringId, startAt, endAt, cleanerUserId, actorUserId }) {
      const durMins = (new Date(endAt) - new Date(startAt)) / 60000;
      const conflict = state.shifts.find(s =>
        s.property_id === propertyId
        && sameDay(s.start_at, startAt)
        && !['Borttaget', 'Avbokat'].includes(s.status),
      );
      if (conflict) {
        const conflictDur = (new Date(conflict.end_at) - new Date(conflict.start_at)) / 60000;
        if (durMins <= conflictDur) return false;
        if (new Date(conflict.start_at).getTime() < Date.now()) return false;
        state.shifts = state.shifts.filter(s => s.id !== conflict.id);
      }
      snapshotChecklistToShift(state.shifts.push({
        id: id('s'),
        property_id: propertyId,
        cleaner_user_id: cleanerUserId,
        start_at: startAt,
        end_at: endAt,
        status: 'Godkänt',
        source: 'recurring',
        recurring_id: recurringId,
        original_start_at: null,
        original_end_at: null,
        last_modified_by: actorUserId || null,
        notes: '',
        checked_in_at: null,
        checked_out_at: null,
      }) - 1);
      return true;
    },
    _generateShiftsForRecurring(rs, { generateWeeks, actorUserId }) {
      const today = startOfDay(new Date());
      const end = addDays(today, generateWeeks * 7);
      let generated = 0;
      for (let d = new Date(today); d <= end; d = addDays(d, 1)) {
        if (!matchesRecurringDate(d, rs)) continue;
        if (rs.valid_from && d < startOfDay(rs.valid_from)) continue;
        if (rs.valid_to && d > startOfDay(rs.valid_to)) continue;
        const [sh, sm] = rs.start_time.split(':').map(Number);
        const [eh, em] = rs.end_time.split(':').map(Number);
        const start_at = setTime(d, sh, sm);
        const end_at = setTime(d, eh, em);
        if (end_at.getTime() < Date.now()) continue;
        if (db._tryAddRecurringShift({
          propertyId: rs.property_id,
          recurringId: rs.id,
          startAt: start_at,
          endAt: end_at,
          cleanerUserId: rs.default_cleaner_user_id,
          actorUserId,
        })) generated++;
      }
      return generated;
    },
    async createRecurringSchedule({
      propertyId,
      weekday,
      startTime,
      endTime,
      defaultCleanerUserId,
      validFrom = null,
      validTo = null,
      generateWeeks = 24,
      actorUserId,
      recurrenceKind = 'weekly',
      label = '',
    }) {
      const rs = {
        id: newId(),
        property_id: propertyId,
        weekday,
        start_time: startTime,
        end_time: endTime,
        default_cleaner_user_id: defaultCleanerUserId,
        valid_from: validFrom ? new Date(validFrom) : null,
        valid_to: validTo ? new Date(validTo) : null,
        active: true,
        recurrence_kind: recurrenceKind === 'monthly_last' ? 'monthly_last' : 'weekly',
        label: label.trim() || null,
        created_at: new Date(),
      };
      const schedulesBefore = state.recurring_schedules.length;
      const shiftsBefore = state.shifts.length;
      state.recurring_schedules.push(rs);
      const generated = db._generateShiftsForRecurring(rs, { generateWeeks, actorUserId });
      bump();

      const persist = window.dbPersist && window.dbPersist.createRecurringSchedule;
      if (persist) {
        const r = await persist({ rs, generateWeeks, actorUserId });
        if (!r.ok) {
          state.recurring_schedules.length = schedulesBefore;
          state.shifts.length = shiftsBefore;
          bump();
          return { error: 'PERSIST_FAILED', message: r.message };
        }
        if (r.rs) Object.assign(rs, r.rs);
      }

      return { rs, generated };
    },

    // §7.4 återkommande scheman – ta bort (+ rensa framtida genererade pass)
    async deleteRecurringSchedule(scheduleId, actorUserId, { removeFutureShifts = true } = {}) {
      const rs = state.recurring_schedules.find(r => r.id === scheduleId);
      if (!rs) return { error: 'NOT_FOUND' };

      const snapshot = {
        schedulesLen: state.recurring_schedules.length,
        shiftsLen: state.shifts.length,
        notificationsLen: state.notifications.length,
      };

      let removed = 0;
      if (removeFutureShifts) {
        const now = Date.now();
        const before = state.shifts.length;
        state.shifts = state.shifts.filter(s => {
          if (s.recurring_id !== scheduleId) return true;
          if (new Date(s.start_at).getTime() < now) return true;
          if (s.cleaner_user_id) pushNotification(s.cleaner_user_id, 'admin_deleted', { shift_id: s.id, property_id: s.property_id, start_at: s.start_at });
          return false;
        });
        removed = before - state.shifts.length;
      }
      state.recurring_schedules = state.recurring_schedules.filter(r => r.id !== scheduleId);
      bump();

      const persist = window.dbPersist && window.dbPersist.deleteRecurringSchedule;
      if (persist) {
        const r = await persist({ scheduleId, actorUserId });
        if (!r.ok) {
          state.recurring_schedules.length = snapshot.schedulesLen;
          state.shifts.length = snapshot.shiftsLen;
          state.notifications.length = snapshot.notificationsLen;
          bump();
          return { error: 'PERSIST_FAILED', message: r.message };
        }
      }

      return { ok: true, removed };
    },

    // §7.4 nytt one-off pass (status Planerat = ingen notis förrän godkänt)
    createOneOffShift({ propertyId, cleanerUserId, startAt, endAt, actorUserId, notes = '', status = 'Godkänt' }) {
      const start_at = new Date(startAt);
      const end_at = new Date(endAt);
      const shiftStatus = status === 'Planerat' ? 'Planerat' : 'Godkänt';
      const shift = {
        id: id('s'),
        property_id: propertyId,
        cleaner_user_id: cleanerUserId,
        start_at, end_at,
        status: shiftStatus,
        source: 'one_off',
        recurring_id: null,
        original_start_at: null,
        original_end_at: null,
        last_modified_by: actorUserId,
        notes,
        checked_in_at: null,
        checked_out_at: null,
        created_at: new Date(),
      };
      state.shifts.push(shift);
      snapshotChecklistToShift(state.shifts.length - 1);
      state.shift_events.push({ id: id('se'), shift_id: shift.id, actor_user_id: actorUserId, event_type: 'shift_created', payload: { source: 'one_off', status: shiftStatus }, created_at: new Date() });
      if (shiftStatus === 'Godkänt') {
        if (cleanerUserId) pushNotification(cleanerUserId, 'assigned_shift', { shift_id: shift.id, property_id: propertyId, start_at });
        const prop = db.propertyById(propertyId);
        const cust = state.customers.find(c => c.id === prop?.customer_id);
        if (cust?.primary_contact_user_id) pushNotification(cust.primary_contact_user_id, 'assigned_shift', { shift_id: shift.id, property_id: propertyId, start_at });
      }
      bump();
      return shift;
    },

    // §7.5 in/utcheckning
    async checkIn(shiftId, cleanerUserId) {
      const s = db.shiftById(shiftId);
      if (!s) return { error: 'NOT_FOUND' };

      const snapshot = {
        checked_in_at: s.checked_in_at,
        status: s.status,
        shift_eventsLen: state.shift_events.length,
      };

      const checkedInAt = new Date();
      s.checked_in_at = checkedInAt;
      s.status = 'Pågående';
      state.shift_events.push({
        id: id('se'),
        shift_id: shiftId,
        actor_user_id: cleanerUserId,
        event_type: 'check_in',
        payload: {},
        created_at: new Date(),
      });
      bump();

      const persist = window.dbPersist && window.dbPersist.checkIn;
      if (persist) {
        const r = await persist({ shiftId, cleanerUserId, checkedInAt });
        if (!r.ok) {
          s.checked_in_at = snapshot.checked_in_at;
          s.status = snapshot.status;
          state.shift_events.length = snapshot.shift_eventsLen;
          bump();
          return { error: 'PERSIST_FAILED', message: r.message };
        }
      }

      return { ok: true };
    },
    async checkOut(shiftId, cleanerUserId) {
      const s = db.shiftById(shiftId);
      if (!s) return { error: 'NOT_FOUND' };

      const snapshot = {
        checked_out_at: s.checked_out_at,
        status: s.status,
        start_at: s.start_at,
        end_at: s.end_at,
        original_start_at: s.original_start_at,
        original_end_at: s.original_end_at,
        shift_eventsLen: state.shift_events.length,
      };

      const plannedStart = s.original_start_at || s.start_at;
      const plannedEnd = s.original_end_at || s.end_at;
      s.checked_out_at = new Date();
      s.status = 'Utfört';

      if (s.checked_in_at) {
        const inT = new Date(s.checked_in_at).getTime();
        const outT = new Date(s.checked_out_at).getTime();
        const ps = new Date(plannedStart).getTime();
        const pe = new Date(plannedEnd).getTime();
        if (inT !== ps || outT !== pe) {
          if (!s.original_start_at) {
            s.original_start_at = s.start_at;
            s.original_end_at = s.end_at;
          }
          s.start_at = s.checked_in_at;
          s.end_at = s.checked_out_at;
        }
      }

      state.shift_events.push({
        id: id('se'),
        shift_id: shiftId,
        actor_user_id: cleanerUserId,
        event_type: 'check_out',
        payload: {
          planned: { start_at: snapshot.original_start_at || plannedStart, end_at: snapshot.original_end_at || plannedEnd },
          actual: { start_at: s.start_at, end_at: s.end_at },
        },
        created_at: new Date(),
      });
      bump();

      const persist = window.dbPersist && window.dbPersist.checkOut;
      if (persist) {
        const r = await persist({
          shiftId,
          cleanerUserId,
          shift: s,
          checkedOutAt: s.checked_out_at,
        });
        if (!r.ok) {
          s.checked_out_at = snapshot.checked_out_at;
          s.status = snapshot.status;
          s.start_at = snapshot.start_at;
          s.end_at = snapshot.end_at;
          s.original_start_at = snapshot.original_start_at;
          s.original_end_at = snapshot.original_end_at;
          state.shift_events.length = snapshot.shift_eventsLen;
          bump();
          return { error: 'PERSIST_FAILED', message: r.message };
        }
      }

      return { ok: true };
    },

    // §7.6 avvikelse / reklamation
    createIncident({ shiftId, propertyId, reporterUserId, reporterRole, kind, category, title, description, attachments = [] }) {
      const inc = {
        id: id('inc'), org_id: state.organizations[0].id,
        shift_id: shiftId || null, property_id: propertyId,
        reported_by_user_id: reporterUserId, reporter_role: reporterRole,
        kind, category, title: title.trim(), description: description.trim(),
        attachments: attachments.map(a => ({ ...a, uploaded_by: reporterUserId, uploaded_at: new Date(), kind: reporterRole === 'admin' ? 'admin' : 'customer' })),
        status: 'open',
        resolved_by_admin_id: null, resolved_at: null, resolution_note: null,
        created_at: new Date(),
      };
      state.incidents.push(inc);
      state.users.filter(u => u.role === 'admin').forEach(a => pushNotification(a.id, 'incident_created', { incident_id: inc.id, kind, property_id: propertyId }));
      if (kind === 'customer_complaint') {
        const sh = shiftId ? db.shiftById(shiftId) : null;
        if (sh && sh.cleaner_user_id) pushNotification(sh.cleaner_user_id, 'incident_created', { incident_id: inc.id, kind, property_id: propertyId });
      }
      bump();
      return inc;
    },
    resolveIncident(incidentId, adminUserId, resolutionNote, attachments = []) {
      const inc = state.incidents.find(i => i.id === incidentId);
      if (!inc) return;
      inc.status = 'resolved';
      inc.resolved_by_admin_id = adminUserId;
      inc.resolved_at = new Date();
      inc.resolution_note = (resolutionNote || '').trim();
      inc.attachments = [
        ...(inc.attachments || []),
        ...attachments.map(a => ({ ...a, uploaded_by: adminUserId, uploaded_at: new Date(), kind: 'admin' })),
      ];
      pushNotification(inc.reported_by_user_id, 'incident_resolved', { incident_id: inc.id });
      bump();
    },
    setIncidentInProgress(incidentId, adminUserId) {
      const inc = state.incidents.find(i => i.id === incidentId);
      if (!inc) return;
      inc.status = 'in_progress';
      pushNotification(inc.reported_by_user_id, 'incident_in_progress', { incident_id: inc.id });
      bump();
    },
    reopenIncident(incidentId) {
      const inc = state.incidents.find(i => i.id === incidentId);
      if (!inc) return;
      inc.status = 'open';
      inc.resolved_by_admin_id = null;
      inc.resolved_at = null;
      inc.resolution_note = null;
      bump();
    },
    incidentDetail(incidentId) {
      const inc = state.incidents.find(i => i.id === incidentId);
      if (!inc) return null;
      const prop = db.propertyById(inc.property_id);
      const customer = prop ? db.customerById(prop.customer_id) : null;
      const shift = inc.shift_id ? db.shiftById(inc.shift_id) : null;
      const reporter = db.userById(inc.reported_by_user_id);
      const resolver = inc.resolved_by_admin_id ? db.userById(inc.resolved_by_admin_id) : null;
      const cleaner = shift?.cleaner_user_id ? db.userById(shift.cleaner_user_id) : null;
      return { ...inc, property: prop, customer, shift, reporter, resolver, cleaner };
    },

    /* —— §7.5 städschema-mall (admin redigerar) —— */
    addChecklistTemplateItem(propertyId, title) {
      const pos = state.cleaning_checklists.filter(c => c.property_id === propertyId).length + 1;
      const item = { id: id('cl'), property_id: propertyId, title: title.trim(), position: pos, active: true };
      state.cleaning_checklists.push(item);
      bump();
      return item;
    },
    removeChecklistTemplateItem(itemId) {
      const idx = state.cleaning_checklists.findIndex(c => c.id === itemId);
      if (idx === -1) return;
      const removed = state.cleaning_checklists.splice(idx, 1)[0];
      // packa position-värden för samma objekt
      state.cleaning_checklists
        .filter(c => c.property_id === removed.property_id)
        .sort((a, b) => a.position - b.position)
        .forEach((c, i) => { c.position = i + 1; });
      bump();
    },
    renameChecklistTemplateItem(itemId, title) {
      const it = state.cleaning_checklists.find(c => c.id === itemId);
      if (!it) return;
      it.title = title;
      bump();
    },
    reorderChecklistTemplateItem(itemId, direction /* -1 | 1 */) {
      const it = state.cleaning_checklists.find(c => c.id === itemId);
      if (!it) return;
      const siblings = state.cleaning_checklists
        .filter(c => c.property_id === it.property_id)
        .sort((a, b) => a.position - b.position);
      const idx = siblings.findIndex(c => c.id === itemId);
      const target = idx + direction;
      if (target < 0 || target >= siblings.length) return;
      const swap = siblings[target];
      const tmp = it.position; it.position = swap.position; swap.position = tmp;
      bump();
    },
    listChecklistTemplate(propertyId, { includeInactive = true } = {}) {
      return state.cleaning_checklists
        .filter(c => c.property_id === propertyId && (includeInactive || c.active))
        .sort((a, b) => a.position - b.position);
    },
    setChecklistTemplateItemActive(itemId, active) {
      const it = state.cleaning_checklists.find(c => c.id === itemId);
      if (!it) return;
      it.active = !!active;
      bump();
    },

    /* —— Objekt-uppdatering (admin) —— */
    async updateProperty(propertyId, fields) {
      const p = db.propertyById(propertyId);
      if (!p) return { error: 'NOT_FOUND' };

      const allowed = ['name', 'address', 'area_sqm', 'access_info', 'notes'];
      const snapshot = {};
      allowed.forEach(k => {
        if (Object.prototype.hasOwnProperty.call(fields, k)) snapshot[k] = p[k];
      });

      const persistFields = {};

      if (Object.prototype.hasOwnProperty.call(fields, 'name')) {
        const trimmed = (fields.name || '').trim();
        if (trimmed.length < 2) return { error: 'INVALID_NAME' };
        p.name = trimmed;
        persistFields.name = p.name;
      }
      if (Object.prototype.hasOwnProperty.call(fields, 'address')) {
        p.address = (fields.address || '').trim();
        persistFields.address = p.address;
      }
      if (Object.prototype.hasOwnProperty.call(fields, 'area_sqm')) {
        const v = fields.area_sqm;
        if (v === '' || v == null) {
          p.area_sqm = null;
        } else {
          const n = Number(v);
          if (!Number.isFinite(n) || n < 0) return { error: 'INVALID_AREA' };
          p.area_sqm = Math.round(n);
        }
        persistFields.area_sqm = p.area_sqm;
      }
      if (Object.prototype.hasOwnProperty.call(fields, 'access_info')) {
        p.access_info = fields.access_info ?? '';
        persistFields.access_info = p.access_info;
      }
      if (Object.prototype.hasOwnProperty.call(fields, 'notes')) {
        p.notes = fields.notes ?? '';
        persistFields.notes = p.notes;
      }

      if (Object.keys(persistFields).length === 0) return { ok: true };

      bump();

      const persist = window.dbPersist && window.dbPersist.updateProperty;
      if (persist) {
        const r = await persist({ propertyId, fields: persistFields });
        if (!r.ok) {
          Object.assign(p, snapshot);
          bump();
          return { error: 'PERSIST_FAILED', message: r.message };
        }
      }

      return { ok: true };
    },

    countFutureShiftsForProperty(propertyId) {
      const now = Date.now();
      return state.shifts.filter(s =>
        s.property_id === propertyId
        && new Date(s.start_at).getTime() >= now
        && !['Avbokat', 'Borttaget'].includes(s.status),
      ).length;
    },

    _collectPropertySnapshot(propertyId) {
      const shiftIds = new Set(
        state.shifts.filter(s => s.property_id === propertyId).map(s => s.id),
      );
      const prop = db.propertyById(propertyId);
      return {
        property: prop ? { ...prop } : null,
        property_cleaners: state.property_cleaners
          .filter(pc => pc.property_id === propertyId)
          .map(x => ({ ...x })),
        recurring_schedules: state.recurring_schedules
          .filter(r => r.property_id === propertyId)
          .map(x => ({ ...x })),
        shifts: state.shifts
          .filter(s => s.property_id === propertyId)
          .map(x => ({ ...x })),
        shift_events: state.shift_events
          .filter(e => shiftIds.has(e.shift_id))
          .map(x => ({ ...x })),
        cleaning_checklists: state.cleaning_checklists
          .filter(c => c.property_id === propertyId)
          .map(x => ({ ...x })),
        shift_checklist_items: state.shift_checklist_items
          .filter(i => shiftIds.has(i.shift_id))
          .map(x => ({ ...x })),
        customer_employee_properties: state.customer_employee_properties
          .filter(x => x.property_id === propertyId)
          .map(x => ({ ...x })),
        customer_holiday_properties: state.customer_holiday_properties
          .filter(x => x.property_id === propertyId)
          .map(x => ({ ...x })),
        incidents: state.incidents
          .filter(i => i.property_id === propertyId)
          .map(x => ({ ...x })),
      };
    },

    _purgePropertyFromState(propertyId) {
      const shiftIds = new Set(
        state.shifts.filter(s => s.property_id === propertyId).map(s => s.id),
      );
      state.properties = state.properties.filter(p => p.id !== propertyId);
      state.property_cleaners = state.property_cleaners.filter(pc => pc.property_id !== propertyId);
      state.recurring_schedules = state.recurring_schedules.filter(r => r.property_id !== propertyId);
      state.shifts = state.shifts.filter(s => s.property_id !== propertyId);
      state.shift_events = state.shift_events.filter(e => !shiftIds.has(e.shift_id));
      state.cleaning_checklists = state.cleaning_checklists.filter(c => c.property_id !== propertyId);
      state.shift_checklist_items = state.shift_checklist_items.filter(i => !shiftIds.has(i.shift_id));
      state.customer_employee_properties = state.customer_employee_properties.filter(x => x.property_id !== propertyId);
      state.customer_holiday_properties = state.customer_holiday_properties.filter(x => x.property_id !== propertyId);
      state.incidents = state.incidents.filter(i => i.property_id !== propertyId);
    },

    _restorePropertySnapshot(snapshot) {
      if (snapshot.property) state.properties.push(snapshot.property);
      state.property_cleaners.push(...snapshot.property_cleaners);
      state.recurring_schedules.push(...snapshot.recurring_schedules);
      state.shifts.push(...snapshot.shifts);
      state.shift_events.push(...snapshot.shift_events);
      state.cleaning_checklists.push(...snapshot.cleaning_checklists);
      state.shift_checklist_items.push(...snapshot.shift_checklist_items);
      state.customer_employee_properties.push(...snapshot.customer_employee_properties);
      state.customer_holiday_properties.push(...snapshot.customer_holiday_properties);
      state.incidents.push(...snapshot.incidents);
    },

    async deleteProperty(propertyId) {
      const p = db.propertyById(propertyId);
      if (!p) return { error: 'NOT_FOUND' };

      const futureCount = db.countFutureShiftsForProperty(propertyId);
      const totalShifts = state.shifts.filter(s => s.property_id === propertyId).length;
      const snapshot = db._collectPropertySnapshot(propertyId);

      db._purgePropertyFromState(propertyId);
      bump();

      const persist = window.dbPersist && window.dbPersist.deleteProperty;
      if (persist) {
        const r = await persist({ propertyId });
        if (!r.ok) {
          db._restorePropertySnapshot(snapshot);
          bump();
          return { error: 'PERSIST_FAILED', message: r.message, futureCount, totalShifts };
        }
      }

      return { ok: true, futureCount, totalShifts };
    },

    countFutureShiftsForCustomer(customerId) {
      const propertyIds = new Set(
        state.properties.filter(p => p.customer_id === customerId).map(p => p.id),
      );
      const now = Date.now();
      return state.shifts.filter(s =>
        propertyIds.has(s.property_id)
        && new Date(s.start_at).getTime() >= now
        && !['Avbokat', 'Borttaget'].includes(s.status),
      ).length;
    },

    customerDeleteSummary(customerId) {
      const propertyIds = state.properties.filter(p => p.customer_id === customerId).map(p => p.id);
      const futureShifts = db.countFutureShiftsForCustomer(customerId);
      const totalShifts = state.shifts.filter(s => propertyIds.includes(s.property_id)).length;
      return {
        propertyCount: propertyIds.length,
        futureShifts,
        totalShifts,
        employeeCount: state.customer_employees.filter(ce => ce.customer_id === customerId).length,
        holidayCount: state.customer_holidays.filter(h => h.customer_id === customerId).length,
      };
    },

    _collectCustomerSnapshot(customerId) {
      const propertyIds = state.properties
        .filter(p => p.customer_id === customerId)
        .map(p => p.id);
      const propertySnapshots = propertyIds.map(pid => db._collectPropertySnapshot(pid));
      const ces = state.customer_employees
        .filter(ce => ce.customer_id === customerId)
        .map(x => ({ ...x }));
      const holidayIds = new Set(
        state.customer_holidays.filter(h => h.customer_id === customerId).map(h => h.id),
      );
      const cust = db.customerById(customerId);
      const userIds = [
        cust?.primary_contact_user_id,
        ...ces.map(ce => ce.user_id),
      ].filter(Boolean);
      const userActive = userIds.map(uid => {
        const u = db.userById(uid);
        return u ? { id: uid, active: u.active } : null;
      }).filter(Boolean);

      return {
        customer: cust ? { ...cust } : null,
        propertySnapshots,
        customer_employees: ces,
        customer_employee_properties: state.customer_employee_properties
          .filter(x => ces.some(ce => ce.id === x.customer_employee_id))
          .map(x => ({ ...x })),
        customer_holidays: state.customer_holidays
          .filter(h => h.customer_id === customerId)
          .map(x => ({ ...x })),
        customer_holiday_properties: state.customer_holiday_properties
          .filter(x => holidayIds.has(x.customer_holiday_id))
          .map(x => ({ ...x })),
        userActive,
      };
    },

    _purgeCustomerFromState(customerId) {
      const propertyIds = state.properties
        .filter(p => p.customer_id === customerId)
        .map(p => p.id);
      propertyIds.forEach(pid => db._purgePropertyFromState(pid));

      const ces = state.customer_employees.filter(ce => ce.customer_id === customerId);
      const ceIds = new Set(ces.map(ce => ce.id));
      state.customer_employees = state.customer_employees.filter(ce => ce.customer_id !== customerId);
      state.customer_employee_properties = state.customer_employee_properties.filter(
        x => !ceIds.has(x.customer_employee_id),
      );

      const holidayIds = new Set(
        state.customer_holidays.filter(h => h.customer_id === customerId).map(h => h.id),
      );
      state.customer_holidays = state.customer_holidays.filter(h => h.customer_id !== customerId);
      state.customer_holiday_properties = state.customer_holiday_properties.filter(
        x => !holidayIds.has(x.customer_holiday_id),
      );

      const cust = db.customerById(customerId);
      const userIds = [
        cust?.primary_contact_user_id,
        ...ces.map(ce => ce.user_id),
      ].filter(Boolean);
      userIds.forEach(uid => {
        const u = db.userById(uid);
        if (u && (u.role === 'customer' || u.role === 'customer_employee')) {
          u.active = false;
        }
      });

      state.customers = state.customers.filter(c => c.id !== customerId);
    },

    _restoreCustomerSnapshot(snapshot) {
      snapshot.propertySnapshots.forEach(ps => db._restorePropertySnapshot(ps));
      if (snapshot.customer) state.customers.push(snapshot.customer);
      state.customer_employees.push(...snapshot.customer_employees);
      state.customer_employee_properties.push(...snapshot.customer_employee_properties);
      state.customer_holidays.push(...snapshot.customer_holidays);
      state.customer_holiday_properties.push(...snapshot.customer_holiday_properties);
      snapshot.userActive.forEach(({ id, active }) => {
        const u = db.userById(id);
        if (u) u.active = active;
      });
    },

    async deleteCustomer(customerId) {
      const cust = db.customerById(customerId);
      if (!cust) return { error: 'NOT_FOUND' };

      const summary = db.customerDeleteSummary(customerId);
      const snapshot = db._collectCustomerSnapshot(customerId);
      const userIdsToDeactivate = snapshot.userActive.map(x => x.id);

      db._purgeCustomerFromState(customerId);
      bump();

      const persist = window.dbPersist && window.dbPersist.deleteCustomer;
      if (persist) {
        const r = await persist({ customerId, userIdsToDeactivate });
        if (!r.ok) {
          db._restoreCustomerSnapshot(snapshot);
          bump();
          return { error: 'PERSIST_FAILED', message: r.message, ...summary };
        }
      }

      return { ok: true, ...summary };
    },

    // §8 admin-inställningar (företag + egen kontaktprofil)
    async updateAdminSettings(userId, { orgName, themeRound, accentColorHex, userName, userEmail, userPhone }) {
      const user = db.userById(userId);
      if (!user || user.role !== 'admin') return { error: 'FORBIDDEN' };
      const org = state.organizations.find(o => o.id === user.org_id);
      if (!org) return { error: 'NOT_FOUND' };

      const trimmedOrgName = (orgName || '').trim();
      if (trimmedOrgName.length < 2) return { error: 'INVALID_ORG_NAME' };
      const trimmedUserName = (userName || '').trim();
      if (trimmedUserName.length < 2) return { error: 'INVALID_NAME' };
      const trimmedEmail = (userEmail || '').trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
        return { error: 'INVALID_EMAIL' };
      }
      if (state.users.some(u => u.org_id === org.id && u.email === trimmedEmail && u.id !== userId)) {
        return { error: 'EMAIL_EXISTS' };
      }

      const snapshot = {
        org: {
          name: org.name,
          theme_round: org.theme_round,
          accent_color: org.accent_color,
          support_contact_user_id: org.support_contact_user_id,
        },
        user: { name: user.name, email: user.email, phone: user.phone },
      };

      org.name = trimmedOrgName;
      org.theme_round = themeRound;
      org.accent_color = accentColorHex;
      org.support_contact_user_id = userId;
      user.name = trimmedUserName;
      user.email = trimmedEmail;
      user.phone = (userPhone || '').trim();
      user.updated_at = new Date();
      bump();

      const persist = window.dbPersist && window.dbPersist.updateAdminSettings;
      if (persist) {
        const r = await persist({
          orgId: org.id,
          userId,
          organization: {
            name: org.name,
            theme_round: org.theme_round,
            accent_color: org.accent_color,
          },
          user: { name: user.name, email: user.email, phone: user.phone },
        });
        if (!r.ok) {
          org.name = snapshot.org.name;
          org.theme_round = snapshot.org.theme_round;
          org.accent_color = snapshot.org.accent_color;
          org.support_contact_user_id = snapshot.org.support_contact_user_id;
          user.name = snapshot.user.name;
          user.email = snapshot.user.email;
          user.phone = snapshot.user.phone;
          bump();
          return { error: 'PERSIST_FAILED', message: r.message };
        }
      }

      return { ok: true, organization: org, user };
    },

    // §7.7 admin redigerar kund + huvudkontakt
    async updateCustomer(customerId, { name, orgNumber, notes, contactName, contactEmail, contactPhone }) {
      const cust = db.customerById(customerId);
      if (!cust) return { error: 'NOT_FOUND' };
      const contactUser = db.userById(cust.primary_contact_user_id);
      if (!contactUser) return { error: 'NO_CONTACT' };

      const trimmedName = (name || '').trim();
      if (trimmedName.length < 2) return { error: 'INVALID_NAME' };

      const trimmedEmail = (contactEmail || '').trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
        return { error: 'INVALID_EMAIL' };
      }
      if (state.users.some(u => u.org_id === cust.org_id && u.email === trimmedEmail && u.id !== contactUser.id)) {
        return { error: 'EMAIL_EXISTS' };
      }

      const snapshot = {
        name: cust.name,
        org_number: cust.org_number,
        notes: cust.notes,
        contactName: contactUser.name,
        contactEmail: contactUser.email,
        contactPhone: contactUser.phone,
      };

      cust.name = trimmedName;
      cust.org_number = (orgNumber || '').trim();
      cust.notes = (notes || '').trim();
      contactUser.name = (contactName || '').trim();
      contactUser.email = trimmedEmail;
      contactUser.phone = (contactPhone || '').trim();
      bump();

      const persist = window.dbPersist && window.dbPersist.updateCustomer;
      if (persist) {
        const r = await persist({
          customerId,
          customer: { name: cust.name, org_number: cust.org_number, notes: cust.notes },
          contactUserId: contactUser.id,
          contact: { name: contactUser.name, email: contactUser.email, phone: contactUser.phone },
        });
        if (!r.ok) {
          cust.name = snapshot.name;
          cust.org_number = snapshot.org_number;
          cust.notes = snapshot.notes;
          contactUser.name = snapshot.contactName;
          contactUser.email = snapshot.contactEmail;
          contactUser.phone = snapshot.contactPhone;
          bump();
          return { error: 'PERSIST_FAILED', message: r.message };
        }
      }

      return { ok: true };
    },

    // §7.7 skapa kund (+ huvudkontakt, valfritt första objekt)
    async createCustomer({
      orgId,
      name,
      orgNumber = '',
      notes = '',
      contactName,
      contactEmail,
      contactPhone = '',
      adminUserId,
      firstProperty = null,
    }) {
      const org = state.organizations.find(o => o.id === orgId) || state.organizations[0];
      if (!org) return { error: 'NO_ORG' };

      const trimmedName = (name || '').trim();
      if (trimmedName.length < 2) return { error: 'INVALID_NAME' };

      const trimmedContactName = (contactName || '').trim();
      if (trimmedContactName.length < 2) return { error: 'INVALID_CONTACT_NAME' };

      const contactEmailLower = (contactEmail || '').trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmailLower)) {
        return { error: 'INVALID_EMAIL' };
      }
      if (state.users.some(u => u.org_id === org.id && u.email === contactEmailLower)) {
        return { error: 'EMAIL_EXISTS' };
      }

      const contactUser = {
        id: newId(),
        org_id: org.id,
        role: 'customer',
        name: trimmedContactName,
        email: contactEmailLower,
        phone: (contactPhone || '').trim(),
        active: true,
      };
      const customer = {
        id: newId(),
        org_id: org.id,
        name: trimmedName,
        org_number: (orgNumber || '').trim(),
        primary_contact_user_id: contactUser.id,
        notes: (notes || '').trim(),
      };

      const snapshot = {
        usersLen: state.users.length,
        customersLen: state.customers.length,
        propertiesLen: state.properties.length,
      };

      state.users.push(contactUser);
      state.customers.push(customer);
      bump();

      let property = null;
      if (firstProperty && (firstProperty.name || '').trim()) {
        const pr = await db.createProperty({
          customerId: customer.id,
          name: firstProperty.name,
          address: firstProperty.address,
          areaSqm: firstProperty.areaSqm,
          accessInfo: firstProperty.accessInfo,
          notes: firstProperty.notes,
          cleanerUserIds: firstProperty.cleanerUserIds || [],
          skipPersist: true,
        });
        if (pr?.error) {
          state.users.length = snapshot.usersLen;
          state.customers.length = snapshot.customersLen;
          state.properties.length = snapshot.propertiesLen;
          bump();
          return pr;
        }
        property = pr.property;
      }

      const persist = window.dbPersist && window.dbPersist.createCustomer;
      if (persist) {
        const r = await persist({
          orgId: org.id,
          contactUser,
          customer,
          property,
        });
        if (!r.ok) {
          if (property) db._purgePropertyFromState(property.id);
          state.users.length = snapshot.usersLen;
          state.customers.length = snapshot.customersLen;
          bump();
          return { error: 'PERSIST_FAILED', message: r.message };
        }
      }

      return { ok: true, customer, contactUser, property };
    },

    async createProperty({
      customerId,
      name,
      address = '',
      areaSqm = null,
      accessInfo = '',
      notes = '',
      cleanerUserIds = [],
      skipPersist = false,
    }) {
      const cust = db.customerById(customerId);
      if (!cust) return { error: 'NOT_FOUND' };

      const trimmedName = (name || '').trim();
      if (trimmedName.length < 2) return { error: 'INVALID_NAME' };

      let area_sqm = null;
      if (areaSqm !== '' && areaSqm != null) {
        const n = Number(areaSqm);
        if (!Number.isFinite(n) || n < 0) return { error: 'INVALID_AREA' };
        area_sqm = Math.round(n);
      }

      const property = {
        id: newId(),
        customer_id: customerId,
        name: trimmedName,
        address: (address || '').trim(),
        area_sqm,
        access_info: (accessInfo || '').trim(),
        notes: (notes || '').trim(),
      };

      state.properties.push(property);
      if (cleanerUserIds.length) {
        db.setPropertyCleaners(property.id, cleanerUserIds);
      }
      bump();

      if (!skipPersist) {
        const persist = window.dbPersist && window.dbPersist.createProperty;
        if (persist) {
          const r = await persist({ property, cleanerUserIds });
          if (!r.ok) {
            db._purgePropertyFromState(property.id);
            bump();
            return { error: 'PERSIST_FAILED', message: r.message };
          }
        }
      }

      return { ok: true, property };
    },

    // §7.7 Kundanställda
    customerEmployeesForCustomer(customerId) {
      const props = state.properties.filter(p => p.customer_id === customerId);
      return state.customer_employees
        .filter(ce => ce.customer_id === customerId)
        .map(ce => {
          const user = db.userById(ce.user_id);
          const properties = ce.scope === 'all_properties'
            ? props
            : state.customer_employee_properties
              .filter(x => x.customer_employee_id === ce.id)
              .map(x => db.propertyById(x.property_id))
              .filter(Boolean);
          return { ...ce, user, properties };
        });
    },
    customerEmployeesForProperty(propertyId) {
      const prop = db.propertyById(propertyId);
      if (!prop) return [];
      return db.customerEmployeesForCustomer(prop.customer_id)
        .filter(ce => ce.scope === 'all_properties' || ce.properties.some(p => p.id === propertyId));
    },
    propertyCleanersForProperty(propertyId) {
      return state.property_cleaners
        .filter(pc => pc.property_id === propertyId)
        .map(pc => ({ ...pc, cleaner: db.userById(pc.cleaner_user_id) }))
        .filter(pc => pc.cleaner);
    },
    setPropertyCleaners(propertyId, cleanerUserIds) {
      state.property_cleaners = state.property_cleaners.filter(pc => pc.property_id !== propertyId);
      cleanerUserIds.forEach(uid => state.property_cleaners.push({ property_id: propertyId, cleaner_user_id: uid }));
      bump();
    },
    addCustomerEmployee({ customerId, name, email, phone = '', scope = 'all_properties', selectedPropertyIds = [], adminUserId }) {
      const trimmedEmail = email.trim().toLowerCase();
      if (state.users.some(u => u.email === trimmedEmail)) {
        throw new Error('EMAIL_EXISTS');
      }
      const u = {
        id: id('u'), org_id: state.organizations[0].id, role: 'customer_employee',
        name: name.trim(), email: trimmedEmail, phone: (phone || '').trim(), active: true,
      };
      state.users.push(u);
      const ce = { id: id('ce'), customer_id: customerId, user_id: u.id, scope, created_by_admin_id: adminUserId };
      state.customer_employees.push(ce);
      if (scope === 'selected') {
        selectedPropertyIds.forEach(pid => state.customer_employee_properties.push({ customer_employee_id: ce.id, property_id: pid }));
      }
      bump();
      return { user: u, ce };
    },
    updateCustomerEmployee(ceId, { name, email, phone, scope, selectedPropertyIds }) {
      const ce = state.customer_employees.find(c => c.id === ceId);
      if (!ce) return;
      const u = db.userById(ce.user_id);
      if (!u) return;
      const trimmedEmail = email.trim().toLowerCase();
      if (state.users.some(x => x.email === trimmedEmail && x.id !== u.id)) {
        throw new Error('EMAIL_EXISTS');
      }
      u.name = name.trim();
      u.email = trimmedEmail;
      u.phone = (phone || '').trim();
      ce.scope = scope;
      state.customer_employee_properties = state.customer_employee_properties.filter(x => x.customer_employee_id !== ceId);
      if (scope === 'selected') {
        selectedPropertyIds.forEach(pid => state.customer_employee_properties.push({ customer_employee_id: ceId, property_id: pid }));
      }
      bump();
    },
    removeCustomerEmployee(ceId) {
      const ce = state.customer_employees.find(c => c.id === ceId);
      if (!ce) return;
      state.customer_employees = state.customer_employees.filter(c => c.id !== ceId);
      state.customer_employee_properties = state.customer_employee_properties.filter(x => x.customer_employee_id !== ceId);
      const u = db.userById(ce.user_id);
      if (u) u.active = false;
      bump();
    },

    /* —— hydrering från Supabase (ersätter hela cachen) —— */
    replaceAll(next) {
      Object.keys(state).forEach(table => {
        if (Array.isArray(next[table])) state[table] = next[table];
      });
      bump();
    },

    buildAdminReport(filters) {
      if (!window.Reporting) return null;
      return window.Reporting.buildAdminReport(state, filters, {
        shiftTimesFn: s => db.shiftTimes(s),
      });
    },
    buildCustomerReport(userId, filters) {
      if (!window.Reporting) return null;
      const customer = db.customerForUser(userId);
      if (!customer) return null;
      return window.Reporting.buildCustomerReport(state, customer.id, filters, {
        shiftTimesFn: s => db.shiftTimes(s),
      });
    },
  };

  /* ============================================================
   * Hook
   * ============================================================ */
  function useDb(selector) {
    const v = useSyncExternalStore(db.subscribe, db.version, db.version);
    return useMemo(() => (selector ? selector(db) : v), [v, selector]);
  }

  /* ============================================================
   * Init
   * ============================================================ */
  seed();

  window.db = db;
  window.useDb = useDb;
})();
