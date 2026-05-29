/*
 * App-skal: router, session, layout, navigation.
 *
 * Routing: hash-baserad (#/path). Vi använder ASCII-slugs ("stadare", "kund")
 * för att slippa specialtecken i URL.
 *
 * Session: mock i minnet + localStorage. När Supabase Auth läggs på ersätter
 * vi useSession() med en wrapper kring supabase.auth.getSession().
 */
(function () {
  const { useState, useEffect, useMemo, useCallback, useSyncExternalStore } = React;

  /* ============================================================
   * Hash-router
   * ============================================================ */
  function readPath() {
    const h = window.location.hash || '#/';
    return h.startsWith('#') ? h.slice(1) : h;
  }
  const routeListeners = new Set();
  window.addEventListener('hashchange', () => routeListeners.forEach(l => l()));
  const router = {
    subscribe(fn) { routeListeners.add(fn); return () => routeListeners.delete(fn); },
    snapshot() { return window.location.hash || '#/'; },
    navigate(path) {
      if (!path.startsWith('#')) path = '#' + path;
      if (window.location.hash !== path) window.location.hash = path;
    },
  };
  function useRoute() {
    useSyncExternalStore(router.subscribe, router.snapshot, router.snapshot);
    return readPath();
  }

  // Enkel route-matcher: '/admin/kunder/:id' mot '/admin/kunder/c_1' → { id: 'c_1' }
  function matchPath(path, pattern) {
    const ps = pattern.split('/').filter(Boolean);
    const as = path.split('/').filter(Boolean);
    if (ps.length !== as.length) return null;
    const params = {};
    for (let i = 0; i < ps.length; i++) {
      if (ps[i].startsWith(':')) params[ps[i].slice(1)] = decodeURIComponent(as[i]);
      else if (ps[i] !== as[i]) return null;
    }
    return params;
  }
  window.router = router;
  window.matchPath = matchPath;

  /* ============================================================
   * Session-store
   * ============================================================ */
  const SESSION_KEY = 'cleanup_session_v1';
  let sessionState = (() => {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      const { userId } = JSON.parse(raw);
      return userId ? { userId } : null;
    } catch (_) { return null; }
  })();
  const sessionListeners = new Set();
  function emitSession() { sessionListeners.forEach(l => l()); }
  const sessionStore = {
    subscribe(fn) { sessionListeners.add(fn); return () => sessionListeners.delete(fn); },
    snapshot() { return sessionState; },
    login(userId) {
      sessionState = { userId };
      try { localStorage.setItem(SESSION_KEY, JSON.stringify(sessionState)); } catch (_) {}
      emitSession();
    },
    logout() {
      sessionState = null;
      try { localStorage.removeItem(SESSION_KEY); } catch (_) {}
      emitSession();
    },
  };
  function useSession() {
    const raw = useSyncExternalStore(sessionStore.subscribe, sessionStore.snapshot, sessionStore.snapshot);
    return useMemo(() => {
      if (!raw) return null;
      const user = db.userById(raw.userId);
      if (!user) return null;
      return { userId: user.id, user, role: user.role };
    }, [raw]);
  }

  /* ============================================================
   * Nav-konfiguration per roll
   * ============================================================ */
  const NAV = {
    admin: [
      { path: '/admin/dashboard', label: 'Dashboard', icon: 'home' },
      { path: '/admin/schema', label: 'Schema', icon: 'calendar' },
      { path: '/admin/kunder', label: 'Kunder', icon: 'briefcase' },
      { path: '/admin/stadare', label: 'Städare', icon: 'users' },
      { path: '/admin/avvikelser', label: 'Avvikelser', icon: 'alert-triangle' },
      { path: '/admin/installningar', label: 'Inställningar', icon: 'settings' },
    ],
    cleaner: [
      { path: '/stadare/idag', label: 'Idag', icon: 'home' },
      { path: '/stadare/pass', label: 'Mina pass', icon: 'calendar' },
      { path: '/stadare/avvikelser', label: 'Avvikelser', icon: 'alert-triangle' },
    ],
    customer: [
      { path: '/kund/oversikt', label: 'Översikt', icon: 'home' },
      { path: '/kund/objekt', label: 'Objekt', icon: 'building' },
      { path: '/kund/ledighet', label: 'Ledighet', icon: 'pause' },
      { path: '/kund/avvikelser', label: 'Avvikelser', icon: 'alert-triangle' },
      { path: '/kund/installningar', label: 'Inställningar', icon: 'settings' },
    ],
    customer_employee: [
      { path: '/kund/oversikt', label: 'Översikt', icon: 'home' },
      { path: '/kund/objekt', label: 'Objekt', icon: 'building' },
      { path: '/kund/avvikelser', label: 'Avvikelser', icon: 'alert-triangle' },
      { path: '/kund/installningar', label: 'Inställningar', icon: 'settings' },
    ],
  };

  function defaultPathForRole(role) {
    return NAV[role][0].path;
  }

  /* ============================================================
   * Layout: Sidebar
   * ============================================================ */
  function Sidebar({ session, currentPath, onNavigate, onClose }) {
    const nav = NAV[session.role] || [];
    return (
      <aside className="h-full w-64 bg-white border-r border-slate-200 flex flex-col">
        <div className="px-5 py-5 border-b border-slate-100 flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-brand-600 text-white flex items-center justify-center text-base font-extrabold">
            C<span className="text-accent-500">.</span>
          </div>
          <div className="min-w-0">
            <p className="font-extrabold text-slate-900 leading-none">CleanUp</p>
            <p className="text-[11px] text-slate-500 mt-0.5 uppercase tracking-wide">{roleLabel(session.role)}</p>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto py-3 px-3 space-y-0.5">
          {nav.map(item => {
            const active = currentPath.startsWith(item.path);
            return (
              <button
                key={item.path}
                onClick={() => { onNavigate(item.path); onClose && onClose(); }}
                className={cx(
                  'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-colors',
                  active ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50',
                )}
              >
                <Icon name={item.icon} className="w-5 h-5" />
                <span className="flex-1 text-left">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="px-3 py-3 border-t border-slate-100">
          <div className="flex items-center gap-3 px-2 py-2">
            <Avatar name={session.user.name} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-slate-900 truncate">{session.user.name}</p>
              <p className="text-[11px] text-slate-500 truncate">{session.user.email}</p>
            </div>
            <button
              onClick={() => { sessionStore.logout(); router.navigate('/'); }}
              className="text-slate-400 hover:text-rose-600 p-1.5 rounded-lg"
              aria-label="Logga ut"
              title="Logga ut"
            >
              <Icon name="logout" className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>
    );
  }

  function roleLabel(role) {
    return { admin: 'Admin', cleaner: 'Städare', customer: 'Kund', customer_employee: 'Kundanställd' }[role] || role;
  }

  /* ============================================================
   * Top bar
   * ============================================================ */
  function TopBar({ session, onOpenMenu }) {
    useDb();
    const unread = db.unreadCountForUser(session.userId);
    const [bellOpen, setBellOpen] = useState(false);
    const [switchOpen, setSwitchOpen] = useState(false);

    return (
      <header className="sticky top-0 z-40 bg-white/90 backdrop-blur border-b border-slate-200">
        <div className="h-14 px-4 sm:px-6 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button onClick={onOpenMenu} className="lg:hidden p-2 -ml-2 text-slate-600" aria-label="Öppna meny">
              <Icon name="menu" className="w-5 h-5" />
            </button>
            <div className="lg:hidden flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-brand-600 text-white flex items-center justify-center text-sm font-extrabold">
                C<span className="text-accent-500">.</span>
              </div>
              <span className="font-extrabold text-slate-900">CleanUp</span>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setSwitchOpen(true)}
              className="hidden sm:inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-xs font-semibold hover:bg-amber-100 transition-colors"
              title="Endast under utveckling — försvinner med Supabase Auth"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
              DEV · Byt profil
            </button>

            <button
              onClick={() => { setBellOpen(o => !o); }}
              className="relative w-9 h-9 rounded-lg text-slate-600 hover:bg-slate-100 flex items-center justify-center"
              aria-label="Notiser"
            >
              <Icon name="bell" className="w-5 h-5" />
              {unread > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-600 text-white text-[10px] font-bold flex items-center justify-center">
                  {unread > 9 ? '9+' : unread}
                </span>
              )}
            </button>
          </div>
        </div>

        {bellOpen && <NotificationsDropdown session={session} onClose={() => setBellOpen(false)} />}
        {switchOpen && <RoleSwitcherModal onClose={() => setSwitchOpen(false)} />}
      </header>
    );
  }

  function NotificationsDropdown({ session, onClose }) {
    const list = db.notificationsForUser(session.userId).slice(0, 12);
    useEffect(() => {
      const onClick = e => {
        if (!e.target.closest('[data-bell-dd]')) onClose();
      };
      setTimeout(() => document.addEventListener('click', onClick), 0);
      return () => document.removeEventListener('click', onClick);
    }, [onClose]);

    function describe(n) {
      const prop = n.payload?.property_id ? db.propertyById(n.payload.property_id) : null;
      switch (n.kind) {
        case 'sick_reported':
          return { title: 'Pass sjukanmält', body: prop ? `${prop.name} · ${formatDateTime(n.payload.start_at)}` : '', icon: 'alert-circle', tone: 'amber' };
        case 'assigned_shift':
          return { title: 'Du har tilldelats ett pass', body: prop ? `${prop.name} · ${formatDateTime(n.payload.start_at)}` : '', icon: 'sparkles', tone: 'brand' };
        case 'cleaner_swapped':
          return { title: 'Städare ombokad', body: prop ? `${prop.name} · ${formatDateTime(n.payload.start_at)}` : '', icon: 'swap', tone: 'brand' };
        case 'time_adjusted':
          return { title: 'Tid justerad', body: prop ? `${prop.name} · ${formatDateTime(n.payload.start_at)}` : '', icon: 'clock', tone: 'brand' };
        case 'customer_cancelled':
          return { title: 'Pass avbokat av kund', body: prop ? `${prop.name} · ${formatDateTime(n.payload.start_at)}` : '', icon: 'x', tone: 'rose' };
        case 'admin_deleted':
          return { title: 'Pass borttaget', body: prop ? `${prop.name} · ${formatDateTime(n.payload.start_at)}` : '', icon: 'trash', tone: 'rose' };
        case 'paused_by_holiday':
          return { title: 'Pass pausat (kundledighet)', body: prop ? `${prop.name} · ${formatDateTime(n.payload.start_at)}` : '', icon: 'pause', tone: 'sky' };
        case 'holiday_created':
          return { title: 'Ny kundledighet registrerad', body: `${n.payload.count} pass pausade.`, icon: 'calendar', tone: 'sky' };
        case 'holiday_removed':
          if (n.payload.shift_id) return { title: 'Pausat pass återaktiverat', body: prop ? `${prop.name} · ${formatDateTime(n.payload.start_at)}` : '', icon: 'refresh', tone: 'emerald' };
          return { title: 'Kundledighet borttagen', body: `${n.payload.restored} pass återaktiverade.`, icon: 'refresh', tone: 'emerald' };
        case 'incident_created':
          return { title: 'Nytt avvikelse-ärende', body: prop ? prop.name : '', icon: 'alert-triangle', tone: 'rose' };
        case 'incident_resolved':
          return { title: 'Ditt ärende är åtgärdat', body: '', icon: 'check-circle', tone: 'emerald' };
        case 'incident_in_progress':
          return { title: 'Ditt ärende behandlas', body: '', icon: 'refresh', tone: 'brand' };
        default:
          return { title: n.kind, body: '', icon: 'bell', tone: 'slate' };
      }
    }

    const tones = {
      amber: 'bg-amber-50 text-amber-700',
      brand: 'bg-brand-50 text-brand-700',
      rose: 'bg-rose-50 text-rose-700',
      sky: 'bg-sky-50 text-sky-700',
      emerald: 'bg-emerald-50 text-emerald-700',
      slate: 'bg-slate-100 text-slate-600',
    };

    return (
      <div data-bell-dd className="absolute right-3 top-12 w-[360px] max-w-[calc(100vw-1.5rem)] bg-white border border-slate-200 rounded-2xl shadow-xl overflow-hidden">
        <div className="px-4 py-3 flex items-center justify-between border-b border-slate-100">
          <h3 className="font-bold text-slate-900">Notiser</h3>
          <button onClick={() => { db.markAllRead(session.userId); }} className="text-xs font-semibold text-brand-700 hover:text-brand-800">
            Markera som lästa
          </button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto">
          {list.length === 0 ? (
            <EmptyState icon="bell" title="Inga notiser" className="py-8" />
          ) : (
            list.map(n => {
              const d = describe(n);
              return (
                <div key={n.id} className={cx('flex items-start gap-3 px-4 py-3 border-b border-slate-50 last:border-0', !n.read_at && 'bg-brand-50/30')}>
                  <span className={cx('w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0', tones[d.tone])}>
                    <Icon name={d.icon} className="w-4.5 h-4.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-900">{d.title}</p>
                    {d.body && <p className="text-xs text-slate-500 mt-0.5">{d.body}</p>}
                    <p className="text-[11px] text-slate-400 mt-1">{relativeDay(n.created_at)} · {formatTime(n.created_at)}</p>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    );
  }

  function RoleSwitcherModal({ onClose }) {
    const users = db.state.users;
    return (
      <Modal open onClose={onClose} title="Byt profil (utvecklingsläge)" size="md">
        <p className="text-sm text-slate-500 mb-4">
          Endast under utveckling. När Supabase Auth läggs på försvinner det här valet och varje användare loggar in via mejl.
        </p>
        <div className="space-y-1.5">
          {users.map(u => (
            <button
              key={u.id}
              onClick={() => {
                sessionStore.login(u.id);
                router.navigate(defaultPathForRole(u.role));
                onClose();
              }}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border border-slate-200 hover:border-brand-300 hover:bg-brand-50/40 transition-colors text-left"
            >
              <Avatar name={u.name} size="sm" />
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-slate-900 text-sm truncate">{u.name}</p>
                <p className="text-xs text-slate-500 truncate">{u.email}</p>
              </div>
              <Badge variant={u.role === 'admin' ? 'brand' : u.role === 'cleaner' ? 'accent' : 'emerald'}>{roleLabel(u.role)}</Badge>
            </button>
          ))}
        </div>
      </Modal>
    );
  }

  /* ============================================================
   * Route → View
   * ============================================================ */
  function renderRoute(path, session, navigate) {
    let m;
    // —— ADMIN ——
    if (matchPath(path, '/admin/dashboard')) return <AdminDashboardView session={session} onNavigate={navigate} />;
    if ((m = matchPath(path, '/admin/schema/:id'))) return <AdminShiftDetailView session={session} onNavigate={navigate} shiftId={m.id} />;
    if (matchPath(path, '/admin/schema')) return <AdminSchemaView session={session} onNavigate={navigate} />;
    if (matchPath(path, '/admin/kunder')) return <AdminCustomersListView session={session} onNavigate={navigate} />;
    if ((m = matchPath(path, '/admin/kunder/:cid'))) return <AdminCustomerView session={session} onNavigate={navigate} customerId={m.cid} />;
    if ((m = matchPath(path, '/admin/kunder/:cid/objekt/:pid'))) return <AdminPropertyView session={session} onNavigate={navigate} customerId={m.cid} propertyId={m.pid} />;
    if (matchPath(path, '/admin/stadare')) return <ComingSoonView title="Städare" section="§4 + §7.7" description="Lista över städare, profiler och tilldelningar till objekt." />;
    if ((m = matchPath(path, '/admin/avvikelser/:id'))) return <IncidentDetailView session={session} onNavigate={navigate} incidentId={m.id} />;
    if (matchPath(path, '/admin/avvikelser')) return <AdminIncidentsView session={session} onNavigate={navigate} />;
    if (matchPath(path, '/admin/installningar')) return <ComingSoonView title="Inställningar" section="§8" description="Företagsuppgifter, tema, notisinställningar." />;

    // —— CLEANER ——
    if (matchPath(path, '/stadare/idag')) return <CleanerTodayView session={session} onNavigate={navigate} />;
    if (matchPath(path, '/stadare/pass')) return <CleanerShiftsListView session={session} onNavigate={navigate} />;
    if ((m = matchPath(path, '/stadare/pass/:id'))) return <CleanerShiftDetailView session={session} onNavigate={navigate} shiftId={m.id} />;
    if ((m = matchPath(path, '/stadare/avvikelser/:id'))) return <IncidentDetailView session={session} onNavigate={navigate} incidentId={m.id} />;
    if (matchPath(path, '/stadare/avvikelser')) return <CleanerIncidentsView session={session} onNavigate={navigate} />;

    // —— CUSTOMER + customer_employee ——
    if (matchPath(path, '/kund/oversikt')) return <CustomerOverviewView session={session} onNavigate={navigate} />;
    if (matchPath(path, '/kund/objekt')) return <ComingSoonView title="Objekt" section="§8" description="Ett kort per objekt med kommande och senaste utförda pass." />;
    if ((m = matchPath(path, '/kund/pass/:id'))) return <CustomerShiftDetailView session={session} onNavigate={navigate} shiftId={m.id} />;
    if (matchPath(path, '/kund/ledighet')) return <CustomerHolidayView session={session} onNavigate={navigate} />;
    if ((m = matchPath(path, '/kund/avvikelser/:id'))) return <IncidentDetailView session={session} onNavigate={navigate} incidentId={m.id} />;
    if (matchPath(path, '/kund/avvikelser')) return <CustomerIncidentsView session={session} onNavigate={navigate} />;
    if (matchPath(path, '/kund/installningar')) return <CustomerSettingsView session={session} />;

    return <ComingSoonView title="Sidan finns inte" section="—" description="Den här vyn matchar inte någon route." />;
  }

  /* ============================================================
   * AppShell
   * ============================================================ */
  function AppShell({ session }) {
    const path = useRoute();
    const [menuOpen, setMenuOpen] = useState(false);

    const navigate = useCallback(p => router.navigate(p), []);

    useEffect(() => {
      // Säkerställ att aktuell route ligger inom rollens prefix; annars skicka till default
      const ROLE_PREFIX = { admin: '/admin', cleaner: '/stadare', customer: '/kund', customer_employee: '/kund' };
      const allowed = path.startsWith(ROLE_PREFIX[session.role] || '/');
      if (!allowed) router.navigate(defaultPathForRole(session.role));
    }, [path, session.role]);

    return (
      <div className="min-h-screen bg-slate-50 text-slate-900">
        {/* Sidebar – desktop */}
        <div className="hidden lg:block fixed inset-y-0 left-0 z-30">
          <Sidebar session={session} currentPath={path} onNavigate={navigate} />
        </div>

        {/* Sidebar – mobil sheet */}
        {menuOpen && (
          <div className="lg:hidden fixed inset-0 z-50 flex">
            <div className="absolute inset-0 bg-slate-900/40" onClick={() => setMenuOpen(false)} />
            <div className="relative">
              <Sidebar session={session} currentPath={path} onNavigate={navigate} onClose={() => setMenuOpen(false)} />
            </div>
          </div>
        )}

        <div className="lg:pl-64 min-h-screen flex flex-col">
          <TopBar session={session} onOpenMenu={() => setMenuOpen(true)} />
          <main className="flex-1 px-4 sm:px-6 py-6 sm:py-8 max-w-7xl w-full mx-auto">
            {renderRoute(path, session, navigate)}
          </main>
        </div>
      </div>
    );
  }

  /* ============================================================
   * App entry
   * ============================================================ */
  function App() {
    const session = useSession();

    if (!session) {
      return (
        <>
          <LoginView onLogin={userId => {
            const user = db.userById(userId);
            sessionStore.login(userId);
            router.navigate(defaultPathForRole(user.role));
          }} />
          <TweaksPanel />
          <ToastContainer />
        </>
      );
    }

    return (
      <>
        <AppShell session={session} />
        <TweaksPanel />
        <ToastContainer />
      </>
    );
  }

  /* ============================================================
   * Mount
   * ============================================================ */
  const root = ReactDOM.createRoot(document.getElementById('root'));
  root.render(<App />);
})();
