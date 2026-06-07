/**
 * Rapportaggregering (klient-side) – använder hydrerad state från mock/Supabase.
 * Arbetade timmar: Utfört, via shiftTimes (faktisk in/utcheckningstid).
 */
(function () {
  const EXCLUDED_BOOKED = new Set(['Borttaget', 'Avbokat', 'Planerat']);
  /** Pass där städaren förväntades arbeta (exkl. admin borttaget, kund avbokat, ej godkänt, kundledighet). */
  const EXCLUDED_CLEANER_ASSIGNED = new Set([...EXCLUDED_BOOKED, 'Pausat (kundledighet)']);

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

  function ensureCleanerStats(map, cleanerId, meta) {
    if (!cleanerId) return null;
    if (!map.has(cleanerId)) {
      map.set(cleanerId, {
        id: meta.id,
        name: meta.name,
        assignedCount: 0,
        workedCount: 0,
        workedHours: 0,
        sickCount: 0,
        noShowCount: 0,
        obstacleCount: 0,
        missCount: 0,
        missRate: 0,
        swappedOutCount: 0,
        _missShiftIds: new Set(),
        _obstacleShiftIds: new Set(),
      });
    }
    return map.get(cleanerId);
  }

  function ensureCustomerOps(map, customerId, meta) {
    if (!customerId) return null;
    if (!map.has(customerId)) {
      map.set(customerId, {
        id: meta.id,
        name: meta.name,
        bookedCount: 0,
        workedCount: 0,
        workedHours: 0,
        cancelledCount: 0,
        cleanerSwapCount: 0,
      });
    }
    return map.get(customerId);
  }

  function finalizeCleanerStats(map) {
    return [...map.values()].map(row => {
      const missCount = row._missShiftIds.size;
      const missRate = row.assignedCount > 0
        ? Math.round((missCount / row.assignedCount) * 1000) / 10
        : 0;
      const { _missShiftIds, _obstacleShiftIds, ...rest } = row;
      return { ...rest, missCount, missRate, obstacleCount: _obstacleShiftIds.size };
    });
  }

  function normalizeFilters(filters = {}) {
    return {
      customerId: filters.customerId && filters.customerId !== 'all' ? filters.customerId : null,
      cleanerId: filters.cleanerId && filters.cleanerId !== 'all' ? filters.cleanerId : null,
      propertyId: filters.propertyId && filters.propertyId !== 'all' ? filters.propertyId : null,
    };
  }

  function resolveCompletionNote(shift, shiftEvents) {
    if (!shift) return '—';
    const pendingStatus = window.ShiftFinalization?.PENDING_REVIEW_STATUS || 'Väntar granskning';
    const events = shiftEvents || [];
    const flagged = events.some(e =>
      e.shift_id === shift.id && (
        e.event_type === 'pending_review'
        || (e.event_type === 'auto_completed' && e.payload?.reason === 'auto_no_checkin')
      ),
    );
    const approved = events.some(e =>
      e.shift_id === shift.id && (e.event_type === 'admin_approved_completion' || e.event_type === 'check_out'),
    );
    if (shift.status === pendingStatus || (shift.status === 'Utfört' && flagged && !approved)) {
      return 'Väntar admin-granskning (ingen incheckning)';
    }
    if (shift.status !== 'Utfört') return '—';
    const SF = window.ShiftFinalization;
    const completionEvents = events
      .filter(e => e.shift_id === shift.id && (
        e.event_type === 'check_out'
        || e.event_type === 'auto_completed'
        || e.event_type === 'admin_approved_completion'
        || e.event_type === 'pending_review'
      ))
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const latest = completionEvents[0];
    if (!latest) return 'Utfört';
    if (latest.event_type === 'admin_approved_completion') return 'Godkänd av admin';
    if (latest.event_type === 'pending_review') return 'Väntar admin-granskning (ingen incheckning)';
    if (latest.event_type === 'auto_completed') {
      const reason = latest.payload?.reason;
      if (SF && reason) return SF.completionNoteFromReason(reason) || 'Automatisk klarmarkering';
      return 'Automatisk klarmarkering';
    }
    if (latest.event_type === 'check_out') return 'Manuell utcheckning';
    return 'Utfört';
  }

  function buildAdminReport(state, filters, opts = {}) {
    const shiftTimesFn = opts.shiftTimesFn || shiftTimes;
    const pendingReviewStatus = window.ShiftFinalization?.PENDING_REVIEW_STATUS || 'Väntar granskning';
    const needsReviewFn = opts.needsReviewFn || (s => s?.status === pendingReviewStatus);
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
    const cleanerStatsMap = new Map();
    const customerOpsMap = new Map();

    const shiftDetails = [];
    const sickShifts = [];
    const deletedShifts = [];
    const cancelledShifts = [];
    const pausedShifts = [];
    const pendingReviewShifts = [];
    let totalHours = 0;
    let totalPlannedHours = 0;
    let shiftCountWorked = 0;
    let shiftCountPlanned = 0;
    let shiftCountSick = 0;
    let sickPlannedHours = 0;
    let shiftCountCancelled = 0;
    let shiftCountDeleted = 0;
    let shiftCountPaused = 0;
    let shiftCountPendingReview = 0;
    let shiftCountBooked = 0;
    let totalCleanerSwaps = 0;

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
        completionNote: resolveCompletionNote(shift, state.shift_events),
      };
      shiftDetails.push(detail);

      const needsReview = needsReviewFn(shift);

      if (shift.status === 'Utfört' && worked > 0 && !needsReview) {
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

      if (needsReview) {
        shiftCountPendingReview += 1;
        pendingReviewShifts.push(detail);
      }

      if (names.cust) {
        const custOps = ensureCustomerOps(customerOpsMap, names.cust.id, {
          id: names.cust.id,
          name: names.cust.name,
        });
        if (!EXCLUDED_BOOKED.has(shift.status)) custOps.bookedCount += 1;
        if (shift.status === 'Utfört' && worked > 0 && !needsReview) {
          custOps.workedCount += 1;
          custOps.workedHours = Math.round((custOps.workedHours + worked) * 100) / 100;
        }
        if (shift.status === 'Avbokat') custOps.cancelledCount += 1;
      }

      if (shift.cleaner_user_id && !EXCLUDED_CLEANER_ASSIGNED.has(shift.status)) {
        const cStats = ensureCleanerStats(cleanerStatsMap, shift.cleaner_user_id, {
          id: names.cleaner?.id || shift.cleaner_user_id,
          name: names.cleanerName,
        });
        cStats.assignedCount += 1;
        if (shift.status === 'Utfört' && worked > 0 && !needsReview) {
          cStats.workedCount += 1;
          cStats.workedHours = Math.round((cStats.workedHours + worked) * 100) / 100;
        }
        if (shift.status === 'Sjukanmäld') {
          cStats.sickCount += 1;
          cStats._missShiftIds.add(shift.id);
        }
        if (needsReview) {
          cStats.noShowCount += 1;
          cStats._missShiftIds.add(shift.id);
        }
      }
    });

    state.incidents.forEach(inc => {
      if (inc.kind !== 'cleaner_issue' || !inc.shift_id) return;
      const shift = state.shifts.find(s => s.id === inc.shift_id);
      if (!shift || !inRange(shift.start_at, start, end) || !matchesScope(shift)) return;
      if (EXCLUDED_CLEANER_ASSIGNED.has(shift.status)) return;
      const cleanerId = shift.cleaner_user_id;
      if (!cleanerId) return;
      const names = resolveNames(shift);
      const cStats = ensureCleanerStats(cleanerStatsMap, cleanerId, {
        id: names.cleaner?.id || cleanerId,
        name: names.cleanerName,
      });
      if (!cStats._obstacleShiftIds.has(shift.id)) {
        cStats._obstacleShiftIds.add(shift.id);
        cStats._missShiftIds.add(shift.id);
      }
    });

    state.shift_events.forEach(ev => {
      if (ev.event_type !== 'cleaner_swapped') return;
      if (!inRange(ev.created_at, start, end)) return;
      const shift = state.shifts.find(s => s.id === ev.shift_id);
      if (!shift || !matchesScope(shift)) return;
      totalCleanerSwaps += 1;
      const names = resolveNames(shift);
      if (names.cust) {
        const custOps = ensureCustomerOps(customerOpsMap, names.cust.id, {
          id: names.cust.id,
          name: names.cust.name,
        });
        custOps.cleanerSwapCount += 1;
      }
      const fromId = ev.payload?.from;
      if (fromId) {
        const fromCleaner = userById.get(fromId);
        const cStats = ensureCleanerStats(cleanerStatsMap, fromId, {
          id: fromId,
          name: fromCleaner?.name || 'Städare',
        });
        cStats.swappedOutCount += 1;
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
    const sortByMissRate = (a, b) => b.missRate - a.missRate || sortByName(a, b);
    const sortByDate = (a, b) => (a.date || '').localeCompare(b.date || '') || (a.plannedStart || '').localeCompare(b.plannedStart || '');

    const cleanerStats = finalizeCleanerStats(cleanerStatsMap).sort(sortByMissRate);
    const customerOps = [...customerOpsMap.values()].sort(sortByName);

    const filterLabels = [];
    if (customerId) filterLabels.push(customerById.get(customerId)?.name || 'Kund');
    if (propertyId) filterLabels.push(propertyById.get(propertyId)?.name || 'Objekt');
    if (cleanerId) filterLabels.push(userById.get(cleanerId)?.name || 'Städare');

    shiftDetails.sort(sortByDate);
    sickShifts.sort(sortByDate);
    deletedShifts.sort(sortByDate);
    cancelledShifts.sort(sortByDate);
    pausedShifts.sort(sortByDate);
    pendingReviewShifts.sort(sortByDate);

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
        shiftCountPendingReview,
        totalIncidents,
        totalTimeAdjusted,
        totalSickReports,
        totalCleanerSwaps,
        customerNewTimes: 0,
        customerNewTimesNote: 'Kundförfrågningar (Planerat) räknas när de godkänts.',
        statsNote: 'Miss-% = sjukanmäld + uteblev utan incheckning + förhinder (städaravvikelse). Admin borttagna pass räknas inte.',
      },
      byCustomer: [...byCustomer.values()].sort(sortByHours),
      byProperty: [...byProperty.values()].sort(sortByHours),
      byCleaner: [...byCleaner.values()].sort(sortByHours),
      sickByCleaner: [...sickByCleaner.values()].sort((a, b) => b.count - a.count || sortByName(a, b)),
      cleanerStats,
      customerOps,
      shiftDetails,
      sickShifts,
      deletedShifts,
      cancelledShifts,
      pausedShifts,
      pendingReviewShifts,
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
    let workedPassCount = 0;
    let workedHours = 0;
    let plannedHours = 0;
    const pendingReviewStatus = window.ShiftFinalization?.PENDING_REVIEW_STATUS || 'Väntar granskning';
    const needsReviewFn = opts.needsReviewFn || (s => s?.status === pendingReviewStatus);

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
      }

      if (shift.status === 'Utfört' && !needsReviewFn(shift)) {
        const t = shiftTimesFn(shift);
        const wh = hoursBetween(t.effective.start, t.effective.end);
        if (wh > 0) {
          workedPassCount += 1;
          workedHours += wh;
        }
      }
    });

    workedHours = Math.round(workedHours * 100) / 100;
    plannedHours = Math.round(plannedHours * 100) / 100;

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
        workedPassCount,
        workedHours,
      },
    };
  }

  window.Reporting = {
    parsePeriod,
    shiftHours: shiftWorkedHours,
    shiftPlannedHours,
    shiftTimes,
    resolveCompletionNote,
    buildAdminReport,
    buildCustomerReport,
    formatDateShort,
  };
})();
