/**
 * Rapportaggregering (klient-side) – använder hydrerad state från mock/Supabase.
 * Arbetade timmar: Utfört, via shiftTimes (faktisk in/utcheckningstid).
 */
(function () {
  const EXCLUDED_BOOKED = new Set(['Borttaget', 'Avbokat', 'Planerat']);

  function startOfDay(d) {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  }

  function endOfDay(d) {
    const x = new Date(d);
    x.setHours(23, 59, 59, 999);
    return x;
  }

  function isoWeekdayMon0(d) {
    return (new Date(d).getDay() + 6) % 7;
  }

  function shiftTimes(shift) {
    if (!shift) {
      return { planned: { start: null, end: null }, effective: { start: null, end: null } };
    }
    const hasOriginal = shift.original_start_at != null && shift.original_end_at != null;
    const plannedStart = hasOriginal ? shift.original_start_at : shift.start_at;
    const plannedEnd = hasOriginal ? shift.original_end_at : shift.end_at;
    return {
      planned: { start: plannedStart, end: plannedEnd },
      effective: { start: shift.start_at, end: shift.end_at },
    };
  }

  function hoursBetween(start, end) {
    if (!start || !end) return 0;
    const ms = new Date(end) - new Date(start);
    if (ms <= 0) return 0;
    return Math.round((ms / 36e5) * 100) / 100;
  }

  function shiftWorkedHours(shift) {
    if (!shift || shift.status !== 'Utfört') return 0;
    const { effective } = shiftTimes(shift);
    return hoursBetween(effective.start, effective.end);
  }

  function shiftPlannedHours(shift) {
    if (!shift) return 0;
    const { planned } = shiftTimes(shift);
    return hoursBetween(planned.start, planned.end);
  }

  function inRange(date, start, end) {
    const t = new Date(date).getTime();
    return t >= start.getTime() && t <= end.getTime();
  }

  function parsePeriod({ preset = 'this_month', from = null, to = null } = {}) {
    const now = new Date();
    let start;
    let end;
    let label;

    if (preset === 'this_week') {
      const day = isoWeekdayMon0(now);
      start = startOfDay(now);
      start.setDate(start.getDate() - day);
      end = endOfDay(start);
      end.setDate(end.getDate() + 6);
      label = 'Denna vecka';
    } else if (preset === 'this_month') {
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      end = endOfDay(new Date(now.getFullYear(), now.getMonth() + 1, 0));
      label = 'Denna månad';
    } else if (preset === 'last_month') {
      start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      end = endOfDay(new Date(now.getFullYear(), now.getMonth(), 0));
      label = 'Föregående månad';
    } else {
      start = from ? startOfDay(from) : startOfDay(now);
      end = to ? endOfDay(to) : endOfDay(now);
      if (start > end) {
        const tmp = start;
        start = startOfDay(end);
        end = endOfDay(tmp);
      }
      label = `${formatDateShort(start)} – ${formatDateShort(end)}`;
    }

    return { start, end, label, preset };
  }

  function formatDateShort(d) {
    return new Date(d).toLocaleDateString('sv-SE', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function formatTimeShort(d) {
    if (!d) return '—';
    return new Date(d).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
  }

  function formatDateIso(d) {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('sv-SE');
  }

  function addHours(map, key, hours, meta, extra = {}) {
    if (!map.has(key)) map.set(key, { ...meta, hours: 0, plannedHours: 0, shiftCount: 0, ...extra });
    const row = map.get(key);
    row.hours = Math.round((row.hours + (hours || 0)) * 100) / 100;
    row.shiftCount += 1;
  }

  function bumpCounter(map, key, meta, field, amount = 1, hoursField = null, hours = 0) {
    if (!map.has(key)) {
      map.set(key, { ...meta, [field]: 0, ...(hoursField ? { [hoursField]: 0 } : {}) });
    }
    const row = map.get(key);
    row[field] += amount;
    if (hoursField && hours > 0) {
      row[hoursField] = Math.round((row[hoursField] + hours) * 100) / 100;
    }
  }

  function normalizeFilters(filters = {}) {
    return {
      customerId: filters.customerId && filters.customerId !== 'all' ? filters.customerId : null,
      cleanerId: filters.cleanerId && filters.cleanerId !== 'all' ? filters.cleanerId : null,
      propertyId: filters.propertyId && filters.propertyId !== 'all' ? filters.propertyId : null,
    };
  }

  function buildAdminReport(state, filters, opts = {}) {
    const shiftTimesFn = opts.shiftTimesFn || shiftTimes;
    const period = parsePeriod(filters);
    const { start, end } = period;
    const { customerId, cleanerId, propertyId } = normalizeFilters(filters);

    const propertyById = new Map(state.properties.map(p => [p.id, p]));
    const customerById = new Map(state.customers.map(c => [c.id, c]));
    const userById = new Map(state.users.map(u => [u.id, u]));

    const byCustomer = new Map();
    const byProperty = new Map();
    const byCleaner = new Map();
    const sickByCleaner = new Map();

    const shiftDetails = [];
    const sickShifts = [];
    const deletedShifts = [];
    const cancelledShifts = [];
    const pausedShifts = [];

    let totalHours = 0;
    let totalPlannedHours = 0;
    let shiftCountWorked = 0;
    let shiftCountPlanned = 0;
    let shiftCountSick = 0;
    let sickPlannedHours = 0;
    let shiftCountCancelled = 0;
    let shiftCountDeleted = 0;
    let shiftCountPaused = 0;
    let shiftCountBooked = 0;

    function matchesScope(shift) {
      const prop = propertyById.get(shift.property_id);
      if (customerId && prop?.customer_id !== customerId) return false;
      if (propertyId && shift.property_id !== propertyId) return false;
      if (cleanerId && shift.cleaner_user_id !== cleanerId) return false;
      return true;
    }

    function resolveNames(shift) {
      const prop = propertyById.get(shift.property_id);
      const cust = prop ? customerById.get(prop.customer_id) : null;
      const cleaner = shift.cleaner_user_id ? userById.get(shift.cleaner_user_id) : null;
      return {
        prop,
        cust,
        cleaner,
        customerName: cust?.name || '—',
        propertyName: prop?.name || '—',
        cleanerName: cleaner?.name || 'Ej tilldelad',
      };
    }

    state.shifts.forEach(shift => {
      if (!inRange(shift.start_at, start, end)) return;
      if (!matchesScope(shift)) return;

      const times = shiftTimesFn(shift);
      const worked = shift.status === 'Utfört'
        ? hoursBetween(times.effective.start, times.effective.end)
        : 0;
      const planned = hoursBetween(times.planned.start, times.planned.end);
      const names = resolveNames(shift);

      const detail = {
        id: shift.id,
        date: formatDateIso(shift.start_at),
        customerName: names.customerName,
        propertyName: names.propertyName,
        cleanerName: names.cleanerName,
        status: shift.status,
        plannedStart: formatTimeShort(times.planned.start),
        plannedEnd: formatTimeShort(times.planned.end),
        actualStart: shift.status === 'Utfört' ? formatTimeShort(times.effective.start) : '—',
        actualEnd: shift.status === 'Utfört' ? formatTimeShort(times.effective.end) : '—',
        plannedHours: planned.toFixed(2),
        workedHours: worked > 0 ? worked.toFixed(2) : '—',
      };
      shiftDetails.push(detail);

      if (shift.status === 'Utfört' && worked > 0) {
        totalHours += worked;
        shiftCountWorked += 1;
        if (names.cust) {
          addHours(byCustomer, names.cust.id, worked, { id: names.cust.id, name: names.cust.name });
          byCustomer.get(names.cust.id).plannedHours = Math.round(((byCustomer.get(names.cust.id).plannedHours || 0) + planned) * 100) / 100;
        }
        if (names.prop) {
          addHours(byProperty, names.prop.id, worked, {
            id: names.prop.id,
            name: names.prop.name,
            customerId: names.prop.customer_id,
            customerName: names.customerName,
          });
        }
        const cKey = shift.cleaner_user_id || '_unassigned';
        addHours(byCleaner, cKey, worked, {
          id: names.cleaner?.id || null,
          name: names.cleanerName,
        });
      }

      if (!EXCLUDED_BOOKED.has(shift.status)) {
        shiftCountBooked += 1;
        totalPlannedHours += planned;
        if (['Godkänt', 'Pågående'].includes(shift.status)) {
          shiftCountPlanned += 1;
        }
      }

      if (shift.status === 'Sjukanmäld') {
        shiftCountSick += 1;
        sickPlannedHours += planned;
        sickShifts.push(detail);
        const cKey = shift.cleaner_user_id || '_unknown';
        bumpCounter(sickByCleaner, cKey, {
          id: names.cleaner?.id || null,
          name: names.cleanerName,
        }, 'count', 1, 'plannedHours', planned);
      }

      if (shift.status === 'Borttaget') {
        shiftCountDeleted += 1;
        deletedShifts.push(detail);
      }

      if (shift.status === 'Avbokat') {
        shiftCountCancelled += 1;
        cancelledShifts.push(detail);
      }

      if (shift.status === 'Pausat (kundledighet)') {
        shiftCountPaused += 1;
        pausedShifts.push(detail);
      }
    });

    totalHours = Math.round(totalHours * 100) / 100;
    totalPlannedHours = Math.round(totalPlannedHours * 100) / 100;
    sickPlannedHours = Math.round(sickPlannedHours * 100) / 100;

    let totalIncidents = 0;
    state.incidents.forEach(inc => {
      if (!inRange(inc.created_at, start, end)) return;
      if (customerId) {
        const prop = propertyById.get(inc.property_id);
        if (prop?.customer_id !== customerId) return;
      }
      if (propertyId && inc.property_id !== propertyId) return;
      totalIncidents += 1;
    });

    let totalTimeAdjusted = 0;
    let totalSickReports = 0;
    state.shift_events.forEach(ev => {
      if (!inRange(ev.created_at, start, end)) return;
      const shift = state.shifts.find(s => s.id === ev.shift_id);
      if (shift && !matchesScope(shift)) return;
      if (ev.event_type === 'time_adjusted') totalTimeAdjusted += 1;
      if (ev.event_type === 'sick_reported') totalSickReports += 1;
    });

    const sortByName = (a, b) => (a.name || '').localeCompare(b.name || '', 'sv');
    const sortByHours = (a, b) => b.hours - a.hours;
    const sortByDate = (a, b) => (a.date || '').localeCompare(b.date || '') || (a.plannedStart || '').localeCompare(b.plannedStart || '');

    const filterLabels = [];
    if (customerId) filterLabels.push(customerById.get(customerId)?.name || 'Kund');
    if (propertyId) filterLabels.push(propertyById.get(propertyId)?.name || 'Objekt');
    if (cleanerId) filterLabels.push(userById.get(cleanerId)?.name || 'Städare');

    shiftDetails.sort(sortByDate);
    sickShifts.sort(sortByDate);
    deletedShifts.sort(sortByDate);
    cancelledShifts.sort(sortByDate);
    pausedShifts.sort(sortByDate);

    return {
      meta: {
        ...period,
        generatedAt: new Date(),
        customerId,
        cleanerId,
        propertyId,
        filterLabel: filterLabels.length ? filterLabels.join(' · ') : 'Alla kunder & städare',
      },
      summary: {
        totalHours,
        totalPlannedHours,
        shiftCountWorked,
        shiftCountBooked,
        shiftCountPlanned,
        shiftCountSick,
        sickPlannedHours,
        shiftCountCancelled,
        shiftCountDeleted,
        shiftCountPaused,
        totalIncidents,
        totalTimeAdjusted,
        totalSickReports,
        customerNewTimes: 0,
        customerNewTimesNote: 'Kundförfrågningar (Planerat) räknas när de godkänts.',
      },
      byCustomer: [...byCustomer.values()].sort(sortByHours),
      byProperty: [...byProperty.values()].sort(sortByHours),
      byCleaner: [...byCleaner.values()].sort(sortByHours),
      sickByCleaner: [...sickByCleaner.values()].sort((a, b) => b.count - a.count || sortByName(a, b)),
      shiftDetails,
      sickShifts,
      deletedShifts,
      cancelledShifts,
      pausedShifts,
    };
  }

  function buildCustomerReport(state, customerId, filters, opts = {}) {
    const shiftTimesFn = opts.shiftTimesFn || shiftTimes;
    const period = parsePeriod(filters);
    const { start, end } = period;

    const propertyIds = opts.propertyIds
      ? new Set(opts.propertyIds)
      : new Set(
          state.properties.filter(p => p.customer_id === customerId).map(p => p.id),
        );

    let bookedCount = 0;
    const cleanerIds = new Set();
    let workedHours = 0;
    let plannedHours = 0;
    let sickCount = 0;
    let cancelledCount = 0;

    state.shifts.forEach(shift => {
      if (!propertyIds.has(shift.property_id)) return;
      if (!inRange(shift.start_at, start, end)) return;

      const ph = (() => {
        const t = shiftTimesFn(shift);
        return hoursBetween(t.planned.start, t.planned.end);
      })();

      if (!EXCLUDED_BOOKED.has(shift.status)) {
        bookedCount += 1;
        plannedHours += ph;
        if (shift.cleaner_user_id) cleanerIds.add(shift.cleaner_user_id);
      }

      if (shift.status === 'Utfört') {
        const t = shiftTimesFn(shift);
        workedHours += hoursBetween(t.effective.start, t.effective.end);
      }
      if (shift.status === 'Sjukanmäld') sickCount += 1;
      if (shift.status === 'Avbokat') cancelledCount += 1;
    });

    workedHours = Math.round(workedHours * 100) / 100;
    plannedHours = Math.round(plannedHours * 100) / 100;

    let incidentsCount = 0;
    state.incidents.forEach(inc => {
      if (!propertyIds.has(inc.property_id)) return;
      if (inc.kind !== 'customer_complaint') return;
      if (inRange(inc.created_at, start, end)) incidentsCount += 1;
    });

    const customer = state.customers.find(c => c.id === customerId);

    return {
      meta: {
        ...period,
        customerId,
        customerName: customer?.name || '—',
        generatedAt: new Date(),
      },
      summary: {
        bookedCount,
        plannedHours,
        workedHours,
        cleanerCount: cleanerIds.size,
        incidentsCount,
        sickCount,
        cancelledCount,
      },
    };
  }

  window.Reporting = {
    parsePeriod,
    shiftHours: shiftWorkedHours,
    shiftPlannedHours,
    shiftTimes,
    buildAdminReport,
    buildCustomerReport,
    formatDateShort,
  };
})();
