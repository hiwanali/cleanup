/*
 * Vyer.
 * En vy per sida i sidkartan (§8 i mvpfinal.md).
 * För första leveransen: Login, en riktig landningsvy per roll och placeholders
 * för resterande sidor – varje placeholder pekar på §-numret i mvpfinal.md
 * så att vi kan bygga vidare stegvis.
 */
(function () {
  const { useState, useMemo, useEffect } = React;

  /* ============================================================
   * LOGIN (Supabase Auth)
   * ============================================================ */
  function LoginView({ onPasswordLogin }) {
    if (!window.SUPABASE_ENABLED) {
      return <SupabaseConfigMissingView />;
    }
    return <PasswordLoginView onPasswordLogin={onPasswordLogin} />;
  }

  function SupabaseConfigMissingView() {
    return (
      <div className="min-h-screen bg-gradient-to-br from-brand-50 via-white to-accent-50 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <div className="inline-flex items-center gap-3 mb-3">
              <BrandLogo size="lg" />
              <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">CleanUp</h1>
            </div>
          </div>
          <Card padding="lg" className="border-amber-200 bg-amber-50/40">
            <div className="flex items-start gap-3">
              <Icon name="alert-circle" className="w-5 h-5 text-amber-700 mt-0.5 flex-shrink-0" />
              <div>
                <h2 className="font-bold text-amber-900 mb-1">Supabase är inte konfigurerat</h2>
                <p className="text-sm text-amber-800/90">
                  Appen kan inte ansluta till databasen. Sätt miljövariablerna{' '}
                  <code className="text-xs bg-white/80 px-1 py-0.5 rounded">SUPABASE_URL</code> och{' '}
                  <code className="text-xs bg-white/80 px-1 py-0.5 rounded">SUPABASE_ANON_KEY</code>{' '}
                  (eller publishable key) i Vercel, eller kör lokalt:{' '}
                  <code className="text-xs bg-white/80 px-1 py-0.5 rounded">node scripts/generate-config.js</code>
                </p>
              </div>
            </div>
          </Card>
        </div>
      </div>
    );
  }

  const LOGIN_REMEMBER_KEY = 'cleanup_login_remember_v1';
  function loadRememberedLogin() {
    try {
      const raw = localStorage.getItem(LOGIN_REMEMBER_KEY);
      if (!raw) return { email: '', rememberMe: false };
      const { email } = JSON.parse(raw);
      if (email) return { email, rememberMe: true };
    } catch (_) {}
    return { email: '', rememberMe: false };
  }
  function saveRememberedLogin(email, rememberMe) {
    try {
      if (rememberMe) localStorage.setItem(LOGIN_REMEMBER_KEY, JSON.stringify({ email: email.trim() }));
      else localStorage.removeItem(LOGIN_REMEMBER_KEY);
    } catch (_) {}
  }

  function PasswordLoginView({ onPasswordLogin }) {
    const remembered = useMemo(() => loadRememberedLogin(), []);
    const [email, setEmail] = useState(remembered.email);
    const [password, setPassword] = useState('');
    const [rememberMe, setRememberMe] = useState(remembered.rememberMe);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    function handleRememberChange(next) {
      setRememberMe(next);
      if (next && email.trim()) saveRememberedLogin(email, true);
      else saveRememberedLogin(email, false);
    }

    function handleEmailChange(next) {
      setEmail(next);
      if (rememberMe && next.trim()) saveRememberedLogin(next, true);
    }

    async function submit(e) {
      e.preventDefault();
      if (!email.trim() || !password) return;
      setLoading(true);
      setError('');
      const msg = await onPasswordLogin(email, password);
      if (msg) { setError(msg); setLoading(false); return; }
      saveRememberedLogin(email, rememberMe);
      // vid lyckad inloggning byts vyn ut av App
    }

    return (
      <div className="min-h-screen bg-gradient-to-br from-brand-50 via-white to-accent-50 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <div className="inline-flex items-center gap-3 mb-3">
              <BrandLogo size="lg" />
              <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">CleanUp</h1>
            </div>
            <p className="text-slate-600">Logga in för att fortsätta.</p>
          </div>

          <Card padding="lg">
            <form onSubmit={submit} className="space-y-4">
              <Field label="Mejl">
                <Input type="email" value={email} autoComplete="username" placeholder="namn@foretag.se" onChange={e => handleEmailChange(e.target.value)} />
              </Field>
              <Field label="Lösenord">
                <Input type="password" value={password} autoComplete="current-password" placeholder="••••••••" onChange={e => setPassword(e.target.value)} />
              </Field>
              <div className="rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2.5">
                <Checkbox
                  id="login-remember-me"
                  checked={rememberMe}
                  onChange={handleRememberChange}
                  label="Kom ihåg mig"
                  className="w-full"
                />
                <p className="text-xs text-slate-500 mt-1.5 ml-7">Sparar din mejladress på den här enheten.</p>
              </div>
              {error && <p className="text-sm text-rose-600">{error}</p>}
              <Button type="submit" variant="primary" className="w-full" disabled={loading || !email.trim() || !password}>
                {loading ? 'Loggar in …' : 'Logga in'}
              </Button>
            </form>
          </Card>
        </div>
      </div>
    );
  }

  function ShiftTimeDisplay({ shift, timeClassName = '', plannedClassName = 'block text-[11px] text-slate-400 mt-0.5' }) {
    useDb();
    const times = db.shiftTimes(shift);
    return (
      <>
        <span className={timeClassName}>{formatRange(times.effective.start, times.effective.end)}</span>
        {times.showsPlannedNote && (
          <span className={plannedClassName}>
            Planerat: {formatRange(times.planned.start, times.planned.end)}
          </span>
        )}
      </>
    );
  }

  function CustomerWorkedTimeDisplay({ shift }) {
    useDb();
    const times = db.shiftTimes(shift);
    const workedMs = new Date(times.effective.end) - new Date(times.effective.start);
    const workedHours = workedMs > 0 ? Math.round((workedMs / 36e5) * 100) / 100 : 0;
    return (
      <div className="space-y-1.5">
        <div>
          <span className="text-[11px] text-slate-500 block">Bokad tid</span>
          <span>{formatRange(times.planned.start, times.planned.end)}</span>
        </div>
        <div>
          <span className="text-[11px] text-emerald-700 block">Utförd tid</span>
          <span className="text-emerald-800">{formatRange(times.effective.start, times.effective.end)}</span>
          {workedHours > 0 && (
            <span className="text-[11px] text-emerald-600 block mt-0.5">{workedHours} timmar arbetade</span>
          )}
        </div>
      </div>
    );
  }

  /* ============================================================
   * Gemensamma kort
   * ============================================================ */
  function ShiftCard({ shift, viewerRole, viewerUserId, onClick }) {
    const prop = db.propertyById(shift.property_id);
    const cleanerLabel = db.displayCleaner(shift.cleaner_user_id, viewerRole);
    const isAnon = viewerRole === 'customer' || viewerRole === 'customer_employee';
    return (
      <button
        onClick={() => onClick && onClick(shift)}
        className="w-full text-left bg-white rounded-2xl border border-slate-200 p-4 hover:border-brand-300 hover:shadow-sm transition-all"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {relativeDay(shift.start_at)} · <ShiftTimeDisplay shift={shift} />
            </p>
            <p className="mt-1 font-semibold text-slate-900 truncate">{prop?.name}</p>
            <p className="text-xs text-slate-500 truncate">{prop?.address}</p>
          </div>
          <StatusBadge status={shift.status} />
        </div>
        <div className="mt-3 flex items-center gap-2 text-xs text-slate-600">
          <Avatar size="xs" name={cleanerLabel} anonymous={isAnon} />
          <span className="font-medium">{cleanerLabel}</span>
        </div>
      </button>
    );
  }

  // Hjälpare: navigera till pass-detalj utifrån roll
  function shiftDetailPath(role, shiftId) {
    if (role === 'cleaner') return `/stadare/pass/${shiftId}`;
    if (role === 'customer' || role === 'customer_employee') return `/kund/pass/${shiftId}`;
    if (role === 'admin') return `/admin/schema/${shiftId}`;
    return '/';
  }

  // Hjälpare: ISO-datum + HH:MM utan TZ-strul
  function toDateInput(d) {
    const x = new Date(d);
    const y = x.getFullYear();
    const m = String(x.getMonth() + 1).padStart(2, '0');
    const day = String(x.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  function toTimeInput(d) {
    const x = new Date(d);
    return `${String(x.getHours()).padStart(2, '0')}:${String(x.getMinutes()).padStart(2, '0')}`;
  }
  function combineDateTime(dateStr, timeStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const [h, mi] = timeStr.split(':').map(Number);
    return new Date(y, m - 1, d, h, mi, 0, 0);
  }

  /* ============================================================
   * ShiftDetail – återanvänds av cleaner/customer (admin senare)
   * ============================================================ */
  /* Önskemål per städtillfälle (kund -> städare + admin) */
  function ShiftRequestsSection({ shift, session }) {
    useDb();
    const role = session.user.role;
    const isCustomerView = role === 'customer' || role === 'customer_employee';
    const requests = db.requestsForShift(shift);

    const [body, setBody] = useState('');
    const [scope, setScope] = useState('single');
    const [saving, setSaving] = useState(false);

    const terminal = ['Utfört', 'Borttaget', 'Avbokat'].includes(shift.status);
    const canAdd = role === 'customer' && !terminal;

    async function submit() {
      const text = body.trim();
      if (text.length < 3 || saving) return;
      setSaving(true);
      const r = await db.createShiftRequest({
        propertyId: shift.property_id,
        shiftId: shift.id,
        scope,
        body: text,
        createdByUserId: session.userId,
      });
      setSaving(false);
      if (r?.ok) {
        setBody('');
        setScope('single');
        toast.success(scope === 'standing' ? 'Stående önskemål sparat.' : 'Önskemål skickat till städaren.');
      } else if (r?.error === 'PERSIST_FAILED') {
        toast.error('Kunde inte spara – försök igen.');
      }
    }

    function creatorLabel(r) {
      if (r.created_by_user_id === session.userId) return 'Du';
      if (role === 'admin') return db.userById(r.created_by_user_id)?.name || 'Kund';
      return 'Kund';
    }

    return (
      <Card padding="md">
        <div className="flex items-start justify-between mb-3">
          <div>
            <h3 className="font-bold text-slate-900">Önskemål för städningen</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              {isCustomerView
                ? 'Lägg till önskemål som städaren och admin ser inför passet.'
                : 'Kundens önskemål för det här passet och stående önskemål för objektet.'}
            </p>
          </div>
          <Icon name="message-square" className="w-5 h-5 text-slate-300" />
        </div>

        {requests.length === 0 ? (
          <EmptyState icon="info" title="Inga önskemål" description={isCustomerView ? 'Skriv ett önskemål nedan.' : 'Kunden har inte lämnat några önskemål.'} className="py-6" />
        ) : (
          <ul className="space-y-2.5 mb-1">
            {requests.map(r => {
              const canDelete = role === 'admin' || r.created_by_user_id === session.userId;
              return (
                <li key={r.id} className="flex items-start gap-3 p-3 rounded-xl bg-slate-50 border border-slate-100">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <Badge variant={r.scope === 'standing' ? 'brand' : 'slate'}>
                        {r.scope === 'standing' ? 'Stående' : 'Detta pass'}
                      </Badge>
                      <span className="text-[11px] text-slate-400">{creatorLabel(r)} · {formatDateTime(r.created_at)}</span>
                    </div>
                    <p className="text-sm text-slate-800 whitespace-pre-wrap break-words">{r.body}</p>
                  </div>
                  {canDelete && (
                    <button
                      onClick={async () => {
                        const res = await db.deleteShiftRequest(r.id);
                        if (res?.ok) toast.success('Önskemål borttaget.');
                        else if (res?.error === 'PERSIST_FAILED') toast.error('Kunde inte ta bort – försök igen.');
                      }}
                      className="text-slate-400 hover:text-rose-600 p-1 rounded-lg flex-shrink-0"
                      aria-label="Ta bort önskemål"
                      title="Ta bort"
                    >
                      <Icon name="trash" className="w-4 h-4" />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {canAdd && (
          <div className="mt-4 pt-4 border-t border-slate-100">
            <Field label="Nytt önskemål" hint="Minst 3 tecken.">
              <Textarea
                rows={2}
                value={body}
                onChange={e => setBody(e.target.value)}
                placeholder="T.ex. Vänligen vattna växterna i receptionen."
              />
            </Field>
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 mt-2">
              <div className="flex rounded-lg border border-slate-200 overflow-hidden text-sm">
                <button
                  type="button"
                  onClick={() => setScope('single')}
                  className={cx('px-3 py-1.5 font-medium transition-colors', scope === 'single' ? 'bg-brand-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50')}
                >
                  Bara detta pass
                </button>
                <button
                  type="button"
                  onClick={() => setScope('standing')}
                  className={cx('px-3 py-1.5 font-medium transition-colors border-l border-slate-200', scope === 'standing' ? 'bg-brand-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50')}
                >
                  Gäller tills vidare
                </button>
              </div>
              <Button variant="primary" icon="send" disabled={body.trim().length < 3 || saving} onClick={submit} className="sm:ml-auto">
                Lägg till
              </Button>
            </div>
          </div>
        )}
      </Card>
    );
  }

  function ShiftDetail({ shift, session, onBack, breadcrumbs }) {
    useDb();
    const prop = db.propertyById(shift.property_id);
    const checklist = db.checklistForShift(shift.id);
    const role = session.user.role;
    const isOwnerCleaner = role === 'cleaner' && shift.cleaner_user_id === session.userId;
    const isCustomerView = role === 'customer' || role === 'customer_employee';
    const cleanerLabel = db.displayCleaner(shift.cleaner_user_id, role);
    // Nyckel/larm: admin + städare med minst ett pass på objektet
    const canSeeAccess = role === 'admin' || (role === 'cleaner' && db.shiftsForCleaner(session.userId).some(s => s.property_id === shift.property_id));
    const done = checklist.filter(c => c.done_at).length;
    const total = checklist.length;
    const pct = total === 0 ? 0 : Math.round((done / total) * 100);

    const canCheckIn = isOwnerCleaner && ['Godkänt', 'Planerat'].includes(shift.status);
    const canCheckOut = isOwnerCleaner && db.canCleanerCheckOut(shift);
    const isLateCheckout = canCheckOut && shift.status === 'Utfört';
    const canReportSick = isOwnerCleaner && ['Godkänt', 'Planerat'].includes(shift.status);
    const canCheckItems = isOwnerCleaner && ['Pågående', 'Utfört'].includes(shift.status);
    const [sickOpen, setSickOpen] = useState(false);

    return (
      <div>
        <PageHeader
          breadcrumbs={breadcrumbs}
          title={prop?.name || 'Pass'}
          subtitle={<>{relativeDay(shift.start_at)} · <ShiftTimeDisplay shift={shift} /> · {prop?.address || ''}</>}
          actions={
            <div className="flex items-center gap-2">
              {onBack && <Button variant="ghost" icon="chevron-left" onClick={onBack}>Tillbaka</Button>}
              <StatusBadge status={shift.status} />
            </div>
          }
        />

        <div className="grid lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 space-y-4">
            {/* Åtgärds-rad */}
            {(canCheckIn || canCheckOut) && (
              <Card padding="md">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">
                      {canCheckIn ? 'Redo att börja' : isLateCheckout ? 'Pass klarmarkerat' : 'Pågående pass'}
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {canCheckIn
                        ? 'Checka in när du är på plats för att starta passet.'
                        : isLateCheckout
                          ? `Incheckad ${shift.checked_in_at ? formatTime(shift.checked_in_at) : ''}. Checka ut för att spara faktisk sluttid i rapporten.`
                          : `Incheckad ${shift.checked_in_at ? formatTime(shift.checked_in_at) : ''}`}
                    </p>
                  </div>
                  {canCheckIn && (
                    <Button variant="primary" icon="play" onClick={async () => {
                      const r = await db.checkIn(shift.id, session.userId);
                      if (r?.ok) toast.success('Incheckad. Lycka till med passet!');
                      else if (r?.error === 'PERSIST_FAILED') toast.error('Kunde inte spara – försök igen.');
                    }}>Checka in</Button>
                  )}
                  {canCheckOut && (
                    <Button variant="success" icon="check" onClick={async () => {
                      const r = await db.checkOut(shift.id, session.userId);
                      if (r?.ok) toast.success('Utcheckad. Tack för idag!');
                      else if (r?.error === 'NOT_ELIGIBLE') toast.error('Passet kan inte checkas ut.');
                      else if (r?.error === 'PERSIST_FAILED') toast.error('Kunde inte spara – försök igen.');
                    }}>Checka ut</Button>
                  )}
                </div>
              </Card>
            )}

            {/* Checklist / städschema */}
            <Card padding="md">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="font-bold text-slate-900">Städschema</h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {total === 0 ? 'Inget städschema är upplagt för det här objektet.' :
                      `${done} av ${total} punkter utförda${pct === 100 ? ' — klart!' : ''}`}
                  </p>
                </div>
                {total > 0 && (
                  <div className="text-right">
                    <p className="text-2xl font-extrabold text-brand-700 leading-none">{pct}%</p>
                  </div>
                )}
              </div>
              {total > 0 && (
                <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden mb-4">
                  <div className="h-full bg-emerald-500 transition-all" style={{ width: pct + '%' }} />
                </div>
              )}
              {total === 0 ? (
                <EmptyState icon="list" title="Tomt städschema" description={role === 'admin' ? 'Lägg till mallpunkter på objektets sida.' : 'Kontakta admin om något ska finnas här.'} />
              ) : (
                <ul className="divide-y divide-slate-100 -mx-2">
                  {checklist.map(item => (
                    <li key={item.id} className="px-2 py-2.5 flex items-start gap-3">
                      <button
                        disabled={!canCheckItems}
                        onClick={async () => {
                          const wasDone = !!item.done_at;
                          const r = await db.toggleChecklistItem(item.id, session.userId, !wasDone);
                          if (r?.error) {
                            toast.error(r.message || 'Kunde inte uppdatera checklistan.');
                            return;
                          }
                          toast.success(wasDone ? 'Avbockat.' : 'Klart!');
                        }}
                        className={cx(
                          'mt-0.5 inline-flex items-center justify-center w-5 h-5 rounded-md border transition-colors flex-shrink-0',
                          item.done_at ? 'bg-emerald-600 border-emerald-600 text-white' : 'bg-white border-slate-300',
                          canCheckItems && !item.done_at && 'hover:border-emerald-400 cursor-pointer',
                          !canCheckItems && 'cursor-default opacity-90',
                        )}
                        aria-label={item.done_at ? 'Markera som ogjort' : 'Markera som klart'}
                      >
                        {item.done_at && <Icon name="check" className="w-3.5 h-3.5" strokeWidth={3} />}
                      </button>
                      <div className="flex-1 min-w-0">
                        <p className={cx('text-sm font-medium', item.done_at ? 'text-slate-400 line-through' : 'text-slate-900')}>{item.title}</p>
                        {item.done_at && (
                          <p className="text-[11px] text-slate-400 mt-0.5">
                            Utfört {formatTime(item.done_at)}
                            {role === 'admin' && item.done_by_cleaner_user_id ? ` · ${db.userById(item.done_by_cleaner_user_id)?.name}` : ''}
                          </p>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            {/* Önskemål per städtillfälle — kund skriver, städare + admin ser */}
            <ShiftRequestsSection shift={shift} session={session} />

            {/* §7.6 Avvikelse / reklamation — formulär + lista */}
            {isOwnerCleaner && <CleanerIncidentSection shift={shift} session={session} />}
            {isCustomerView && shift.status === 'Utfört' && (
              <CustomerComplaintSection shift={shift} session={session} />
            )}
            {/* §7.6 ärenden kopplade till passet — synliga för admin + kund */}
            {!isOwnerCleaner && <ShiftIncidentsList shift={shift} session={session} />}
          </div>

          <div className="space-y-4">
            {/* Översikt */}
            <Card padding="md">
              <h3 className="font-bold text-slate-900 mb-3">Information</h3>
              <dl className="text-sm space-y-2.5">
                <div className="flex items-start gap-2">
                  <Icon name="calendar" className="w-4 h-4 text-slate-400 mt-0.5" />
                  <div className="flex-1">
                    <dt className="text-xs text-slate-500">Datum</dt>
                    <dd className="font-medium text-slate-900">{formatDateLong(shift.start_at)}</dd>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <Icon name="clock" className="w-4 h-4 text-slate-400 mt-0.5" />
                  <div className="flex-1">
                    <dt className="text-xs text-slate-500">Tid</dt>
                    <dd className="font-medium text-slate-900">
                      {isCustomerView && shift.status === 'Utfört' ? (
                        <CustomerWorkedTimeDisplay shift={shift} />
                      ) : (
                        <ShiftTimeDisplay shift={shift} plannedClassName="block text-xs text-slate-500 mt-0.5 font-normal" />
                      )}
                    </dd>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <Icon name="map-pin" className="w-4 h-4 text-slate-400 mt-0.5" />
                  <div className="flex-1">
                    <dt className="text-xs text-slate-500">Adress</dt>
                    <dd className="font-medium text-slate-900">{prop?.address}</dd>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <Icon name="user" className="w-4 h-4 text-slate-400 mt-0.5" />
                  <div className="flex-1">
                    <dt className="text-xs text-slate-500">Städare</dt>
                    <dd className="font-medium text-slate-900 flex items-center gap-2">
                      <Avatar size="xs" name={cleanerLabel} anonymous={isCustomerView} />
                      {cleanerLabel}
                    </dd>
                  </div>
                </div>
                {prop?.notes && (
                  <div className="flex items-start gap-2 pt-2 border-t border-slate-100">
                    <Icon name="info" className="w-4 h-4 text-slate-400 mt-0.5" />
                    <div className="flex-1">
                      <dt className="text-xs text-slate-500">Att tänka på</dt>
                      <dd className="text-slate-700">{prop.notes}</dd>
                    </div>
                  </div>
                )}
              </dl>
            </Card>

            {/* Nyckel / larm */}
            {canSeeAccess && prop?.access_info && (
              <Card padding="md" className="border-amber-200 bg-amber-50/40">
                <div className="flex items-start gap-2 mb-2">
                  <Icon name="key" className="w-4 h-4 text-amber-700 mt-0.5" />
                  <div>
                    <h3 className="font-bold text-amber-900">Nyckel / larm</h3>
                    <p className="text-[11px] text-amber-700/80">Visas endast för admin och tilldelade städare.</p>
                  </div>
                </div>
                <p className="text-sm text-amber-900/90 whitespace-pre-line">{prop.access_info}</p>
              </Card>
            )}

            {/* Sjukanmälan – endast egen städare på Godkänt/Planerat */}
            {canReportSick && (
              <Card padding="md">
                <h3 className="font-bold text-slate-900 mb-1">Kan du inte arbeta?</h3>
                <p className="text-xs text-slate-500 mb-3">Sjukanmäl passet så får admin och kund besked direkt.</p>
                <Button variant="danger-ghost" icon="alert-circle" className="w-full" onClick={() => setSickOpen(true)}>
                  Sjukanmäl pass
                </Button>
              </Card>
            )}

            {role === 'cleaner' && shift.status === 'Sjukanmäld' && (
              <Card padding="md" className="border-amber-200 bg-amber-50/40">
                <h3 className="font-bold text-amber-900 mb-1">Sjukanmält pass</h3>
                <p className="text-sm text-amber-900/90">Admin hanterar ombokningen. Du behöver inte göra något mer.</p>
              </Card>
            )}

            {role === 'admin' && <AdminShiftActions shift={shift} session={session} onClose={onBack} />}
            {isCustomerView && <CustomerShiftActions shift={shift} session={session} onClose={onBack} />}
          </div>
        </div>

        <SickReportModal open={sickOpen} onClose={() => setSickOpen(false)} shift={shift} session={session} onDone={() => onBack && onBack()} />
      </div>
    );
  }

  /* ============================================================
   * AdminDeleteShiftSection – §7.4 ta bort pass (alla statusar utom Borttaget)
   * ============================================================ */
  function adminDeleteConfirmMessage(status) {
    if (status === 'Pågående') {
      return 'Passet är incheckat och pågår. Om du tar bort det markeras det som Borttaget. Kund och städare får besked.';
    }
    if (status === 'Utfört') {
      return 'Passet är redan utfört. Om du tar bort det markeras det som Borttaget och historiken ändras. Kund och städare får besked.';
    }
    return 'Passet markeras som Borttaget. Kund och städare får besked.';
  }

  function AdminDeleteShiftSection({ shift, session, onClose }) {
    const [deleteOpen, setDeleteOpen] = useState(false);
    const [deleting, setDeleting] = useState(false);

    if (shift.status === 'Borttaget') return null;

    async function handleDelete() {
      setDeleting(true);
      try {
        const r = await db.adminDelete(shift.id, session.userId);
        if (r?.ok) {
          toast.success('Passet borttaget.');
          setDeleteOpen(false);
          onClose && onClose();
        } else if (r?.error === 'ALREADY_DELETED') {
          toast.info('Passet är redan borttaget.');
          setDeleteOpen(false);
        } else if (r?.error === 'PERSIST_FAILED') {
          toast.error('Kunde inte spara – försök igen.');
        } else {
          toast.error('Passet kunde inte hittas.');
          setDeleteOpen(false);
        }
      } finally {
        setDeleting(false);
      }
    }

    return (
      <Card padding="md" className="border-rose-100 mt-4">
        <h3 className="font-bold text-slate-900 mb-2">Farlig zon</h3>
        <p className="text-xs text-slate-500 mb-3">Admin kan alltid ta bort pass, även inom 48 timmar.</p>
        <Button
          variant="danger-ghost"
          icon="trash"
          className="w-full justify-start"
          disabled={deleting}
          onClick={() => setDeleteOpen(true)}
        >
          Ta bort pass
        </Button>
        <ConfirmDialog
          open={deleteOpen}
          onClose={() => { if (!deleting) setDeleteOpen(false); }}
          title="Ta bort passet?"
          message={adminDeleteConfirmMessage(shift.status)}
          confirmLabel={deleting ? 'Tar bort…' : 'Ta bort'}
          danger
          onConfirm={handleDelete}
        />
      </Card>
    );
  }

  /* ============================================================
   * AdminShiftActions – §7.1 + §7.4 åtgärdspanel
   * ============================================================ */
  function AdminShiftActions({ shift, session, onClose }) {
    useDb();
    const [assignOpen, setAssignOpen] = useState(false);
    const [adjustOpen, setAdjustOpen] = useState(false);
    const [sickOpen, setSickOpen] = useState(false);
    const [approveOpen, setApproveOpen] = useState(false);
    const [declineOpen, setDeclineOpen] = useState(false);
    const [acting, setActing] = useState(false);
    const isSick = shift.status === 'Sjukanmäld';
    const isAwaitingApproval = shift.status === 'Planerat';
    const isCompleted = shift.status === 'Utfört';
    const isScheduled = shift.status === 'Godkänt';
    const isLive = shift.status === 'Pågående';
    const isBorttaget = shift.status === 'Borttaget';
    const cleaner = db.userById(shift.cleaner_user_id);

    async function handleApprove(cleanerUserId) {
      setActing(true);
      try {
        const r = await db.approveShift(shift.id, session.userId, { cleanerUserId });
        if (r?.ok) {
          toast.success('Passet godkänt. Städare och kund har fått besked.');
          setApproveOpen(false);
          onClose && onClose();
        } else if (r?.error === 'NO_CLEANER') {
          toast.error('Välj en städare innan du godkänner.');
        } else if (r?.error === 'PERSIST_FAILED') {
          toast.error('Kunde inte spara – försök igen.');
        } else {
          toast.error('Passet kunde inte godkännas.');
        }
      } finally {
        setActing(false);
      }
    }

    async function handleDecline() {
      setActing(true);
      try {
        const r = await db.declineShift(shift.id, session.userId);
        if (r?.ok) {
          toast.success('Förfrågan avslagen. Berörda parter har fått besked.');
          setDeclineOpen(false);
          onClose && onClose();
        } else if (r?.error === 'PERSIST_FAILED') {
          toast.error('Kunde inte spara – försök igen.');
        } else {
          toast.error('Passet kunde inte avslås.');
        }
      } finally {
        setActing(false);
      }
    }

    if (isBorttaget) {
      return (
        <Card padding="md">
          <h3 className="font-bold text-slate-900 mb-1">Borttaget pass</h3>
          <p className="text-xs text-slate-500">Det här passet är markerat som borttaget. Inga ytterligare åtgärder.</p>
        </Card>
      );
    }

    if (isSick) {
      return (
        <>
          <Card padding="md" className="border-amber-200 bg-amber-50/50">
            <div className="flex items-start gap-2 mb-2">
              <Icon name="alert-circle" className="w-4 h-4 text-amber-700 mt-0.5" />
              <div>
                <h3 className="font-bold text-amber-900">Kräver din åtgärd</h3>
                <p className="text-[12px] text-amber-800/90 mt-0.5">
                  {cleaner?.name} sjukanmälde sig. Välj hur passet ska hanteras.
                </p>
              </div>
            </div>
          </Card>
          <Card padding="md">
            <h3 className="font-bold text-slate-900 mb-3">Åtgärder</h3>
            <div className="space-y-2">
              <Button variant="primary" icon="user-plus" className="w-full justify-start" onClick={() => setAssignOpen(true)}>
                Tilldela annan städare
              </Button>
              <Button variant="outline" icon="clock" className="w-full justify-start" onClick={() => setAdjustOpen(true)}>
                Justera tiden manuellt
              </Button>
              {shift.sick_finalized_at ? (
                <div className="text-xs text-slate-500 mt-2 flex items-start gap-2">
                  <Icon name="check" className="w-4 h-4 text-emerald-600 mt-0.5" />
                  <span>Markerat som hanterat – passet uteblir.</span>
                </div>
              ) : (
                <Button variant="ghost" icon="x" className="w-full justify-start" onClick={async () => {
                  if (confirm('Lämna passet som "Sjukanmäld" och meddela kund att det uteblir?')) {
                    const r = await db.markSickAsFinal(shift.id, session.userId);
                    if (r?.error) {
                      toast.error(r.message || 'Kunde inte markera passet.');
                      return;
                    }
                    toast.success('Passet markerat som hanterat. Kund har fått besked.');
                    onClose && onClose();
                  }
                }}>
                  Lämna som "Sjukanmäld" (passet uteblir)
                </Button>
              )}
            </div>
          </Card>
          <AdminDeleteShiftSection shift={shift} session={session} onClose={onClose} />
          <AssignReplacementModal open={assignOpen} onClose={() => setAssignOpen(false)} shift={shift} session={session} onDone={onClose} />
          <AdjustShiftModal open={adjustOpen} onClose={() => setAdjustOpen(false)} shift={shift} session={session} onDone={onClose} />
        </>
      );
    }

    if (isCompleted) {
      const times = db.shiftTimes(shift);
      const hasCheckInOut = shift.checked_in_at && shift.checked_out_at;
      return (
        <>
          <Card padding="md">
            <h3 className="font-bold text-slate-900 mb-1">Utfört pass</h3>
            <p className="text-xs text-slate-500 mb-3">
              {hasCheckInOut
                ? `Registrerad tid: ${formatRange(shift.checked_in_at, shift.checked_out_at)}.`
                : `Klarmarkerad med planerad tid: ${formatRange(times.planned.start, times.planned.end)}.`}
              {' '}Justera tid nedan om städaren missat incheckning eller utcheckning.
            </p>
            <div className="space-y-2">
              <Button variant="outline" icon="clock" className="w-full justify-start" onClick={() => setAdjustOpen(true)}>
                Justera tid
              </Button>
              <Button variant="outline" icon="user-plus" className="w-full justify-start" onClick={() => setAssignOpen(true)}>
                Byt städare
              </Button>
            </div>
          </Card>
          <AdminDeleteShiftSection shift={shift} session={session} onClose={onClose} />
          <AssignReplacementModal open={assignOpen} onClose={() => setAssignOpen(false)} shift={shift} session={session} onDone={onClose} />
          <AdjustShiftModal open={adjustOpen} onClose={() => setAdjustOpen(false)} shift={shift} session={session} onDone={onClose} />
        </>
      );
    }

    if (isAwaitingApproval) {
      return (
        <>
          <Card padding="md" className="border-brand-200 bg-brand-50/40">
            <div className="flex items-start gap-2 mb-3">
              <Icon name="calendar" className="w-4 h-4 text-brand-700 mt-0.5" />
              <div>
                <h3 className="font-bold text-brand-900">Väntar på godkännande</h3>
                <p className="text-[12px] text-brand-800/90 mt-0.5">
                  Passet är planerat men inte godkänt. Godkänn för att meddela städare och kund, eller avslå förfrågan.
                </p>
              </div>
            </div>
            <div className="space-y-2">
              <Button variant="primary" icon="check" className="w-full justify-start" disabled={acting} onClick={() => setApproveOpen(true)}>
                Godkänn pass
              </Button>
              <Button variant="danger-ghost" icon="x" className="w-full justify-start" disabled={acting} onClick={() => setDeclineOpen(true)}>
                Avslå förfrågan
              </Button>
            </div>
          </Card>
          <Card padding="md">
            <h3 className="font-bold text-slate-900 mb-3">Övriga åtgärder</h3>
            <div className="space-y-2">
              <Button variant="outline" icon="user-plus" className="w-full justify-start" onClick={() => setAssignOpen(true)}>
                Byt städare
              </Button>
              <Button variant="outline" icon="clock" className="w-full justify-start" onClick={() => setAdjustOpen(true)}>
                Justera tid
              </Button>
            </div>
          </Card>
          <AdminDeleteShiftSection shift={shift} session={session} onClose={onClose} />
          <AssignReplacementModal open={assignOpen} onClose={() => setAssignOpen(false)} shift={shift} session={session} onDone={onClose} />
          <AdjustShiftModal open={adjustOpen} onClose={() => setAdjustOpen(false)} shift={shift} session={session} onDone={onClose} />
          <ApproveShiftModal
            open={approveOpen}
            onClose={() => { if (!acting) setApproveOpen(false); }}
            shift={shift}
            acting={acting}
            onApprove={handleApprove}
          />
          <ConfirmDialog
            open={declineOpen}
            onClose={() => { if (!acting) setDeclineOpen(false); }}
            title="Avslå förfrågan?"
            message="Passet markeras som Avbokat i den gemensamma kalendern. Kund och städare får besked."
            confirmLabel={acting ? 'Avslår…' : 'Avslå'}
            danger
            onConfirm={handleDecline}
          />
        </>
      );
    }

    if (isScheduled) {
      return (
        <>
          <Card padding="md">
            <h3 className="font-bold text-slate-900 mb-3">Admin-åtgärder</h3>
            <div className="space-y-2">
              <Button variant="outline" icon="user-plus" className="w-full justify-start" onClick={() => setAssignOpen(true)}>
                Byt städare
              </Button>
              <Button variant="outline" icon="clock" className="w-full justify-start" onClick={() => setAdjustOpen(true)}>
                Justera tid
              </Button>
              <Button variant="danger-ghost" icon="alert-circle" className="w-full justify-start" onClick={() => setSickOpen(true)}>
                Sjukanmäl åt städaren
              </Button>
            </div>
          </Card>
          <AdminDeleteShiftSection shift={shift} session={session} onClose={onClose} />
          <AssignReplacementModal open={assignOpen} onClose={() => setAssignOpen(false)} shift={shift} session={session} onDone={onClose} />
          <AdjustShiftModal open={adjustOpen} onClose={() => setAdjustOpen(false)} shift={shift} session={session} onDone={onClose} />
          <SickReportModal open={sickOpen} onClose={() => setSickOpen(false)} shift={shift} session={session} adminActor onDone={onClose} />
        </>
      );
    }

    if (isLive) {
      return (
        <>
          <Card padding="md">
            <h3 className="font-bold text-slate-900 mb-1">Pågående pass</h3>
            <p className="text-xs text-slate-500">Du kan följa städarens framsteg via checklistan.</p>
          </Card>
          <AdminDeleteShiftSection shift={shift} session={session} onClose={onClose} />
        </>
      );
    }

    return (
      <>
        <Card padding="md">
          <h3 className="font-bold text-slate-900 mb-1">Passstatus</h3>
          <p className="text-xs text-slate-500">
            Status: <span className="font-medium text-slate-700">{shift.status}</span>
          </p>
        </Card>
        <AdminDeleteShiftSection shift={shift} session={session} onClose={onClose} />
      </>
    );
  }

  /* ============================================================
   * ApproveShiftModal – godkänn Planerat med obligatorisk städare
   * ============================================================ */
  function ApproveShiftModal({ open, onClose, shift, acting, onApprove }) {
    const [cleanerId, setCleanerId] = useState('');
    useEffect(() => {
      if (open) setCleanerId(shift?.cleaner_user_id || '');
    }, [open, shift?.id, shift?.cleaner_user_id]);
    if (!open || !shift) return null;

    const candidates = db.availableCleanersFor(shift.id)
      .sort((a, b) => (a.conflict - b.conflict) || (b.inPool - a.inPool) || a.user.name.localeCompare(b.user.name, 'sv'));
    const poolDefault = candidates.find(c => c.inPool)?.user.id || candidates[0]?.user.id || '';
    const effectiveCleanerId = cleanerId || poolDefault;

    return (
      <Modal
        open={open}
        onClose={onClose}
        title="Godkänn passet"
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={onClose} disabled={acting}>Avbryt</Button>
            <Button
              variant="primary"
              icon="check"
              disabled={acting || !effectiveCleanerId}
              onClick={() => onApprove(effectiveCleanerId)}
            >
              {acting ? 'Godkänner…' : 'Godkänn och tilldela'}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600 mb-4">
          Passet blir <span className="font-semibold text-emerald-700">Godkänt</span> i den gemensamma kalendern. Välj städare – både städare och kund får notis.
        </p>
        <Field label="Städare" required>
          <Select value={effectiveCleanerId} onChange={e => setCleanerId(e.target.value)}>
            <option value="">Välj städare…</option>
            {candidates.map(c => (
              <option key={c.user.id} value={c.user.id}>
                {c.user.name}{c.inPool ? ' · i poolen' : ''}{c.conflict ? ' · krock' : ''}
              </option>
            ))}
          </Select>
        </Field>
        {candidates.length === 0 && (
          <p className="text-xs text-amber-700 mt-2">Inga tillgängliga städare utan tidskrock. Justera tiden eller tilldela manuellt via ”Byt städare”.</p>
        )}
      </Modal>
    );
  }

  /* ============================================================
   * AssignReplacementModal – §7.1 tilldela annan städare
   * ============================================================ */
  function AssignReplacementModal({ open, onClose, shift, session, onDone }) {
    const [query, setQuery] = useState('');
    useEffect(() => { if (open) setQuery(''); }, [open]);
    if (!open) return null;
    const candidates = db.availableCleanersFor(shift.id);
    const filtered = candidates
      .filter(c => !query || c.user.name.toLowerCase().includes(query.toLowerCase()))
      .sort((a, b) => {
        if (a.conflict !== b.conflict) return a.conflict ? 1 : -1;
        if (a.inPool !== b.inPool) return a.inPool ? -1 : 1;
        return a.user.name.localeCompare(b.user.name);
      });
    const currentId = shift.cleaner_user_id;

    return (
      <Modal
        open={open}
        onClose={onClose}
        title={shift.status === 'Sjukanmäld' ? 'Tilldela annan städare' : 'Byt städare'}
        size="md"
      >
        <p className="text-xs text-slate-500 mb-3">
          Städare i objektets pool visas först. <span className="text-rose-600 font-medium">Röd</span> = krock med annat pass.
        </p>
        <Input
          autoFocus
          placeholder="Sök städare…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          className="mb-3"
        />
        <div className="max-h-80 overflow-y-auto -mx-1">
          {filtered.length === 0 ? (
            <EmptyState icon="users" title="Inga städare matchar" />
          ) : (
            <ul className="divide-y divide-slate-100">
              {filtered.map(c => {
                const isCurrent = c.user.id === currentId;
                return (
                  <li key={c.user.id} className="px-1">
                    <button
                      disabled={isCurrent}
                      onClick={async () => {
                        if (c.conflict && !confirm(`${c.user.name} har redan ett pass under den här tiden. Tilldela ändå?`)) return;
                        const r = await db.swapCleaner(shift.id, c.user.id, session.userId);
                        if (r?.error) {
                          toast.error(r.message || 'Kunde inte byta städare.');
                          return;
                        }
                        toast.success(shift.status === 'Sjukanmäld'
                          ? `${c.user.name} tilldelad passet. Kund och städare är notifierade.`
                          : `${c.user.name} tar nu passet.`);
                        onClose();
                        onDone && onDone();
                      }}
                      className={cx(
                        'w-full flex items-center gap-3 py-2.5 px-2 rounded-lg text-left transition-colors',
                        isCurrent ? 'opacity-50 cursor-default' : 'hover:bg-slate-50',
                      )}
                    >
                      <Avatar size="sm" name={c.user.name} />
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-slate-900 truncate flex items-center gap-2">
                          {c.user.name}
                          {isCurrent && <Badge variant="slate">Nuvarande</Badge>}
                          {c.inPool && !isCurrent && <Badge variant="brand">I poolen</Badge>}
                        </p>
                        <p className="text-xs text-slate-500 truncate">{c.user.email}</p>
                      </div>
                      {c.conflict ? (
                        <Badge variant="rose" icon="alert-triangle">Krock</Badge>
                      ) : !isCurrent && (
                        <Icon name="chevron-right" className="w-4 h-4 text-slate-400" />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </Modal>
    );
  }

  /* ============================================================
   * AdjustShiftModal – §7.1 / §7.4 justera tid (+ valfri städar-byte)
   * ============================================================ */
  function AdjustShiftModal({ open, onClose, shift, session, onDone }) {
    const [date, setDate] = useState('');
    const [start, setStart] = useState('');
    const [end, setEnd] = useState('');
    const [swapCleaner, setSwapCleaner] = useState(false);
    const [newCleanerId, setNewCleanerId] = useState('');

    useEffect(() => {
      if (open) {
        setDate(toDateInput(shift.start_at));
        setStart(toTimeInput(shift.start_at));
        setEnd(toTimeInput(shift.end_at));
        setSwapCleaner(false);
        setNewCleanerId('');
      }
    }, [open, shift.id]);

    if (!open) return null;
    const prop = db.propertyById(shift.property_id);
    const newStart = combineDateTime(date, start);
    const newEnd = combineDateTime(date, end);
    const validTime = newEnd > newStart;
    const cleaners = db.state.users.filter(u => u.role === 'cleaner' && u.active);

    return (
      <Modal
        open={open}
        onClose={onClose}
        title="Justera tiden"
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={onClose}>Avbryt</Button>
            <Button variant="primary" icon="check" disabled={!validTime || (swapCleaner && !newCleanerId)} onClick={async () => {
              const r = await db.adjustTime(shift.id, newStart, newEnd, session.userId);
              if (r?.error) {
                toast.error(r.message || 'Kunde inte justera tiden.');
                return;
              }
              if (swapCleaner && newCleanerId) {
                const r2 = await db.swapCleaner(shift.id, newCleanerId, session.userId);
                if (r2?.error) {
                  toast.error(r2.message || 'Tiden sparades men städarbytet misslyckades.');
                  return;
                }
              }
              toast.success('Tiden uppdaterad. Berörda parter notifierade.');
              onClose();
              onDone && onDone();
            }}>Spara</Button>
          </>
        }
      >
        <p className="text-sm text-slate-700 mb-1"><span className="font-semibold">{prop?.name}</span></p>
        <p className="text-xs text-slate-500 mb-4">Originaltiden sparas under historiken och kund + städare notifieras.</p>

        <Field label="Datum">
          <Input type="date" value={date} onChange={e => setDate(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3 mt-3">
          <Field label="Starttid">
            <Input type="time" value={start} onChange={e => setStart(e.target.value)} />
          </Field>
          <Field label="Sluttid">
            <Input type="time" value={end} onChange={e => setEnd(e.target.value)} />
          </Field>
        </div>
        {!validTime && (
          <p className="text-xs text-rose-600 mt-2">Sluttiden måste ligga efter starttiden.</p>
        )}

        <div className="mt-4 pt-4 border-t border-slate-100">
          <Checkbox checked={swapCleaner} onChange={setSwapCleaner} label="Byt även städare" />
          {swapCleaner && (
            <div className="mt-3">
              <Select value={newCleanerId} onChange={e => setNewCleanerId(e.target.value)}>
                <option value="">— välj städare —</option>
                {cleaners.map(c => (
                  <option key={c.id} value={c.id} disabled={c.id === shift.cleaner_user_id}>
                    {c.name}{c.id === shift.cleaner_user_id ? ' (nuvarande)' : ''}
                  </option>
                ))}
              </Select>
            </div>
          )}
        </div>
      </Modal>
    );
  }

  /* ============================================================
   * CustomerShiftActions – §7.2 48h-avbokning
   * ============================================================ */
  function CustomerShiftActions({ shift, session, onClose }) {
    useDb();
    const [cancelOpen, setCancelOpen] = useState(false);
    const status = shift.status;
    const startMs = new Date(db.shiftPlannedStart(shift)).getTime();
    const hoursToStart = (startMs - Date.now()) / 36e5;

    if (status === 'Avbokat') {
      return (
        <Card padding="md" className="border-slate-200 bg-slate-50/60">
          <div className="flex items-start gap-2 mb-1">
            <Icon name="x" className="w-4 h-4 text-slate-500 mt-0.5" />
            <h3 className="font-bold text-slate-700">Avbokat pass</h3>
          </div>
          <p className="text-sm text-slate-600">Passet är avbokat. Inga vidare åtgärder krävs.</p>
          {shift.cancel_reason && (
            <p className="text-xs text-slate-500 mt-2">Orsak: {shift.cancel_reason}</p>
          )}
        </Card>
      );
    }

    if (status === 'Borttaget') {
      return (
        <Card padding="md" className="border-slate-200 bg-slate-50/60">
          <h3 className="font-bold text-slate-700 mb-1">Passet är borttaget</h3>
          <p className="text-sm text-slate-600">Admin har tagit bort passet.</p>
        </Card>
      );
    }

    if (status === 'Pausat (kundledighet)') {
      return (
        <Card padding="md" className="border-sky-200 bg-sky-50/40">
          <h3 className="font-bold text-sky-900 mb-1">Pausat – kundledighet</h3>
          <p className="text-sm text-sky-900/90">Passet är pausat enligt registrerad ledighet.</p>
        </Card>
      );
    }

    if (status !== 'Godkänt' && status !== 'Planerat') {
      // Pågående / Utfört / Sjukanmäld → ingen avbokningsmöjlighet
      return null;
    }

    // Status är Godkänt / Planerat → 48h-regeln gäller
    if (hoursToStart > 48) {
      return (
        <Card padding="md">
          <h3 className="font-bold text-slate-900 mb-1">Behöver du avboka?</h3>
          <p className="text-xs text-slate-500 mb-3">Avbokning är möjlig fram till 48 timmar före passet.</p>
          <Button variant="danger-ghost" icon="x" className="w-full" onClick={() => setCancelOpen(true)}>
            Avboka pass
          </Button>
          <CancelShiftModal open={cancelOpen} onClose={() => setCancelOpen(false)} shift={shift} session={session} onDone={onClose} />
        </Card>
      );
    }

    // ≤ 48 h kvar → infobox med admins kontaktuppgifter
    const support = db.orgSupportContact();
    const hoursLeft = Math.max(0, Math.floor(hoursToStart));
    return (
      <Card padding="md" className="border-amber-200 bg-amber-50/40">
        <div className="flex items-start gap-2 mb-2">
          <Icon name="alert-circle" className="w-4 h-4 text-amber-700 mt-0.5" />
          <div>
            <h3 className="font-bold text-amber-900">Inom 48 timmar</h3>
            <p className="text-xs text-amber-800/90 mt-0.5">
              {hoursLeft <= 0 ? 'Passet börjar inom kort.' : `Cirka ${hoursLeft} timmar kvar.`} Kontakta oss för att avboka.
            </p>
          </div>
        </div>
        <div className="mt-3 space-y-1.5 text-sm">
          <div className="flex items-center gap-2 text-slate-900">
            <Icon name="phone" className="w-4 h-4 text-amber-700" />
            <a href={`tel:${support.phone}`} className="font-medium hover:underline">{support.phone || '—'}</a>
          </div>
          <div className="flex items-center gap-2 text-slate-900">
            <Icon name="mail" className="w-4 h-4 text-amber-700" />
            <a href={`mailto:${support.email}`} className="font-medium hover:underline">{support.email}</a>
          </div>
        </div>
      </Card>
    );
  }

  /* ============================================================
   * CancelShiftModal – §7.2 bekräfta kundavbokning
   * ============================================================ */
  function CancelShiftModal({ open, onClose, shift, session, onDone }) {
    const [reason, setReason] = useState('');
    const [cancelling, setCancelling] = useState(false);
    useEffect(() => { if (open) setReason(''); }, [open]);
    if (!shift) return null;
    const prop = db.propertyById(shift.property_id);
    const hoursToStart = (new Date(shift.start_at).getTime() - Date.now()) / 36e5;

    async function confirmCancel() {
      setCancelling(true);
      try {
        const result = await db.cancelByCustomer(shift.id, session.userId, reason);
        if (result?.error === 'INSIDE_48H') {
          toast.error('Passet ligger inom 48 timmar – kontakta admin för att avboka.');
          return;
        }
        if (result?.error === 'FORBIDDEN') {
          toast.error('Du har inte behörighet att avboka det här passet.');
          return;
        }
        if (result?.error === 'PERSIST_FAILED') {
          toast.error('Kunde inte spara – försök igen.');
          return;
        }
        toast.success('Passet är avbokat. Admin och städaren är notifierade.');
        onClose();
        onDone && onDone();
      } finally {
        setCancelling(false);
      }
    }

    return (
      <Modal
        open={open}
        onClose={onClose}
        title="Avboka pass"
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={onClose} disabled={cancelling}>Behåll passet</Button>
            <Button variant="danger" icon="x" disabled={cancelling} onClick={confirmCancel}>
              {cancelling ? 'Avbokar…' : 'Avboka pass'}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-700 mb-1">
          <span className="font-semibold">{prop?.name}</span> · {relativeDay(shift.start_at)} <ShiftTimeDisplay shift={shift} />
        </p>
        <p className="text-xs text-slate-500 mb-4">
          Cirka {Math.floor(hoursToStart)} timmar kvar till passet. Admin och tilldelad städare får besked direkt.
        </p>
        <Field label="Orsak (valfri)">
          <Textarea rows={3} value={reason} onChange={e => setReason(e.target.value)} placeholder="T.ex. helgstängt, ombyggnad…" />
        </Field>
      </Modal>
    );
  }

  /* ============================================================
   * Sjukanmälan-modal (§7.1) – fungerar både för städare och admin
   * ============================================================ */
  function SickReportModal({ open, onClose, shift, session, adminActor = false, onDone }) {
    const [reason, setReason] = useState('');
    useEffect(() => { if (open) setReason(''); }, [open]);
    if (!shift) return null;
    const prop = db.propertyById(shift.property_id);
    const cleaner = db.userById(shift.cleaner_user_id);
    return (
      <Modal
        open={open}
        onClose={onClose}
        title={adminActor ? 'Sjukanmäl åt städaren' : 'Sjukanmäl pass'}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={onClose}>Avbryt</Button>
            <Button variant="danger" icon="alert-circle" onClick={async () => {
              const r = await db.reportSick(shift.id, session.userId, reason.trim());
              if (r?.error) {
                toast.error(r.message || 'Kunde inte spara sjukanmälan.');
                return;
              }
              toast.success(adminActor
                ? `${cleaner?.name} är sjukanmäld. Kund har fått besked.`
                : 'Sjukanmält. Admin och kund har fått besked.');
              onClose();
              onDone && onDone();
            }}>{adminActor ? 'Sjukanmäl' : 'Sjukanmäl pass'}</Button>
          </>
        }
      >
        <p className="text-sm text-slate-700 mb-1">
          <span className="font-semibold">{prop?.name}</span> · {relativeDay(shift.start_at)} <ShiftTimeDisplay shift={shift} />
        </p>
        {adminActor && cleaner && (
          <p className="text-xs text-slate-500 mb-1">Städare: {cleaner.name}</p>
        )}
        <p className="text-xs text-slate-500 mb-4">
          {adminActor
            ? 'Passet får status "Sjukanmäld" och du kan därefter tilldela en ersättare.'
            : 'Admin notifieras direkt och kan boka om till en annan städare.'}
        </p>
        <Field label="Orsak (valfri)">
          <Textarea rows={3} value={reason} onChange={e => setReason(e.target.value)} placeholder="T.ex. förkyld, hög feber…" />
        </Field>
      </Modal>
    );
  }

  /* ============================================================
   * §7.6 Avvikelse / reklamation — kategorier + bilage-hjälp
   * ============================================================ */
  const CLEANER_CATEGORIES = [
    { id: 'broken_equipment', label: 'Trasig utrustning' },
    { id: 'no_access', label: 'Kom ej in' },
    { id: 'alarm', label: 'Larm / larmproblem' },
    { id: 'missing_supplies', label: 'Material slut' },
    { id: 'other', label: 'Annat' },
  ];
  const CUSTOMER_CATEGORIES = [
    { id: 'missed_area', label: 'Missad yta' },
    { id: 'poor_quality', label: 'Bristfällig städning' },
    { id: 'damage', label: 'Skada' },
    { id: 'other', label: 'Annat' },
  ];
  const ALL_CATEGORIES = [...CLEANER_CATEGORIES, ...CUSTOMER_CATEGORIES];
  function categoryLabel(id) {
    return ALL_CATEGORIES.find(c => c.id === id)?.label || id;
  }
  const MAX_ATTACHMENTS = 5;
  const MAX_FILE_SIZE = 5 * 1024 * 1024;
  const ACCEPTED_MIME = ['image/jpeg', 'image/png'];

  function fileToAttachment(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve({
        name: file.name,
        size: file.size,
        mime: file.type,
        path: `mock://incident/${Date.now()}_${file.name}`,
        dataUrl: reader.result,
      });
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  function AttachmentUploader({ value, onChange, hint }) {
    const [error, setError] = useState('');
    const remaining = MAX_ATTACHMENTS - value.length;
    async function handleFiles(files) {
      setError('');
      const list = Array.from(files);
      if (value.length + list.length > MAX_ATTACHMENTS) {
        setError(`Max ${MAX_ATTACHMENTS} bilder per ärende.`);
        return;
      }
      for (const f of list) {
        if (!ACCEPTED_MIME.includes(f.type)) {
          setError(`Endast JPEG och PNG. (${f.name})`);
          return;
        }
        if (f.size > MAX_FILE_SIZE) {
          setError(`Max 5 MB per bild. (${f.name})`);
          return;
        }
      }
      const next = [...value];
      for (const f of list) next.push(await fileToAttachment(f));
      onChange(next);
    }
    return (
      <div>
        <div className="flex flex-wrap gap-2 mb-2">
          {value.map((a, i) => (
            <div key={i} className="relative group">
              <img src={a.dataUrl} alt={a.name} className="w-20 h-20 object-cover rounded-lg border border-slate-200" />
              <button
                type="button"
                onClick={() => onChange(value.filter((_, j) => j !== i))}
                className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-slate-900 text-white text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                aria-label={`Ta bort ${a.name}`}
              >
                <Icon name="x" className="w-3 h-3" />
              </button>
            </div>
          ))}
          {remaining > 0 && (
            <label className="w-20 h-20 rounded-lg border-2 border-dashed border-slate-300 hover:border-brand-400 hover:bg-brand-50/40 cursor-pointer flex flex-col items-center justify-center text-slate-400 hover:text-brand-600 transition-colors">
              <Icon name="plus" className="w-5 h-5" />
              <span className="text-[10px] mt-0.5">Lägg till</span>
              <input
                type="file"
                accept="image/jpeg,image/png"
                multiple
                className="hidden"
                onChange={e => { handleFiles(e.target.files); e.target.value = ''; }}
              />
            </label>
          )}
        </div>
        <p className="text-xs text-slate-500">
          {hint || `Upp till ${MAX_ATTACHMENTS} bilder (JPEG/PNG, max 5 MB/st). ${value.length} av ${MAX_ATTACHMENTS} valda.`}
        </p>
        {error && <p className="text-xs text-rose-600 mt-1">{error}</p>}
      </div>
    );
  }

  function AttachmentGallery({ items, emptyText = 'Inga bilagor.' }) {
    if (!items || items.length === 0) {
      return <p className="text-xs text-slate-400">{emptyText}</p>;
    }
    return (
      <div className="flex flex-wrap gap-2">
        {items.map((a, i) => (
          <a
            key={i}
            href={a.dataUrl}
            target="_blank"
            rel="noreferrer"
            className="block w-24 h-24 rounded-lg overflow-hidden border border-slate-200 hover:border-brand-400 transition-colors group"
            title={a.name}
          >
            <img src={a.dataUrl} alt={a.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
          </a>
        ))}
      </div>
    );
  }

  function StatusPill({ status }) {
    const map = {
      open: { label: 'Öppen', variant: 'rose' },
      in_progress: { label: 'Pågående', variant: 'amber' },
      resolved: { label: 'Åtgärdad', variant: 'emerald' },
    };
    const c = map[status] || { label: status, variant: 'slate' };
    return <Badge variant={c.variant}>{c.label}</Badge>;
  }

  function CleanerIncidentReportModal({ open, onClose, shift, session, onDone }) {
    const prop = shift ? db.propertyById(shift.property_id) : null;
    const [category, setCategory] = useState('broken_equipment');
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');

    useEffect(() => {
      if (open) { setCategory('broken_equipment'); setTitle(''); setDescription(''); }
    }, [open]);

    const canSubmit = title.trim().length > 0 && description.trim().length > 0;
    return (
      <Modal
        open={open}
        onClose={onClose}
        title="Rapportera avvikelse"
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={onClose}>Avbryt</Button>
            <Button
              variant="primary"
              disabled={!canSubmit}
              onClick={async () => {
                const r = await db.createIncident({
                  shiftId: shift?.id,
                  propertyId: shift.property_id,
                  reporterUserId: session.userId,
                  reporterRole: 'cleaner',
                  kind: 'cleaner_issue',
                  category, title, description,
                });
                if (r?.error) {
                  toast.error(r.message || 'Kunde inte skicka avvikelsen.');
                  return;
                }
                toast.success('Avvikelse skickad. Admin notifieras.');
                onClose();
                onDone && onDone();
              }}
            >Skicka in</Button>
          </>
        }
      >
        <p className="text-xs text-slate-500 mb-3">
          {prop?.name} · <ShiftTimeDisplay shift={shift} /> · går till admin
        </p>
        <Field label="Kategori *" className="mb-3">
          <Select value={category} onChange={e => setCategory(e.target.value)}>
            {CLEANER_CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
          </Select>
        </Field>
        <Field label="Titel *" className="mb-3">
          <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Kort sammanfattning" />
        </Field>
        <Field label="Beskrivning *">
          <Textarea rows={5} value={description} onChange={e => setDescription(e.target.value)} placeholder="Vad hände? Vad gjorde du? Behövs uppföljning?" />
        </Field>
        <p className="text-[11px] text-slate-400 mt-3">Bildbilagor från städare läggs till i v1.1.</p>
      </Modal>
    );
  }

  function CustomerComplaintModal({ open, onClose, shift, session, onDone }) {
    const prop = shift ? db.propertyById(shift.property_id) : null;
    const [category, setCategory] = useState('missed_area');
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [attachments, setAttachments] = useState([]);

    useEffect(() => {
      if (open) { setCategory('missed_area'); setTitle(''); setDescription(''); setAttachments([]); }
    }, [open]);

    const canSubmit = title.trim().length > 0 && description.trim().length > 0;
    return (
      <Modal
        open={open}
        onClose={onClose}
        title="Reklamera passet"
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={onClose}>Avbryt</Button>
            <Button
              variant="primary"
              disabled={!canSubmit}
              onClick={async () => {
                const r = await db.createIncident({
                  shiftId: shift?.id,
                  propertyId: shift.property_id,
                  reporterUserId: session.userId,
                  reporterRole: session.user.role,
                  kind: 'customer_complaint',
                  category, title, description, attachments,
                });
                if (r?.error) {
                  toast.error(r.message || 'Kunde inte skicka reklamationen.');
                  return;
                }
                toast.success('Tack — vi tar tag i det direkt.');
                onClose();
                onDone && onDone();
              }}
            >Skicka in</Button>
          </>
        }
      >
        <p className="text-xs text-slate-500 mb-3">
          {prop?.name} · {formatDateLong(shift.start_at)} · <ShiftTimeDisplay shift={shift} />
        </p>
        <Field label="Kategori *" className="mb-3">
          <Select value={category} onChange={e => setCategory(e.target.value)}>
            {CUSTOMER_CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
          </Select>
        </Field>
        <Field label="Titel *" className="mb-3">
          <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Kort sammanfattning" />
        </Field>
        <Field label="Beskrivning *" className="mb-3">
          <Textarea rows={4} value={description} onChange={e => setDescription(e.target.value)} placeholder="Beskriv vad som inte stämmer." />
        </Field>
        <Field label="Bildbilagor">
          <AttachmentUploader value={attachments} onChange={setAttachments} />
        </Field>
      </Modal>
    );
  }

  function ResolveIncidentModal({ open, onClose, incident, session, onDone }) {
    const [note, setNote] = useState('');
    const [attachments, setAttachments] = useState([]);

    useEffect(() => {
      if (open) { setNote(''); setAttachments([]); }
    }, [open]);

    if (!incident) return null;
    const canSubmit = note.trim().length > 0;
    return (
      <Modal
        open={open}
        onClose={onClose}
        title="Åtgärda ärende"
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={onClose}>Avbryt</Button>
            <Button
              variant="primary"
              disabled={!canSubmit}
              onClick={async () => {
                const r = await db.resolveIncident(incident.id, session.userId, note, attachments);
                if (r?.error) {
                  toast.error(r.message || 'Kunde inte åtgärda ärendet.');
                  return;
                }
                toast.success('Ärendet är markerat som åtgärdat.');
                onClose();
                onDone && onDone();
              }}
            >Markera som åtgärdat</Button>
          </>
        }
      >
        <p className="text-sm font-semibold text-slate-900 mb-1">{incident.title}</p>
        <p className="text-xs text-slate-500 mb-4">{categoryLabel(incident.category)} · rapporterat {formatDateTime(incident.created_at)}</p>
        <Field label="Åtgärdsnotering *" className="mb-3">
          <Textarea rows={4} value={note} onChange={e => setNote(e.target.value)} placeholder="Vad gjordes? Skicka vidare till städaren / kunden om relevant." />
        </Field>
        <Field label="Bildbilagor (valfritt)">
          <AttachmentUploader value={attachments} onChange={setAttachments} hint={`Upp till ${MAX_ATTACHMENTS} bilder (JPEG/PNG, max 5 MB/st). Visas för rapportören.`} />
        </Field>
      </Modal>
    );
  }

  function IncidentRow({ incident, viewerRole, onClick }) {
    const reporter = db.userById(incident.reported_by_user_id);
    const reporterLabel = viewerRole === 'customer' || viewerRole === 'customer_employee'
      ? (incident.reporter_role === 'cleaner' ? 'Städare' : reporter?.name)
      : reporter?.name;
    return (
      <button
        type="button"
        onClick={onClick}
        className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-slate-50 border border-slate-100 transition-colors"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-0.5 flex-wrap">
              <Badge variant={incident.kind === 'customer_complaint' ? 'rose' : 'amber'}>
                {incident.kind === 'customer_complaint' ? 'Reklamation' : 'Avvikelse'}
              </Badge>
              <StatusPill status={incident.status} />
              <span className="text-[11px] text-slate-400">{categoryLabel(incident.category)}</span>
            </div>
            <p className="font-semibold text-sm text-slate-900 truncate">{incident.title}</p>
            <p className="text-xs text-slate-500 mt-0.5">
              {reporterLabel} · {formatDateTime(incident.created_at)}
              {incident.attachments?.length > 0 && ` · ${incident.attachments.length} bild${incident.attachments.length === 1 ? '' : 'er'}`}
            </p>
          </div>
          <Icon name="chevron-down" className="w-4 h-4 text-slate-400 mt-1 -rotate-90 flex-shrink-0" />
        </div>
      </button>
    );
  }

  function CleanerIncidentSection({ shift, session }) {
    useDb();
    const [open, setOpen] = useState(false);
    const myIncidents = db.state.incidents.filter(
      i => i.shift_id === shift.id && i.reported_by_user_id === session.userId,
    ).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const canReport = ['Pågående', 'Utfört'].includes(shift.status);
    return (
      <Card padding="md">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div>
            <p className="text-sm font-semibold text-slate-900">Något att rapportera?</p>
            <p className="text-xs text-slate-500 mt-0.5">Trasig utrustning, larmproblem, slut på material eller annat.</p>
          </div>
          <Button variant="outline" icon="alert-triangle" onClick={() => setOpen(true)} disabled={!canReport}>
            Rapportera avvikelse
          </Button>
        </div>
        {!canReport && (
          <p className="text-xs text-slate-400">Du kan rapportera när passet pågår eller är utfört.</p>
        )}
        {myIncidents.length > 0 && (
          <div className="mt-3 pt-3 border-t border-slate-100 space-y-2">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Mina ärenden på passet</p>
            {myIncidents.map(i => (
              <IncidentRow key={i.id} incident={i} viewerRole="cleaner" onClick={() => location.hash = `#/stadare/avvikelser/${i.id}`} />
            ))}
          </div>
        )}
        <CleanerIncidentReportModal open={open} onClose={() => setOpen(false)} shift={shift} session={session} />
      </Card>
    );
  }

  function CustomerComplaintSection({ shift, session }) {
    useDb();
    const [open, setOpen] = useState(false);
    const myComplaints = db.state.incidents.filter(
      i => i.shift_id === shift.id && i.kind === 'customer_complaint',
    ).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return (
      <Card padding="md">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div>
            <p className="text-sm font-semibold text-slate-900">Synpunkter på utfört arbete?</p>
            <p className="text-xs text-slate-500 mt-0.5">Missad yta, bristfällig städning, skada — vi tar tag i det direkt.</p>
          </div>
          <Button variant="outline" icon="alert-triangle" onClick={() => setOpen(true)}>
            Reklamera / avvikelse
          </Button>
        </div>
        {myComplaints.length > 0 && (
          <div className="mt-3 pt-3 border-t border-slate-100 space-y-2">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Tidigare reklamationer på passet</p>
            {myComplaints.map(i => (
              <IncidentRow key={i.id} incident={i} viewerRole={session.user.role} onClick={() => location.hash = `#/kund/avvikelser/${i.id}`} />
            ))}
          </div>
        )}
        <CustomerComplaintModal open={open} onClose={() => setOpen(false)} shift={shift} session={session} />
      </Card>
    );
  }

  function IncidentDetailView({ session, onNavigate, incidentId }) {
    useDb();
    const detail = db.incidentDetail(incidentId);
    const role = session.user.role;
    const [resolveOpen, setResolveOpen] = useState(false);

    const backLink = role === 'admin' ? '/admin/avvikelser'
      : role === 'cleaner' ? '/stadare/avvikelser'
      : '/kund/avvikelser';

    if (!detail) {
      return (
        <div>
          <PageHeader breadcrumbs={[{ label: 'Avvikelser', href: `#${backLink}` }]} title="Ärendet finns inte" />
          <Card padding="lg">
            <EmptyState icon="alert-circle" title="Inte hittat" description="Ärendet du letar efter finns inte eller har tagits bort." />
          </Card>
        </div>
      );
    }

    const isAdmin = role === 'admin';
    const isCustomer = role === 'customer' || role === 'customer_employee';
    const reporterLabel = isCustomer && detail.reporter_role === 'cleaner' ? 'Städare' : detail.reporter?.name;
    const cleanerLabel = db.displayCleaner(detail.shift?.cleaner_user_id, role);

    return (
      <div>
        <PageHeader
          breadcrumbs={[{ label: 'Avvikelser', href: `#${backLink}` }]}
          title={detail.title}
          subtitle={`${categoryLabel(detail.category)} · ${detail.property?.name}`}
          actions={<Button variant="ghost" icon="chevron-left" onClick={() => onNavigate(backLink)}>Tillbaka</Button>}
        />

        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4">
            <Card padding="md">
              <div className="flex items-center gap-2 mb-3 flex-wrap">
                <Badge variant={detail.kind === 'customer_complaint' ? 'rose' : 'amber'}>
                  {detail.kind === 'customer_complaint' ? 'Reklamation' : 'Avvikelse'}
                </Badge>
                <StatusPill status={detail.status} />
                <span className="text-xs text-slate-500">{categoryLabel(detail.category)}</span>
              </div>
              <p className="text-sm font-semibold text-slate-900 mb-1">Beskrivning</p>
              <p className="text-sm text-slate-700 whitespace-pre-line">{detail.description}</p>
            </Card>

            <Card padding="md">
              <h3 className="font-bold text-slate-900 mb-3">Bildbilagor</h3>
              <AttachmentGallery items={detail.attachments} emptyText="Inga bildbilagor på det här ärendet." />
            </Card>

            {detail.status === 'resolved' && (
              <Card padding="md" className="border-emerald-200 bg-emerald-50/40">
                <div className="flex items-start gap-2 mb-2">
                  <Icon name="check-circle" className="w-5 h-5 text-emerald-600 mt-0.5" />
                  <div>
                    <h3 className="font-bold text-emerald-900">Åtgärdat {formatDateTime(detail.resolved_at)}</h3>
                    {detail.resolver && <p className="text-xs text-emerald-700">av {detail.resolver.name}</p>}
                  </div>
                </div>
                <p className="text-sm text-emerald-900/90 whitespace-pre-line">{detail.resolution_note}</p>
              </Card>
            )}

            {isAdmin && (
              <Card padding="md">
                <h3 className="font-bold text-slate-900 mb-3">Admin-åtgärder</h3>
                <div className="flex flex-wrap gap-2">
                  {detail.status === 'open' && (
                    <Button variant="outline" icon="refresh" onClick={async () => {
                      const r = await db.setIncidentInProgress(detail.id, session.userId);
                      if (r?.error) {
                        toast.error(r.message || 'Kunde inte uppdatera ärendet.');
                        return;
                      }
                      toast.success('Ärendet är markerat som pågående.');
                    }}>Markera som pågående</Button>
                  )}
                  {detail.status !== 'resolved' && (
                    <Button variant="primary" icon="check-circle" onClick={() => setResolveOpen(true)}>Åtgärda</Button>
                  )}
                  {detail.status === 'resolved' && (
                    <Button variant="ghost" icon="refresh" onClick={async () => {
                      const r = await db.reopenIncident(detail.id);
                      if (r?.error) {
                        toast.error(r.message || 'Kunde inte återöppna ärendet.');
                        return;
                      }
                      toast.info('Ärendet är återöppnat.');
                    }}>Återöppna ärende</Button>
                  )}
                </div>
              </Card>
            )}
          </div>

          <div className="space-y-4">
            <Card padding="md">
              <h3 className="font-bold text-slate-900 mb-3">Information</h3>
              <dl className="text-sm space-y-2.5">
                <div>
                  <dt className="text-xs text-slate-500">Objekt</dt>
                  <dd className="font-medium text-slate-900">{detail.property?.name}</dd>
                </div>
                {!isCustomer && (
                  <div>
                    <dt className="text-xs text-slate-500">Kund</dt>
                    <dd className="font-medium text-slate-900">{detail.customer?.name}</dd>
                  </div>
                )}
                {detail.shift && (
                  <div>
                    <dt className="text-xs text-slate-500">Pass</dt>
                    <dd className="font-medium text-slate-900">
                      <a
                        href={`#${role === 'admin' ? '/admin/schema' : role === 'cleaner' ? '/stadare/pass' : '/kund/pass'}/${detail.shift.id}`}
                        className="text-brand-600 hover:underline"
                      >
                        {formatDateLong(detail.shift.start_at)} · <ShiftTimeDisplay shift={detail.shift} />
                      </a>
                    </dd>
                  </div>
                )}
                <div>
                  <dt className="text-xs text-slate-500">Rapporterad</dt>
                  <dd className="font-medium text-slate-900">{formatDateTime(detail.created_at)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Rapportör</dt>
                  <dd className="font-medium text-slate-900">{reporterLabel}</dd>
                </div>
                {detail.cleaner && !isCustomer && (
                  <div>
                    <dt className="text-xs text-slate-500">Städare på passet</dt>
                    <dd className="font-medium text-slate-900">{cleanerLabel}</dd>
                  </div>
                )}
              </dl>
            </Card>
          </div>
        </div>

        <ResolveIncidentModal open={resolveOpen} onClose={() => setResolveOpen(false)} incident={detail} session={session} />
      </div>
    );
  }

  function AdminIncidentsView({ session, onNavigate }) {
    useDb();
    const [statusFilter, setStatusFilter] = useState('open_first');
    const [customerFilter, setCustomerFilter] = useState('all');
    const [propertyFilter, setPropertyFilter] = useState('all');
    const [cleanerFilter, setCleanerFilter] = useState('all');
    const [categoryFilter, setCategoryFilter] = useState('all');
    const [periodFilter, setPeriodFilter] = useState('all');

    const customers = db.state.customers;
    const properties = db.state.properties;
    const cleaners = db.state.users.filter(u => u.role === 'cleaner');

    let list = db.state.incidents.slice();

    if (statusFilter !== 'open_first' && statusFilter !== 'all') {
      list = list.filter(i => i.status === statusFilter);
    }
    if (customerFilter !== 'all') {
      const customerProps = new Set(properties.filter(p => p.customer_id === customerFilter).map(p => p.id));
      list = list.filter(i => customerProps.has(i.property_id));
    }
    if (propertyFilter !== 'all') list = list.filter(i => i.property_id === propertyFilter);
    if (cleanerFilter !== 'all') {
      list = list.filter(i => {
        const sh = i.shift_id ? db.shiftById(i.shift_id) : null;
        return sh?.cleaner_user_id === cleanerFilter;
      });
    }
    if (categoryFilter !== 'all') list = list.filter(i => i.category === categoryFilter);
    if (periodFilter !== 'all') {
      const now = Date.now();
      const cutoff = periodFilter === '7d' ? now - 7 * 24 * 36e5
        : periodFilter === '30d' ? now - 30 * 24 * 36e5
        : periodFilter === '90d' ? now - 90 * 24 * 36e5 : 0;
      list = list.filter(i => new Date(i.created_at).getTime() >= cutoff);
    }

    const order = { open: 0, in_progress: 1, resolved: 2 };
    list.sort((a, b) => (order[a.status] - order[b.status]) || (new Date(b.created_at) - new Date(a.created_at)));

    const stats = {
      open: db.state.incidents.filter(i => i.status === 'open').length,
      in_progress: db.state.incidents.filter(i => i.status === 'in_progress').length,
      resolved: db.state.incidents.filter(i => i.status === 'resolved').length,
    };

    const filteredProperties = customerFilter === 'all' ? properties : properties.filter(p => p.customer_id === customerFilter);

    return (
      <div>
        <PageHeader title="Avvikelser" subtitle="Alla ärenden — öppna först" />

        <div className="grid grid-cols-3 gap-3 mb-6">
          <Stat label="Öppna" value={stats.open} icon="alert-circle" tone="rose" />
          <Stat label="Pågående" value={stats.in_progress} icon="refresh" tone="amber" />
          <Stat label="Åtgärdade" value={stats.resolved} icon="check-circle" tone="emerald" />
        </div>

        <Card padding="md" className="mb-4">
          <div className="grid md:grid-cols-3 lg:grid-cols-6 gap-3">
            <Field label="Status">
              <Select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
                <option value="open_first">Öppna först</option>
                <option value="open">Endast öppna</option>
                <option value="in_progress">Endast pågående</option>
                <option value="resolved">Endast åtgärdade</option>
                <option value="all">Alla</option>
              </Select>
            </Field>
            <Field label="Kund">
              <Select value={customerFilter} onChange={e => { setCustomerFilter(e.target.value); setPropertyFilter('all'); }}>
                <option value="all">Alla kunder</option>
                {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </Field>
            <Field label="Objekt">
              <Select value={propertyFilter} onChange={e => setPropertyFilter(e.target.value)}>
                <option value="all">Alla objekt</option>
                {filteredProperties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            </Field>
            <Field label="Städare">
              <Select value={cleanerFilter} onChange={e => setCleanerFilter(e.target.value)}>
                <option value="all">Alla städare</option>
                {cleaners.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </Field>
            <Field label="Kategori">
              <Select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}>
                <option value="all">Alla kategorier</option>
                <optgroup label="Städare">
                  {CLEANER_CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                </optgroup>
                <optgroup label="Kund">
                  {CUSTOMER_CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                </optgroup>
              </Select>
            </Field>
            <Field label="Period">
              <Select value={periodFilter} onChange={e => setPeriodFilter(e.target.value)}>
                <option value="all">All tid</option>
                <option value="7d">Senaste 7 dagar</option>
                <option value="30d">Senaste 30 dagar</option>
                <option value="90d">Senaste 90 dagar</option>
              </Select>
            </Field>
          </div>
        </Card>

        {list.length === 0 ? (
          <Card padding="lg">
            <EmptyState icon="check-circle" title="Inga ärenden" description="Inga avvikelser matchar dina filter." />
          </Card>
        ) : (
          <Card padding="sm">
            <div className="divide-y divide-slate-100">
              {list.map(i => (
                <div key={i.id} className="px-2">
                  <IncidentRow incident={i} viewerRole="admin" onClick={() => onNavigate(`/admin/avvikelser/${i.id}`)} />
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>
    );
  }

  function CleanerIncidentsView({ session, onNavigate }) {
    useDb();
    const [statusFilter, setStatusFilter] = useState('all');
    let list = db.incidents({ viewerUserId: session.userId });
    if (statusFilter !== 'all') list = list.filter(i => i.status === statusFilter);

    return (
      <div>
        <PageHeader title="Mina avvikelser" subtitle="Avvikelser du själv rapporterat eller som rör dina pass" />

        <Card padding="md" className="mb-4">
          <Field label="Status">
            <Select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
              <option value="all">Alla</option>
              <option value="open">Öppna</option>
              <option value="in_progress">Pågående</option>
              <option value="resolved">Åtgärdade</option>
            </Select>
          </Field>
        </Card>

        {list.length === 0 ? (
          <Card padding="lg">
            <EmptyState icon="check-circle" title="Inga ärenden" description="Du har inga avvikelser just nu." />
          </Card>
        ) : (
          <Card padding="sm">
            <div className="divide-y divide-slate-100">
              {list.map(i => (
                <div key={i.id} className="px-2">
                  <IncidentRow incident={i} viewerRole="cleaner" onClick={() => onNavigate(`/stadare/avvikelser/${i.id}`)} />
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>
    );
  }

  function CustomerIncidentsView({ session, onNavigate }) {
    useDb();
    const [statusFilter, setStatusFilter] = useState('all');
    let list = db.incidents({ viewerUserId: session.userId });
    if (statusFilter !== 'all') list = list.filter(i => i.status === statusFilter);

    return (
      <div>
        <PageHeader title="Avvikelser & reklamationer" subtitle="Allt som rapporterats kring era objekt" />

        <Card padding="md" className="mb-4">
          <Field label="Status">
            <Select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
              <option value="all">Alla</option>
              <option value="open">Öppna</option>
              <option value="in_progress">Pågående</option>
              <option value="resolved">Åtgärdade</option>
            </Select>
          </Field>
        </Card>

        {list.length === 0 ? (
          <Card padding="lg">
            <EmptyState icon="check-circle" title="Inga ärenden" description="Inga avvikelser eller reklamationer just nu." />
          </Card>
        ) : (
          <Card padding="sm">
            <div className="divide-y divide-slate-100">
              {list.map(i => (
                <div key={i.id} className="px-2">
                  <IncidentRow incident={i} viewerRole={session.user.role} onClick={() => onNavigate(`/kund/avvikelser/${i.id}`)} />
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>
    );
  }

  function ShiftIncidentsList({ shift, session }) {
    useDb();
    const role = session.user.role;
    const items = db.state.incidents.filter(i => i.shift_id === shift.id)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    if (items.length === 0) return null;
    const linkPrefix = role === 'admin' ? '/admin/avvikelser' : '/kund/avvikelser';
    return (
      <Card padding="md">
        <h3 className="font-bold text-slate-900 mb-3 flex items-center gap-2">
          <Icon name="alert-triangle" className="w-4 h-4 text-rose-600" />
          Ärenden på passet <Badge variant="slate">{items.length}</Badge>
        </h3>
        <div className="space-y-2">
          {items.map(i => (
            <IncidentRow key={i.id} incident={i} viewerRole={role} onClick={() => location.hash = `#${linkPrefix}/${i.id}`} />
          ))}
        </div>
      </Card>
    );
  }

  /* ============================================================
   * ADMIN · Pass-detalj
   * ============================================================ */
  /* ============================================================
   * ScheduleCalendar – månadskalender (måndag först) för alla roller
   * ============================================================ */
  const CAL_WEEKDAYS = ['Mån', 'Tis', 'Ons', 'Tors', 'Fre', 'Lör', 'Sön'];
  const CAL_MONTHS = [
    'januari', 'februari', 'mars', 'april', 'maj', 'juni',
    'juli', 'augusti', 'september', 'oktober', 'november', 'december',
  ];
  const CAL_STATUS_CHIP = {
    'Godkänt': 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200',
    'Planerat': 'bg-slate-200 text-slate-700 hover:bg-slate-300',
    'Pågående': 'bg-accent-100 text-accent-700 hover:bg-accent-200',
    'Utfört': 'bg-slate-100 text-slate-600 hover:bg-slate-200',
    'Väntar granskning': 'bg-amber-100 text-amber-800 hover:bg-amber-200',
    'Sjukanmäld': 'bg-amber-100 text-amber-800 hover:bg-amber-200',
    'Pausat (kundledighet)': 'bg-sky-100 text-sky-800 hover:bg-sky-200',
    'Avbokat': 'bg-rose-100 text-rose-700 hover:bg-rose-200 line-through',
    'Borttaget': 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200 line-through',
  };

  function CalendarListToggle({ view, onChange }) {
    const opts = [
      { id: 'calendar', label: 'Kalender', icon: 'calendar' },
      { id: 'list', label: 'Lista', icon: 'list' },
    ];
    return (
      <div className="inline-flex rounded-xl border border-slate-200 bg-white p-0.5">
        {opts.map(opt => (
          <button
            key={opt.id}
            type="button"
            onClick={() => onChange(opt.id)}
            className={cx(
              'inline-flex items-center gap-1.5 rounded-lg px-3 h-9 text-sm font-semibold transition-colors',
              view === opt.id ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-100',
            )}
          >
            <Icon name={opt.icon} className="w-4 h-4" />
            <span className="hidden sm:inline">{opt.label}</span>
          </button>
        ))}
      </div>
    );
  }

  function calStartOfMonth(d) { const x = new Date(d); x.setDate(1); x.setHours(0, 0, 0, 0); return x; }
  function calMondayIndex(d) { return (new Date(d).getDay() + 6) % 7; }
  function calSameDay(a, b) {
    const x = new Date(a), y = new Date(b);
    return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
  }

  function ScheduleCalendar({ shifts = [], viewerRole, onSelectShift }) {
    const [cursor, setCursor] = useState(() => calStartOfMonth(new Date()));
    const [dayDetail, setDayDetail] = useState(null);
    const MAX_CHIPS = 3;

    const monthStart = calStartOfMonth(cursor);
    const gridStart = new Date(monthStart);
    gridStart.setDate(gridStart.getDate() - calMondayIndex(monthStart));

    const days = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(gridStart);
      d.setDate(gridStart.getDate() + i);
      days.push(d);
    }

    const byDay = {};
    shifts.forEach(s => {
      const k = toDateInput(s.start_at);
      (byDay[k] = byDay[k] || []).push(s);
    });
    Object.values(byDay).forEach(list => list.sort((a, b) => new Date(a.start_at) - new Date(b.start_at)));

    const today = new Date();

    function shiftChip(s, full = false) {
      const prop = db.propertyById(s.property_id);
      return (
        <button
          key={s.id}
          onClick={() => onSelectShift(s)}
          className={cx(
            'w-full text-left rounded-md px-1.5 py-1 text-[11px] font-medium leading-tight truncate transition-colors',
            CAL_STATUS_CHIP[s.status] || 'bg-slate-100 text-slate-600 hover:bg-slate-200',
          )}
          title={`${formatTime(s.start_at)}–${formatTime(s.end_at)} · ${prop?.name || ''}`}
        >
          <span className="tabular-nums">{formatTime(s.start_at)}</span> {prop?.name || 'Pass'}
          {full && <span className="text-slate-500"> · {s.status}</span>}
        </button>
      );
    }

    function gotoMonth(delta) {
      setCursor(prev => { const x = new Date(prev); x.setMonth(x.getMonth() + delta); return calStartOfMonth(x); });
    }

    return (
      <Card padding="sm">
        <div className="flex items-center justify-between mb-3 px-1">
          <div className="flex items-center gap-1.5">
            <Button variant="outline" size="sm" iconOnly icon="chevron-left" aria-label="Föregående månad" onClick={() => gotoMonth(-1)} />
            <Button variant="outline" size="sm" iconOnly icon="chevron-right" aria-label="Nästa månad" onClick={() => gotoMonth(1)} />
            <Button variant="ghost" size="sm" onClick={() => setCursor(calStartOfMonth(new Date()))}>Idag</Button>
          </div>
          <h3 className="text-base font-bold text-slate-900 capitalize">
            {CAL_MONTHS[monthStart.getMonth()]} {monthStart.getFullYear()}
          </h3>
        </div>

        <div className="overflow-x-auto">
          <div className="min-w-[680px]">
            <div className="grid grid-cols-7 border-t border-l border-slate-100 rounded-t-lg overflow-hidden">
              {CAL_WEEKDAYS.map(w => (
                <div key={w} className="border-b border-r border-slate-100 bg-slate-50 px-2 py-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500 text-center">
                  {w}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 border-l border-slate-100">
              {days.map((d, i) => {
                const key = toDateInput(d);
                const list = byDay[key] || [];
                const inMonth = d.getMonth() === monthStart.getMonth();
                const isToday = calSameDay(d, today);
                return (
                  <div
                    key={i}
                    className={cx(
                      'min-h-[96px] border-b border-r border-slate-100 p-1.5 flex flex-col gap-1',
                      !inMonth && 'bg-slate-50/60',
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span className={cx(
                        'inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-semibold',
                        isToday ? 'bg-brand-600 text-white' : inMonth ? 'text-slate-700' : 'text-slate-400',
                      )}>{d.getDate()}</span>
                    </div>
                    <div className="flex flex-col gap-1">
                      {list.slice(0, MAX_CHIPS).map(s => shiftChip(s))}
                      {list.length > MAX_CHIPS && (
                        <button
                          onClick={() => setDayDetail({ date: new Date(d), list })}
                          className="text-[11px] font-semibold text-brand-700 hover:underline text-left px-1.5"
                        >
                          +{list.length - MAX_CHIPS} fler
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <Modal
          open={!!dayDetail}
          onClose={() => setDayDetail(null)}
          title={dayDetail ? formatDateLong(dayDetail.date) : ''}
          size="sm"
          footer={<Button variant="ghost" onClick={() => setDayDetail(null)}>Stäng</Button>}
        >
          <div className="flex flex-col gap-1.5">
            {dayDetail?.list.map(s => shiftChip(s, true))}
          </div>
        </Modal>
      </Card>
    );
  }

  /* ============================================================
   * ADMIN · Schema (§7.4) – kalender + listvy med filter
   * ============================================================ */
  function AdminSchemaView({ session, onNavigate }) {
    useDb();
    const [statusFilter, setStatusFilter] = useState('all');
    const [cleanerFilter, setCleanerFilter] = useState('all');
    const [customerFilter, setCustomerFilter] = useState('all');
    const [dateRange, setDateRange] = useState('upcoming');
    const [createOpen, setCreateOpen] = useState(false);
    const [view, setView] = useState('calendar');

    const cleaners = db.state.users.filter(u => u.role === 'cleaner' && u.active);
    const customers = db.state.customers;

    const allShifts = db.state.shifts.slice();
    const now = Date.now();

    function applyEntityFilters(list) {
      let out = list;
      if (statusFilter !== 'all') out = out.filter(s => s.status === statusFilter);
      if (cleanerFilter !== 'all') out = out.filter(s => s.cleaner_user_id === cleanerFilter);
      if (customerFilter !== 'all') {
        const propIds = new Set(db.state.properties.filter(p => p.customer_id === customerFilter).map(p => p.id));
        out = out.filter(s => propIds.has(s.property_id));
      }
      return out;
    }

    const calShifts = applyEntityFilters(allShifts);

    let filtered = allShifts;

    if (dateRange === 'today') {
      const todayStr = formatDateShort(new Date());
      filtered = filtered.filter(s => formatDateShort(s.start_at) === todayStr);
    } else if (dateRange === 'upcoming') {
      filtered = filtered.filter(s => new Date(s.end_at).getTime() >= now);
    } else if (dateRange === 'past') {
      filtered = filtered.filter(s => new Date(s.end_at).getTime() < now);
    } else if (dateRange === 'week') {
      const weekEnd = Date.now() + 7 * 24 * 36e5;
      filtered = filtered.filter(s => new Date(s.start_at).getTime() <= weekEnd && new Date(s.end_at).getTime() >= now);
    }

    if (statusFilter !== 'all') filtered = filtered.filter(s => s.status === statusFilter);
    if (cleanerFilter !== 'all') filtered = filtered.filter(s => s.cleaner_user_id === cleanerFilter);
    if (customerFilter !== 'all') {
      const propIds = new Set(db.state.properties.filter(p => p.customer_id === customerFilter).map(p => p.id));
      filtered = filtered.filter(s => propIds.has(s.property_id));
    }

    filtered.sort((a, b) => new Date(a.start_at) - new Date(b.start_at));

    function resetFilters() {
      setStatusFilter('all'); setCleanerFilter('all'); setCustomerFilter('all'); setDateRange('upcoming');
    }

    return (
      <div>
        <PageHeader
          title="Schema"
          subtitle="Alla pass – kalender eller lista, filtrera på status, städare och kund."
          actions={
            <div className="flex items-center gap-2">
              <CalendarListToggle view={view} onChange={setView} />
              <Button icon="plus" onClick={() => setCreateOpen(true)}>Nytt pass</Button>
            </div>
          }
        />

        <Card padding="md" className="mb-4">
          <div className="grid md:grid-cols-4 gap-3">
            {view === 'list' && (
              <Field label="Period">
                <Select value={dateRange} onChange={e => setDateRange(e.target.value)}>
                  <option value="upcoming">Kommande</option>
                  <option value="today">Idag</option>
                  <option value="week">7 dagar</option>
                  <option value="past">Historik</option>
                  <option value="all">Alla</option>
                </Select>
              </Field>
            )}
            <Field label="Status">
              <Select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
                <option value="all">Alla</option>
                <option value="Godkänt">Godkänt</option>
                <option value="Planerat">Planerat</option>
                <option value="Pågående">Pågående</option>
                <option value="Utfört">Utfört</option>
                <option value="Sjukanmäld">Sjukanmäld</option>
                <option value="Pausat (kundledighet)">Pausat (kundledighet)</option>
                <option value="Avbokat">Avbokat</option>
                <option value="Borttaget">Borttaget</option>
              </Select>
            </Field>
            <Field label="Städare">
              <Select value={cleanerFilter} onChange={e => setCleanerFilter(e.target.value)}>
                <option value="all">Alla städare</option>
                {cleaners.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </Field>
            <Field label="Kund">
              <Select value={customerFilter} onChange={e => setCustomerFilter(e.target.value)}>
                <option value="all">Alla kunder</option>
                {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </Field>
          </div>
          <div className="mt-3 flex items-center justify-between">
            <p className="text-sm text-slate-600">
              <strong className="text-slate-900">{view === 'calendar' ? calShifts.length : filtered.length}</strong> pass {view === 'calendar' ? 'i urvalet' : 'matchar filtret'}.
            </p>
            <Button variant="ghost" size="sm" icon="refresh" onClick={resetFilters}>Återställ filter</Button>
          </div>
        </Card>

        {view === 'calendar' ? (
          <ScheduleCalendar
            shifts={calShifts}
            viewerRole="admin"
            onSelectShift={s => onNavigate(`/admin/schema/${s.id}`)}
          />
        ) : filtered.length === 0 ? (
          <Card padding="lg"><EmptyState icon="calendar" title="Inga pass matchar" description="Justera filtret eller skapa ett nytt pass." /></Card>
        ) : (
          <>
            <div className="grid md:grid-cols-2 gap-3">
              {filtered.slice(0, 100).map(s => (
                <ShiftCard key={s.id} shift={s} viewerRole="admin" viewerUserId={session.userId} onClick={() => onNavigate(`/admin/schema/${s.id}`)} />
              ))}
            </div>
            {filtered.length > 100 && (
              <p className="text-xs text-slate-500 mt-3 text-center">Visar de första 100 passen. Förfina filtret för att se färre.</p>
            )}
          </>
        )}

        <CreateShiftModal open={createOpen} onClose={() => setCreateOpen(false)} session={session} />
      </div>
    );
  }

  /* ============================================================
   * CreateShiftModal (§7.4) – nytt one-off pass
   * ============================================================ */
  function CreateShiftModal({ open, onClose, session, preselectPropertyId = null }) {
    const [propertyId, setPropertyId] = useState(preselectPropertyId || '');
    const [cleanerId, setCleanerId] = useState('');
    const [date, setDate] = useState(toDateInput(new Date()));
    const [startTime, setStartTime] = useState('08:00');
    const [endTime, setEndTime] = useState('10:00');
    const [notes, setNotes] = useState('');
    const [requiresApproval, setRequiresApproval] = useState(false);

    useEffect(() => {
      if (open) {
        setPropertyId(preselectPropertyId || '');
        setCleanerId('');
        setDate(toDateInput(new Date()));
        setStartTime('08:00');
        setEndTime('10:00');
        setNotes('');
        setRequiresApproval(false);
      }
    }, [open, preselectPropertyId]);

    const cleaners = db.state.users.filter(u => u.role === 'cleaner' && u.active);
    const properties = db.state.properties.slice().sort((a, b) => a.name.localeCompare(b.name));

    const validTime = startTime && endTime && startTime < endTime;
    const canSubmit = propertyId && cleanerId && date && validTime;
    const endAtPreview = date && endTime && validTime ? combineDateTime(date, endTime) : null;
    const isHistorical = endAtPreview ? new Date(endAtPreview).getTime() <= Date.now() : false;

    async function submit() {
      const startAt = combineDateTime(date, startTime);
      const endAt = combineDateTime(date, endTime);
      const status = isHistorical ? 'Utfört' : (requiresApproval ? 'Planerat' : 'Godkänt');
      const r = await db.createOneOffShift({
        propertyId, cleanerUserId: cleanerId,
        startAt, endAt,
        actorUserId: session.userId,
        notes: notes.trim(),
        status,
      });
      if (r?.error) {
        toast.error(r.message || 'Kunde inte spara passet. Försök igen.');
        return;
      }
      toast.success(
        isHistorical
          ? 'Historiskt pass registrerat som utfört och ingår i rapporten.'
          : requiresApproval
            ? 'Pass skapat som Planerat – godkänn det i dashboarden innan städare och kund meddelas.'
            : 'Nytt pass skapat. Städare och kund notifieras.',
      );
      onClose();
    }

    return (
      <Modal
        open={open}
        onClose={onClose}
        title="Nytt pass"
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={onClose}>Avbryt</Button>
            <Button disabled={!canSubmit} icon="plus" onClick={submit}>Skapa pass</Button>
          </>
        }
      >
        <Field label="Objekt" required>
          <Select value={propertyId} onChange={e => setPropertyId(e.target.value)} disabled={!!preselectPropertyId}>
            <option value="">Välj objekt…</option>
            {properties.map(p => {
              const cust = db.customerById(p.customer_id);
              return <option key={p.id} value={p.id}>{cust?.name} · {p.name}</option>;
            })}
          </Select>
        </Field>
        <div className="mt-3">
          <Field label="Städare" required>
            <Select value={cleanerId} onChange={e => setCleanerId(e.target.value)}>
              <option value="">Välj städare…</option>
              {cleaners.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-3 gap-3 mt-3">
          <Field label="Datum">
            <Input type="date" value={date} onChange={e => setDate(e.target.value)} />
          </Field>
          <Field label="Starttid">
            <Input type="time" value={startTime} onChange={e => setStartTime(e.target.value)} />
          </Field>
          <Field label="Sluttid" error={!validTime && startTime && endTime ? 'Måste vara efter starttid.' : null}>
            <Input type="time" value={endTime} onChange={e => setEndTime(e.target.value)} />
          </Field>
        </div>
        {isHistorical ? (
          <p className="mt-4 text-sm text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
            Pass i det förflutna registreras som <span className="font-medium text-slate-900">utfört</span> direkt och ingår i rapporten utan godkännande eller granskning.
          </p>
        ) : (
          <label className="mt-4 flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              className="mt-1 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
              checked={requiresApproval}
              onChange={e => setRequiresApproval(e.target.checked)}
            />
            <span className="text-sm text-slate-700">
              <span className="font-medium text-slate-900">Kräver godkännande (Planerat)</span>
              <span className="block text-xs text-slate-500 mt-0.5">Städare och kund meddelas först när du godkänner passet.</span>
            </span>
          </label>
        )}
        <div className="mt-3">
          <Field label="Interna anteckningar" hint="Visas för admin och städare.">
            <Textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="T.ex. extrastädning efter event." />
          </Field>
        </div>
      </Modal>
    );
  }

  /* ============================================================
   * CustomerShiftRequestModal – kund begär nytt pass (Planerat)
   * ============================================================ */
  function CustomerShiftRequestModal({ open, onClose, session, preselectPropertyId = null }) {
    const isMainContact = session.user.role === 'customer';
    const properties = db.propertiesForUser(session.userId).slice().sort((a, b) => a.name.localeCompare(b.name, 'sv'));
    const [propertyId, setPropertyId] = useState(preselectPropertyId || '');
    const [date, setDate] = useState(toDateInput(new Date()));
    const [startTime, setStartTime] = useState('08:00');
    const [endTime, setEndTime] = useState('10:00');
    const [notes, setNotes] = useState('');
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
      if (open) {
        setPropertyId(preselectPropertyId || properties[0]?.id || '');
        setDate(toDateInput(new Date()));
        setStartTime('08:00');
        setEndTime('10:00');
        setNotes('');
      }
    }, [open, preselectPropertyId]);

    const validTime = startTime && endTime && startTime < endTime;
    const canSubmit = propertyId && date && validTime && !submitting;

    async function submit() {
      setSubmitting(true);
      try {
        const r = await db.createCustomerShiftRequest({
          propertyId,
          startAt: combineDateTime(date, startTime),
          endAt: combineDateTime(date, endTime),
          actorUserId: session.userId,
          notes,
        });
        if (r?.error === 'FORBIDDEN') {
          toast.error('Du har inte åtkomst till det valda objektet.');
          return;
        }
        if (r?.error === 'INVALID_TIME') {
          toast.error('Sluttid måste vara efter starttid.');
          return;
        }
        if (r?.error === 'PERSIST_FAILED') {
          toast.error('Kunde inte skicka – försök igen.');
          return;
        }
        toast.success('Förfrågan skickad. Den syns som grå i kalendern tills admin godkänner.');
        onClose();
      } finally {
        setSubmitting(false);
      }
    }

    return (
      <Modal
        open={open}
        onClose={onClose}
        title="Begär städning"
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={onClose} disabled={submitting}>Avbryt</Button>
            <Button disabled={!canSubmit} icon="send" onClick={submit}>
              {submitting ? 'Skickar…' : 'Skicka förfrågan'}
            </Button>
          </>
        }
      >
        {!isMainContact ? (
          <EmptyState icon="shield" title="Endast huvudkontakt" description="Som kundanställd kan du se objekt och pass men inte begära nya städningar. Kontakta huvudkontakten." />
        ) : properties.length === 0 ? (
          <EmptyState icon="building" title="Inga objekt" description="Du saknar åtkomst till objekt. Kontakta admin." />
        ) : (
          <>
            <Field label="Objekt" required>
              <Select value={propertyId} onChange={e => setPropertyId(e.target.value)} disabled={!!preselectPropertyId}>
                {properties.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </Select>
            </Field>
            <div className="grid grid-cols-3 gap-3 mt-3">
              <Field label="Datum">
                <Input type="date" value={date} onChange={e => setDate(e.target.value)} />
              </Field>
              <Field label="Starttid">
                <Input type="time" value={startTime} onChange={e => setStartTime(e.target.value)} />
              </Field>
              <Field label="Sluttid" error={!validTime && startTime && endTime ? 'Måste vara efter starttid.' : null}>
                <Input type="time" value={endTime} onChange={e => setEndTime(e.target.value)} />
              </Field>
            </div>
            <div className="mt-3">
              <Field label="Kommentar" hint="Valfritt – t.ex. extrastädning eller särskilda önskemål.">
                <Textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Beskriv kort vad ni behöver." />
              </Field>
            </div>
            <p className="text-xs text-slate-500 mt-3">
              Förfrågan visas som <span className="font-medium text-slate-700">grå</span> i kalendern tills admin godkänner och tilldelar städare.
            </p>
          </>
        )}
      </Modal>
    );
  }

  function AdminShiftDetailView({ session, onNavigate, shiftId }) {
    useDb();
    const shift = db.shiftById(shiftId);
    if (!shift) return <ComingSoonView title="Pass saknas" section="—" description="Passet kunde inte hittas." />;
    const prop = db.propertyById(shift.property_id);
    const cust = prop ? db.state.customers.find(c => c.id === prop.customer_id) : null;
    return <ShiftDetail
      shift={shift}
      session={session}
      onBack={() => onNavigate('/admin/dashboard')}
      breadcrumbs={[
        { label: 'Schema', href: '#/admin/schema' },
        cust && { label: cust.name, href: `#/admin/kunder/${cust.id}` },
        prop && { label: prop.name, href: `#/admin/kunder/${cust?.id}/objekt/${prop.id}` },
        { label: relativeDay(shift.start_at) },
      ].filter(Boolean)}
    />;
  }

  /* ============================================================
   * CLEANER · Mina pass
   * ============================================================ */
  function CleanerShiftsListView({ session, onNavigate }) {
    useDb();
    const [tab, setTab] = useState('upcoming');
    const [view, setView] = useState('calendar');
    const all = db.shiftsForCleaner(session.userId);
    const now = Date.now();
    const upcoming = all.filter(s => new Date(s.end_at).getTime() >= now && !['Avbokat', 'Borttaget', 'Pausat (kundledighet)'].includes(s.status));
    const past = all.filter(s => new Date(s.end_at).getTime() < now).reverse();
    const cancelled = all.filter(s => ['Avbokat', 'Borttaget', 'Pausat (kundledighet)', 'Sjukanmäld'].includes(s.status));

    const tabs = [
      { id: 'upcoming', label: 'Kommande', count: upcoming.length, icon: 'calendar' },
      { id: 'past', label: 'Historik', count: past.length, icon: 'check' },
      { id: 'other', label: 'Avbokat / pausat', count: cancelled.length, icon: 'pause' },
    ];

    const items = tab === 'upcoming' ? upcoming : tab === 'past' ? past : cancelled;

    return (
      <div>
        <PageHeader
          title="Mina pass"
          subtitle={`Totalt ${all.length} pass tilldelade dig.`}
          actions={<CalendarListToggle view={view} onChange={setView} />}
        />
        {view === 'calendar' ? (
          <ScheduleCalendar
            shifts={all}
            viewerRole="cleaner"
            onSelectShift={s => onNavigate(shiftDetailPath('cleaner', s.id))}
          />
        ) : (
          <>
            <Tabs tabs={tabs} value={tab} onChange={setTab} className="mb-5" />
            {items.length === 0 ? (
              <Card padding="lg"><EmptyState icon="inbox" title="Inga pass här" /></Card>
            ) : (
              <div className="grid md:grid-cols-2 gap-3">
                {items.map(s => (
                  <ShiftCard key={s.id} shift={s} viewerRole="cleaner" viewerUserId={session.userId}
                    onClick={() => onNavigate(shiftDetailPath('cleaner', s.id))} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  function CleanerShiftDetailView({ session, onNavigate, shiftId }) {
    useDb();
    const shift = db.shiftById(shiftId);
    if (!shift) return <ComingSoonView title="Pass saknas" section="—" description="Passet kunde inte hittas." />;
    if (shift.cleaner_user_id !== session.userId) {
      // Separationsregel: städare kan endast se egna pass
      return (
        <div>
          <PageHeader title="Åtkomst nekas" />
          <Card padding="lg"><EmptyState icon="shield" title="Det här passet tillhör inte dig" description="Du kan bara öppna pass där du är tilldelad städare." action={<Button onClick={() => onNavigate('/stadare/idag')}>Tillbaka till Idag</Button>} /></Card>
        </div>
      );
    }
    return <ShiftDetail
      shift={shift}
      session={session}
      onBack={() => onNavigate('/stadare/pass')}
      breadcrumbs={[{ label: 'Mina pass', href: '#/stadare/pass' }, { label: relativeDay(shift.start_at) }]}
    />;
  }

  /* ============================================================
   * CUSTOMER · Pass-detalj (read-only, anonymiserad)
   * ============================================================ */
  function CustomerShiftDetailView({ session, onNavigate, shiftId }) {
    useDb();
    const shift = db.shiftById(shiftId);
    if (!shift) return <ComingSoonView title="Pass saknas" section="—" description="Passet kunde inte hittas." />;
    // Separationsregel: kund ser endast sina egna pass
    const allowed = db.shiftsForCustomerUser(session.userId).some(s => s.id === shiftId);
    if (!allowed) {
      return (
        <div>
          <PageHeader title="Åtkomst nekas" />
          <Card padding="lg"><EmptyState icon="shield" title="Det här passet tillhör inte dig" action={<Button onClick={() => onNavigate('/kund/oversikt')}>Tillbaka</Button>} /></Card>
        </div>
      );
    }
    return <ShiftDetail
      shift={shift}
      session={session}
      onBack={() => onNavigate('/kund/oversikt')}
      breadcrumbs={[{ label: 'Översikt', href: '#/kund/oversikt' }, { label: relativeDay(shift.start_at) }]}
    />;
  }

  /* ============================================================
   * MEDDELANDEN · Realtidsdialog kund <-> admin
   * ============================================================ */
  function MessageBubble({ message, isMine, senderName }) {
    return (
      <div className={cx('flex flex-col max-w-[78%]', isMine ? 'items-end self-end' : 'items-start self-start')}>
        <div className={cx(
          'px-3.5 py-2 rounded-2xl text-sm whitespace-pre-wrap break-words',
          isMine ? 'bg-brand-600 text-white rounded-br-sm' : 'bg-white border border-slate-200 text-slate-800 rounded-bl-sm',
        )}>
          {message.body}
        </div>
        <span className="text-[11px] text-slate-400 mt-1 px-1">
          {senderName} · {formatDateTime(message.created_at)}
        </span>
      </div>
    );
  }

  function ConversationPanel({ customerId, session, heightClass = 'h-[60vh]' }) {
    useDb();
    const scrollRef = React.useRef(null);
    const [draft, setDraft] = useState('');
    const [sending, setSending] = useState(false);

    const thread = db.threadForCustomer(customerId);
    const messages = thread ? db.messagesForThread(thread.id) : [];
    const role = session.user.role;
    const isAdmin = role === 'admin';

    // Markera tråden som läst när den visas / nya meddelanden kommer
    useEffect(() => {
      if (thread && db.unreadInThread(thread.id, session.userId) > 0) {
        db.markThreadRead(thread.id, session.userId);
      }
    }, [thread?.id, messages.length, session.userId]);

    useEffect(() => {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }, [messages.length, customerId]);

    function senderLabelFor(m) {
      if (m.sender_user_id === session.userId) return 'Du';
      if (isAdmin) {
        const u = db.userById(m.sender_user_id);
        return u ? u.name : 'Kund';
      }
      // Kundvy: alla admins visas som supportteamet
      return m.sender_role === 'admin' ? 'CleanUp' : (db.userById(m.sender_user_id)?.name || 'Kollega');
    }

    async function send() {
      const text = draft.trim();
      if (!text || sending) return;
      setSending(true);
      const r = await db.sendMessage({ customerId, senderUserId: session.userId, body: text });
      setSending(false);
      if (r?.ok) setDraft('');
      else if (r?.error === 'PERSIST_FAILED') toast.error('Kunde inte skicka – försök igen.');
    }

    return (
      <div className="flex flex-col min-h-0">
        <div ref={scrollRef} className={cx('flex flex-col gap-3 overflow-y-auto px-1 py-2', heightClass)}>
          {messages.length === 0 ? (
            <EmptyState icon="message-square" title="Inga meddelanden än" description={isAdmin ? 'Skriv ett meddelande för att starta dialogen.' : 'Skriv till oss så svarar vi så snart vi kan.'} className="my-auto" />
          ) : (
            messages.map(m => (
              <MessageBubble key={m.id} message={m} isMine={m.sender_user_id === session.userId} senderName={senderLabelFor(m)} />
            ))
          )}
        </div>
        <div className="border-t border-slate-100 pt-3 mt-2">
          <div className="flex items-end gap-2">
            <Textarea
              rows={2}
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); } }}
              placeholder="Skriv ett meddelande…"
              className="flex-1"
            />
            <Button variant="primary" icon="send" disabled={!draft.trim() || sending} onClick={send}>Skicka</Button>
          </div>
          <p className="text-[11px] text-slate-400 mt-1.5">Tryck Cmd/Ctrl + Enter för att skicka.</p>
        </div>
      </div>
    );
  }

  function MessagesView({ session, onNavigate }) {
    useDb();
    const role = session.user.role;

    // Kund / kundanställd: en enda tråd
    if (role === 'customer' || role === 'customer_employee') {
      const customer = db.customerForUser(session.userId);
      if (!customer) {
        return (
          <div>
            <PageHeader title="Meddelanden" />
            <Card padding="lg"><EmptyState icon="message-square" title="Ingen kund kopplad" description="Din profil saknar koppling till en kund." /></Card>
          </div>
        );
      }
      return (
        <div>
          <PageHeader title="Meddelanden" subtitle="Direktdialog med CleanUp-teamet." />
          <Card padding="md">
            <ConversationPanel customerId={customer.id} session={session} />
          </Card>
        </div>
      );
    }

    // Admin: trådlista + vald konversation
    const threads = db.threadsForAdmin(session.userId);
    const [selectedId, setSelectedId] = useState(threads[0]?.customer.id || null);
    const selected = threads.find(t => t.customer.id === selectedId) || threads[0] || null;

    return (
      <div>
        <PageHeader title="Meddelanden" subtitle="Dialog med kunder i realtid." />
        <div className="grid lg:grid-cols-3 gap-4">
          <Card padding="sm" className="lg:col-span-1">
            <div className="max-h-[64vh] overflow-y-auto -mx-1">
              {threads.length === 0 ? (
                <EmptyState icon="message-square" title="Inga kunder" className="py-8" />
              ) : (
                <ul className="divide-y divide-slate-100">
                  {threads.map(t => (
                    <li key={t.customer.id}>
                      <button
                        onClick={() => setSelectedId(t.customer.id)}
                        className={cx(
                          'w-full text-left px-3 py-3 flex items-start gap-3 rounded-lg transition-colors',
                          selected?.customer.id === t.customer.id ? 'bg-brand-50' : 'hover:bg-slate-50',
                        )}
                      >
                        <Avatar name={t.customer.name} size="sm" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <p className="font-semibold text-sm text-slate-900 truncate">{t.customer.name}</p>
                            {t.unread > 0 && (
                              <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-brand-600 text-white text-[10px] font-bold flex items-center justify-center flex-shrink-0">{t.unread}</span>
                            )}
                          </div>
                          <p className="text-xs text-slate-500 truncate mt-0.5">
                            {t.lastMessage ? t.lastMessage.body : 'Ingen konversation än'}
                          </p>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>

          <Card padding="md" className="lg:col-span-2">
            {selected ? (
              <>
                <div className="flex items-center gap-2 pb-3 mb-1 border-b border-slate-100">
                  <Avatar name={selected.customer.name} size="sm" />
                  <div>
                    <p className="font-bold text-slate-900 leading-tight">{selected.customer.name}</p>
                    <p className="text-xs text-slate-500">Kunddialog</p>
                  </div>
                </div>
                <ConversationPanel customerId={selected.customer.id} session={session} heightClass="h-[52vh]" />
              </>
            ) : (
              <EmptyState icon="message-square" title="Välj en kund" description="Välj en kund i listan för att se konversationen." className="py-12" />
            )}
          </Card>
        </div>
      </div>
    );
  }

  /* ============================================================
   * CUSTOMER · Ledighet (§7.3)
   * ============================================================ */
  function CustomerHolidayView({ session, onNavigate }) {
    useDb();
    const customer = db.customerForUser(session.userId);
    if (!customer) return <ComingSoonView title="Ledighet" section="§7.3" description="Ingen kund kopplad till denna profil." />;

    const allProperties = db.propertiesForUser(session.userId);
    const holidays = db.holidaysWithSummary(customer.id);

    return (
      <div>
        <PageHeader
          title="Ledighet"
          subtitle="Pausa pass när ert kontor är stängt – t.ex. semester, helger eller ombyggnad."
        />
        <div className="grid lg:grid-cols-5 gap-6">
          <div className="lg:col-span-3 space-y-4">
            <HolidayForm session={session} customer={customer} properties={allProperties} />
          </div>
          <div className="lg:col-span-2 space-y-3">
            <h2 className="text-lg font-bold text-slate-900">Registrerade ledigheter</h2>
            {holidays.length === 0 ? (
              <Card padding="md"><EmptyState icon="calendar" title="Inga registrerade ledigheter" /></Card>
            ) : (
              holidays.map(h => <HolidayCard key={h.id} holiday={h} session={session} isAdmin={false} />)
            )}
          </div>
        </div>
      </div>
    );
  }

  function HolidayForm({ session, customer, properties }) {
    const today = new Date();
    const todayStr = toDateInput(today);
    const [scope, setScope] = useState('all_properties');
    const [propertyIds, setPropertyIds] = useState([]);
    const [startDate, setStartDate] = useState(todayStr);
    const [endDate, setEndDate] = useState(todayStr);
    const [reason, setReason] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const validDates = startDate && endDate && new Date(endDate) >= new Date(startDate);
    const validReason = reason.trim().length >= 3;
    const validScope = scope === 'all_properties' || (propertyIds && propertyIds.length > 0);
    const canSubmit = validDates && validReason && validScope && !submitting;

    const preview = validDates && validScope
      ? db.previewPausedShifts({
          customerId: customer.id,
          scope,
          propertyIds,
          startDate: new Date(startDate),
          endDate: new Date(endDate + 'T23:59:59'),
        })
      : [];

    function togglePropertyId(pid) {
      setPropertyIds(prev => prev.includes(pid) ? prev.filter(x => x !== pid) : [...prev, pid]);
    }

    async function submit() {
      setSubmitting(true);
      const result = await db.createHoliday({
        customerId: customer.id,
        createdByUserId: session.userId,
        scope,
        propertyIds: scope === 'selected' ? propertyIds : [],
        startDate: new Date(startDate),
        endDate: new Date(endDate + 'T23:59:59'),
        reason: reason.trim(),
      });
      setSubmitting(false);
      if (result?.error === 'FORBIDDEN') {
        toast.error('Du kan bara registrera ledighet på objekt du har åtkomst till.');
        return;
      }
      if (result?.error) {
        toast.error(result.message || 'Kunde inte registrera ledigheten.');
        return;
      }
      toast.success(`Ledighet registrerad – ${result.pausedCount} pass pausade.`);
      setScope('all_properties');
      setPropertyIds([]);
      setReason('');
      setStartDate(todayStr);
      setEndDate(todayStr);
    }

    return (
      <Card padding="lg">
        <h3 className="font-bold text-slate-900 mb-1">Ny ledighet</h3>
        <p className="text-xs text-slate-500 mb-5">Pass i perioden pausas automatiskt och städaren får besked.</p>

        <Field label="Objekt">
          <div className="space-y-2">
            <Radio name="scope" value="all_properties" checked={scope === 'all_properties'} onChange={setScope} label={`Alla objekt (${properties.length})`} />
            <Radio name="scope" value="selected" checked={scope === 'selected'} onChange={setScope} label="Välj specifika objekt" />
            {scope === 'selected' && (
              <div className="ml-7 mt-2 space-y-1.5 border-l-2 border-slate-200 pl-4">
                {properties.map(p => (
                  <Checkbox key={p.id} checked={propertyIds.includes(p.id)} onChange={() => togglePropertyId(p.id)} label={p.name} />
                ))}
              </div>
            )}
          </div>
        </Field>

        <div className="grid grid-cols-2 gap-3 mt-4">
          <Field label="Fr.o.m.">
            <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} min={todayStr} />
          </Field>
          <Field label="T.o.m." error={startDate && endDate && new Date(endDate) < new Date(startDate) ? 'Slutdatum måste vara samma eller efter startdatum.' : null}>
            <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} min={startDate || todayStr} />
          </Field>
        </div>

        <div className="mt-4">
          <Field label="Anledning" hint="Minst 3 tecken. Visas för admin och städare.">
            <Textarea rows={2} value={reason} onChange={e => setReason(e.target.value)} placeholder="T.ex. Semester, ombyggnad, helgstängt." />
          </Field>
        </div>

        <div className="mt-5 rounded-lg border border-sky-200 bg-sky-50/50 p-3">
          <div className="flex items-start gap-2 mb-2">
            <Icon name="info" className="w-4 h-4 text-sky-700 mt-0.5" />
            <div>
              <p className="font-semibold text-sm text-sky-900">Förhandsvisning</p>
              {!validDates || !validScope ? (
                <p className="text-xs text-sky-800/80">Välj period och objekt för att se vilka pass som påverkas.</p>
              ) : preview.length === 0 ? (
                <p className="text-xs text-sky-800/80">Inga pass i perioden påverkas.</p>
              ) : (
                <p className="text-xs text-sky-800/90">
                  <strong>{preview.length} pass</strong> kommer att pausas mellan {startDate} och {endDate}.
                </p>
              )}
            </div>
          </div>
          {preview.length > 0 && (
            <div className="mt-2 max-h-40 overflow-y-auto space-y-1 text-xs">
              {preview.map(s => {
                const prop = db.propertyById(s.property_id);
                const cleanerLabel = db.displayCleaner(s.cleaner_user_id, session.user.role);
                return (
                  <div key={s.id} className="flex items-center justify-between gap-2 py-1 px-2 rounded bg-white border border-sky-100">
                    <span className="text-slate-700">{formatDateShort(s.start_at)} · <ShiftTimeDisplay shift={s} /></span>
                    <span className="text-slate-500 truncate">{prop?.name} · {cleanerLabel}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="mt-5 flex justify-end">
          <Button disabled={!canSubmit} icon="pause" onClick={submit}>Registrera ledighet</Button>
        </div>
      </Card>
    );
  }

  function HolidayCard({ holiday, session, isAdmin, isEmployee }) {
    const [confirmOpen, setConfirmOpen] = useState(false);
    const scopeLabel = holiday.scope === 'all_properties'
      ? `Alla objekt (${holiday.properties.length})`
      : `${holiday.properties.length} ${holiday.properties.length === 1 ? 'objekt' : 'objekt'}`;
    const datesPassed = new Date(holiday.end_date).getTime() < Date.now();
    return (
      <Card padding="md">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <p className="font-bold text-slate-900">{formatDateShort(holiday.start_date)} – {formatDateShort(holiday.end_date)}</p>
            <p className="text-xs text-slate-500 mt-0.5">{scopeLabel} · {holiday.pausedCount} pass</p>
          </div>
          <Badge variant={datesPassed ? 'slate' : 'sky'}>{datesPassed ? 'Avslutad' : 'Aktiv'}</Badge>
        </div>
        <p className="text-sm text-slate-700 mt-2 italic">"{holiday.reason}"</p>
        <div className="mt-2 flex flex-wrap gap-1">
          {holiday.properties.map(p => (
            <span key={p.id} className="text-[11px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">{p.name}</span>
          ))}
        </div>
        <p className="text-[11px] text-slate-400 mt-3">Skapad av {holiday.creator?.name || 'okänd'} · {formatDateShort(holiday.created_at)}</p>
        {isAdmin && !datesPassed && (
          <div className="mt-3">
            <Button variant="danger-ghost" icon="trash" onClick={() => setConfirmOpen(true)}>Ta bort ledighet</Button>
            <ConfirmDialog
              open={confirmOpen}
              onClose={() => setConfirmOpen(false)}
              title="Ta bort ledigheten?"
              message={`${holiday.pausedCount} pausade pass kommer att återaktiveras. Städare och admin notifieras.`}
              confirmLabel="Ta bort"
              danger
              onConfirm={async () => {
                const r = await db.deleteHoliday(holiday.id, session.userId);
                if (r?.error) {
                  toast.error(r.message || 'Kunde inte ta bort ledigheten.');
                } else if (r?.ok) {
                  toast.success(`Ledighet borttagen – ${r.restoredCount} pass återaktiverade.`);
                }
                setConfirmOpen(false);
              }}
            />
          </div>
        )}
      </Card>
    );
  }

  /* ============================================================
   * ADMIN · Kunder
   * ============================================================ */
  function AdminEditCustomerModal({ open, onClose, customer, contactUser }) {
    const [name, setName] = useState('');
    const [orgNumber, setOrgNumber] = useState('');
    const [notes, setNotes] = useState('');
    const [contactName, setContactName] = useState('');
    const [contactEmail, setContactEmail] = useState('');
    const [contactPhone, setContactPhone] = useState('');
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);

    useEffect(() => {
      if (!open) return;
      setError('');
      setName(customer.name || '');
      setOrgNumber(customer.org_number || '');
      setNotes(customer.notes || '');
      setContactName(contactUser?.name || '');
      setContactEmail(contactUser?.email || '');
      setContactPhone(contactUser?.phone || '');
    }, [open, customer.id, contactUser?.id]);

    const validName = name.trim().length >= 2;
    const validContactName = contactName.trim().length >= 2;
    const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail.trim());
    const canSubmit = validName && validContactName && validEmail && !saving;

    async function submit() {
      setError('');
      setSaving(true);
      try {
        const r = await db.updateCustomer(customer.id, {
          name,
          orgNumber,
          notes,
          contactName,
          contactEmail,
          contactPhone,
        });
        if (r?.ok) {
          toast.success('Kunduppgifter sparade.');
          onClose();
        } else if (r?.error === 'EMAIL_EXISTS') {
          setError('Mejladressen används redan av en annan användare.');
        } else if (r?.error === 'INVALID_EMAIL') {
          setError('Ange en giltig mejladress för huvudkontakten.');
        } else if (r?.error === 'INVALID_NAME') {
          setError('Företagsnamnet måste vara minst 2 tecken.');
        } else if (r?.error === 'PERSIST_FAILED') {
          setError('Kunde inte spara – försök igen.');
        } else {
          setError('Kunden kunde inte hittas.');
        }
      } finally {
        setSaving(false);
      }
    }

    return (
      <Modal
        open={open}
        onClose={onClose}
        title="Redigera kund"
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={onClose} disabled={saving}>Avbryt</Button>
            <Button variant="primary" disabled={!canSubmit} onClick={submit}>
              {saving ? 'Sparar…' : 'Spara'}
            </Button>
          </>
        }
      >
        <p className="text-xs text-slate-500 mb-4">
          Uppdaterar företagsuppgifter och huvudkontakt. Kundanställda redigeras separat nedan.
        </p>
        <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Företag</h4>
        <Field label="Företagsnamn *" className="mb-3">
          <Input value={name} onChange={e => setName(e.target.value)} placeholder="Acme AB" />
        </Field>
        <Field label="Org.nr" className="mb-3">
          <Input value={orgNumber} onChange={e => setOrgNumber(e.target.value)} placeholder="556677-1122" />
        </Field>
        <Field label="Anteckningar (interna)" className="mb-4">
          <Textarea rows={3} value={notes} onChange={e => setNotes(e.target.value)} placeholder="T.ex. föredrar morgonstädning…" />
        </Field>
        <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Huvudkontakt</h4>
        <Field label="Namn *" className="mb-3">
          <Input value={contactName} onChange={e => setContactName(e.target.value)} placeholder="För- och efternamn" />
        </Field>
        <Field label="Mejl *" className="mb-3">
          <Input type="email" value={contactEmail} onChange={e => setContactEmail(e.target.value)} placeholder="namn@foretag.se" />
        </Field>
        <Field label="Telefon" className="mb-3">
          <Input type="tel" value={contactPhone} onChange={e => setContactPhone(e.target.value)} placeholder="+46 70 123 45 67" />
        </Field>
        {error && <p className="text-xs text-rose-600">{error}</p>}
      </Modal>
    );
  }

  /* ============================================================
   * §7.7 Kontakter & kundanställda
   * ============================================================ */
  function cleanupRandInt(max) {
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      const a = new Uint32Array(1);
      crypto.getRandomValues(a);
      return a[0] % max;
    }
    return Math.floor(Math.random() * max);
  }

  function cleanupGeneratePassword(len = 14) {
    const lower = 'abcdefghijkmnpqrstuvwxyz';
    const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    const digits = '23456789';
    const symbols = '!@#%*?-_';
    const all = lower + upper + digits + symbols;
    const pick = set => set[cleanupRandInt(set.length)];
    const chars = [pick(lower), pick(upper), pick(digits), pick(symbols)];
    while (chars.length < len) chars.push(pick(all));
    for (let i = chars.length - 1; i > 0; i--) {
      const j = cleanupRandInt(i + 1);
      [chars[i], chars[j]] = [chars[j], chars[i]];
    }
    return chars.join('');
  }

  function PasswordInput({ value, onChange, onGenerate, placeholder = 'Minst 8 tecken', error, className = '' }) {
    const [show, setShow] = useState(false);
    return (
      <div className={cx('flex gap-2', className)}>
        <div className="relative flex-1">
          <Input
            type={show ? 'text' : 'password'}
            value={value}
            onChange={onChange}
            placeholder={placeholder}
            autoComplete="new-password"
            error={error}
            className="pr-10"
          />
          <button
            type="button"
            onClick={() => setShow(s => !s)}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            aria-label={show ? 'Dölj lösenord' : 'Visa lösenord'}
          >
            <Icon name={show ? 'eye-off' : 'eye'} className="w-4 h-4" />
          </button>
        </div>
        {onGenerate && (
          <Button variant="outline" icon="sparkles" onClick={onGenerate} aria-label="Generera lösenord">Generera</Button>
        )}
      </div>
    );
  }

  function AddCustomerEmployeeModal({ open, onClose, customer, properties, session, editEmployee = null }) {
    const isEdit = !!editEmployee;
    const provisioning = !isEdit && session?.user?.role === 'admin' && !!window.SUPABASE_ENABLED;

    const blankEntry = () => ({
      key: Math.random().toString(36).slice(2),
      name: '', email: '', phone: '',
      password: provisioning ? cleanupGeneratePassword() : '',
      scope: 'all_properties', propertyIds: [],
      error: '',
    });

    const [entries, setEntries] = useState([blankEntry()]);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
      if (!open) return;
      setError('');
      setSaving(false);
      if (editEmployee) {
        setEntries([{
          key: editEmployee.id,
          name: editEmployee.user?.name || '',
          email: editEmployee.user?.email || '',
          phone: editEmployee.user?.phone || '',
          password: '',
          scope: editEmployee.scope,
          propertyIds: editEmployee.properties?.map(p => p.id) || [],
          error: '',
        }]);
      } else {
        setEntries([blankEntry()]);
      }
    }, [open, editEmployee?.id]);

    function patchEntry(key, patch) {
      setEntries(prev => prev.map(en => en.key === key ? { ...en, ...patch } : en));
    }
    function toggleEntryProperty(key, pid) {
      setEntries(prev => prev.map(en => en.key === key
        ? { ...en, propertyIds: en.propertyIds.includes(pid) ? en.propertyIds.filter(x => x !== pid) : [...en.propertyIds, pid] }
        : en));
    }
    function addEntry() { setEntries(prev => [...prev, blankEntry()]); }
    function removeEntry(key) { setEntries(prev => prev.length > 1 ? prev.filter(en => en.key !== key) : prev); }

    function entryValid(en) {
      const validName = en.name.trim().length >= 2;
      const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(en.email.trim());
      const validScope = en.scope === 'all_properties' || en.propertyIds.length > 0;
      const validPwd = !provisioning || (en.password || '').length >= 8;
      return validName && validEmail && validScope && validPwd;
    }
    const canSubmit = entries.length > 0 && entries.every(entryValid);

    function errorLabel(code) {
      switch (code) {
        case 'EMAIL_EXISTS': return 'Mejladressen används redan.';
        case 'INVALID_EMAIL': return 'Ogiltig mejladress.';
        case 'INVALID_NAME': return 'Namn måste vara minst 2 tecken.';
        case 'WEAK_PASSWORD': return 'Lösenordet måste vara minst 8 tecken.';
        case 'PERSIST_FAILED': return 'Kunde inte spara till databasen.';
        default: return 'Kunde inte spara.';
      }
    }

    async function submit() {
      setError('');
      setSaving(true);
      try {
        if (isEdit) {
          const en = entries[0];
          try {
            db.updateCustomerEmployee(editEmployee.id, {
              name: en.name, email: en.email, phone: en.phone, scope: en.scope,
              selectedPropertyIds: en.scope === 'selected' ? en.propertyIds : [],
            });
            toast.success('Kundanställd uppdaterad.');
            onClose();
          } catch (e) {
            patchEntry(en.key, { error: e.message === 'EMAIL_EXISTS' ? 'Mejladressen används redan.' : 'Kunde inte spara.' });
          }
          return;
        }

        let added = 0;
        const remaining = [];
        for (const en of entries) {
          const r = await db.addCustomerEmployee({
            customerId: customer.id,
            name: en.name, email: en.email, phone: en.phone,
            password: en.password,
            scope: en.scope,
            selectedPropertyIds: en.scope === 'selected' ? en.propertyIds : [],
            adminUserId: session.userId,
            provision: provisioning,
          });
          if (r?.ok) {
            added++;
          } else {
            remaining.push({ ...en, error: errorLabel(r?.error) });
          }
        }

        if (added > 0) {
          toast.success(provisioning
            ? `${added} kundanställd${added === 1 ? '' : 'a'} skapad${added === 1 ? '' : 'a'} med inloggning.`
            : `${added} kundanställd${added === 1 ? '' : 'a'} tillagd${added === 1 ? '' : 'a'}.`);
        }

        if (remaining.length > 0) {
          setEntries(remaining);
          setError(`${remaining.length} av ${entries.length} kunde inte sparas – se markeringar nedan.`);
        } else {
          onClose();
        }
      } finally {
        setSaving(false);
      }
    }

    const multiple = !isEdit;

    return (
      <Modal
        open={open}
        onClose={onClose}
        title={isEdit ? 'Redigera kundanställd' : 'Lägg till kundanställda'}
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={onClose} disabled={saving}>Avbryt</Button>
            <Button variant="primary" disabled={!canSubmit || saving} loading={saving} onClick={submit}>
              {isEdit ? 'Spara' : (entries.length > 1 ? `Skapa ${entries.length} konton` : 'Lägg till')}
            </Button>
          </>
        }
      >
        <p className="text-xs text-slate-500 mb-4">
          {customer.name} · kundanställda kan logga in och följa pass (endast läsbehörighet).
          {provisioning
            ? ' Ange ett lösenord per person – de kan byta det själva efter första inloggningen.'
            : ' Inbjudan/inloggning hanteras av admin.'}
        </p>

        <div className="space-y-4">
          {entries.map((en, idx) => (
            <div key={en.key} className={cx('rounded-2xl border p-4', en.error ? 'border-rose-300 bg-rose-50/40' : 'border-slate-200')}>
              {multiple && (
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-xs font-bold uppercase tracking-wide text-slate-500">Kundanställd {idx + 1}</h4>
                  {entries.length > 1 && (
                    <Button variant="danger-ghost" size="sm" iconOnly icon="trash" aria-label="Ta bort rad" onClick={() => removeEntry(en.key)} />
                  )}
                </div>
              )}
              <div className="grid sm:grid-cols-2 gap-3">
                <Field label="Namn *">
                  <Input value={en.name} onChange={e => patchEntry(en.key, { name: e.target.value, error: '' })} placeholder="För- och efternamn" />
                </Field>
                <Field label="Mejl *">
                  <Input type="email" value={en.email} onChange={e => patchEntry(en.key, { email: e.target.value, error: '' })} placeholder="namn@foretag.se" />
                </Field>
              </div>
              <div className="grid sm:grid-cols-2 gap-3 mt-3">
                <Field label="Telefon">
                  <Input type="tel" value={en.phone} onChange={e => patchEntry(en.key, { phone: e.target.value })} placeholder="+46 70 123 45 67" />
                </Field>
                {provisioning && (
                  <Field label="Lösenord *" hint="Minst 8 tecken">
                    <PasswordInput
                      value={en.password}
                      onChange={e => patchEntry(en.key, { password: e.target.value, error: '' })}
                      onGenerate={() => patchEntry(en.key, { password: cleanupGeneratePassword(), error: '' })}
                    />
                  </Field>
                )}
              </div>
              <Field label="Åtkomst till objekt *" className="mt-3">
                <div className="space-y-2">
                  <Radio name={`emp_scope_${en.key}`} value="all_properties" checked={en.scope === 'all_properties'} onChange={v => patchEntry(en.key, { scope: v })} label={`Alla objekt (${properties.length})`} />
                  <Radio name={`emp_scope_${en.key}`} value="selected" checked={en.scope === 'selected'} onChange={v => patchEntry(en.key, { scope: v })} label="Valda objekt" />
                  {en.scope === 'selected' && (
                    <div className="ml-7 mt-2 space-y-1.5 border-l-2 border-slate-200 pl-4">
                      {properties.length === 0 && <p className="text-xs text-slate-400">Inga objekt ännu.</p>}
                      {properties.map(p => (
                        <Checkbox key={p.id} checked={en.propertyIds.includes(p.id)} onChange={() => toggleEntryProperty(en.key, p.id)} label={p.name} />
                      ))}
                    </div>
                  )}
                </div>
              </Field>
              {en.error && <p className="text-xs text-rose-600 mt-3">{en.error}</p>}
            </div>
          ))}
        </div>

        {multiple && (
          <Button variant="ghost" size="sm" icon="plus" className="mt-3" onClick={addEntry}>
            Lägg till ytterligare en
          </Button>
        )}

        {error && <p className="text-sm text-rose-600 mt-4">{error}</p>}
      </Modal>
    );
  }

  function ResetPasswordModal({ open, onClose, employee }) {
    const [password, setPassword] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
      if (!open) return;
      setPassword(cleanupGeneratePassword());
      setError('');
      setSaving(false);
    }, [open, employee?.id]);

    const valid = (password || '').length >= 8;

    async function submit() {
      if (!employee) return;
      setSaving(true);
      setError('');
      try {
        const r = await db.setCustomerEmployeePassword(employee.id, password);
        if (r?.ok) {
          toast.success(`Nytt lösenord satt för ${employee.user?.name || 'kundanställd'}.`);
          onClose();
        } else if (r?.error === 'WEAK_PASSWORD') {
          setError('Lösenordet måste vara minst 8 tecken.');
        } else {
          setError('Kunde inte uppdatera lösenordet. Försök igen.');
        }
      } finally {
        setSaving(false);
      }
    }

    return (
      <Modal
        open={open}
        onClose={onClose}
        title="Återställ lösenord"
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={onClose} disabled={saving}>Avbryt</Button>
            <Button variant="primary" icon="key" disabled={!valid || saving} loading={saving} onClick={submit}>Spara lösenord</Button>
          </>
        }
      >
        <p className="text-xs text-slate-500 mb-4">
          Sätter ett nytt lösenord för <span className="font-semibold text-slate-700">{employee?.user?.name}</span> ({employee?.user?.email}).
          Personen kan byta det själv efteråt.
        </p>
        <Field label="Nytt lösenord *" hint="Minst 8 tecken">
          <PasswordInput
            value={password}
            onChange={e => { setPassword(e.target.value); setError(''); }}
            onGenerate={() => { setPassword(cleanupGeneratePassword()); setError(''); }}
          />
        </Field>
        {error && <p className="text-xs text-rose-600 mt-3">{error}</p>}
      </Modal>
    );
  }

  function AdminCustomerEmployeesCard({ customer, properties, session }) {
    useDb();
    const [modalOpen, setModalOpen] = useState(false);
    const [editTarget, setEditTarget] = useState(null);
    const [removeTarget, setRemoveTarget] = useState(null);
    const [pwTarget, setPwTarget] = useState(null);
    const canManagePasswords = session?.user?.role === 'admin' && !!window.SUPABASE_ENABLED;
    const employees = db.customerEmployeesForCustomer(customer.id);

    return (
      <>
        <Card padding="md">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold text-slate-900">Kundanställda</h3>
            <Button variant="ghost" size="sm" icon="plus" onClick={() => { setEditTarget(null); setModalOpen(true); }}>
              Lägg till
            </Button>
          </div>
          {employees.length === 0 ? (
            <EmptyState icon="users" title="Inga kundanställda" description="Lägg till medarbetare som ska kunna följa pass och avvikelser." />
          ) : (
            <ul className="divide-y divide-slate-100 -mx-2">
              {employees.map(e => (
                <li key={e.id} className="px-2 py-3 flex items-start gap-3">
                  <Avatar size="sm" name={e.user?.name} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-900 truncate">{e.user?.name}</p>
                    <p className="text-xs text-slate-500 truncate">{e.user?.email}</p>
                    {e.user?.phone && <p className="text-xs text-slate-400">{e.user.phone}</p>}
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      <Badge variant="slate">{e.scope === 'all_properties' ? 'Alla objekt' : `${e.properties.length} objekt`}</Badge>
                      {e.scope === 'selected' && e.properties.map(p => (
                        <Badge key={p.id} variant="brand">{p.name}</Badge>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {canManagePasswords && (
                      <Button variant="ghost" size="sm" iconOnly icon="key" aria-label="Återställ lösenord" onClick={() => setPwTarget(e)} />
                    )}
                    <Button variant="ghost" size="sm" iconOnly icon="edit" aria-label="Redigera" onClick={() => { setEditTarget(e); setModalOpen(true); }} />
                    <Button variant="danger-ghost" size="sm" iconOnly icon="trash" aria-label="Ta bort" onClick={() => setRemoveTarget(e)} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <AddCustomerEmployeeModal
          open={modalOpen}
          onClose={() => { setModalOpen(false); setEditTarget(null); }}
          customer={customer}
          properties={properties}
          session={session}
          editEmployee={editTarget}
        />

        <ConfirmDialog
          open={!!removeTarget}
          onClose={() => setRemoveTarget(null)}
          title="Ta bort kundanställd?"
          message={removeTarget ? `${removeTarget.user?.name} förlorar åtkomst till ${customer.name}. Kontot inaktiveras.` : ''}
          confirmLabel="Ta bort"
          danger
          onConfirm={() => {
            db.removeCustomerEmployee(removeTarget.id);
            toast.success('Kundanställd borttagen.');
            setRemoveTarget(null);
          }}
        />

        <ResetPasswordModal
          open={!!pwTarget}
          onClose={() => setPwTarget(null)}
          employee={pwTarget}
        />
      </>
    );
  }

  function AdminPropertyContactsTab({ property, customer, session }) {
    useDb();
    const employees = db.customerEmployeesForProperty(property.id);
    const assignedCleaners = db.propertyCleanersForProperty(property.id);
    const allCleaners = db.state.users.filter(u => u.role === 'cleaner' && u.active);
    const assignedKey = assignedCleaners.map(pc => pc.cleaner_user_id).sort().join(',');
    const [cleanerIds, setCleanerIds] = useState(() => assignedCleaners.map(pc => pc.cleaner_user_id));
    const dirty = JSON.stringify([...cleanerIds].sort()) !== JSON.stringify([...assignedKey.split(',')].filter(Boolean).sort());

    useEffect(() => {
      setCleanerIds(assignedCleaners.map(pc => pc.cleaner_user_id));
    }, [property.id, assignedKey]);

    function toggleCleaner(uid) {
      setCleanerIds(prev => prev.includes(uid) ? prev.filter(x => x !== uid) : [...prev, uid]);
    }

    return (
      <div className="space-y-4">
        <Card padding="md">
          <h3 className="font-bold text-slate-900 mb-1">Kundanställda med åtkomst</h3>
          <p className="text-xs text-slate-500 mb-4">Medarbetare hos {customer.name} som kan se pass på det här objektet.</p>
          {employees.length === 0 ? (
            <p className="text-sm text-slate-500">Ingen kundanställd har åtkomst till det här objektet. Lägg till under kundens sida.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {employees.map(e => (
                <li key={e.id} className="py-3 flex items-center gap-3">
                  <Avatar size="sm" name={e.user?.name} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-900">{e.user?.name}</p>
                    <p className="text-xs text-slate-500">{e.user?.email}</p>
                  </div>
                  <Badge variant={e.scope === 'all_properties' ? 'emerald' : 'brand'}>
                    {e.scope === 'all_properties' ? 'Alla objekt' : 'Detta objekt'}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
          <Button variant="outline" size="sm" className="mt-4" icon="users" onClick={() => { location.hash = `#/admin/kunder/${customer.id}`; }}>
            Hantera alla kontakter
          </Button>
        </Card>

        <Card padding="md">
          <h3 className="font-bold text-slate-900 mb-1">Tilldelade städare (baspool)</h3>
          <p className="text-xs text-slate-500 mb-4">Förslag vid schemaläggning – admin kan tilldela vem som helst per pass.</p>
          <ul className="space-y-2 mb-4">
            {allCleaners.map(c => (
              <li key={c.id}>
                <Checkbox
                  checked={cleanerIds.includes(c.id)}
                  onChange={() => toggleCleaner(c.id)}
                  label={c.name}
                />
              </li>
            ))}
          </ul>
          {dirty && (
            <Button variant="primary" size="sm" onClick={async () => {
              const r = await db.setPropertyCleaners(property.id, cleanerIds);
              if (r?.error) {
                toast.error(r.message || 'Kunde inte spara städarpoolen.');
                return;
              }
              toast.success('Städarpool uppdaterad.');
            }}>Spara städare</Button>
          )}
        </Card>
      </div>
    );
  }

  const ADMIN_ACCENT_PRESETS = [
    { name: 'Orange', hex: '#f2603c' },
    { name: 'Korall', hex: '#f45b5b' },
    { name: 'Grön', hex: '#10b981' },
    { name: 'Lila', hex: '#8b5cf6' },
    { name: 'Cyan', hex: '#06b6d4' },
  ];
  const ADMIN_ROUND_OPTIONS = ['Skarp', 'Standard', 'Rundad'];

  function accentHexToPresetName(hex) {
    const p = ADMIN_ACCENT_PRESETS.find(x => x.hex.toLowerCase() === (hex || '').toLowerCase());
    return p ? p.name : 'Orange';
  }

  function accentPresetToHex(name) {
    return ADMIN_ACCENT_PRESETS.find(x => x.name === name)?.hex || '#f2603c';
  }

  function applyOrgThemeToDocument(themeRound, accentHex) {
    if (typeof window.applyCleanupTweaks === 'function') {
      window.applyCleanupTweaks({
        round: themeRound || 'Standard',
        accent: accentHexToPresetName(accentHex),
      });
      try {
        localStorage.setItem('cleanup_tweaks_v1', JSON.stringify({
          round: themeRound || 'Standard',
          accent: accentHexToPresetName(accentHex),
        }));
      } catch (_) {}
    }
  }

  function ChangePasswordCard({ className = '' }) {
    const [pw1, setPw1] = useState('');
    const [pw2, setPw2] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    if (!window.SUPABASE_ENABLED || !window.dbAuth) return null;

    const valid = pw1.length >= 8 && pw1 === pw2;

    async function submit() {
      setError('');
      if (pw1.length < 8) { setError('Lösenordet måste vara minst 8 tecken.'); return; }
      if (pw1 !== pw2) { setError('Lösenorden matchar inte.'); return; }
      setSaving(true);
      try {
        const r = await window.dbAuth.changeOwnPassword({ password: pw1 });
        if (r?.ok) {
          toast.success('Lösenordet uppdaterat.');
          setPw1(''); setPw2('');
        } else if (r?.code === 'WEAK_PASSWORD') {
          setError('Lösenordet måste vara minst 8 tecken.');
        } else if (r?.code === 'SAME_PASSWORD') {
          setError('Välj ett lösenord som skiljer sig från det nuvarande.');
        } else {
          setError('Kunde inte uppdatera lösenordet. Försök igen.');
        }
      } finally {
        setSaving(false);
      }
    }

    return (
      <Card padding="md" className={className}>
        <h3 className="font-bold text-slate-900 mb-1">Byt lösenord</h3>
        <p className="text-xs text-slate-500 mb-4">Uppdatera ditt inloggningslösenord. Minst 8 tecken.</p>
        <Field label="Nytt lösenord *" className="mb-3">
          <PasswordInput value={pw1} onChange={e => { setPw1(e.target.value); setError(''); }} placeholder="Minst 8 tecken" />
        </Field>
        <Field label="Bekräfta lösenord *" className="mb-3">
          <PasswordInput value={pw2} onChange={e => { setPw2(e.target.value); setError(''); }} placeholder="Upprepa lösenord" />
        </Field>
        {error && <p className="text-xs text-rose-600 mb-3">{error}</p>}
        <Button variant="primary" icon="key" disabled={!valid || saving} loading={saving} onClick={submit}>
          {saving ? 'Uppdaterar…' : 'Uppdatera lösenord'}
        </Button>
      </Card>
    );
  }

  function AdminSettingsView({ session }) {
    useDb();
    const org = db.organizationForUser(session.userId);
    const [orgName, setOrgName] = useState('');
    const [themeRound, setThemeRound] = useState('Standard');
    const [accentName, setAccentName] = useState('Orange');
    const [userName, setUserName] = useState('');
    const [userEmail, setUserEmail] = useState('');
    const [userPhone, setUserPhone] = useState('');
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);

    useEffect(() => {
      if (!org) return;
      setOrgName(org.name || '');
      setThemeRound(org.theme_round || 'Standard');
      setAccentName(accentHexToPresetName(org.accent_color));
      setUserName(session.user.name || '');
      setUserEmail(session.user.email || '');
      setUserPhone(session.user.phone || '');
      setError('');
      applyOrgThemeToDocument(org.theme_round, org.accent_color);
    }, [org?.id, org?.name, org?.theme_round, org?.accent_color, session.user.id, session.user.name, session.user.email, session.user.phone]);

    if (!org) {
      return <ComingSoonView title="Inställningar" section="§8" description="Ingen organisation kopplad till din profil." />;
    }

    const dirty = orgName !== (org.name || '')
      || themeRound !== (org.theme_round || 'Standard')
      || accentName !== accentHexToPresetName(org.accent_color)
      || userName !== (session.user.name || '')
      || userEmail !== (session.user.email || '')
      || userPhone !== (session.user.phone || '');

    const validOrg = orgName.trim().length >= 2;
    const validUser = userName.trim().length >= 2 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(userEmail.trim());

    async function save() {
      setError('');
      setSaving(true);
      try {
        const r = await db.updateAdminSettings(session.userId, {
          orgName,
          themeRound,
          accentColorHex: accentPresetToHex(accentName),
          userName,
          userEmail,
          userPhone,
        });
        if (r?.ok) {
          applyOrgThemeToDocument(themeRound, accentPresetToHex(accentName));
          toast.success('Inställningarna sparade.');
        } else if (r?.error === 'EMAIL_EXISTS') {
          setError('Mejladressen används redan av en annan användare.');
        } else if (r?.error === 'INVALID_EMAIL') {
          setError('Ange en giltig mejladress.');
        } else if (r?.error === 'INVALID_ORG_NAME' || r?.error === 'INVALID_NAME') {
          setError('Namn måste vara minst 2 tecken.');
        } else if (r?.error === 'PERSIST_FAILED') {
          setError('Kunde inte spara – försök igen.');
        } else {
          setError('Kunde inte spara inställningarna.');
        }
      } finally {
        setSaving(false);
      }
    }

    return (
      <div>
        <PageHeader
          title="Inställningar"
          subtitle="Företagsuppgifter och din kontaktprofil för kunder (48h-avbokning)."
        />

        <div className="grid lg:grid-cols-2 gap-6 max-w-4xl">
          <Card padding="md">
            <h3 className="font-bold text-slate-900 mb-1">Företag</h3>
            <p className="text-xs text-slate-500 mb-4">Visas internt och som avsändare i kommunikation.</p>
            <Field label="Företagsnamn *" className="mb-4">
              <Input value={orgName} onChange={e => setOrgName(e.target.value)} placeholder="CleanUp" />
            </Field>
            <Field label="Hörnradie" className="mb-4">
              <div className="grid grid-cols-3 gap-1.5">
                {ADMIN_ROUND_OPTIONS.map(opt => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => setThemeRound(opt)}
                    className={cx(
                      'h-9 text-xs font-semibold rounded-lg border transition-colors',
                      themeRound === opt
                        ? 'bg-brand-600 border-brand-600 text-white'
                        : 'border-slate-200 text-slate-600 hover:border-brand-300',
                    )}
                  >{opt}</button>
                ))}
              </div>
            </Field>
            <Field label="Accentfärg">
              <div className="grid grid-cols-5 gap-1.5">
                {ADMIN_ACCENT_PRESETS.map(opt => (
                  <button
                    key={opt.name}
                    type="button"
                    title={opt.name}
                    onClick={() => setAccentName(opt.name)}
                    className={cx(
                      'h-9 rounded-lg border-2 transition-transform',
                      accentName === opt.name ? 'border-slate-900 scale-110' : 'border-transparent hover:scale-105',
                    )}
                    style={{ background: opt.hex }}
                    aria-label={opt.name}
                  />
                ))}
              </div>
            </Field>
          </Card>

          <Card padding="md">
            <h3 className="font-bold text-slate-900 mb-1">Din kontaktprofil</h3>
            <p className="text-xs text-slate-500 mb-4">
              Kunder inom 48 timmar ser dessa uppgifter när de inte kan avboka själva.
            </p>
            <Field label="Namn *" className="mb-3">
              <Input value={userName} onChange={e => setUserName(e.target.value)} />
            </Field>
            <Field label="Mejl *" className="mb-3">
              <Input type="email" value={userEmail} onChange={e => setUserEmail(e.target.value)} />
            </Field>
            <Field label="Telefon" className="mb-3">
              <Input type="tel" value={userPhone} onChange={e => setUserPhone(e.target.value)} placeholder="+46 70 123 45 67" />
            </Field>
            <Card padding="sm" className="border-brand-100 bg-brand-50/40">
              <p className="text-xs text-brand-900">
                Förhandsvisning för kund: {userName || '—'} · {userEmail || '—'} · {userPhone || 'ingen telefon angiven'}
              </p>
            </Card>
          </Card>
        </div>

        {error && <p className="text-sm text-rose-600 mt-4 max-w-4xl">{error}</p>}

        <div className="flex justify-end gap-2 mt-6 max-w-4xl">
          {dirty && (
            <Button variant="ghost" disabled={saving} onClick={() => {
              setOrgName(org.name || '');
              setThemeRound(org.theme_round || 'Standard');
              setAccentName(accentHexToPresetName(org.accent_color));
              setUserName(session.user.name || '');
              setUserEmail(session.user.email || '');
              setUserPhone(session.user.phone || '');
              setError('');
            }}>Återställ</Button>
          )}
          <Button variant="primary" icon="check" disabled={!dirty || !validOrg || !validUser || saving} onClick={save}>
            {saving ? 'Sparar…' : 'Spara inställningar'}
          </Button>
        </div>

        <ChangePasswordCard className="mt-6 max-w-md" />
      </div>
    );
  }

  function CustomerSettingsView({ session }) {
    useDb();
    const customer = db.customerForUser(session.userId);
    if (!customer) return <ComingSoonView title="Inställningar" section="§7.7" description="Ingen kund kopplad till denna profil." />;

    const isHuvudkontakt = session.user.role === 'customer';
    const properties = db.propertiesForUser(session.userId);
    const main = db.userById(customer.primary_contact_user_id);

    if (!isHuvudkontakt) {
      const ce = db.state.customer_employees.find(x => x.user_id === session.userId);
      const myProps = db.propertiesForUser(session.userId);
      return (
        <div>
          <PageHeader title="Inställningar" subtitle="Din profil som kundanställd" />
          <Card padding="md" className="mb-4">
            <h3 className="font-bold text-slate-900 mb-3">Din profil</h3>
            <dl className="text-sm space-y-2">
              <div><dt className="text-xs text-slate-500">Namn</dt><dd className="font-medium">{session.user.name}</dd></div>
              <div><dt className="text-xs text-slate-500">Mejl</dt><dd className="font-medium">{session.user.email}</dd></div>
              {session.user.phone && (
                <div><dt className="text-xs text-slate-500">Telefon</dt><dd className="font-medium">{session.user.phone}</dd></div>
              )}
              <div><dt className="text-xs text-slate-500">Företag</dt><dd className="font-medium">{customer.name}</dd></div>
              <div><dt className="text-xs text-slate-500">Åtkomst</dt><dd className="font-medium">{ce?.scope === 'all_properties' ? 'Alla objekt' : `${myProps.length} valda objekt`}</dd></div>
            </dl>
          </Card>
          <Card padding="md" className="border-slate-200 bg-slate-50/60 mb-4">
            <p className="text-sm text-slate-600">Som kundanställd har du läsbehörighet. Be huvudkontakten ({main?.name}) om du behöver fler objekt eller vill lägga till kollegor.</p>
          </Card>
          <ChangePasswordCard />
        </div>
      );
    }

    return (
      <div>
        <PageHeader
          title="Inställningar"
          subtitle={`${customer.name} · hantera kundanställda och kontaktuppgifter`}
        />
        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <AdminCustomerEmployeesCard customer={customer} properties={properties} session={session} />
          </div>
          <div>
            <Card padding="md">
              <h3 className="font-bold text-slate-900 mb-3">Huvudkontakt (du)</h3>
              <div className="flex items-center gap-3 mb-3">
                <Avatar name={session.user.name} />
                <div>
                  <p className="font-semibold text-slate-900">{session.user.name}</p>
                  <p className="text-xs text-slate-500">{session.user.email}</p>
                </div>
              </div>
              <p className="text-xs text-slate-500">Org.nr {customer.org_number}. Ändring av företagsuppgifter görs via admin på CleanUp.</p>
            </Card>
            <ChangePasswordCard className="mt-4" />
            {customer.notes && (
              <Card padding="md" className="mt-4">
                <h3 className="font-bold text-slate-900 mb-2">Anteckningar från admin</h3>
                <p className="text-sm text-slate-600">{customer.notes}</p>
              </Card>
            )}
          </div>
        </div>
      </div>
    );
  }

  function CreateCustomerModal({ open, onClose, session, onCreated }) {
    const org = db.organizationForUser(session.userId);
    const [name, setName] = useState('');
    const [orgNumber, setOrgNumber] = useState('');
    const [notes, setNotes] = useState('');
    const [contactName, setContactName] = useState('');
    const [contactEmail, setContactEmail] = useState('');
    const [contactPhone, setContactPhone] = useState('');
    const [addProperty, setAddProperty] = useState(true);
    const [propName, setPropName] = useState('');
    const [propAddress, setPropAddress] = useState('');
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);

    useEffect(() => {
      if (!open) return;
      setName('');
      setOrgNumber('');
      setNotes('');
      setContactName('');
      setContactEmail('');
      setContactPhone('');
      setAddProperty(true);
      setPropName('');
      setPropAddress('');
      setError('');
    }, [open]);

    const valid = name.trim().length >= 2
      && contactName.trim().length >= 2
      && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail.trim())
      && (!addProperty || propName.trim().length >= 2);

    async function submit() {
      if (!org) {
        setError('Ingen organisation hittades.');
        return;
      }
      setError('');
      setSaving(true);
      try {
        const r = await db.createCustomer({
          orgId: org.id,
          name,
          orgNumber,
          notes,
          contactName,
          contactEmail,
          contactPhone,
          adminUserId: session.userId,
          firstProperty: addProperty && propName.trim()
            ? { name: propName, address: propAddress }
            : null,
        });
        if (r?.ok) {
          toast.success(r.property
            ? `Kund och objekt "${r.property.name}" skapade.`
            : 'Kund skapad.');
          onClose();
          onCreated && onCreated(r.customer.id);
        } else if (r?.error === 'EMAIL_EXISTS') {
          setError('Mejladressen används redan.');
        } else if (r?.error === 'INVALID_EMAIL') {
          setError('Ange en giltig mejladress för huvudkontakten.');
        } else if (r?.error === 'INVALID_NAME' || r?.error === 'INVALID_CONTACT_NAME') {
          setError('Företags- och kontaktnamn måste vara minst 2 tecken.');
        } else if (r?.error === 'PERSIST_FAILED') {
          setError('Kunde inte spara till databasen – försök igen.');
        } else {
          setError('Kunde inte skapa kunden.');
        }
      } finally {
        setSaving(false);
      }
    }

    return (
      <Modal
        open={open}
        onClose={onClose}
        title="Ny kund"
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={onClose} disabled={saving}>Avbryt</Button>
            <Button variant="primary" icon="plus" disabled={!valid || saving} onClick={submit}>
              {saving ? 'Skapar…' : 'Skapa kund'}
            </Button>
          </>
        }
      >
        <p className="text-xs text-slate-500 mb-4">
          Skapar företag och huvudkontakt. Inloggning aktiveras när Supabase Auth-inbjudan är på plats (tillfälligt demo-lösenord i databasen).
        </p>
        <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Företag</h4>
        <Field label="Företagsnamn *" className="mb-3">
          <Input value={name} onChange={e => setName(e.target.value)} placeholder="Acme AB" />
        </Field>
        <Field label="Org.nr" className="mb-3">
          <Input value={orgNumber} onChange={e => setOrgNumber(e.target.value)} placeholder="556677-1122" />
        </Field>
        <Field label="Anteckningar" className="mb-4">
          <Textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} />
        </Field>
        <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Huvudkontakt</h4>
        <Field label="Namn *" className="mb-3">
          <Input value={contactName} onChange={e => setContactName(e.target.value)} />
        </Field>
        <Field label="Mejl *" className="mb-3">
          <Input type="email" value={contactEmail} onChange={e => setContactEmail(e.target.value)} />
        </Field>
        <Field label="Telefon" className="mb-4">
          <Input type="tel" value={contactPhone} onChange={e => setContactPhone(e.target.value)} />
        </Field>
        <Checkbox
          label="Lägg till första objekt nu"
          checked={addProperty}
          onChange={setAddProperty}
        />
        {addProperty && (
          <div className="mt-3 pl-1 border-l-2 border-slate-200 ml-1 space-y-3">
            <Field label="Objektnamn *">
              <Input value={propName} onChange={e => setPropName(e.target.value)} placeholder="Huvudkontor" />
            </Field>
            <Field label="Adress">
              <Input value={propAddress} onChange={e => setPropAddress(e.target.value)} placeholder="Gatuadress" />
            </Field>
          </div>
        )}
        {error && <p className="text-xs text-rose-600 mt-3">{error}</p>}
      </Modal>
    );
  }

  function CreatePropertyModal({ open, onClose, customer, session, onCreated }) {
    const [name, setName] = useState('');
    const [address, setAddress] = useState('');
    const [areaSqm, setAreaSqm] = useState('');
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);

    useEffect(() => {
      if (!open) return;
      setName('');
      setAddress('');
      setAreaSqm('');
      setError('');
    }, [open]);

    async function submit() {
      setError('');
      setSaving(true);
      try {
        const r = await db.createProperty({
          customerId: customer.id,
          name,
          address,
          areaSqm: areaSqm.trim() === '' ? null : areaSqm,
        });
        if (r?.ok) {
          toast.success(`Objektet "${r.property.name}" skapat.`);
          onClose();
          onCreated && onCreated(r.property.id);
        } else if (r?.error === 'INVALID_NAME') {
          setError('Objektnamnet måste vara minst 2 tecken.');
        } else if (r?.error === 'INVALID_AREA') {
          setError('Yta måste vara ett positivt tal.');
        } else if (r?.error === 'PERSIST_FAILED') {
          setError('Kunde inte spara – försök igen.');
        } else {
          setError('Kunden kunde inte hittas.');
        }
      } finally {
        setSaving(false);
      }
    }

    const valid = name.trim().length >= 2;

    return (
      <Modal
        open={open}
        onClose={onClose}
        title="Nytt objekt"
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={onClose} disabled={saving}>Avbryt</Button>
            <Button variant="primary" icon="plus" disabled={!valid || saving} onClick={submit}>
              {saving ? 'Skapar…' : 'Skapa objekt'}
            </Button>
          </>
        }
      >
        <p className="text-xs text-slate-500 mb-4">{customer.name} · du kan lägga till städschema och pass efteråt.</p>
        <Field label="Objektnamn *" className="mb-3">
          <Input value={name} onChange={e => setName(e.target.value)} placeholder="T.ex. HQ" />
        </Field>
        <Field label="Adress" className="mb-3">
          <Input value={address} onChange={e => setAddress(e.target.value)} />
        </Field>
        <Field label="Yta (kvm)" hint="Valfritt">
          <Input type="number" min="0" value={areaSqm} onChange={e => setAreaSqm(e.target.value)} />
        </Field>
        {error && <p className="text-xs text-rose-600 mt-2">{error}</p>}
      </Modal>
    );
  }

  function AdminUserPasswordModal({ open, onClose, user, onReset }) {
    const [password, setPassword] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
      if (!open) return;
      setPassword(cleanupGeneratePassword());
      setError('');
      setSaving(false);
    }, [open, user?.id]);

    const valid = (password || '').length >= 8;

    async function submit() {
      if (!user) return;
      setSaving(true);
      setError('');
      try {
        const r = await onReset(user.id, password);
        if (r?.ok) {
          toast.success(`Nytt lösenord satt för ${user.name || 'användaren'}.`);
          onClose();
        } else if (r?.error === 'WEAK_PASSWORD') {
          setError('Lösenordet måste vara minst 8 tecken.');
        } else {
          setError('Kunde inte uppdatera lösenordet. Försök igen.');
        }
      } finally {
        setSaving(false);
      }
    }

    return (
      <Modal
        open={open}
        onClose={onClose}
        title="Återställ lösenord"
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={onClose} disabled={saving}>Avbryt</Button>
            <Button variant="primary" icon="key" disabled={!valid || saving} loading={saving} onClick={submit}>Spara lösenord</Button>
          </>
        }
      >
        <p className="text-xs text-slate-500 mb-4">
          Sätter ett nytt lösenord för <span className="font-semibold text-slate-700">{user?.name}</span> ({user?.email}).
          Personen kan byta det själv efteråt.
        </p>
        <Field label="Nytt lösenord *" hint="Minst 8 tecken">
          <PasswordInput
            value={password}
            onChange={e => { setPassword(e.target.value); setError(''); }}
            onGenerate={() => { setPassword(cleanupGeneratePassword()); setError(''); }}
          />
        </Field>
        {error && <p className="text-xs text-rose-600 mt-3">{error}</p>}
      </Modal>
    );
  }

  function AddCleanerModal({ open, onClose, session, onCreated }) {
    const provisioning = session?.user?.role === 'admin' && !!window.SUPABASE_ENABLED;
    const org = db.organizationForUser(session.userId);
    const customers = db.state.customers.filter(c => c.org_id === org?.id);
    const allProperties = customers.flatMap(c => {
      const props = db.state.properties.filter(p => p.customer_id === c.id);
      return props.map(p => ({ ...p, customerName: c.name }));
    });

    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [phone, setPhone] = useState('');
    const [password, setPassword] = useState('');
    const [propertyIds, setPropertyIds] = useState([]);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
      if (!open) return;
      setName('');
      setEmail('');
      setPhone('');
      setPassword(provisioning ? cleanupGeneratePassword() : '');
      setPropertyIds([]);
      setError('');
      setSaving(false);
    }, [open, provisioning]);

    function toggleProperty(pid) {
      setPropertyIds(prev => prev.includes(pid) ? prev.filter(x => x !== pid) : [...prev, pid]);
    }

    const validName = name.trim().length >= 2;
    const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
    const validPwd = !provisioning || (password || '').length >= 8;
    const canSubmit = validName && validEmail && validPwd;

    function errorLabel(code) {
      switch (code) {
        case 'EMAIL_EXISTS': return 'Mejladressen används redan.';
        case 'INVALID_EMAIL': return 'Ogiltig mejladress.';
        case 'INVALID_NAME': return 'Namn måste vara minst 2 tecken.';
        case 'WEAK_PASSWORD': return 'Lösenordet måste vara minst 8 tecken.';
        case 'PERSIST_FAILED': return 'Kunde inte spara till databasen.';
        default: return 'Kunde inte spara.';
      }
    }

    async function submit() {
      setError('');
      setSaving(true);
      try {
        const r = await db.addCleaner({
          name, email, phone, password,
          propertyIds,
          orgId: org?.id,
          adminUserId: session.userId,
          provision: provisioning,
        });
        if (r?.ok) {
          toast.success(provisioning
            ? `${name.trim()} skapad med inloggning.`
            : `${name.trim()} tillagd.`);
          onClose();
          if (onCreated) onCreated(r.user.id);
        } else {
          setError(errorLabel(r?.error));
        }
      } finally {
        setSaving(false);
      }
    }

    return (
      <Modal
        open={open}
        onClose={onClose}
        title="Ny städare"
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={onClose} disabled={saving}>Avbryt</Button>
            <Button variant="primary" disabled={!canSubmit || saving} loading={saving} onClick={submit}>Skapa städare</Button>
          </>
        }
      >
        <p className="text-xs text-slate-500 mb-4">
          Städare loggar in med mejl och lösenord och ser sina egna pass.
          {provisioning
            ? ' Ange ett lösenord – städaren kan byta det själv efter första inloggningen.'
            : ' Inloggning hanteras av admin.'}
        </p>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Namn *">
            <Input value={name} onChange={e => { setName(e.target.value); setError(''); }} placeholder="För- och efternamn" />
          </Field>
          <Field label="Mejl *" hint="Används som inloggning">
            <Input type="email" value={email} onChange={e => { setEmail(e.target.value); setError(''); }} placeholder="namn@foretag.se" />
          </Field>
        </div>
        <div className="grid sm:grid-cols-2 gap-3 mt-3">
          <Field label="Telefon">
            <Input type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+46 70 123 45 67" />
          </Field>
          {provisioning && (
            <Field label="Lösenord *" hint="Minst 8 tecken">
              <PasswordInput
                value={password}
                onChange={e => { setPassword(e.target.value); setError(''); }}
                onGenerate={() => { setPassword(cleanupGeneratePassword()); setError(''); }}
              />
            </Field>
          )}
        </div>
        {allProperties.length > 0 && (
          <Field label="Objekt i baspool" hint="Valfritt – förslag vid schemaläggning" className="mt-3">
            <div className="space-y-3 max-h-48 overflow-y-auto border border-slate-200 rounded-xl p-3">
              {customers.map(c => {
                const props = allProperties.filter(p => p.customer_id === c.id);
                if (props.length === 0) return null;
                return (
                  <div key={c.id}>
                    <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-1.5">{c.name}</p>
                    <div className="space-y-1.5">
                      {props.map(p => (
                        <Checkbox
                          key={p.id}
                          checked={propertyIds.includes(p.id)}
                          onChange={() => toggleProperty(p.id)}
                          label={p.name}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </Field>
        )}
        {error && <p className="text-sm text-rose-600 mt-4">{error}</p>}
      </Modal>
    );
  }

  function EditCleanerModal({ open, onClose, cleaner }) {
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [phone, setPhone] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
      if (!open || !cleaner) return;
      setName(cleaner.name || '');
      setEmail(cleaner.email || '');
      setPhone(cleaner.phone || '');
      setError('');
      setSaving(false);
    }, [open, cleaner?.id]);

    const valid = name.trim().length >= 2 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

    async function submit() {
      setSaving(true);
      setError('');
      try {
        const r = await db.updateCleaner(cleaner.id, { name, email, phone });
        if (r?.ok) {
          toast.success('Städare uppdaterad.');
          onClose();
        } else if (r?.error === 'EMAIL_EXISTS') {
          setError('Mejladressen används redan.');
        } else {
          setError('Kunde inte spara.');
        }
      } finally {
        setSaving(false);
      }
    }

    return (
      <Modal
        open={open}
        onClose={onClose}
        title="Redigera städare"
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={onClose} disabled={saving}>Avbryt</Button>
            <Button variant="primary" disabled={!valid || saving} loading={saving} onClick={submit}>Spara</Button>
          </>
        }
      >
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Namn *">
            <Input value={name} onChange={e => { setName(e.target.value); setError(''); }} />
          </Field>
          <Field label="Mejl *">
            <Input type="email" value={email} onChange={e => { setEmail(e.target.value); setError(''); }} />
          </Field>
        </div>
        <Field label="Telefon" className="mt-3">
          <Input type="tel" value={phone} onChange={e => setPhone(e.target.value)} />
        </Field>
        {error && <p className="text-xs text-rose-600 mt-3">{error}</p>}
      </Modal>
    );
  }

  function AdminCleanersListView({ session, onNavigate }) {
    useDb();
    const [createOpen, setCreateOpen] = useState(false);
    const [filter, setFilter] = useState('active');
    const org = db.organizationForUser(session.userId);
    const allCleaners = db.cleanersForOrg(org?.id);
    const cleaners = allCleaners.filter(c => {
      if (filter === 'active') return c.active;
      if (filter === 'inactive') return !c.active;
      return true;
    });

    return (
      <div>
        <PageHeader
          title="Städare"
          subtitle={`${allCleaners.filter(c => c.active).length} aktiva · ${allCleaners.length} totalt`}
          actions={<Button variant="primary" icon="plus" onClick={() => setCreateOpen(true)}>Ny städare</Button>}
        />
        <AddCleanerModal
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          session={session}
          onCreated={(id) => onNavigate(`/admin/stadare/${id}`)}
        />
        <div className="flex gap-2 mb-4">
          {[
            { id: 'active', label: 'Aktiva' },
            { id: 'inactive', label: 'Inaktiva' },
            { id: 'all', label: 'Alla' },
          ].map(f => (
            <Button
              key={f.id}
              variant={filter === f.id ? 'primary' : 'outline'}
              size="sm"
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </Button>
          ))}
        </div>
        {cleaners.length === 0 ? (
          <Card padding="md">
            <EmptyState
              icon="users"
              title={filter === 'inactive' ? 'Inga inaktiva städare' : 'Inga städare än'}
              description="Lägg till städare som ska kunna logga in och se sina pass."
              action={<Button icon="plus" onClick={() => setCreateOpen(true)}>Ny städare</Button>}
            />
          </Card>
        ) : (
          <div className="grid md:grid-cols-2 gap-3">
            {cleaners.map(c => {
              const pool = db.propertyPoolForCleaner(c.id);
              const upcoming = db.upcomingShiftsForCleaner(c.id).length;
              return (
                <button
                  key={c.id}
                  onClick={() => onNavigate(`/admin/stadare/${c.id}`)}
                  className={cx(
                    'text-left bg-white rounded-2xl border p-5 hover:border-brand-300 hover:shadow-sm transition-all',
                    c.active ? 'border-slate-200' : 'border-slate-200 opacity-60',
                  )}
                >
                  <div className="flex items-start gap-3">
                    <Avatar size="md" name={c.name} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-bold text-slate-900">{c.name}</p>
                        {!c.active && <Badge variant="slate">Inaktiv</Badge>}
                      </div>
                      <p className="text-xs text-slate-500 truncate">{c.email}</p>
                      {c.phone && <p className="text-xs text-slate-400">{c.phone}</p>}
                    </div>
                    <Icon name="chevron-right" className="w-5 h-5 text-slate-300" />
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-2 text-center">
                    <div className="bg-slate-50 rounded-lg py-2">
                      <p className="text-xl font-extrabold text-slate-900">{pool.length}</p>
                      <p className="text-[11px] uppercase text-slate-500">objekt</p>
                    </div>
                    <div className="bg-slate-50 rounded-lg py-2">
                      <p className="text-xl font-extrabold text-slate-900">{upcoming}</p>
                      <p className="text-[11px] uppercase text-slate-500">kommande pass</p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  function AdminCleanerView({ session, onNavigate, cleanerId }) {
    useDb();
    const cleaner = db.userById(cleanerId);
    const [editOpen, setEditOpen] = useState(false);
    const [pwOpen, setPwOpen] = useState(false);
    const [deactivateOpen, setDeactivateOpen] = useState(false);
    const [reactivateOpen, setReactivateOpen] = useState(false);
    const canManagePasswords = session?.user?.role === 'admin' && !!window.SUPABASE_ENABLED;

    const org = db.organizationForUser(session.userId);
    const customers = db.state.customers.filter(c => c.org_id === org?.id);
    const allProperties = customers.flatMap(c => {
      const props = db.state.properties.filter(p => p.customer_id === c.id);
      return props.map(p => ({ ...p, customerName: c.name }));
    });

    const assignedIds = db.propertyPoolForCleaner(cleanerId).map(p => p.id);
    const assignedKey = [...assignedIds].sort().join(',');
    const [propertyIds, setPropertyIds] = useState(assignedIds);
    const poolDirty = JSON.stringify([...propertyIds].sort()) !== JSON.stringify([...assignedIds].sort());

    useEffect(() => {
      setPropertyIds(assignedIds);
    }, [cleanerId, assignedKey]);

    if (!cleaner || cleaner.role !== 'cleaner') {
      return <ComingSoonView title="Städare saknas" section="—" description="Städaren kunde inte hittas." />;
    }

    const upcoming = db.upcomingShiftsForCleaner(cleanerId);

    function toggleProperty(pid) {
      setPropertyIds(prev => prev.includes(pid) ? prev.filter(x => x !== pid) : [...prev, pid]);
    }

    return (
      <div>
        <PageHeader
          breadcrumbs={[{ label: 'Städare', href: '#/admin/stadare' }, { label: cleaner.name }]}
          title={cleaner.name}
          subtitle={cleaner.email}
          actions={
            <>
              {!cleaner.active && <Badge variant="slate">Inaktiv</Badge>}
              <Button variant="outline" icon="edit" onClick={() => setEditOpen(true)}>Redigera</Button>
              {cleaner.active ? (
                <Button variant="danger-ghost" icon="user-x" onClick={() => setDeactivateOpen(true)}>Deaktivera</Button>
              ) : (
                <Button variant="outline" icon="user-check" onClick={() => setReactivateOpen(true)}>Återaktivera</Button>
              )}
            </>
          }
        />

        <EditCleanerModal open={editOpen} onClose={() => setEditOpen(false)} cleaner={cleaner} />

        <AdminUserPasswordModal
          open={pwOpen}
          onClose={() => setPwOpen(false)}
          user={cleaner}
          onReset={(userId, password) => db.setCleanerPassword(userId, password)}
        />

        <ConfirmDialog
          open={deactivateOpen}
          onClose={() => setDeactivateOpen(false)}
          title="Deaktivera städare?"
          message={`${cleaner.name} kan inte längre logga in och visas inte i schemaläggningslistor. Befintliga pass påverkas inte.`}
          confirmLabel="Deaktivera"
          danger
          onConfirm={async () => {
            const r = await db.deactivateCleaner(cleanerId);
            if (r?.error) {
              toast.error('Kunde inte deaktivera städaren.');
              return;
            }
            toast.success('Städare deaktiverad.');
            setDeactivateOpen(false);
          }}
        />

        <ConfirmDialog
          open={reactivateOpen}
          onClose={() => setReactivateOpen(false)}
          title="Återaktivera städare?"
          message={`${cleaner.name} kan logga in igen och tilldelas nya pass.`}
          confirmLabel="Återaktivera"
          onConfirm={async () => {
            const r = await db.reactivateCleaner(cleanerId);
            if (r?.error) {
              toast.error('Kunde inte återaktivera städaren.');
              return;
            }
            toast.success('Städare återaktiverad.');
            setReactivateOpen(false);
          }}
        />

        <div className="grid lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 space-y-4">
            <Card padding="md">
              <h3 className="font-bold text-slate-900 mb-3">Profil</h3>
              <dl className="grid sm:grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-xs text-slate-500">Namn</dt>
                  <dd className="font-medium text-slate-900">{cleaner.name}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Mejl</dt>
                  <dd className="font-medium text-slate-900">{cleaner.email}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Telefon</dt>
                  <dd className="font-medium text-slate-900">{cleaner.phone || '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Status</dt>
                  <dd><Badge variant={cleaner.active ? 'emerald' : 'slate'}>{cleaner.active ? 'Aktiv' : 'Inaktiv'}</Badge></dd>
                </div>
              </dl>
            </Card>

            <Card padding="md">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-slate-900">Objekttilldelningar (baspool)</h3>
              </div>
              <p className="text-xs text-slate-500 mb-4">Förslag vid schemaläggning – admin kan tilldela vem som helst per pass.</p>
              {allProperties.length === 0 ? (
                <p className="text-sm text-slate-500">Inga objekt i organisationen ännu.</p>
              ) : (
                <div className="space-y-3 max-h-64 overflow-y-auto">
                  {customers.map(c => {
                    const props = allProperties.filter(p => p.customer_id === c.id);
                    if (props.length === 0) return null;
                    return (
                      <div key={c.id}>
                        <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-1.5">{c.name}</p>
                        <div className="space-y-1.5">
                          {props.map(p => (
                            <Checkbox
                              key={p.id}
                              checked={propertyIds.includes(p.id)}
                              onChange={() => toggleProperty(p.id)}
                              label={p.name}
                            />
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              {poolDirty && (
                <Button variant="primary" size="sm" className="mt-4" onClick={async () => {
                  const r = await db.setCleanerPropertyPool(cleanerId, propertyIds);
                  if (r?.error) {
                    toast.error(r.message || 'Kunde inte spara tilldelningar.');
                    return;
                  }
                  toast.success('Objekttilldelningar sparade.');
                }}>Spara tilldelningar</Button>
              )}
            </Card>

            <Card padding="md">
              <h3 className="font-bold text-slate-900 mb-3">Kommande pass</h3>
              {upcoming.length === 0 ? (
                <p className="text-sm text-slate-500">Inga kommande pass tilldelade.</p>
              ) : (
                <ul className="divide-y divide-slate-100 -mx-2">
                  {upcoming.map(s => {
                    const prop = db.propertyById(s.property_id);
                    const cust = prop ? db.customerById(prop.customer_id) : null;
                    return (
                      <li key={s.id} className="px-2 py-3">
                        <button
                          type="button"
                          onClick={() => onNavigate(`/admin/schema/${s.id}`)}
                          className="w-full text-left flex items-center gap-3 hover:bg-slate-50 rounded-lg -mx-1 px-1 py-0.5"
                        >
                          <span className="text-sm font-semibold text-slate-900">{formatDate(s.start_at)}</span>
                          <span className="text-xs text-slate-500">{formatTime(s.start_at)}–{formatTime(s.end_at)}</span>
                          <span className="text-xs text-slate-600 flex-1 truncate">{cust?.name} · {prop?.name}</span>
                          <Badge variant={s.status === 'Godkänt' ? 'emerald' : 'brand'}>{s.status}</Badge>
                          <Icon name="chevron-right" className="w-4 h-4 text-slate-300" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          </div>

          <div className="space-y-4">
            <Card padding="md">
              <h3 className="font-bold text-slate-900 mb-1">Inloggning</h3>
              <p className="text-xs text-slate-500 mb-3">Städaren loggar in med mejl och lösenord.</p>
              <dl className="text-sm mb-4">
                <dt className="text-xs text-slate-500">Mejl</dt>
                <dd className="font-medium text-slate-900">{cleaner.email}</dd>
              </dl>
              {canManagePasswords && (
                <Button variant="outline" size="sm" icon="key" onClick={() => setPwOpen(true)}>Återställ lösenord</Button>
              )}
            </Card>
          </div>
        </div>
      </div>
    );
  }

  function CleanerSettingsView({ session }) {
    useDb();
    const user = session.user;

    return (
      <div>
        <PageHeader title="Inställningar" subtitle="Din profil och inloggning" />
        <div className="grid lg:grid-cols-2 gap-4 max-w-3xl">
          <Card padding="md">
            <h3 className="font-bold text-slate-900 mb-1">Min profil</h3>
            <p className="text-xs text-slate-500 mb-4">Kontaktuppgifter ändras av din administratör.</p>
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-xs text-slate-500">Namn</dt>
                <dd className="font-medium text-slate-900">{user.name}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Mejl</dt>
                <dd className="font-medium text-slate-900">{user.email}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Telefon</dt>
                <dd className="font-medium text-slate-900">{user.phone || '—'}</dd>
              </div>
            </dl>
          </Card>
          <ChangePasswordCard />
        </div>
      </div>
    );
  }

  function AdminCustomersListView({ session, onNavigate }) {
    useDb();
    const [createOpen, setCreateOpen] = useState(false);
    const customers = db.state.customers;
    return (
      <div>
        <PageHeader
          title="Kunder"
          subtitle={`${customers.length} kunder totalt.`}
          actions={<Button variant="primary" icon="plus" onClick={() => setCreateOpen(true)}>Ny kund</Button>}
        />
        <CreateCustomerModal
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          session={session}
          onCreated={(id) => onNavigate(`/admin/kunder/${id}`)}
        />
        <div className="grid md:grid-cols-2 gap-3">
          {customers.map(c => {
            const props = db.state.properties.filter(p => p.customer_id === c.id);
            const upcoming = db.state.shifts.filter(s => props.some(p => p.id === s.property_id) && new Date(s.start_at) > new Date() && s.status === 'Godkänt').length;
            return (
              <button
                key={c.id}
                onClick={() => onNavigate(`/admin/kunder/${c.id}`)}
                className="text-left bg-white rounded-2xl border border-slate-200 p-5 hover:border-brand-300 hover:shadow-sm transition-all"
              >
                <div className="flex items-start gap-3">
                  <span className="w-11 h-11 rounded-xl bg-brand-50 text-brand-700 flex items-center justify-center font-bold">
                    {initials(c.name) || 'KU'}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-slate-900">{c.name}</p>
                    <p className="text-xs text-slate-500 truncate">Org.nr {c.org_number}</p>
                  </div>
                  <Icon name="chevron-right" className="w-5 h-5 text-slate-300" />
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2 text-center">
                  <div className="bg-slate-50 rounded-lg py-2">
                    <p className="text-xl font-extrabold text-slate-900">{props.length}</p>
                    <p className="text-[11px] uppercase text-slate-500">objekt</p>
                  </div>
                  <div className="bg-slate-50 rounded-lg py-2">
                    <p className="text-xl font-extrabold text-slate-900">{upcoming}</p>
                    <p className="text-[11px] uppercase text-slate-500">kommande pass</p>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  function AdminCustomerView({ session, onNavigate, customerId }) {
    useDb();
    const [editOpen, setEditOpen] = useState(false);
    const [createPropertyOpen, setCreatePropertyOpen] = useState(false);
    const cust = db.customerById(customerId);
    if (!cust) return <ComingSoonView title="Kund saknas" section="—" />;
    const props = db.state.properties.filter(p => p.customer_id === cust.id);
    const main = db.userById(cust.primary_contact_user_id);

    return (
      <div>
        <PageHeader
          breadcrumbs={[{ label: 'Kunder', href: '#/admin/kunder' }, { label: cust.name }]}
          title={cust.name}
          subtitle={`Org.nr ${cust.org_number || '—'} · ${props.length} objekt`}
          actions={
            <>
              <Button variant="outline" icon="edit" onClick={() => setEditOpen(true)}>Redigera</Button>
              <Button variant="primary" icon="plus" onClick={() => setCreatePropertyOpen(true)}>Nytt objekt</Button>
            </>
          }
        />
        <AdminEditCustomerModal
          open={editOpen}
          onClose={() => setEditOpen(false)}
          customer={cust}
          contactUser={main}
        />
        <CreatePropertyModal
          open={createPropertyOpen}
          onClose={() => setCreatePropertyOpen(false)}
          customer={cust}
          session={session}
          onCreated={(pid) => onNavigate(`/admin/kunder/${cust.id}/objekt/${pid}`)}
        />

        <div className="grid lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2">
            <h2 className="text-sm font-bold text-slate-700 mb-3 uppercase tracking-wide">Objekt</h2>
            <div className="space-y-3">
              {props.length === 0 && (
                <Card padding="md">
                  <EmptyState icon="building" title="Inga objekt än" description="Lägg till första objektet för den här kunden." action={<Button icon="plus" onClick={() => setCreatePropertyOpen(true)}>Nytt objekt</Button>} />
                </Card>
              )}
              {props.map(p => {
                const next = db.shiftsForProperty(p.id, { from: new Date() })[0];
                const checklistCount = db.listChecklistTemplate(p.id).length;
                return (
                  <button key={p.id}
                    onClick={() => onNavigate(`/admin/kunder/${cust.id}/objekt/${p.id}`)}
                    className="w-full text-left bg-white rounded-2xl border border-slate-200 p-4 hover:border-brand-300 hover:shadow-sm transition-all"
                  >
                    <div className="flex items-start gap-3">
                      <span className="w-10 h-10 rounded-xl bg-slate-100 text-slate-500 flex items-center justify-center"><Icon name="building" className="w-5 h-5" /></span>
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-slate-900">{p.name}</p>
                        <p className="text-xs text-slate-500 truncate">{p.address}</p>
                        <div className="mt-2 flex items-center gap-2 flex-wrap">
                          <Badge variant="brand" icon="list">{checklistCount} checklist-punkter</Badge>
                          {next && <Badge variant="slate" icon="calendar">{relativeDay(next.start_at)} {formatTime(next.start_at)}</Badge>}
                          {p.access_info && <Badge variant="amber" icon="key">Nyckel/larm</Badge>}
                        </div>
                      </div>
                      <Icon name="chevron-right" className="w-5 h-5 text-slate-300 flex-shrink-0" />
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-4">
            <Card padding="md">
              <div className="flex items-center justify-between gap-2 mb-3">
                <h3 className="font-bold text-slate-900">Huvudkontakt</h3>
                <Button variant="ghost" size="sm" icon="edit" onClick={() => setEditOpen(true)}>Redigera</Button>
              </div>
              {main ? (
                <div className="flex items-center gap-3">
                  <Avatar name={main.name} />
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900 truncate">{main.name}</p>
                    <p className="text-xs text-slate-500 truncate">{main.email}</p>
                    {main.phone && <p className="text-xs text-slate-500">{main.phone}</p>}
                  </div>
                </div>
              ) : <p className="text-sm text-slate-500">Ingen huvudkontakt satt.</p>}
            </Card>

            <AdminCustomerEmployeesCard customer={cust} properties={props} session={session} />

            <Card padding="md">
              <h3 className="font-bold text-slate-900 mb-2">Anteckningar</h3>
              {cust.notes ? (
                <p className="text-sm text-slate-600">{cust.notes}</p>
              ) : (
                <p className="text-sm text-slate-500">Inga anteckningar.</p>
              )}
            </Card>

            <AdminCustomerHolidays customer={cust} session={session} />
          </div>
        </div>
        <AdminDeleteCustomerSection customer={cust} onNavigate={onNavigate} />
      </div>
    );
  }

  function AdminDeleteCustomerSection({ customer, onNavigate }) {
    useDb();
    const [deleteOpen, setDeleteOpen] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const summary = db.customerDeleteSummary(customer.id);

    const confirmMessage = [
      `${summary.propertyCount} objekt och all kopplad data raderas permanent.`,
      summary.futureShifts > 0
        ? `${summary.futureShifts} kommande pass tas bort${summary.totalShifts > summary.futureShifts ? ` (${summary.totalShifts} pass totalt i historiken)` : ''}.`
        : summary.totalShifts > 0
          ? `${summary.totalShifts} pass i historiken raderas.`
          : null,
      summary.employeeCount > 0
        ? `${summary.employeeCount} kundanställd${summary.employeeCount === 1 ? '' : 'a'} förlorar åtkomst (konton inaktiveras).`
        : null,
      summary.holidayCount > 0
        ? `${summary.holidayCount} registrerad${summary.holidayCount === 1 ? '' : 'a'} kundledighet${summary.holidayCount === 1 ? '' : 'er'} tas bort.`
        : null,
      'Huvudkontaktens konto inaktiveras. Detta går inte att ångra.',
    ].filter(Boolean).join(' ');

    async function handleDelete() {
      setDeleting(true);
      try {
        const r = await db.deleteCustomer(customer.id);
        if (r?.ok) {
          toast.success(`Kunden "${customer.name}" är borttagen.`);
          setDeleteOpen(false);
          onNavigate('/admin/kunder');
        } else if (r?.error === 'PERSIST_FAILED') {
          toast.error('Kunde inte spara – försök igen.');
        } else {
          toast.error('Kunden kunde inte hittas.');
          setDeleteOpen(false);
        }
      } finally {
        setDeleting(false);
      }
    }

    return (
      <Card padding="md" className="border-rose-100 mt-8">
        <h3 className="font-bold text-slate-900 mb-2">Farlig zon</h3>
        <p className="text-xs text-slate-500 mb-3">
          {summary.propertyCount} objekt
          {summary.futureShifts > 0 ? ` · ${summary.futureShifts} kommande pass` : ''}
          {summary.employeeCount > 0 ? ` · ${summary.employeeCount} kundanställda` : ''}
          . Hela kunden raderas.
        </p>
        <Button
          variant="danger-ghost"
          icon="trash"
          disabled={deleting}
          onClick={() => setDeleteOpen(true)}
        >
          Ta bort kund
        </Button>
        <ConfirmDialog
          open={deleteOpen}
          onClose={() => { if (!deleting) setDeleteOpen(false); }}
          title={`Ta bort "${customer.name}"?`}
          message={confirmMessage}
          confirmLabel={deleting ? 'Tar bort…' : 'Ta bort kund'}
          danger
          onConfirm={handleDelete}
        />
      </Card>
    );
  }

  function AdminCustomerHolidays({ customer, session }) {
    useDb();
    const holidays = db.holidaysWithSummary(customer.id);
    return (
      <Card padding="md">
        <h3 className="font-bold text-slate-900 mb-3">Kundledigheter</h3>
        {holidays.length === 0 ? (
          <p className="text-sm text-slate-500">Inga registrerade.</p>
        ) : (
          <div className="space-y-2">
            {holidays.map(h => <HolidayCard key={h.id} holiday={h} session={session} isAdmin={true} />)}
          </div>
        )}
      </Card>
    );
  }

  function AdminPropertyView({ session, onNavigate, customerId, propertyId }) {
    useDb();
    const cust = db.customerById(customerId);
    const prop = db.propertyById(propertyId);
    if (!prop || !cust) return <ComingSoonView title="Objekt saknas" section="—" />;
    const [tab, setTab] = useState('stadschema');
    const upcomingShifts = db.shiftsForProperty(prop.id, { from: new Date() }).filter(s => !['Avbokat', 'Borttaget'].includes(s.status)).slice(0, 8);

    const tabs = [
      { id: 'uppgifter', label: 'Uppgifter', icon: 'building' },
      { id: 'stadschema', label: 'Städschema', icon: 'list', count: db.listChecklistTemplate(prop.id, { includeInactive: false }).length },
      { id: 'recurring', label: 'Återkommande', icon: 'refresh', count: db.listRecurringSchedules(prop.id).length },
      { id: 'access', label: 'Nyckel / larm', icon: 'key' },
      { id: 'pass', label: 'Pass', icon: 'calendar', count: upcomingShifts.length },
      { id: 'ledighet', label: 'Ledigheter', icon: 'pause' },
      { id: 'kontakter', label: 'Kontakter', icon: 'users' },
    ];

    return (
      <div>
        <PageHeader
          breadcrumbs={[
            { label: 'Kunder', href: '#/admin/kunder' },
            { label: cust.name, href: `#/admin/kunder/${cust.id}` },
            { label: prop.name },
          ]}
          title={prop.name}
          subtitle={prop.address || 'Ingen adress angiven'}
          actions={
            <>
              <Button variant="outline" icon="edit" onClick={() => setTab('uppgifter')}>Redigera</Button>
              <Button variant="ghost" icon="chevron-left" onClick={() => onNavigate(`/admin/kunder/${cust.id}`)}>Tillbaka</Button>
            </>
          }
        />
        <Tabs tabs={tabs} value={tab} onChange={setTab} className="mb-5" />

        {tab === 'uppgifter' && <AdminPropertyDetailsEditor property={prop} />}
        {tab === 'stadschema' && <AdminChecklistEditor propertyId={prop.id} />}
        {tab === 'recurring' && <AdminRecurringEditor property={prop} session={session} />}
        {tab === 'access' && <AdminAccessEditor property={prop} />}
        {tab === 'pass' && <PropertyShiftsList property={prop} session={session} onNavigate={onNavigate} upcomingShifts={upcomingShifts} />}
        {tab === 'ledighet' && <ComingSoonView title="Ledigheter" section="§7.3" description="Lista över registrerade kundledigheter på det här objektet." />}
        {tab === 'kontakter' && <AdminPropertyContactsTab property={prop} customer={cust} session={session} />}
        <AdminDeletePropertySection property={prop} customerId={cust.id} onNavigate={onNavigate} />
      </div>
    );
  }

  function AdminDeletePropertySection({ property, customerId, onNavigate }) {
    useDb();
    const [deleteOpen, setDeleteOpen] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const futureCount = db.countFutureShiftsForProperty(property.id);
    const totalShifts = db.state.shifts.filter(s => s.property_id === property.id).length;
    const checklistCount = db.listChecklistTemplate(property.id).length;
    const recurringCount = db.listRecurringSchedules(property.id).length;

    const confirmMessage = futureCount > 0
      ? `${futureCount} kommande pass tas bort permanent. ${totalShifts > futureCount ? `Totalt ${totalShifts} pass i historiken raderas också.` : ''} Städschema (${checklistCount} punkter) och ${recurringCount} återkommande mall${recurringCount === 1 ? '' : 'ar'} försvinner. Detta går inte att ångra.`
      : totalShifts > 0
        ? `${totalShifts} pass i historiken och all objektdata raderas permanent. Detta går inte att ångra.`
        : `Objektet "${property.name}" och all tillhörande data raderas permanent. Detta går inte att ångra.`;

    async function handleDelete() {
      setDeleting(true);
      try {
        const r = await db.deleteProperty(property.id);
        if (r?.ok) {
          toast.success(`Objektet "${property.name}" är borttaget.`);
          setDeleteOpen(false);
          onNavigate(`/admin/kunder/${customerId}`);
        } else if (r?.error === 'PERSIST_FAILED') {
          toast.error('Kunde inte spara – försök igen.');
        } else {
          toast.error('Objektet kunde inte hittas.');
          setDeleteOpen(false);
        }
      } finally {
        setDeleting(false);
      }
    }

    return (
      <Card padding="md" className="border-rose-100 mt-8">
        <h3 className="font-bold text-slate-900 mb-2">Farlig zon</h3>
        <p className="text-xs text-slate-500 mb-3">
          {futureCount > 0
            ? `${futureCount} kommande pass på det här objektet.`
            : 'Inga kommande pass.'}
          {' '}Radering tar bort hela objektet och all kopplad data.
        </p>
        <Button
          variant="danger-ghost"
          icon="trash"
          disabled={deleting}
          onClick={() => setDeleteOpen(true)}
        >
          Ta bort objekt
        </Button>
        <ConfirmDialog
          open={deleteOpen}
          onClose={() => { if (!deleting) setDeleteOpen(false); }}
          title={`Ta bort "${property.name}"?`}
          message={confirmMessage}
          confirmLabel={deleting ? 'Tar bort…' : 'Ta bort objekt'}
          danger
          onConfirm={handleDelete}
        />
      </Card>
    );
  }

  function AdminChecklistEditor({ propertyId }) {
    useDb();
    const items = db.listChecklistTemplate(propertyId);
    const activeCount = items.filter(i => i.active).length;
    const inactiveCount = items.length - activeCount;
    const [newTitle, setNewTitle] = useState('');

    return (
      <Card padding="md">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="font-bold text-slate-900">Mallpunkter</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              {activeCount} aktiva{inactiveCount > 0 ? ` · ${inactiveCount} inaktiva (kopieras inte till nya pass)` : ''}. Ändringar påverkar inte tidigare pass.
            </p>
          </div>
        </div>

        {items.length === 0 ? (
          <EmptyState icon="list" title="Inget städschema än" description="Lägg till första punkten nedan." />
        ) : (
          <ul className="divide-y divide-slate-100 -mx-2 mb-4">
            {items.map((it, idx) => (
              <li key={it.id} className={cx('px-2 py-2 flex items-center gap-2', !it.active && 'opacity-60')}>
                <span className={cx(
                  'w-7 h-7 rounded-lg text-xs font-bold flex items-center justify-center flex-shrink-0',
                  it.active ? 'bg-slate-100 text-slate-500' : 'bg-slate-50 text-slate-400 line-through',
                )}>{it.position}</span>
                <Input
                  value={it.title}
                  onChange={e => db.renameChecklistTemplateItem(it.id, e.target.value)}
                  className={cx('flex-1', !it.active && 'line-through text-slate-400')}
                  disabled={!it.active}
                />
                <div className="flex items-center">
                  <Button
                    variant="ghost"
                    size="sm"
                    iconOnly
                    icon={it.active ? 'eye' : 'eye-off'}
                    title={it.active ? 'Avaktivera (visas inte i nya pass)' : 'Aktivera igen'}
                    onClick={async () => {
                      const wasActive = it.active;
                      const r = await db.setChecklistTemplateItemActive(it.id, !wasActive);
                      if (r?.error) {
                        toast.error(r.message || 'Kunde inte uppdatera punkten.');
                        return;
                      }
                      toast.success(wasActive ? 'Punkten är avaktiverad.' : 'Punkten är aktiv igen.');
                    }}
                    aria-label={it.active ? 'Avaktivera' : 'Aktivera'}
                  />
                  <Button variant="ghost" size="sm" iconOnly icon="chevron-down" onClick={() => db.reorderChecklistTemplateItem(it.id, 1)} disabled={idx === items.length - 1} aria-label="Flytta ner" />
                  <Button variant="ghost" size="sm" iconOnly icon="chevron-down" className="rotate-180" onClick={() => db.reorderChecklistTemplateItem(it.id, -1)} disabled={idx === 0} aria-label="Flytta upp" />
                  <Button variant="danger-ghost" size="sm" iconOnly icon="trash" onClick={async () => {
                    if (confirm(`Ta bort "${it.title}"?`)) {
                      const r = await db.removeChecklistTemplateItem(it.id);
                      if (r?.error) {
                        toast.error(r.message || 'Kunde inte ta bort punkten.');
                        return;
                      }
                      toast.success('Punkten borttagen.');
                    }
                  }} aria-label="Ta bort" />
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="flex gap-2">
          <Input
            placeholder="Beskriv nästa punkt…"
            value={newTitle}
            onChange={e => setNewTitle(e.target.value)}
            onKeyDown={async e => {
              if (e.key === 'Enter' && newTitle.trim()) {
                const r = await db.addChecklistTemplateItem(propertyId, newTitle);
                if (r?.error) {
                  toast.error(r.message || 'Kunde inte lägga till punkten.');
                  return;
                }
                toast.success('Punkt tillagd.');
                setNewTitle('');
              }
            }}
          />
          <Button
            variant="primary"
            icon="plus"
            disabled={!newTitle.trim()}
            onClick={async () => {
              const r = await db.addChecklistTemplateItem(propertyId, newTitle);
              if (r?.error) {
                toast.error(r.message || 'Kunde inte lägga till punkten.');
                return;
              }
              toast.success('Punkt tillagd.');
              setNewTitle('');
            }}
          >Lägg till</Button>
        </div>
      </Card>
    );
  }

  const WEEKDAYS = ['Måndag', 'Tisdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lördag', 'Söndag'];
  const WEEKDAYS_SHORT = ['Mån', 'Tis', 'Ons', 'Tors', 'Fre', 'Lör', 'Sön'];

  function recurringScheduleTitle(rs) {
    const kind = rs.recurrence_kind || 'weekly';
    if (kind === 'monthly_last') return `Sista ${WEEKDAYS[rs.weekday]} i månaden`;
    return `Varje ${WEEKDAYS[rs.weekday]}`;
  }

  function PropertyShiftsList({ property, session, onNavigate, upcomingShifts }) {
    const [createOpen, setCreateOpen] = useState(false);
    return (
      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm text-slate-600">{upcomingShifts.length === 0 ? 'Inga kommande pass på det här objektet.' : `${upcomingShifts.length} kommande pass.`}</p>
          <Button size="sm" icon="plus" onClick={() => setCreateOpen(true)}>Nytt pass</Button>
        </div>
        {upcomingShifts.length === 0 ? (
          <Card padding="md"><EmptyState icon="calendar" title="Inga kommande pass" /></Card>
        ) : (
          <div className="grid md:grid-cols-2 gap-3">
            {upcomingShifts.map(s => (
              <ShiftCard key={s.id} shift={s} viewerRole="admin" viewerUserId={session.userId} onClick={() => onNavigate(`/admin/schema/${s.id}`)} />
            ))}
          </div>
        )}
        <CreateShiftModal open={createOpen} onClose={() => setCreateOpen(false)} session={session} preselectPropertyId={property.id} />
      </div>
    );
  }

  function AdminRecurringEditor({ property, session }) {
    useDb();
    const items = db.listRecurringSchedules(property.id);
    const [createOpen, setCreateOpen] = useState(false);
    const [confirmRemoveId, setConfirmRemoveId] = useState(null);

    return (
      <Card padding="md">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-bold text-slate-900">Återkommande pass</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Mallar genererar pass rullande 24 veckor framåt. Lägg två mallar om ni har både veckostäd och t.ex. storstäd sista söndagen i månaden.
            </p>
          </div>
          <Button icon="plus" onClick={() => setCreateOpen(true)}>Ny mall</Button>
        </div>

        {items.length === 0 ? (
          <EmptyState icon="refresh" title="Inga återkommande pass" description="Lägg till en mall så genereras pass automatiskt." />
        ) : (
          <ul className="divide-y divide-slate-100 -mx-2">
            {items.map(rs => (
              <li key={rs.id} className="px-2 py-3 flex items-center gap-3">
                <span className="w-10 h-10 rounded-xl bg-brand-50 text-brand-700 text-xs font-bold flex items-center justify-center flex-shrink-0">{WEEKDAYS_SHORT[rs.weekday]}</span>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-slate-900">
                    {recurringScheduleTitle(rs)} · {rs.start_time}–{rs.end_time}
                    {rs.label ? <span className="text-slate-500 font-normal"> · {rs.label}</span> : null}
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Städare: {rs.cleaner?.name || '—'}
                    {(rs.valid_from || rs.valid_to) && (
                      <> · Giltig {rs.valid_from ? formatDateShort(rs.valid_from) : '–'} {rs.valid_to ? `→ ${formatDateShort(rs.valid_to)}` : '→ tills vidare'}</>
                    )}
                  </p>
                </div>
                <Button variant="danger-ghost" size="sm" icon="trash" onClick={() => setConfirmRemoveId(rs.id)}>Ta bort mall</Button>
              </li>
            ))}
          </ul>
        )}

        <CreateRecurringModal open={createOpen} onClose={() => setCreateOpen(false)} property={property} session={session} />
        <ConfirmDialog
          open={!!confirmRemoveId}
          onClose={() => setConfirmRemoveId(null)}
          title="Ta bort mallen?"
          message="Alla framtida pass från den här mallen tas bort. Historiska pass bevaras. Berörda städare notifieras."
          confirmLabel="Ta bort mall"
          danger
          onConfirm={async () => {
            const r = await db.deleteRecurringSchedule(confirmRemoveId, session.userId);
            if (r?.ok) toast.success(`Mall borttagen – ${r.removed} framtida pass rensade.`);
            else if (r?.error === 'PERSIST_FAILED') toast.error('Kunde inte spara – försök igen.');
            setConfirmRemoveId(null);
          }}
        />
      </Card>
    );
  }

  function CreateRecurringModal({ open, onClose, property, session }) {
    const [weekday, setWeekday] = useState('0');
    const [recurrenceKind, setRecurrenceKind] = useState('weekly');
    const [label, setLabel] = useState('');
    const [startTime, setStartTime] = useState('08:00');
    const [endTime, setEndTime] = useState('10:00');
    const [cleanerId, setCleanerId] = useState('');
    const [validFrom, setValidFrom] = useState('');
    const [validTo, setValidTo] = useState('');

    useEffect(() => {
      if (open) {
        setWeekday('0'); setRecurrenceKind('weekly'); setLabel('');
        setStartTime('08:00'); setEndTime('10:00');
        setCleanerId(''); setValidFrom(''); setValidTo('');
      }
    }, [open]);

    const cleaners = db.state.users.filter(u => u.role === 'cleaner' && u.active);
    const validTime = startTime && endTime && startTime < endTime;
    const canSubmit = cleanerId && validTime;

    return (
      <Modal
        open={open}
        onClose={onClose}
        title="Ny återkommande mall"
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={onClose}>Avbryt</Button>
            <Button disabled={!canSubmit} icon="plus" onClick={async () => {
              const r = await db.createRecurringSchedule({
                propertyId: property.id,
                weekday: Number(weekday),
                recurrenceKind,
                label,
                startTime, endTime,
                defaultCleanerUserId: cleanerId,
                validFrom: validFrom || null,
                validTo: validTo || null,
                generateWeeks: 24,
                actorUserId: session.userId,
              });
              if (r?.error === 'PERSIST_FAILED') {
                toast.error('Kunde inte spara – försök igen.');
                return;
              }
              toast.success(`Mall skapad – ${r.generated} pass genererade för 24 veckor framåt.`);
              onClose();
            }}>Skapa mall</Button>
          </>
        }
      >
        <Field label="Upprepning">
          <Select value={recurrenceKind} onChange={e => setRecurrenceKind(e.target.value)}>
            <option value="weekly">Varje vecka</option>
            <option value="monthly_last">Sista veckodagen i månaden</option>
          </Select>
        </Field>
        <div className="mt-3">
          <Field label="Veckodag">
            <Select value={weekday} onChange={e => setWeekday(e.target.value)}>
              {WEEKDAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3 mt-3">
          <Field label="Starttid">
            <Input type="time" value={startTime} onChange={e => setStartTime(e.target.value)} />
          </Field>
          <Field label="Sluttid" error={!validTime && startTime && endTime ? 'Sluttid måste vara efter starttid.' : null}>
            <Input type="time" value={endTime} onChange={e => setEndTime(e.target.value)} />
          </Field>
        </div>
        <div className="mt-3">
          <Field label="Beskrivning" hint="Valfritt, t.ex. Storstädning.">
            <Input value={label} onChange={e => setLabel(e.target.value)} placeholder="T.ex. Storstädning" />
          </Field>
        </div>
        <div className="mt-3">
          <Field label="Defaultstädare" required>
            <Select value={cleanerId} onChange={e => setCleanerId(e.target.value)}>
              <option value="">Välj städare…</option>
              {cleaners.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3 mt-3">
          <Field label="Giltig fr.o.m." hint="Lämna tomt = från idag.">
            <Input type="date" value={validFrom} onChange={e => setValidFrom(e.target.value)} />
          </Field>
          <Field label="Giltig t.o.m." hint="Lämna tomt = tills vidare.">
            <Input type="date" value={validTo} onChange={e => setValidTo(e.target.value)} />
          </Field>
        </div>
        <div className="mt-4 rounded-lg border border-sky-200 bg-sky-50/50 p-3 text-xs text-sky-900/90">
          <Icon name="info" className="w-4 h-4 text-sky-700 inline-block mr-1 -mt-0.5" />
          Mallen genererar pass rullande 24 veckor framåt. Justeringar och borttagningar av enskilda pass påverkar bara den raden, inte mallen.
        </div>
      </Modal>
    );
  }

  function AdminPropertyDetailsEditor({ property }) {
    const [name, setName] = useState(property.name || '');
    const [address, setAddress] = useState(property.address || '');
    const [areaSqm, setAreaSqm] = useState(property.area_sqm != null ? String(property.area_sqm) : '');
    const [saving, setSaving] = useState(false);

    useEffect(() => {
      setName(property.name || '');
      setAddress(property.address || '');
      setAreaSqm(property.area_sqm != null ? String(property.area_sqm) : '');
    }, [property.id]);

    const dirty = name !== (property.name || '')
      || address !== (property.address || '')
      || areaSqm !== (property.area_sqm != null ? String(property.area_sqm) : '');

    async function save() {
      setSaving(true);
      try {
        const r = await db.updateProperty(property.id, {
          name,
          address,
          area_sqm: areaSqm.trim() === '' ? null : areaSqm,
        });
        if (r?.ok) toast.success('Objektuppgifter sparade.');
        else if (r?.error === 'INVALID_NAME') toast.error('Namnet måste vara minst 2 tecken.');
        else if (r?.error === 'INVALID_AREA') toast.error('Yta måste vara ett positivt tal.');
        else if (r?.error === 'PERSIST_FAILED') toast.error('Kunde inte spara – försök igen.');
        else toast.error('Objektet kunde inte hittas.');
      } finally {
        setSaving(false);
      }
    }

    return (
      <Card padding="md">
        <h3 className="font-bold text-slate-900 mb-1">Grunduppgifter</h3>
        <p className="text-xs text-slate-500 mb-4">Namn och adress visas för kund, städare och admin.</p>
        <Field label="Objektnamn *" className="mb-3">
          <Input value={name} onChange={e => setName(e.target.value)} placeholder="T.ex. Acme HQ" />
        </Field>
        <Field label="Adress" className="mb-3">
          <Input value={address} onChange={e => setAddress(e.target.value)} placeholder="Gatuadress, postort" />
        </Field>
        <Field label="Yta (kvm)" hint="Valfritt, heltal." className="mb-4">
          <Input
            type="number"
            min="0"
            step="1"
            value={areaSqm}
            onChange={e => setAreaSqm(e.target.value)}
            placeholder="320"
          />
        </Field>
        <div className="flex justify-end gap-2">
          {dirty && (
            <Button variant="ghost" disabled={saving} onClick={() => {
              setName(property.name || '');
              setAddress(property.address || '');
              setAreaSqm(property.area_sqm != null ? String(property.area_sqm) : '');
            }}>Återställ</Button>
          )}
          <Button variant="primary" icon="check" disabled={!dirty || saving || name.trim().length < 2} onClick={save}>
            {saving ? 'Sparar…' : 'Spara'}
          </Button>
        </div>
      </Card>
    );
  }

  function AdminAccessEditor({ property }) {
    const [draft, setDraft] = useState(property.access_info || '');
    const [notes, setNotes] = useState(property.notes || '');
    const [saving, setSaving] = useState(false);
    useEffect(() => { setDraft(property.access_info || ''); setNotes(property.notes || ''); }, [property.id]);
    const dirty = draft !== (property.access_info || '') || notes !== (property.notes || '');

    async function save() {
      setSaving(true);
      try {
        const r = await db.updateProperty(property.id, { access_info: draft, notes });
        if (r?.ok) toast.success('Nyckel och anteckningar sparade.');
        else if (r?.error === 'PERSIST_FAILED') toast.error('Kunde inte spara – försök igen.');
        else toast.error('Objektet kunde inte hittas.');
      } finally {
        setSaving(false);
      }
    }

    return (
      <div className="space-y-4">
        <Card padding="md" className="border-amber-200 bg-amber-50/40">
          <div className="flex items-start gap-2 mb-1">
            <Icon name="shield" className="w-4 h-4 text-amber-700 mt-0.5" />
            <p className="text-xs text-amber-800 font-semibold">
              Det här fältet visas <span className="underline">aldrig</span> för kund eller kundanställd — endast admin och städare med tilldelade pass på objektet.
            </p>
          </div>
        </Card>

        <Card padding="md">
          <Field label="Nyckel / larm-info" hint="Hur städaren tar sig in: koder, var nyckel finns, larminstruktioner, m.m.">
            <Textarea rows={5} value={draft} onChange={e => setDraft(e.target.value)} placeholder="T.ex. Nyckel i kodlåda 1234 vid huvudentrén. Larm av/på-kod: …" />
          </Field>
        </Card>

        <Card padding="md">
          <Field label="Övriga anteckningar (synliga för alla)" hint="T.ex. specialönskemål, produkter att undvika.">
            <Textarea rows={3} value={notes} onChange={e => setNotes(e.target.value)} placeholder="" />
          </Field>
        </Card>

        <div className="flex justify-end gap-2 sticky bottom-4">
          {dirty && <Button variant="ghost" disabled={saving} onClick={() => { setDraft(property.access_info || ''); setNotes(property.notes || ''); }}>Återställ</Button>}
          <Button variant="primary" icon="check" disabled={!dirty || saving} onClick={save}>
            {saving ? 'Sparar…' : 'Spara'}
          </Button>
        </div>
      </div>
    );
  }

  /* ============================================================
   * ADMIN · Dashboard (Kräver din åtgärd)
   * ============================================================ */
  function AdminDashboardView({ session, onNavigate }) {
    const [createShiftOpen, setCreateShiftOpen] = useState(false);
    useDb();
    const { sick, openIncidents, todayShifts, planned } = db.adminActionables();
    const totalCleaners = db.state.users.filter(u => u.role === 'cleaner' && u.active).length;
    const totalCustomers = db.state.customers.length;
    const todayAll = db.state.shifts.filter(s => formatDateShort(s.start_at) === formatDateShort(new Date()));

    return (
      <div>
        <PageHeader
          title={`God morgon, ${session.user.name.split(' ')[0]}.`}
          subtitle="Här är dagens läge och allt som kräver din åtgärd."
          actions={
            <>
              <Button variant="outline" icon="building" onClick={() => onNavigate('/admin/kunder')}>Återkommande på objekt</Button>
              <Button variant="outline" icon="calendar" onClick={() => onNavigate('/admin/schema')}>Schema</Button>
              <Button variant="primary" icon="plus" onClick={() => setCreateShiftOpen(true)}>Nytt pass</Button>
            </>
          }
        />

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
          <Stat label="Pass idag" value={todayAll.length} hint={`${todayAll.filter(s => s.status === 'Utfört').length} utförda`} icon="calendar" tone="brand" />
          <Stat label="Sjukanmälda" value={sick.length} hint={sick.length ? 'Kräver åtgärd' : 'Inget just nu'} icon="alert-circle" tone="amber" />
          <Stat label="Öppna avvikelser" value={openIncidents.length} icon="alert-triangle" tone="rose" />
          <Stat label="Aktiva städare" value={totalCleaners} hint={`${totalCustomers} kunder`} icon="users" tone="emerald" />
        </div>

        <h2 className="text-lg font-bold text-slate-900 mb-3 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-accent-500" />
          Kräver din åtgärd
        </h2>

        {sick.length === 0 && openIncidents.length === 0 && planned.length === 0 && todayShifts.length === 0 ? (
          <Card padding="lg">
            <EmptyState icon="check-circle" title="Allt är under kontroll" description="Inga väntande godkännanden, sjukanmälda pass eller öppna avvikelser just nu." />
          </Card>
        ) : (
          <div className="space-y-6">
            {todayShifts.length > 0 && (
              <section>
                <h3 className="text-sm font-bold text-slate-700 mb-2 flex items-center gap-2">
                  <Icon name="clock" className="w-4 h-4 text-rose-600" />
                  Dagens pass utan incheckning <Badge variant="rose">{todayShifts.length}</Badge>
                </h3>
                <div className="grid md:grid-cols-2 gap-3">
                  {todayShifts.map(s => (
                    <ShiftCard key={s.id} shift={s} viewerRole="admin" viewerUserId={session.userId} onClick={() => onNavigate(`/admin/schema/${s.id}`)} />
                  ))}
                </div>
              </section>
            )}
            {planned.length > 0 && (
              <section>
                <h3 className="text-sm font-bold text-slate-700 mb-2 flex items-center gap-2">
                  <Icon name="calendar" className="w-4 h-4 text-brand-600" />
                  Väntar på godkännande <Badge variant="brand">{planned.length}</Badge>
                </h3>
                <div className="grid md:grid-cols-2 gap-3">
                  {planned.map(s => (
                    <ShiftCard key={s.id} shift={s} viewerRole="admin" viewerUserId={session.userId} onClick={() => onNavigate(`/admin/schema/${s.id}`)} />
                  ))}
                </div>
              </section>
            )}
            {sick.length > 0 && (
              <section>
                <h3 className="text-sm font-bold text-slate-700 mb-2 flex items-center gap-2">
                  <Icon name="alert-circle" className="w-4 h-4 text-amber-600" />
                  Sjukanmälda pass <Badge variant="amber">{sick.length}</Badge>
                </h3>
                <div className="grid md:grid-cols-2 gap-3">
                  {sick.map(s => (
                    <ShiftCard key={s.id} shift={s} viewerRole="admin" viewerUserId={session.userId} onClick={() => onNavigate(`/admin/schema/${s.id}`)} />
                  ))}
                </div>
              </section>
            )}
            {openIncidents.length > 0 && (
              <section>
                <h3 className="text-sm font-bold text-slate-700 mb-2 flex items-center gap-2">
                  <Icon name="alert-triangle" className="w-4 h-4 text-rose-600" />
                  Nya avvikelser <Badge variant="rose">{openIncidents.length}</Badge>
                </h3>
                <div className="space-y-2">
                  {openIncidents.map(i => {
                    const prop = db.propertyById(i.property_id);
                    return (
                      <Card key={i.id} padding="md" className="hover:border-brand-300 transition-colors">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <Badge variant={i.kind === 'customer_complaint' ? 'rose' : 'amber'}>
                                {i.kind === 'customer_complaint' ? 'Reklamation' : 'Avvikelse'}
                              </Badge>
                              <span className="text-xs text-slate-500">{prop?.name}</span>
                            </div>
                            <p className="font-semibold text-slate-900">{i.title}</p>
                            <p className="text-sm text-slate-600 line-clamp-2">{i.description}</p>
                          </div>
                          <Button variant="outline" size="sm" onClick={() => onNavigate(`/admin/avvikelser/${i.id}`)}>Öppna</Button>
                        </div>
                      </Card>
                    );
                  })}
                </div>
              </section>
            )}
          </div>
        )}

        <CreateShiftModal open={createShiftOpen} onClose={() => setCreateShiftOpen(false)} session={session} />
      </div>
    );
  }

  /* ============================================================
   * CLEANER · Idag
   * ============================================================ */
  function CleanerTodayView({ session, onNavigate }) {
    useDb();
    const today = db.todayForCleaner(session.userId);
    const upcoming = db.shiftsForCleaner(session.userId, { from: new Date(Date.now() + 24 * 36e5), statuses: ['Godkänt', 'Planerat'] }).slice(0, 5);
    const myIncidents = db.incidents({ viewerUserId: session.userId, status: 'open' });

    return (
      <div>
        <PageHeader
          title={`Hej ${session.user.name.split(' ')[0]}!`}
          subtitle={formatDateLong(new Date())}
        />

        <div className="grid grid-cols-3 gap-3 mb-8">
          <Stat label="Pass idag" value={today.length} icon="calendar" tone="brand" />
          <Stat label="Kommande" value={db.shiftsForCleaner(session.userId, { from: new Date(), statuses: ['Godkänt', 'Planerat'] }).length} icon="clock" tone="accent" />
          <Stat label="Egna ärenden" value={myIncidents.length} icon="alert-triangle" tone="amber" />
        </div>

        <section className="mb-8">
          <h2 className="text-lg font-bold text-slate-900 mb-3">Idag</h2>
          {today.length === 0 ? (
            <Card padding="lg">
              <EmptyState icon="calendar" title="Inga pass idag" description="Du har inga schemalagda pass idag. Vila skönt!" />
            </Card>
          ) : (
            <div className="space-y-3">
              {today.map(s => <ShiftCard key={s.id} shift={s} viewerRole="cleaner" viewerUserId={session.userId} onClick={() => onNavigate(`/stadare/pass/${s.id}`)} />)}
            </div>
          )}
        </section>

        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-bold text-slate-900">Kommande pass</h2>
            <button onClick={() => onNavigate('/stadare/pass')} className="text-sm font-semibold text-brand-700 hover:text-brand-800 flex items-center gap-1">
              Se alla <Icon name="arrow-right" className="w-4 h-4" />
            </button>
          </div>
          {upcoming.length === 0 ? (
            <Card padding="md"><EmptyState icon="inbox" title="Inga kommande pass" /></Card>
          ) : (
            <div className="grid md:grid-cols-2 gap-3">
              {upcoming.map(s => <ShiftCard key={s.id} shift={s} viewerRole="cleaner" viewerUserId={session.userId} onClick={() => onNavigate(`/stadare/pass/${s.id}`)} />)}
            </div>
          )}
        </section>
      </div>
    );
  }

  /* ============================================================
   * CUSTOMER · Översikt
   * ============================================================ */
  function CustomerOverviewView({ session, onNavigate }) {
    useDb();
    const customer = db.customerForUser(session.userId);
    const props = db.propertiesForUser(session.userId);
    const upcoming = db.shiftsForCustomerUser(session.userId, { from: new Date(), statuses: ['Godkänt', 'Planerat', 'Sjukanmäld', 'Pausat (kundledighet)'] }).slice(0, 8);
    const openIncidents = db.incidents({ viewerUserId: session.userId, status: 'open' });
    const isEmployee = session.user.role === 'customer_employee';
    const roleLabel = isEmployee ? 'Kundanställd' : 'Huvudkontakt';

    return (
      <div>
        <PageHeader
          title={customer ? customer.name : 'Översikt'}
          subtitle={`${props.length} objekt · ${session.user.name}`}
          actions={
            <Button variant="outline" icon="calendar" onClick={() => onNavigate('/kund/ledighet')}>Ny ledighet</Button>
          }
        />

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
          <Stat label="Objekt" value={props.length} icon="building" tone="brand" />
          <Stat label="Kommande pass" value={upcoming.length} icon="calendar" tone="accent" />
          <Stat label="Öppna ärenden" value={openIncidents.length} icon="alert-triangle" tone="amber" />
          <Stat label="Roll" value={roleLabel} icon="shield" tone="emerald" />
        </div>

        <section className="mb-8">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-bold text-slate-900">Dina objekt</h2>
            {props.length > 0 && (
              <Button variant="ghost" size="sm" onClick={() => onNavigate('/kund/objekt')}>Visa alla</Button>
            )}
          </div>
          {props.length === 0 ? (
            <Card padding="lg"><EmptyState icon="building" title="Inga objekt kopplade" description="Kontakta admin om du saknar åtkomst." /></Card>
          ) : (
            <div className="grid md:grid-cols-2 gap-3">
              {props.map(p => (
                <CustomerPropertyCard key={p.id} property={p} session={session} onNavigate={onNavigate} />
              ))}
            </div>
          )}
        </section>

        <section>
          <h2 className="text-lg font-bold text-slate-900 mb-3">Kommande pass</h2>
          {upcoming.length === 0 ? (
            <Card padding="md"><EmptyState icon="inbox" title="Inga kommande pass" /></Card>
          ) : (
            <div className="grid md:grid-cols-2 gap-3">
              {upcoming.map(s => <ShiftCard key={s.id} shift={s} viewerRole={session.user.role} viewerUserId={session.userId} onClick={() => onNavigate(`/kund/pass/${s.id}`)} />)}
            </div>
          )}
        </section>
      </div>
    );
  }

  /* ============================================================
   * Placeholder för icke-byggda sidor
   * ============================================================ */
  function ComingSoonView({ title, section, description }) {
    return (
      <div>
        <PageHeader title={title} subtitle={description || 'Den här vyn byggs härnäst.'} />
        <Card padding="lg">
          <EmptyState
            icon="sparkles"
            title="Bygger ut härnäst"
            description={
              <>
                Den här vyn motsvarar <span className="font-mono font-semibold text-slate-700">{section}</span> i <span className="font-mono">mvpfinal.md</span>.
                <br />Vi bygger sidorna stegvis enligt specen.
              </>
            }
          />
        </Card>
      </div>
    );
  }

  window.LoginView = LoginView;
  window.AdminDashboardView = AdminDashboardView;
  window.CleanerTodayView = CleanerTodayView;
  window.CleanerShiftsListView = CleanerShiftsListView;
  window.CleanerShiftDetailView = CleanerShiftDetailView;
  window.CustomerOverviewView = CustomerOverviewView;
  window.CustomerShiftDetailView = CustomerShiftDetailView;
  window.AdminCleanersListView = AdminCleanersListView;
  window.AdminCleanerView = AdminCleanerView;
  window.CleanerSettingsView = CleanerSettingsView;
  window.AdminCustomersListView = AdminCustomersListView;
  window.AdminCustomerView = AdminCustomerView;
  window.AdminPropertyView = AdminPropertyView;
  window.AdminShiftDetailView = AdminShiftDetailView;
  window.ComingSoonView = ComingSoonView;
  window.ShiftCard = ShiftCard;
  window.ShiftDetail = ShiftDetail;
  window.SickReportModal = SickReportModal;
  window.CustomerShiftActions = CustomerShiftActions;
  window.CancelShiftModal = CancelShiftModal;
  window.CustomerHolidayView = CustomerHolidayView;
  window.HolidayCard = HolidayCard;
  window.AdminSchemaView = AdminSchemaView;
  window.CreateShiftModal = CreateShiftModal;
  window.CustomerShiftRequestModal = CustomerShiftRequestModal;
  window.ApproveShiftModal = ApproveShiftModal;
  window.AdminRecurringEditor = AdminRecurringEditor;
  window.CreateRecurringModal = CreateRecurringModal;
  // §7.6
  window.CleanerIncidentReportModal = CleanerIncidentReportModal;
  window.CustomerComplaintModal = CustomerComplaintModal;
  window.ResolveIncidentModal = ResolveIncidentModal;
  window.AdminIncidentsView = AdminIncidentsView;
  window.CleanerIncidentsView = CleanerIncidentsView;
  window.CustomerIncidentsView = CustomerIncidentsView;
  window.IncidentDetailView = IncidentDetailView;
  // §7.7
  window.AddCustomerEmployeeModal = AddCustomerEmployeeModal;
  window.AdminCustomerEmployeesCard = AdminCustomerEmployeesCard;
  window.AdminPropertyContactsTab = AdminPropertyContactsTab;
  window.CustomerSettingsView = CustomerSettingsView;
  window.AdminSettingsView = AdminSettingsView;

  /* ============================================================
   * RAPPORTER – periodfilter + export (§ roadmap tidrapportering)
   * ============================================================ */
  function ReportPeriodFilters({ preset, onPresetChange, from, to, onFromChange, onToChange }) {
    return (
      <Card padding="md" className="mb-4">
        <div className="grid md:grid-cols-4 gap-3">
          <Field label="Period">
            <Select value={preset} onChange={e => onPresetChange(e.target.value)}>
              <optgroup label="Historik">
                <option value="last_week">Förra veckan</option>
                <option value="last_month">Föregående månad</option>
              </optgroup>
              <optgroup label="Nu">
                <option value="this_week">Denna vecka</option>
                <option value="this_month">Denna månad</option>
              </optgroup>
              <optgroup label="Planerat (kommande)">
                <option value="next_week">Nästa vecka</option>
                <option value="next_month">Nästa månad</option>
              </optgroup>
              <option value="custom">Anpassat datumintervall</option>
            </Select>
          </Field>
          <Field label="Från datum" hint={preset !== 'custom' ? 'Aktiveras vid anpassat intervall' : ''}>
            <Input
              type="date"
              value={from}
              onChange={e => onFromChange(e.target.value)}
              disabled={preset !== 'custom'}
            />
          </Field>
          <Field label="Till datum">
            <Input
              type="date"
              value={to}
              onChange={e => onToChange(e.target.value)}
              disabled={preset !== 'custom'}
            />
          </Field>
        </div>
      </Card>
    );
  }

  function ReportScopeFilters({ customerId, cleanerId, propertyId, onCustomerChange, onCleanerChange, onPropertyChange, customers, cleaners, properties }) {
    return (
      <Card padding="md" className="mb-4">
        <h3 className="text-sm font-bold text-slate-900 mb-3">Filtrera urval</h3>
        <div className="grid md:grid-cols-3 gap-3">
          <Field label="Kund">
            <Select value={customerId} onChange={e => onCustomerChange(e.target.value)}>
              <option value="all">Alla kunder</option>
              {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="Städare">
            <Select value={cleanerId} onChange={e => onCleanerChange(e.target.value)}>
              <option value="all">Alla städare</option>
              {cleaners.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="Objekt">
            <Select value={propertyId} onChange={e => onPropertyChange(e.target.value)}>
              <option value="all">Alla objekt</option>
              {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </Field>
        </div>
      </Card>
    );
  }

  function ReportTable({ title, headers, rows, emptyText = 'Inget att visa för vald period.' }) {
    return (
      <Card padding="md" className="mb-4">
        <h3 className="font-bold text-slate-900 mb-3">{title}</h3>
        {rows.length === 0 ? (
          <p className="text-sm text-slate-500">{emptyText}</p>
        ) : (
          <div className="overflow-x-auto -mx-2">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">
                  {headers.map(h => (
                    <th key={h.key} className="px-2 py-2">{h.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {rows.map((row, i) => (
                  <tr key={row.id || i} className="hover:bg-slate-50/80">
                    {headers.map(h => (
                      <td key={h.key} className="px-2 py-2.5 text-slate-800">{row[h.key]}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    );
  }

  async function hydrateReportData(userId) {
    if (window.SUPABASE_ENABLED && typeof window.hydrateFromSupabase === 'function') {
      await window.hydrateFromSupabase(userId);
      return new Date();
    }
    if (typeof db.runShiftFinalization === 'function') {
      await db.runShiftFinalization(userId);
      return new Date();
    }
    return null;
  }

  function AdminReportsView({ session }) {
    const dbVersion = useDb();
    const [preset, setPreset] = useState('this_month');
    const [from, setFrom] = useState(toDateInput(new Date()));
    const [to, setTo] = useState(toDateInput(new Date()));
    const [customerId, setCustomerId] = useState('all');
    const [cleanerId, setCleanerId] = useState('all');
    const [propertyId, setPropertyId] = useState('all');
    const [detailTab, setDetailTab] = useState('all');
    const [report, setReport] = useState(null);
    const [reportFilters, setReportFilters] = useState(null);
    const [dataSyncedAt, setDataSyncedAt] = useState(null);
    const [generating, setGenerating] = useState(false);
    const [exporting, setExporting] = useState(null);

    const customers = db.state.customers.slice().sort((a, b) => a.name.localeCompare(b.name, 'sv'));
    const cleaners = db.state.users.filter(u => u.role === 'cleaner' && u.active).sort((a, b) => a.name.localeCompare(b.name, 'sv'));
    let scopedProperties = db.state.properties;
    if (customerId !== 'all') scopedProperties = scopedProperties.filter(p => p.customer_id === customerId);
    scopedProperties = scopedProperties.slice().sort((a, b) => a.name.localeCompare(b.name, 'sv'));

    function currentFilters() {
      return {
        preset,
        from: preset === 'custom' ? from : null,
        to: preset === 'custom' ? to : null,
        customerId,
        cleanerId,
        propertyId,
      };
    }

    function buildFromFilters(filters) {
      return db.buildAdminReport(filters);
    }

    async function generate() {
      setGenerating(true);
      try {
        const syncedAt = await hydrateReportData(session.userId);
        if (syncedAt) setDataSyncedAt(syncedAt);
        const filters = currentFilters();
        setReportFilters(filters);
        setReport(buildFromFilters(filters));
      } catch (e) {
        console.error(e);
        toast.error('Kunde inte hämta senaste data från databasen.');
      } finally {
        setGenerating(false);
      }
    }

    useEffect(() => {
      setReport(null);
      setReportFilters(null);
      setDataSyncedAt(null);
    }, [preset, from, to, customerId, cleanerId, propertyId]);

    useEffect(() => {
      if (!reportFilters) return;
      setReport(buildFromFilters(reportFilters));
      if (window.SUPABASE_ENABLED) setDataSyncedAt(new Date());
    }, [dbVersion]);

    function handleCustomerChange(id) {
      setCustomerId(id);
      setPropertyId('all');
    }

    async function exportExcel() {
      if (!report || !window.ReportExport) return;
      setExporting('xlsx');
      try {
        const syncedAt = await hydrateReportData(session.userId);
        let exportReport = report;
        if (syncedAt && reportFilters) {
          exportReport = buildFromFilters(reportFilters);
          setReport(exportReport);
          setDataSyncedAt(syncedAt);
        }
        const { sheets, periodLabel } = window.ReportExport.adminReportToExport(exportReport);
        const safe = periodLabel.replace(/[^\w\d-]+/g, '_').slice(0, 40);
        await window.ReportExport.exportReportXlsx({ filename: `cleanup-admin-rapport-${safe}.xlsx`, sheets });
        toast.success('Excel-fil nedladdad.');
      } catch (e) {
        console.error(e);
        toast.error('Kunde inte exportera Excel. Försök igen.');
      } finally {
        setExporting(null);
      }
    }

    async function exportPdf() {
      if (!report || !window.ReportExport) return;
      setExporting('pdf');
      try {
        const syncedAt = await hydrateReportData(session.userId);
        let exportReport = report;
        if (syncedAt && reportFilters) {
          exportReport = buildFromFilters(reportFilters);
          setReport(exportReport);
          setDataSyncedAt(syncedAt);
        }
        const { pdfSections, periodLabel } = window.ReportExport.adminReportToExport(exportReport);
        const safe = periodLabel.replace(/[^\w\d-]+/g, '_').slice(0, 40);
        await window.ReportExport.exportReportPdf({
          filename: `cleanup-admin-rapport-${safe}.pdf`,
          title: 'CleanUp – Adminrapport',
          subtitle: `Period: ${periodLabel} · Genererad ${formatDateLong(new Date())}`,
          sections: pdfSections,
        });
        toast.success('PDF nedladdad.');
      } catch (e) {
        console.error(e);
        toast.error('Kunde inte exportera PDF. Försök igen.');
      } finally {
        setExporting(null);
      }
    }

    const s = report?.summary;
    const shiftDetailHeaders = [
      { key: 'date', label: 'Datum' },
      { key: 'customerName', label: 'Kund' },
      { key: 'propertyName', label: 'Objekt' },
      { key: 'cleanerName', label: 'Städare' },
      { key: 'status', label: 'Status' },
      { key: 'plannedStart', label: 'Plan. start' },
      { key: 'plannedEnd', label: 'Plan. slut' },
      { key: 'actualStart', label: 'Fakt. start' },
      { key: 'actualEnd', label: 'Fakt. slut' },
      { key: 'plannedHours', label: 'Plan. tim' },
      { key: 'workedHours', label: 'Arb. tim' },
      { key: 'completionNote', label: 'Klarmarkering' },
    ];
    const detailTabs = [
      { id: 'all', label: 'Alla pass', rows: report?.shiftDetails || [] },
      { id: 'worked', label: 'Utförda', rows: (report?.shiftDetails || []).filter(r => r.status === 'Utfört') },
      { id: 'planned', label: 'Planerade', rows: (report?.shiftDetails || []).filter(r => r.status === 'Godkänt' || r.status === 'Planerat' || r.status === 'Pågående') },
      { id: 'sick', label: 'Sjuka', rows: report?.sickShifts || [] },
      { id: 'deleted', label: 'Borttagna', rows: report?.deletedShifts || [] },
      { id: 'cancelled', label: 'Avbokade', rows: report?.cancelledShifts || [] },
      { id: 'paused', label: 'Pausade', rows: report?.pausedShifts || [] },
    ];
    const activeDetail = detailTabs.find(t => t.id === detailTab) || detailTabs[0];

    return (
      <div>
        <PageHeader
          title="Rapporter"
          subtitle="KPI:er och löneunderlag för revisor. Arbetade timmar = utförda pass (manuell utcheckning eller automatisk klarmarkering efter sluttid). Filtrera på kund, städare och period."
          actions={
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" icon="file-text" disabled={generating} onClick={generate}>
                {generating ? 'Hämtar data…' : 'Generera rapport'}
              </Button>
              {report && (
                <>
                  <Button variant="outline" icon="download" disabled={!!exporting || generating} onClick={exportExcel}>
                    {exporting === 'xlsx' ? 'Exporterar…' : 'Exportera Excel'}
                  </Button>
                  <Button variant="outline" icon="download" disabled={!!exporting || generating} onClick={exportPdf}>
                    {exporting === 'pdf' ? 'Exporterar…' : 'Exportera PDF'}
                  </Button>
                </>
              )}
            </div>
          }
        />

        <ReportPeriodFilters
          preset={preset}
          onPresetChange={setPreset}
          from={from}
          to={to}
          onFromChange={setFrom}
          onToChange={setTo}
        />

        <ReportScopeFilters
          customerId={customerId}
          cleanerId={cleanerId}
          propertyId={propertyId}
          onCustomerChange={handleCustomerChange}
          onCleanerChange={setCleanerId}
          onPropertyChange={setPropertyId}
          customers={customers}
          cleaners={cleaners}
          properties={scopedProperties}
        />

        {!report ? (
          <Card padding="lg">
            <EmptyState
              icon="file-text"
              title="Ingen rapport genererad"
              description="Välj period, filter och klicka på Generera rapport. Data hämtas direkt från Supabase."
            />
          </Card>
        ) : (
          <>
            <p className="text-sm text-slate-600 mb-4">
              Period: <span className="font-semibold text-slate-900">{report.meta.label}</span>
              {report.meta.filterLabel && report.meta.filterLabel !== 'Alla kunder & städare' && (
                <span className="text-slate-500"> · Filter: {report.meta.filterLabel}</span>
              )}
              {dataSyncedAt && (
                <span className="block text-xs text-slate-500 mt-1">
                  Senast synkad {formatTime(dataSyncedAt)}
                  {window.SUPABASE_ENABLED && ' · uppdateras automatiskt vid ändringar i schemat'}
                </span>
              )}
            </p>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
              <Stat label="Arbetade timmar" value={s.totalHours} hint={`${s.shiftCountWorked} utförda pass`} icon="clock" tone="brand" />
              <Stat label="Planerade timmar" value={s.totalPlannedHours} hint={`${s.shiftCountBooked} bokade pass`} icon="calendar" tone="accent" />
              <Stat label="Sjuka pass" value={s.shiftCountSick} hint={`${s.sickPlannedHours} planerade timmar`} icon="alert-circle" tone="amber" />
              <Stat label="Avvikelser" value={s.totalIncidents} icon="alert-triangle" tone="rose" />
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
              <Stat label="Borttagna pass" value={s.shiftCountDeleted} icon="trash" tone="slate" />
              <Stat label="Avbokade pass" value={s.shiftCountCancelled} icon="x" tone="slate" />
              <Stat label="Pausade (ledighet)" value={s.shiftCountPaused} icon="pause" tone="slate" />
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
              <Stat label="Städarbyten" value={s.totalCleanerSwaps} hint="Alla byten i perioden" icon="refresh" tone="amber" />
              <Stat label="Justerade tider" value={s.totalTimeAdjusted} hint={`${s.totalSickReports} sjukanmälan`} icon="refresh" tone="amber" />
            </div>
            {s.statsNote && (
              <p className="text-xs text-slate-500 mb-6">{s.statsNote}</p>
            )}

            <Card padding="md" className="mb-6">
              <div className="flex flex-wrap gap-2 mb-4">
                {detailTabs.map(t => (
                  <Button
                    key={t.id}
                    size="sm"
                    variant={detailTab === t.id ? 'primary' : 'outline'}
                    onClick={() => setDetailTab(t.id)}
                  >
                    {t.label} ({t.rows.length})
                  </Button>
                ))}
              </div>
              <ReportTable
                title={`Passdetaljer – ${activeDetail.label} (lämpligt för revisor/löneunderlag)`}
                headers={shiftDetailHeaders}
                rows={activeDetail.rows}
                emptyText="Inga pass i den här kategorin för valt urval."
              />
            </Card>

            <ReportTable
              title="Arbetade timmar per kund"
              headers={[
                { key: 'name', label: 'Kund' },
                { key: 'hours', label: 'Arbetade timmar' },
                { key: 'shiftCount', label: 'Utförda pass' },
              ]}
              rows={report.byCustomer.map(r => ({ ...r, hours: r.hours.toFixed(2) }))}
            />
            <ReportTable
              title="Arbetade timmar per objekt"
              headers={[
                { key: 'customerName', label: 'Kund' },
                { key: 'name', label: 'Objekt' },
                { key: 'hours', label: 'Arbetade timmar' },
                { key: 'shiftCount', label: 'Utförda pass' },
              ]}
              rows={report.byProperty.map(r => ({ ...r, hours: r.hours.toFixed(2) }))}
            />
            <ReportTable
              title="Arbetade timmar per städare"
              headers={[
                { key: 'name', label: 'Städare' },
                { key: 'hours', label: 'Arbetade timmar' },
                { key: 'shiftCount', label: 'Utförda pass' },
              ]}
              rows={report.byCleaner.map(r => ({ ...r, hours: r.hours.toFixed(2) }))}
            />
            <ReportTable
              title="Sjukanmälan per städare"
              headers={[
                { key: 'name', label: 'Städare' },
                { key: 'count', label: 'Sjuka pass' },
                { key: 'plannedHours', label: 'Planerade timmar' },
              ]}
              rows={report.sickByCleaner.map(r => ({
                ...r,
                plannedHours: (r.plannedHours || 0).toFixed(2),
              }))}
            />
            <ReportTable
              title="Statistik per städare (miss, utfört, sjuk, förhinder)"
              headers={[
                { key: 'name', label: 'Städare' },
                { key: 'assignedCount', label: 'Tilldelade pass' },
                { key: 'workedCount', label: 'Utförda pass' },
                { key: 'workedHours', label: 'Arbetade timmar' },
                { key: 'sickCount', label: 'Sjukanmäld' },
                { key: 'noShowCount', label: 'Uteblev (ej incheckad)' },
                { key: 'obstacleCount', label: 'Förhinder' },
                { key: 'missCount', label: 'Miss totalt' },
                { key: 'missRate', label: 'Miss-%' },
                { key: 'swappedOutCount', label: 'Byten bort' },
              ]}
              rows={(report.cleanerStats || []).map(r => ({
                ...r,
                workedHours: (r.workedHours || 0).toFixed(2),
                missRate: `${r.missRate}%`,
              }))}
              emptyText="Inga tilldelade pass för valt urval."
            />
            <ReportTable
              title="Statistik per kund (pass, timmar, avbokningar, städarbyten)"
              headers={[
                { key: 'name', label: 'Kund' },
                { key: 'bookedCount', label: 'Bokade pass' },
                { key: 'workedCount', label: 'Utförda pass' },
                { key: 'workedHours', label: 'Arbetade timmar' },
                { key: 'cancelledCount', label: 'Kundavbokningar' },
                { key: 'cleanerSwapCount', label: 'Städarbyten' },
              ]}
              rows={(report.customerOps || []).map(r => ({
                ...r,
                workedHours: (r.workedHours || 0).toFixed(2),
              }))}
              emptyText="Inga kunder i valt urval."
            />
          </>
        )}
      </div>
    );
  }

  function CustomerReportsMain({ session }) {
    const dbVersion = useDb();
    const accessibleProps = db.propertiesForUser(session.userId);
    const isEmployee = session.user.role === 'customer_employee';
    const scopeHint = isEmployee && accessibleProps.length > 0
      ? `Baserat på ${accessibleProps.length} objekt du har åtkomst till.`
      : null;
    const [preset, setPreset] = useState('this_month');
    const [from, setFrom] = useState(toDateInput(new Date()));
    const [to, setTo] = useState(toDateInput(new Date()));
    const [report, setReport] = useState(null);
    const [reportFilters, setReportFilters] = useState(null);
    const [dataSyncedAt, setDataSyncedAt] = useState(null);
    const [generating, setGenerating] = useState(false);
    const [exporting, setExporting] = useState(null);

    function currentFilters() {
      return {
        preset,
        from: preset === 'custom' ? from : null,
        to: preset === 'custom' ? to : null,
      };
    }

    function buildFromFilters(filters) {
      return db.buildCustomerReport(session.userId, filters);
    }

    async function generate() {
      setGenerating(true);
      try {
        const syncedAt = await hydrateReportData(session.userId);
        if (syncedAt) setDataSyncedAt(syncedAt);
        const filters = currentFilters();
        setReportFilters(filters);
        setReport(buildFromFilters(filters));
      } catch (e) {
        console.error(e);
        toast.error('Kunde inte hämta senaste data.');
      } finally {
        setGenerating(false);
      }
    }

    useEffect(() => {
      setReport(null);
      setReportFilters(null);
      setDataSyncedAt(null);
    }, [preset, from, to]);

    useEffect(() => {
      if (!reportFilters) return;
      setReport(buildFromFilters(reportFilters));
      if (window.SUPABASE_ENABLED) setDataSyncedAt(new Date());
    }, [dbVersion]);

    async function exportExcel() {
      if (!report || !window.ReportExport) return;
      setExporting('xlsx');
      try {
        const syncedAt = await hydrateReportData(session.userId);
        let exportReport = report;
        if (syncedAt && reportFilters) {
          exportReport = buildFromFilters(reportFilters);
          setReport(exportReport);
        }
        const { sheets, periodLabel } = window.ReportExport.customerReportToExport(exportReport);
        const safe = periodLabel.replace(/[^\w\d-]+/g, '_').slice(0, 40);
        await window.ReportExport.exportReportXlsx({ filename: `cleanup-kund-rapport-${safe}.xlsx`, sheets });
        toast.success('Excel-fil nedladdad.');
      } catch (e) {
        toast.error('Kunde inte exportera Excel.');
      } finally {
        setExporting(null);
      }
    }

    async function exportPdf() {
      if (!report || !window.ReportExport) return;
      setExporting('pdf');
      try {
        const syncedAt = await hydrateReportData(session.userId);
        let exportReport = report;
        if (syncedAt && reportFilters) {
          exportReport = buildFromFilters(reportFilters);
          setReport(exportReport);
        }
        const { pdfSections, periodLabel } = window.ReportExport.customerReportToExport(exportReport);
        const safe = periodLabel.replace(/[^\w\d-]+/g, '_').slice(0, 40);
        await window.ReportExport.exportReportPdf({
          filename: `cleanup-kund-rapport-${safe}.pdf`,
          title: 'CleanUp – Kundrapport',
          subtitle: `${report.meta.customerName} · ${periodLabel}`,
          sections: pdfSections,
        });
        toast.success('PDF nedladdad.');
      } catch (e) {
        toast.error('Kunde inte exportera PDF.');
      } finally {
        setExporting(null);
      }
    }

    const s = report?.summary;

    return (
      <div>
        <PageHeader
          title="Rapporter"
          subtitle={scopeHint || 'Översikt av bokade pass och arbetade timmar (inkl. automatiskt klarmarkerade pass efter sluttid). Städare visas som ”Städare” enligt era visningsregler.'}
          actions={
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" icon="file-text" disabled={generating} onClick={generate}>
                {generating ? 'Hämtar data…' : 'Generera rapport'}
              </Button>
              {report && (
                <>
                  <Button variant="outline" icon="download" disabled={!!exporting || generating} onClick={exportExcel}>
                    {exporting === 'xlsx' ? 'Exporterar…' : 'Exportera Excel'}
                  </Button>
                  <Button variant="outline" icon="download" disabled={!!exporting || generating} onClick={exportPdf}>
                    {exporting === 'pdf' ? 'Exporterar…' : 'Exportera PDF'}
                  </Button>
                </>
              )}
            </div>
          }
        />

        <ReportPeriodFilters
          preset={preset}
          onPresetChange={setPreset}
          from={from}
          to={to}
          onFromChange={setFrom}
          onToChange={setTo}
        />

        {!report ? (
          <Card padding="lg">
            <EmptyState icon="file-text" title="Ingen rapport genererad" description="Välj period och klicka Generera rapport. Data hämtas direkt från Supabase." />
          </Card>
        ) : (
          <>
            <p className="text-sm text-slate-600 mb-4">
              Period: <span className="font-semibold text-slate-900">{report.meta.label}</span>
              {dataSyncedAt && (
                <span className="block text-xs text-slate-500 mt-1">
                  Senast synkad {formatTime(dataSyncedAt)}
                  {window.SUPABASE_ENABLED && ' · uppdateras automatiskt vid ändringar'}
                </span>
              )}
            </p>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <Stat label="Bokade pass" value={s.bookedCount} hint={`${s.plannedHours} planerade timmar`} icon="calendar" tone="brand" />
              <Stat label="Utförda pass" value={s.workedPassCount} hint={`${s.workedHours} arbetade timmar`} icon="check" tone="emerald" />
              <Stat label="Arbetade timmar" value={s.workedHours} hint={`${s.workedPassCount} utförda pass`} icon="clock" tone="emerald" />
            </div>
          </>
        )}
      </div>
    );
  }

  function CustomerReportsView({ session }) {
    return <CustomerReportsMain session={session} />;
  }

  function customerPropertyShiftSummary(propertyId) {
    const isActive = s => !['Avbokat', 'Borttaget'].includes(s.status);
    const all = db.shiftsForProperty(propertyId);
    const upcoming = all.filter(s => new Date(s.end_at) >= Date.now() && isActive(s));
    const next = upcoming.sort((a, b) => new Date(a.start_at) - new Date(b.start_at))[0] || null;
    const lastDone = all
      .filter(s => s.status === 'Utfört' && new Date(s.end_at) < Date.now())
      .sort((a, b) => new Date(b.end_at) - new Date(a.end_at))[0] || null;
    return { next, lastDone, upcomingCount: upcoming.length };
  }

  function checklistCompletionForShift(shiftId) {
    const items = db.checklistForShift(shiftId);
    const done = items.filter(i => i.done_at).length;
    const total = items.length;
    return { done, total, pct: total ? Math.round((done / total) * 100) : null };
  }

  function CustomerPropertyCard({ property, session, onNavigate }) {
    useDb();
    const { next, lastDone, upcomingCount } = customerPropertyShiftSummary(property.id);
    const checklistCount = db.listChecklistTemplate(property.id, { includeInactive: false }).length;
    const recurringCount = db.listRecurringSchedules(property.id).filter(r => r.active !== false).length;
    const lastCompletion = lastDone ? checklistCompletionForShift(lastDone.id) : null;

    return (
      <Card
        as="button"
        type="button"
        padding="md"
        className="text-left w-full hover:border-brand-300 hover:shadow-sm transition-all cursor-pointer"
        onClick={() => onNavigate(`/kund/objekt/${property.id}`)}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-slate-900 truncate">{property.name}</p>
            <p className="text-xs text-slate-500 mt-0.5 truncate">{property.address || 'Ingen adress angiven'}</p>
            {property.area_sqm && (
              <p className="text-[11px] text-slate-400 mt-1">{property.area_sqm} m²</p>
            )}
          </div>
          <Icon name="building" className="w-5 h-5 text-slate-300 flex-shrink-0" />
        </div>

        <div className="mt-3 pt-3 border-t border-slate-100 grid grid-cols-2 gap-2 text-[11px]">
          <div>
            <span className="text-slate-500 block">Kommande</span>
            <span className="font-semibold text-slate-800">{upcomingCount} pass</span>
          </div>
          <div>
            <span className="text-slate-500 block">Städschema</span>
            <span className="font-semibold text-slate-800">{checklistCount} punkter</span>
          </div>
        </div>

        {next && (
          <div className="mt-3 pt-3 border-t border-slate-100 text-xs text-slate-600 flex items-center gap-2 flex-wrap">
            <Icon name="calendar" className="w-3.5 h-3.5 text-brand-500 flex-shrink-0" />
            <span>
              Nästa: <span className="font-medium text-slate-800">{relativeDay(next.start_at)} {formatRange(next.start_at, next.end_at)}</span>
            </span>
            <StatusBadge status={next.status} />
          </div>
        )}

        {lastDone && (
          <div className="mt-2 text-xs text-slate-500 flex items-center gap-2 flex-wrap">
            <Icon name="check-circle" className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
            <span>
              Senast utfört: {formatDateShort(lastDone.end_at)}
              {lastCompletion?.pct != null && (
                <span className="text-emerald-700 font-medium"> · {lastCompletion.pct}% av städschemat</span>
              )}
            </span>
          </div>
        )}

        {recurringCount > 0 && !next && (
          <p className="mt-2 text-[11px] text-slate-400">{recurringCount} återkommande {recurringCount === 1 ? 'schema' : 'scheman'}</p>
        )}
      </Card>
    );
  }

  function CustomerChecklistReadonly({ propertyId }) {
    useDb();
    const items = db.listChecklistTemplate(propertyId, { includeInactive: false });
    return (
      <Card padding="md">
        <div className="mb-4">
          <h3 className="font-bold text-slate-900">Städschema</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Det här är mallen som städaren följer vid varje pass. I pass-detaljen ser du vad som faktiskt utförts.
          </p>
        </div>
        {items.length === 0 ? (
          <EmptyState icon="list" title="Inget städschema upplagt" description="Kontakta CleanUp om ni vill lägga till checklistpunkter." className="py-6" />
        ) : (
          <ol className="space-y-2">
            {items.map((it, idx) => (
              <li key={it.id} className="flex items-start gap-3 p-3 rounded-xl bg-slate-50 border border-slate-100">
                <span className="w-7 h-7 rounded-lg bg-white border border-slate-200 text-xs font-bold text-slate-500 flex items-center justify-center flex-shrink-0">
                  {idx + 1}
                </span>
                <p className="text-sm text-slate-800 pt-0.5">{it.title}</p>
              </li>
            ))}
          </ol>
        )}
      </Card>
    );
  }

  function CustomerRecurringReadonly({ propertyId }) {
    useDb();
    const items = db.listRecurringSchedules(propertyId).filter(r => r.active !== false);
    return (
      <Card padding="md">
        <div className="mb-4">
          <h3 className="font-bold text-slate-900">Återkommande städning</h3>
          <p className="text-xs text-slate-500 mt-0.5">Fasta tider som CleanUp planerar in automatiskt.</p>
        </div>
        {items.length === 0 ? (
          <EmptyState icon="refresh" title="Inget återkommande schema" description="Pass bokas manuellt eller via förfrågan." className="py-6" />
        ) : (
          <ul className="divide-y divide-slate-100 -mx-2">
            {items.map(rs => (
              <li key={rs.id} className="px-2 py-3 flex items-center gap-3">
                <span className="w-10 h-10 rounded-xl bg-brand-50 text-brand-700 text-xs font-bold flex items-center justify-center flex-shrink-0">
                  {WEEKDAYS_SHORT[rs.weekday]}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-slate-900 text-sm">
                    {recurringScheduleTitle(rs)} · {rs.start_time}–{rs.end_time}
                    {rs.label ? <span className="text-slate-500 font-normal"> · {rs.label}</span> : null}
                  </p>
                  {(rs.valid_from || rs.valid_to) && (
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Giltig {rs.valid_from ? formatDateShort(rs.valid_from) : '–'}
                      {rs.valid_to ? ` → ${formatDateShort(rs.valid_to)}` : ' → tills vidare'}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    );
  }

  function PropertyStandingRequestsSection({ propertyId, session }) {
    useDb();
    const requests = db.standingRequestsForProperty(propertyId);
    const canAdd = session.user.role === 'customer';
    const [body, setBody] = useState('');
    const [saving, setSaving] = useState(false);

    async function submit() {
      const text = body.trim();
      if (text.length < 3 || saving) return;
      setSaving(true);
      const r = await db.createShiftRequest({
        propertyId,
        shiftId: null,
        scope: 'standing',
        body: text,
        createdByUserId: session.userId,
      });
      setSaving(false);
      if (r?.ok) {
        setBody('');
        toast.success('Stående önskemål sparat.');
      } else if (r?.error === 'PERSIST_FAILED') {
        toast.error('Kunde inte spara – försök igen.');
      } else if (r?.error === 'FORBIDDEN') {
        toast.error('Du har inte behörighet att lägga till önskemål.');
      }
    }

    return (
      <Card padding="md">
        <div className="mb-3">
          <h3 className="font-bold text-slate-900">Stående önskemål</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Gäller alla framtida pass på det här objektet tills ni tar bort dem.
          </p>
        </div>
        {requests.length === 0 ? (
          <EmptyState icon="message-square" title="Inga stående önskemål" description={canAdd ? 'Lägg till instruktioner som städaren ska följa löpande.' : 'Huvudkontakten kan lägga till önskemål här.'} className="py-6" />
        ) : (
          <ul className="space-y-2 mb-1">
            {requests.map(r => (
              <li key={r.id} className="flex items-start gap-3 p-3 rounded-xl bg-slate-50 border border-slate-100">
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] text-slate-400 mb-1">{formatDateTime(r.created_at)}</p>
                  <p className="text-sm text-slate-800 whitespace-pre-wrap break-words">{r.body}</p>
                </div>
                {canAdd && (
                  <button
                    onClick={async () => {
                      const res = await db.deleteShiftRequest(r.id);
                      if (res?.ok) toast.success('Önskemål borttaget.');
                      else if (res?.error === 'PERSIST_FAILED') toast.error('Kunde inte ta bort – försök igen.');
                    }}
                    className="text-slate-400 hover:text-rose-600 p-1 rounded-lg flex-shrink-0"
                    aria-label="Ta bort önskemål"
                  >
                    <Icon name="trash" className="w-4 h-4" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {canAdd && (
          <div className="mt-4 pt-4 border-t border-slate-100">
            <Field label="Nytt stående önskemål" hint="Minst 3 tecken.">
              <Textarea
                rows={2}
                value={body}
                onChange={e => setBody(e.target.value)}
                placeholder="T.ex. Använd alltid den gröna moppen i konferensrummet."
              />
            </Field>
            <Button variant="primary" icon="send" className="mt-2" disabled={body.trim().length < 3 || saving} onClick={submit}>
              Lägg till
            </Button>
          </div>
        )}
      </Card>
    );
  }

  function CustomerPropertiesView({ session, onNavigate }) {
    useDb();
    const [requestOpen, setRequestOpen] = useState(false);
    const props = db.propertiesForUser(session.userId).slice().sort((a, b) => a.name.localeCompare(b.name, 'sv'));
    const isEmployee = session.user.role === 'customer_employee';
    const totalUpcoming = props.reduce((n, p) => n + customerPropertyShiftSummary(p.id).upcomingCount, 0);

    return (
      <div>
        <PageHeader
          title="Objekt"
          subtitle={isEmployee
            ? 'Objekt du har läsåtkomst till – klicka för schema och historik.'
            : 'Era lokaler – kommande pass, städschema och senaste utförda städning.'}
          actions={
            session.user.role === 'customer' ? (
              <Button icon="plus" onClick={() => setRequestOpen(true)}>Begär städning</Button>
            ) : null
          }
        />

        {props.length > 0 && (
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
            <Stat label="Objekt" value={props.length} icon="building" tone="brand" />
            <Stat label="Kommande pass" value={totalUpcoming} icon="calendar" tone="accent" />
            {isEmployee && <Stat label="Åtkomst" value="Läsbehörighet" icon="eye" tone="slate" />}
          </div>
        )}

        {props.length === 0 ? (
          <Card padding="lg"><EmptyState icon="building" title="Inga objekt" description="Kontakta admin om du saknar åtkomst." /></Card>
        ) : (
          <div className="grid md:grid-cols-2 gap-3">
            {props.map(p => (
              <CustomerPropertyCard key={p.id} property={p} session={session} onNavigate={onNavigate} />
            ))}
          </div>
        )}
        <CustomerShiftRequestModal open={requestOpen} onClose={() => setRequestOpen(false)} session={session} />
      </div>
    );
  }

  function CustomerPropertyView({ session, onNavigate, propertyId }) {
    useDb();
    const [requestOpen, setRequestOpen] = useState(false);
    const [tab, setTab] = useState('oversikt');
    const allowed = db.propertiesForUser(session.userId).some(p => p.id === propertyId);
    const prop = db.propertyById(propertyId);
    const isMainContact = session.user.role === 'customer';

    if (!prop || !allowed) {
      return (
        <div>
          <PageHeader title="Åtkomst nekas" />
          <Card padding="lg"><EmptyState icon="shield" title="Det här objektet tillhör inte dig" action={<Button onClick={() => onNavigate('/kund/objekt')}>Till objekt</Button>} /></Card>
        </div>
      );
    }

    const shifts = db.shiftsForProperty(propertyId);
    const isActive = s => !['Avbokat', 'Borttaget'].includes(s.status);
    const upcoming = shifts.filter(s => new Date(s.end_at) >= Date.now() && isActive(s))
      .sort((a, b) => new Date(a.start_at) - new Date(b.start_at));
    const { lastDone } = customerPropertyShiftSummary(propertyId);
    const lastCompletion = lastDone ? checklistCompletionForShift(lastDone.id) : null;
    const checklistCount = db.listChecklistTemplate(propertyId, { includeInactive: false }).length;
    const standingCount = db.standingRequestsForProperty(propertyId).length;

    const tabs = [
      { id: 'oversikt', label: 'Översikt', icon: 'home' },
      { id: 'schema', label: 'Schema', icon: 'calendar', count: upcoming.length },
      { id: 'stadschema', label: 'Städschema', icon: 'list', count: checklistCount },
      { id: 'onskemal', label: 'Önskemål', icon: 'message-square', count: standingCount },
    ];

    return (
      <div>
        <PageHeader
          breadcrumbs={[{ label: 'Objekt', href: '#/kund/objekt' }, { label: prop.name }]}
          title={prop.name}
          subtitle={[prop.address, prop.area_sqm ? `${prop.area_sqm} m²` : null].filter(Boolean).join(' · ') || 'Ingen adress angiven'}
          actions={
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" icon="calendar" onClick={() => onNavigate('/kund/schema')}>Hela schemat</Button>
              {isMainContact && (
                <Button icon="plus" onClick={() => setRequestOpen(true)}>Begär städning</Button>
              )}
            </div>
          }
        />

        <Tabs tabs={tabs} value={tab} onChange={setTab} className="mb-5" />

        {tab === 'oversikt' && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <Stat label="Kommande pass" value={upcoming.length} icon="calendar" tone="brand" />
              <Stat label="Städschema" value={checklistCount} hint="Checklistpunkter" icon="list" tone="accent" />
              <Stat label="Stående önskemål" value={standingCount} icon="message-square" tone="slate" />
              {prop.area_sqm && <Stat label="Yta" value={`${prop.area_sqm} m²`} icon="building" tone="emerald" />}
            </div>

            <CustomerRecurringReadonly propertyId={propertyId} />

            {lastDone && (
              <Card padding="md">
                <h3 className="font-bold text-slate-900 mb-3">Senaste utförda städning</h3>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{formatDateLong(lastDone.end_at)}</p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {formatRange(lastDone.start_at, lastDone.end_at)}
                      {lastCompletion?.pct != null && (
                        <span className="text-emerald-700 font-medium"> · {lastCompletion.done}/{lastCompletion.total} punkter ({lastCompletion.pct}%)</span>
                      )}
                    </p>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => onNavigate(`/kund/pass/${lastDone.id}`)}>Visa pass</Button>
                </div>
              </Card>
            )}

            {upcoming.length > 0 && (
              <section>
                <h3 className="text-sm font-bold text-slate-700 mb-2">Nästa pass</h3>
                <div className="grid md:grid-cols-2 gap-3">
                  {upcoming.slice(0, 4).map(s => (
                    <ShiftCard key={s.id} shift={s} viewerRole={session.user.role} viewerUserId={session.userId} onClick={() => onNavigate(`/kund/pass/${s.id}`)} />
                  ))}
                </div>
                {upcoming.length > 4 && (
                  <Button variant="ghost" size="sm" className="mt-3" onClick={() => setTab('schema')}>Visa alla {upcoming.length} pass</Button>
                )}
              </section>
            )}
          </div>
        )}

        {tab === 'schema' && (
          <div className="space-y-6">
            <ScheduleCalendar
              shifts={shifts}
              viewerRole={session.user.role}
              onSelectShift={s => onNavigate(`/kund/pass/${s.id}`)}
            />
            <section>
              <h3 className="text-lg font-bold text-slate-900 mb-3">Kommande pass</h3>
              {upcoming.length === 0 ? (
                <Card padding="md"><EmptyState icon="calendar" title="Inga kommande pass" description={isMainContact ? 'Begär städning om ni behöver ett nytt tillfälle.' : 'Kontakta huvudkontakten om ni behöver boka städning.'} /></Card>
              ) : (
                <div className="grid md:grid-cols-2 gap-3">
                  {upcoming.map(s => (
                    <ShiftCard key={s.id} shift={s} viewerRole={session.user.role} viewerUserId={session.userId} onClick={() => onNavigate(`/kund/pass/${s.id}`)} />
                  ))}
                </div>
              )}
            </section>
          </div>
        )}

        {tab === 'stadschema' && <CustomerChecklistReadonly propertyId={propertyId} />}

        {tab === 'onskemal' && <PropertyStandingRequestsSection propertyId={propertyId} session={session} />}

        <CustomerShiftRequestModal open={requestOpen} onClose={() => setRequestOpen(false)} session={session} preselectPropertyId={propertyId} />
      </div>
    );
  }

  function CustomerScheduleView({ session, onNavigate }) {
    useDb();
    const [requestOpen, setRequestOpen] = useState(false);
    const shifts = db.shiftsForCustomerUser(session.userId);
    return (
      <div>
        <PageHeader
          title="Schema"
          subtitle="Kalenderöversikt över alla pass på dina objekt. Grå = väntar på godkännande, grön = godkänt."
          actions={
            <Button icon="plus" onClick={() => setRequestOpen(true)}>Begär städning</Button>
          }
        />
        <ScheduleCalendar
          shifts={shifts}
          viewerRole={session.user.role}
          onSelectShift={s => onNavigate(`/kund/pass/${s.id}`)}
        />
        <CustomerShiftRequestModal open={requestOpen} onClose={() => setRequestOpen(false)} session={session} />
      </div>
    );
  }

  window.AdminReportsView = AdminReportsView;
  window.CustomerReportsView = CustomerReportsView;
  window.CustomerScheduleView = CustomerScheduleView;
  window.CustomerPropertiesView = CustomerPropertiesView;
  window.CustomerPropertyView = CustomerPropertyView;
  window.MessagesView = MessagesView;
})();
