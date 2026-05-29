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
    const end = addDays(today, 84);
    for (let d = new Date(start); d <= end; d = addDays(d, 1)) {
      const wd = isoDay(d);
      rs.filter(r => r.weekday === wd && r.active).forEach(r => {
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
    markAllRead(uid) {
      state.notifications.forEach(n => { if (n.recipient_user_id === uid) n.read_at = new Date(); });
      bump();
    },

    /* —— "Kräver din åtgärd" för admin —— */
    adminActionables() {
      const sick = state.shifts.filter(s => s.status === 'Sjukanmäld' && !s.sick_finalized_at);
      const openIncidents = state.incidents.filter(i => i.status === 'open');
      const todayShifts = state.shifts.filter(s => sameDay(s.start_at, new Date()) && s.status === 'Godkänt' && new Date(s.start_at) < new Date() && !s.checked_in_at);
      return { sick, openIncidents, todayShifts };
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

    // §7.2 kundavbokning
    cancelByCustomer(shiftId, actorUserId, reason = '') {
      const s = db.shiftById(shiftId);
      if (!s) return;
      const hours = (new Date(s.start_at) - Date.now()) / 36e5;
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

    // §7.2 hämtar supportkontakt (org → första admin)
    orgSupportContact() {
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

    // §7.4 admin tar bort pass
    adminDelete(shiftId, actorUserId) {
      const s = db.shiftById(shiftId);
      if (!s) return;
      s.status = 'Borttaget';
      s.last_modified_by = actorUserId;
      state.shift_events.push({ id: id('se'), shift_id: shiftId, actor_user_id: actorUserId, event_type: 'admin_deleted', payload: {}, created_at: new Date() });
      if (s.cleaner_user_id) pushNotification(s.cleaner_user_id, 'admin_deleted', { shift_id: s.id, property_id: s.property_id, start_at: s.start_at });
      const prop = db.propertyById(s.property_id);
      const cust = state.customers.find(c => c.id === prop.customer_id);
      if (cust) pushNotification(cust.primary_contact_user_id, 'admin_deleted', { shift_id: s.id, property_id: s.property_id, start_at: s.start_at });
      bump();
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
    createRecurringSchedule({ propertyId, weekday, startTime, endTime, defaultCleanerUserId, validFrom = null, validTo = null, generateWeeks = 12, actorUserId }) {
      const rs = {
        id: id('rs'),
        property_id: propertyId,
        weekday,
        start_time: startTime,
        end_time: endTime,
        default_cleaner_user_id: defaultCleanerUserId,
        valid_from: validFrom ? new Date(validFrom) : null,
        valid_to: validTo ? new Date(validTo) : null,
        active: true,
        created_at: new Date(),
      };
      state.recurring_schedules.push(rs);
      // Generera pass framåt
      const today = startOfDay(new Date());
      const end = addDays(today, generateWeeks * 7);
      let generated = 0;
      for (let d = new Date(today); d <= end; d = addDays(d, 1)) {
        if (isoDay(d) !== weekday) continue;
        if (rs.valid_from && d < rs.valid_from) continue;
        if (rs.valid_to && d > rs.valid_to) continue;
        const [sh, sm] = startTime.split(':').map(Number);
        const [eh, em] = endTime.split(':').map(Number);
        const start_at = setTime(d, sh, sm);
        const end_at = setTime(d, eh, em);
        if (end_at.getTime() < Date.now()) continue; // hoppa över redan passerade tider idag
        snapshotChecklistToShift(state.shifts.push({
          id: id('s'),
          property_id: propertyId,
          cleaner_user_id: defaultCleanerUserId,
          start_at, end_at,
          status: 'Godkänt',
          source: 'recurring',
          recurring_id: rs.id,
          original_start_at: null,
          original_end_at: null,
          last_modified_by: actorUserId || null,
          notes: '',
          checked_in_at: null,
          checked_out_at: null,
        }) - 1);
        generated++;
      }
      bump();
      return { rs, generated };
    },

    // §7.4 återkommande scheman – ta bort (+ rensa framtida genererade pass)
    deleteRecurringSchedule(scheduleId, actorUserId, { removeFutureShifts = true } = {}) {
      const rs = state.recurring_schedules.find(r => r.id === scheduleId);
      if (!rs) return { error: 'NOT_FOUND' };
      let removed = 0;
      if (removeFutureShifts) {
        const now = Date.now();
        const before = state.shifts.length;
        state.shifts = state.shifts.filter(s => {
          if (s.recurring_id !== scheduleId) return true;
          if (new Date(s.start_at).getTime() < now) return true; // historiska pass behålls
          if (s.cleaner_user_id) pushNotification(s.cleaner_user_id, 'admin_deleted', { shift_id: s.id, property_id: s.property_id, start_at: s.start_at });
          return false;
        });
        removed = before - state.shifts.length;
      }
      state.recurring_schedules = state.recurring_schedules.filter(r => r.id !== scheduleId);
      bump();
      return { ok: true, removed };
    },

    // §7.4 nytt one-off pass
    createOneOffShift({ propertyId, cleanerUserId, startAt, endAt, actorUserId, notes = '' }) {
      const start_at = new Date(startAt);
      const end_at = new Date(endAt);
      const shift = {
        id: id('s'),
        property_id: propertyId,
        cleaner_user_id: cleanerUserId,
        start_at, end_at,
        status: 'Godkänt',
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
      state.shift_events.push({ id: id('se'), shift_id: shift.id, actor_user_id: actorUserId, event_type: 'shift_created', payload: { source: 'one_off' }, created_at: new Date() });
      if (cleanerUserId) pushNotification(cleanerUserId, 'assigned_shift', { shift_id: shift.id, property_id: propertyId, start_at });
      const prop = db.propertyById(propertyId);
      const cust = state.customers.find(c => c.id === prop?.customer_id);
      if (cust?.primary_contact_user_id) pushNotification(cust.primary_contact_user_id, 'assigned_shift', { shift_id: shift.id, property_id: propertyId, start_at });
      bump();
      return shift;
    },

    // §7.5 in/utcheckning
    checkIn(shiftId, cleanerUserId) {
      const s = db.shiftById(shiftId);
      if (!s) return;
      s.checked_in_at = new Date();
      s.status = 'Pågående';
      state.shift_events.push({ id: id('se'), shift_id: shiftId, actor_user_id: cleanerUserId, event_type: 'check_in', payload: {}, created_at: new Date() });
      bump();
    },
    checkOut(shiftId, cleanerUserId) {
      const s = db.shiftById(shiftId);
      if (!s) return;
      s.checked_out_at = new Date();
      s.status = 'Utfört';
      state.shift_events.push({ id: id('se'), shift_id: shiftId, actor_user_id: cleanerUserId, event_type: 'check_out', payload: {}, created_at: new Date() });
      bump();
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

    /* —— Objekt-uppdatering (t.ex. nyckel/larm-info) —— */
    updateProperty(propertyId, fields) {
      const p = db.propertyById(propertyId);
      if (!p) return;
      Object.assign(p, fields);
      bump();
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
