/**
 * Regelmotor för automatisk klarmarkering av passerade pass.
 */
(function () {
  const FINALIZE_ELIGIBLE_STATUSES = ['Godkänt', 'Pågående'];
  const PENDING_REVIEW_STATUS = 'Väntar granskning';
  const AUTO_COMPLETE_EVENT = 'auto_completed';
  const PENDING_REVIEW_EVENT = 'pending_review';
  const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;

  function toMs(d) {
    if (d == null) return NaN;
    return d instanceof Date ? d.getTime() : new Date(d).getTime();
  }

  function getPlannedTimes(shift) {
    if (!shift) {
      return { start: null, end: null };
    }
    const hasOriginal = shift.original_start_at != null && shift.original_end_at != null;
    return {
      start: hasOriginal ? shift.original_start_at : shift.start_at,
      end: hasOriginal ? shift.original_end_at : shift.end_at,
    };
  }

  function eventTypeForResult() {
    return AUTO_COMPLETE_EVENT;
  }

  /**
   * @returns {null | {
   *   status: string,
   *   start_at: Date|string,
   *   end_at: Date|string,
   *   original_start_at: Date|string|null,
   *   original_end_at: Date|string|null,
   *   checked_in_at: Date|string|null,
   *   checked_out_at: null,
   *   reason: string
   * }}
   */
  function evaluateShiftFinalization(shift, now) {
    if (!shift) return null;
    if (!FINALIZE_ELIGIBLE_STATUSES.includes(shift.status)) return null;
    if (shift.status === 'Utfört' || shift.status === PENDING_REVIEW_STATUS) return null;
    if (shift.checked_out_at) return null;

    const planned = getPlannedTimes(shift);
    const nowMs = toMs(now ?? new Date());
    const plannedEndMs = toMs(planned.end);
    if (!Number.isFinite(plannedEndMs) || nowMs <= plannedEndMs) return null;

    const checkedIn = shift.checked_in_at;

    if (!checkedIn) {
      return {
        status: 'Utfört',
        start_at: planned.start,
        end_at: planned.end,
        original_start_at: shift.original_start_at ?? null,
        original_end_at: shift.original_end_at ?? null,
        checked_in_at: null,
        checked_out_at: null,
        reason: 'auto_no_checkin',
      };
    }

    const checkedInMs = toMs(checkedIn);
    if (nowMs >= checkedInMs + TWELVE_HOURS_MS) {
      return {
        status: 'Utfört',
        start_at: planned.start,
        end_at: planned.end,
        original_start_at: shift.original_start_at ?? null,
        original_end_at: shift.original_end_at ?? null,
        checked_in_at: checkedIn,
        checked_out_at: null,
        reason: 'abandoned_checkin_12h',
      };
    }

    const originalStart = shift.original_start_at ?? planned.start;
    const originalEnd = shift.original_end_at ?? planned.end;
    return {
      status: 'Utfört',
      start_at: checkedIn,
      end_at: planned.end,
      original_start_at: originalStart,
      original_end_at: originalEnd,
      checked_in_at: checkedIn,
      checked_out_at: null,
      reason: 'auto_after_end',
    };
  }

  function completionNoteFromReason(reason) {
    switch (reason) {
      case 'auto_no_checkin':
        return 'Automatisk klarmarkering (planerad tid, ingen incheckning)';
      case 'auto_after_end':
        return 'Auto-klarmarkerad (incheckning → planerad slut)';
      case 'abandoned_checkin_12h':
        return 'Auto-klarmarkerad (12 h utan utcheckning, planerad tid)';
      default:
        return null;
    }
  }

  function completionNoteFromEventType(eventType) {
    if (eventType === 'check_out') return 'Manuell utcheckning';
    if (eventType === 'admin_approved_completion') return 'Godkänd av admin';
    if (eventType === AUTO_COMPLETE_EVENT) return 'Automatisk klarmarkering';
    if (eventType === PENDING_REVIEW_EVENT) return 'Väntar admin-granskning';
    return null;
  }

  function __runTests() {
    const results = [];
    function assert(name, cond) {
      results.push({ name, ok: !!cond });
      if (!cond) console.error('[ShiftFinalization] FAIL:', name);
    }

    function d(iso) {
      return new Date(iso);
    }

    const base = {
      id: 's1',
      property_id: 'p1',
      cleaner_user_id: 'u1',
      status: 'Godkänt',
      start_at: d('2026-06-06T10:00:00'),
      end_at: d('2026-06-06T12:00:00'),
      original_start_at: null,
      original_end_at: null,
      checked_in_at: null,
      checked_out_at: null,
    };

    const manual = {
      ...base,
      status: 'Utfört',
      checked_in_at: d('2026-06-06T10:00:00'),
      checked_out_at: d('2026-06-06T12:05:00'),
      start_at: d('2026-06-06T10:00:00'),
      end_at: d('2026-06-06T12:05:00'),
    };
    assert('already Utfört → null', evaluateShiftFinalization(manual, d('2026-06-06T12:30:00')) === null);

    const noCheckin = evaluateShiftFinalization(base, d('2026-06-06T12:30:00'));
    assert('no check-in → Utfört', noCheckin?.status === 'Utfört');
    assert('no check-in uses planned times', toMs(noCheckin?.start_at) === toMs(base.start_at) && toMs(noCheckin?.end_at) === toMs(base.end_at));
    assert('no check-in reason', noCheckin?.reason === 'auto_no_checkin');
    assert('no check-in event', eventTypeForResult(noCheckin) === AUTO_COMPLETE_EVENT);

    assert('already Väntar granskning → null', evaluateShiftFinalization({ ...base, status: PENDING_REVIEW_STATUS }, d('2026-06-06T13:00:00')) === null);

    assert('before end → null', evaluateShiftFinalization(base, d('2026-06-06T11:00:00')) === null);

    assert('sick → null', evaluateShiftFinalization({ ...base, status: 'Sjukanmäld' }, d('2026-06-06T13:00:00')) === null);

    const checkinOnly = {
      ...base,
      status: 'Pågående',
      checked_in_at: d('2026-06-06T10:00:00'),
    };
    const afterEnd = evaluateShiftFinalization(checkinOnly, d('2026-06-06T12:30:00'));
    assert('check-in past end → Utfört', afterEnd?.status === 'Utfört');
    assert('check-in past end start = checked_in', toMs(afterEnd?.start_at) === toMs(checkinOnly.checked_in_at));
    assert('check-in past end end = planned end', toMs(afterEnd?.end_at) === toMs(base.end_at));
    assert('check-in past end reason', afterEnd?.reason === 'auto_after_end');

    const abandoned = {
      ...base,
      status: 'Pågående',
      checked_in_at: d('2026-06-05T08:00:00'),
      start_at: d('2026-06-06T10:00:00'),
      end_at: d('2026-06-06T12:00:00'),
    };
    const after12h = evaluateShiftFinalization(abandoned, d('2026-06-06T12:30:00'));
    assert('12h abandoned → Utfört', after12h?.status === 'Utfört');
    assert('12h uses planned start', toMs(after12h?.start_at) === toMs(abandoned.start_at));
    assert('12h uses planned end', toMs(after12h?.end_at) === toMs(abandoned.end_at));
    assert('12h reason', after12h?.reason === 'abandoned_checkin_12h');

    const failed = results.filter(r => !r.ok);
    if (failed.length) {
      console.error('[ShiftFinalization] Tests failed:', failed.map(f => f.name));
      return { ok: false, results };
    }
    console.log('[ShiftFinalization] All', results.length, 'tests passed');
    return { ok: true, results };
  }

  window.ShiftFinalization = {
    FINALIZE_ELIGIBLE_STATUSES,
    PENDING_REVIEW_STATUS,
    AUTO_COMPLETE_EVENT,
    PENDING_REVIEW_EVENT,
    TWELVE_HOURS_MS,
    getPlannedTimes,
    evaluateShiftFinalization,
    eventTypeForResult,
    completionNoteFromReason,
    completionNoteFromEventType,
    __runTests,
  };
})();
