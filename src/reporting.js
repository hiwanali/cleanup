/**
 * Rapportaggregering (klient-side) – använder hydrerad state från mock/Supabase.
 * Arbetade timmar: endast Utfört, via shiftTimes (faktisk tid efter utcheckning).
 */
(function () {
  const EXCLUDED_BOOKED = new Set(['Borttaget', 'Avbokat']);

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

  function shiftHours(shift) {
    if (!shift || shift.status !== 'Utfört') return 0;
    const { effective } = shiftTimes(shift);
    if (!effective.start || !effective.end) return 0;
    const ms = new Date(effective.end) - new Date(effective.start);
    if (ms <= 0) return 0;
    return Math.round((ms / 36e5) * 100) / 100;
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

  function addHours(map, key, hours, meta) {
    if (!map.has(key)) map.set(key, { ...meta, hours: 0, shiftCount: 0 });
    const row = map.get(key);
    row.hours = Math.round((row.hours + hours) * 100) / 100;
    row.shiftCount += 1;
  }

  function buildAdminReport(state, filters, opts = {}) {
    const shiftTimesFn = opts.shiftTimesFn || shiftTimes;
    const period = parsePeriod(filters);
    const { start, end } = period;

    const propertyById = new Map(state.properties.map(p => [p.id, p]));
    const customerById = new Map(state.customers.map(c => [c.id, c]));
    const userById = new Map(state.users.map(u => [u.id, u]));

    const byCustomer = new Map();
    const byProperty = new Map();
    const byCleaner = new Map();
    const sickByCleaner = new Map();

    let totalHours = 0;

    state.shifts.forEach(shift => {
      if (!inRange(shift.start_at, start, end)) return;
      if (shift.status !== 'Utfört') return;

      const hours = (() => {
        if (opts.shiftTimesFn) {
          const t = opts.shiftTimesFn(shift);
          if (!t.effective.start || !t.effective.end) return 0;
          const ms = new Date(t.effective.end) - new Date(t.effective.start);
          return ms > 0 ? Math.round((ms / 36e5) * 100) / 100 : 0;
        }
        return shiftHours(shift);
      })();

      if (hours <= 0) return;

      totalHours += hours;
      const prop = propertyById.get(shift.property_id);
      const cust = prop ? customerById.get(prop.customer_id) : null;
      const cleaner = shift.cleaner_user_id ? userById.get(shift.cleaner_user_id) : null;

      if (cust) {
        addHours(byCustomer, cust.id, hours, { id: cust.id, name: cust.name });
      }
      if (prop) {
        addHours(byProperty, prop.id, hours, {
          id: prop.id,
          name: prop.name,
          customerId: prop.customer_id,
          customerName: cust?.name || '—',
        });
      }
      if (cleaner) {
        addHours(byCleaner, cleaner.id, hours, { id: cleaner.id, name: cleaner.name });
      } else {
        addHours(byCleaner, '_unassigned', hours, { id: null, name: 'Ej tilldelad' });
      }
    });

    totalHours = Math.round(totalHours * 100) / 100;

    let totalIncidents = 0;
    state.incidents.forEach(inc => {
      if (inRange(inc.created_at, start, end)) totalIncidents += 1;
    });

    let totalTimeAdjusted = 0;
    let totalSickReports = 0;
    state.shift_events.forEach(ev => {
      if (!inRange(ev.created_at, start, end)) return;
      if (ev.event_type === 'time_adjusted') totalTimeAdjusted += 1;
      if (ev.event_type === 'sick_reported') {
        totalSickReports += 1;
        const shift = state.shifts.find(s => s.id === ev.shift_id);
        const cid = shift?.cleaner_user_id || '_unknown';
        const cleaner = userById.get(cid);
        const key = cid;
        if (!sickByCleaner.has(key)) {
          sickByCleaner.set(key, {
            id: cleaner?.id || null,
            name: cleaner?.name || 'Okänd städare',
            count: 0,
          });
        }
        sickByCleaner.get(key).count += 1;
      }
    });

    const sortByName = (a, b) => (a.name || '').localeCompare(b.name || '', 'sv');
    const sortByHours = (a, b) => b.hours - a.hours;

    return {
      meta: {
        ...period,
        generatedAt: new Date(),
      },
      summary: {
        totalHours,
        totalIncidents,
        totalTimeAdjusted,
        totalSickReports,
        customerNewTimes: 0,
        customerNewTimesNote: 'Kommer när kund kan boka eller efterfråga pass i plattformen.',
      },
      byCustomer: [...byCustomer.values()].sort(sortByHours),
      byProperty: [...byProperty.values()].sort(sortByHours),
      byCleaner: [...byCleaner.values()].sort(sortByHours),
      sickByCleaner: [...sickByCleaner.values()].sort((a, b) => b.count - a.count || sortByName(a, b)),
    };
  }

  function buildCustomerReport(state, customerId, filters, opts = {}) {
    const shiftTimesFn = opts.shiftTimesFn || shiftTimes;
    const period = parsePeriod(filters);
    const { start, end } = period;

    const propertyIds = new Set(
      state.properties.filter(p => p.customer_id === customerId).map(p => p.id),
    );

    let bookedCount = 0;
    const cleanerIds = new Set();
    let workedHours = 0;

    state.shifts.forEach(shift => {
      if (!propertyIds.has(shift.property_id)) return;
      if (!inRange(shift.start_at, start, end)) return;

      if (!EXCLUDED_BOOKED.has(shift.status)) {
        bookedCount += 1;
        if (shift.cleaner_user_id) cleanerIds.add(shift.cleaner_user_id);
      }

      if (shift.status === 'Utfört') {
        const hours = (() => {
          if (shiftTimesFn) {
            const t = shiftTimesFn(shift);
            if (!t.effective.start || !t.effective.end) return 0;
            const ms = new Date(t.effective.end) - new Date(t.effective.start);
            return ms > 0 ? Math.round((ms / 36e5) * 100) / 100 : 0;
          }
          return shiftHours(shift);
        })();
        workedHours += hours;
      }
    });

    workedHours = Math.round(workedHours * 100) / 100;

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
        workedHours,
        cleanerCount: cleanerIds.size,
        incidentsCount,
      },
    };
  }

  window.Reporting = {
    parsePeriod,
    shiftHours,
    shiftTimes,
    buildAdminReport,
    buildCustomerReport,
    formatDateShort,
  };
})();
