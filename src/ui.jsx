/*
 * UI primitives. All exported on window for global use.
 * Depends on: window.Icon (icons.jsx) and React/ReactDOM (CDN).
 */
(function () {
  const { useState, useEffect, useRef, useMemo, useCallback, useSyncExternalStore } = React;

  /* ============================================================
   * Date / number helpers (sv-SE)
   * ============================================================ */
  const SV = 'sv-SE';

  function pad(n) { return String(n).padStart(2, '0'); }
  function toDate(d) { return d instanceof Date ? d : new Date(d); }

  function formatDate(d) {
    const x = toDate(d);
    return x.toLocaleDateString(SV, { weekday: 'short', day: 'numeric', month: 'short' });
  }
  function formatDateLong(d) {
    const x = toDate(d);
    return x.toLocaleDateString(SV, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }
  function formatDateShort(d) {
    const x = toDate(d);
    return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
  }
  function formatTime(d) {
    const x = toDate(d);
    return `${pad(x.getHours())}:${pad(x.getMinutes())}`;
  }
  function formatDateTime(d) {
    return `${formatDate(d)} · ${formatTime(d)}`;
  }
  function formatRange(start, end) {
    return `${formatTime(start)}–${formatTime(end)}`;
  }
  function hoursUntil(date) {
    return (toDate(date).getTime() - Date.now()) / 36e5;
  }
  function relativeDay(d) {
    const x = toDate(d);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const that = new Date(x);
    that.setHours(0, 0, 0, 0);
    const days = Math.round((that - today) / 86400000);
    if (days === 0) return 'Idag';
    if (days === 1) return 'Imorgon';
    if (days === -1) return 'Igår';
    if (days > 1 && days < 7) return x.toLocaleDateString(SV, { weekday: 'long' });
    return formatDate(x);
  }
  function initials(name = '') {
    return name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map(w => w[0])
      .join('')
      .toUpperCase();
  }

  /* ============================================================
   * cx helper
   * ============================================================ */
  function cx(...parts) {
    return parts.filter(Boolean).join(' ');
  }

  /* ============================================================
   * Button
   * ============================================================ */
  function Button({
    variant = 'primary',
    size = 'md',
    icon,
    iconRight,
    iconOnly = false,
    loading = false,
    disabled = false,
    className = '',
    children,
    ...rest
  }) {
    const variants = {
      primary: 'bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-800 disabled:bg-brand-300',
      secondary: 'bg-brand-50 text-brand-700 hover:bg-brand-100 active:bg-brand-200 disabled:text-brand-300',
      accent: 'bg-accent-600 text-white hover:bg-accent-700 active:bg-accent-700 disabled:bg-accent-100',
      outline: 'border border-slate-300 text-slate-700 hover:bg-slate-50 active:bg-slate-100 disabled:text-slate-300',
      ghost: 'text-slate-700 hover:bg-slate-100 active:bg-slate-200 disabled:text-slate-300',
      danger: 'bg-rose-600 text-white hover:bg-rose-700 active:bg-rose-800 disabled:bg-rose-200',
      'danger-ghost': 'text-rose-700 hover:bg-rose-50 active:bg-rose-100',
      success: 'bg-emerald-600 text-white hover:bg-emerald-700 active:bg-emerald-800',
    };
    const sizes = {
      sm: iconOnly ? 'h-8 w-8' : 'h-8 px-3 text-sm',
      md: iconOnly ? 'h-10 w-10' : 'h-10 px-4 text-sm',
      lg: iconOnly ? 'h-12 w-12' : 'h-12 px-5 text-base',
    };
    return (
      <button
        type="button"
        disabled={disabled || loading}
        className={cx(
          'inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-colors',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2',
          'disabled:cursor-not-allowed',
          variants[variant],
          sizes[size],
          className,
        )}
        {...rest}
      >
        {loading ? (
          <Spinner className={size === 'lg' ? 'w-5 h-5' : 'w-4 h-4'} />
        ) : (
          icon && <Icon name={icon} className={size === 'lg' ? 'w-5 h-5' : 'w-4 h-4'} />
        )}
        {!iconOnly && children}
        {iconRight && !loading && <Icon name={iconRight} className={size === 'lg' ? 'w-5 h-5' : 'w-4 h-4'} />}
      </button>
    );
  }

  function Spinner({ className = 'w-4 h-4' }) {
    return (
      <svg viewBox="0 0 24 24" fill="none" className={cx('animate-spin', className)} aria-hidden="true">
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
        <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
    );
  }

  /* ============================================================
   * Card
   * ============================================================ */
  function Card({ children, className = '', padding = 'md', as: As = 'div', ...rest }) {
    const pad = { none: '', sm: 'p-4', md: 'p-5', lg: 'p-6 sm:p-8' }[padding];
    return (
      <As
        className={cx(
          'bg-white border border-slate-200/80 rounded-2xl shadow-sm',
          pad,
          className,
        )}
        {...rest}
      >
        {children}
      </As>
    );
  }

  /* ============================================================
   * Badge & StatusBadge
   * ============================================================ */
  function Badge({ variant = 'slate', children, icon, className = '' }) {
    const v = {
      slate: 'bg-slate-100 text-slate-700',
      brand: 'bg-brand-50 text-brand-700',
      accent: 'bg-accent-50 text-accent-700',
      emerald: 'bg-emerald-50 text-emerald-700',
      amber: 'bg-amber-50 text-amber-700',
      rose: 'bg-rose-50 text-rose-700',
      sky: 'bg-sky-50 text-sky-700',
      zinc: 'bg-zinc-100 text-zinc-700',
    }[variant];
    return (
      <span className={cx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold', v, className)}>
        {icon && <Icon name={icon} className="w-3.5 h-3.5" />}
        {children}
      </span>
    );
  }

  const STATUS_MAP = {
    Planerat: { variant: 'zinc', icon: 'calendar', label: 'Väntar på godkännande' },
    Godkänt: { variant: 'emerald', icon: 'check-circle', label: 'Godkänt' },
    Pågående: { variant: 'accent', icon: 'play', label: 'Pågående' },
    Utfört: { variant: 'slate', icon: 'check', label: 'Utfört' },
    Sjukanmäld: { variant: 'amber', icon: 'alert-circle', label: 'Sjukanmäld' },
    'Pausat (kundledighet)': { variant: 'sky', icon: 'pause', label: 'Pausad – ledighet' },
    Avbokat: { variant: 'rose', icon: 'x', label: 'Avbokat' },
    Borttaget: { variant: 'zinc', icon: 'trash', label: 'Borttaget' },
  };
  function StatusBadge({ status, className = '' }) {
    const s = STATUS_MAP[status] || { variant: 'slate', label: status };
    return <Badge variant={s.variant} icon={s.icon} className={className}>{s.label}</Badge>;
  }

  /* ============================================================
   * Avatar
   * ============================================================ */
  function Avatar({ name = '', size = 'md', anonymous = false, className = '' }) {
    const sizes = { xs: 'w-6 h-6 text-[10px]', sm: 'w-8 h-8 text-xs', md: 'w-10 h-10 text-sm', lg: 'w-14 h-14 text-base' };
    if (anonymous) {
      return (
        <span className={cx(
          'inline-flex items-center justify-center rounded-full bg-slate-100 text-slate-500',
          sizes[size], className,
        )} title="Städare">
          <Icon name="user" className="w-1/2 h-1/2" />
        </span>
      );
    }
    return (
      <span className={cx(
        'inline-flex items-center justify-center rounded-full bg-brand-100 text-brand-700 font-semibold',
        sizes[size], className,
      )}>
        {initials(name) || '?'}
      </span>
    );
  }

  const BRAND_LOGO_SRC = 'CleanUp%20favicon.png';

  function BrandLogo({ size = 'md', className }) {
    const sizes = {
      sm: 'w-8 h-8 rounded-lg',
      md: 'w-9 h-9 rounded-xl',
      lg: 'w-12 h-12 rounded-2xl',
    };
    return (
      <img
        src={BRAND_LOGO_SRC}
        alt="CleanUp"
        className={cx(sizes[size] || sizes.md, 'object-contain flex-shrink-0', className)}
      />
    );
  }

  /* ============================================================
   * Modal
   * ============================================================ */
  function Modal({ open, onClose, title, children, footer, size = 'md', closeOnBackdrop = true }) {
    useEffect(() => {
      if (!open) return;
      const onKey = e => e.key === 'Escape' && onClose && onClose();
      window.addEventListener('keydown', onKey);
      const prev = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        window.removeEventListener('keydown', onKey);
        document.body.style.overflow = prev;
      };
    }, [open, onClose]);

    if (!open) return null;
    const sizes = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-5xl' };
    return (
      <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center p-0 sm:p-4">
        <div
          className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
          onClick={() => closeOnBackdrop && onClose && onClose()}
        />
        <div className={cx(
          'relative bg-white w-full sm:rounded-2xl shadow-2xl flex flex-col max-h-[92vh] sm:max-h-[88vh]',
          'rounded-t-2xl',
          sizes[size],
        )}>
          <div className="flex items-start justify-between px-5 sm:px-6 pt-5 pb-3 border-b border-slate-100">
            <h3 className="text-lg font-bold text-slate-900 pr-8">{title}</h3>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600 -mt-1 -mr-2 p-2" aria-label="Stäng">
              <Icon name="x" className="w-5 h-5" />
            </button>
          </div>
          <div className="overflow-y-auto px-5 sm:px-6 py-5">{children}</div>
          {footer && (
            <div className="px-5 sm:px-6 py-4 border-t border-slate-100 bg-slate-50/50 flex flex-wrap justify-end gap-2 sm:rounded-b-2xl">
              {footer}
            </div>
          )}
        </div>
      </div>
    );
  }

  /* ============================================================
   * ConfirmDialog
   * ============================================================ */
  function ConfirmDialog({ open, onClose, onConfirm, title, message, confirmLabel = 'Bekräfta', cancelLabel = 'Avbryt', danger = false }) {
    return (
      <Modal
        open={open}
        onClose={onClose}
        title={title}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={onClose}>{cancelLabel}</Button>
            <Button variant={danger ? 'danger' : 'primary'} onClick={() => { onConfirm && onConfirm(); }}>{confirmLabel}</Button>
          </>
        }
      >
        <p className="text-sm text-slate-600">{message}</p>
      </Modal>
    );
  }

  /* ============================================================
   * Tabs
   * ============================================================ */
  function Tabs({ tabs, value, onChange, className = '' }) {
    return (
      <div className={cx('border-b border-slate-200 flex items-center gap-1 overflow-x-auto', className)}>
        {tabs.map(t => {
          const active = t.id === value;
          return (
            <button
              key={t.id}
              onClick={() => onChange && onChange(t.id)}
              className={cx(
                'inline-flex items-center gap-2 px-3 py-2.5 text-sm font-semibold border-b-2 -mb-px whitespace-nowrap',
                active
                  ? 'border-brand-600 text-brand-700'
                  : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300',
              )}
            >
              {t.icon && <Icon name={t.icon} className="w-4 h-4" />}
              {t.label}
              {typeof t.count === 'number' && (
                <span className={cx(
                  'inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[11px] font-semibold',
                  active ? 'bg-brand-100 text-brand-700' : 'bg-slate-100 text-slate-600',
                )}>{t.count}</span>
              )}
            </button>
          );
        })}
      </div>
    );
  }

  /* ============================================================
   * Form fields
   * ============================================================ */
  function Field({ label, hint, error, required, children, htmlFor, className = '' }) {
    return (
      <div className={className}>
        {label && (
          <label htmlFor={htmlFor} className="block text-sm font-semibold text-slate-700 mb-1.5">
            {label} {required && <span className="text-rose-600">*</span>}
          </label>
        )}
        {children}
        {error ? (
          <p className="mt-1.5 text-xs font-medium text-rose-600">{error}</p>
        ) : hint ? (
          <p className="mt-1.5 text-xs text-slate-500">{hint}</p>
        ) : null}
      </div>
    );
  }

  const inputBase =
    'w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 ' +
    'focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-brand-400 transition-shadow';

  function Input({ className = '', error, ...rest }) {
    return <input className={cx(inputBase, error && 'border-rose-400 focus:ring-rose-300 focus:border-rose-400', className)} {...rest} />;
  }
  function Textarea({ className = '', rows = 4, error, ...rest }) {
    return <textarea rows={rows} className={cx(inputBase, error && 'border-rose-400', className)} {...rest} />;
  }
  function Select({ className = '', children, error, ...rest }) {
    return (
      <select className={cx(inputBase, 'pr-10 appearance-none bg-no-repeat', error && 'border-rose-400', className)}
        style={{ backgroundImage: 'url("data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'16\' height=\'16\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'%2364748b\' stroke-width=\'2\' stroke-linecap=\'round\' stroke-linejoin=\'round\'><path d=\'M6 9l6 6 6-6\'/></svg>")', backgroundPosition: 'right 0.75rem center', backgroundSize: '16px' }}
        {...rest}
      >{children}</select>
    );
  }
  function Checkbox({ label, checked, onChange, disabled, className = '' }) {
    return (
      <label className={cx('inline-flex items-start gap-2.5 cursor-pointer select-none', disabled && 'opacity-50 cursor-not-allowed', className)}>
        <span
          className={cx(
            'mt-0.5 inline-flex items-center justify-center w-5 h-5 rounded-md border transition-colors flex-shrink-0',
            checked ? 'bg-brand-600 border-brand-600 text-white' : 'bg-white border-slate-300 hover:border-brand-400',
          )}
          onClick={() => !disabled && onChange && onChange(!checked)}
        >
          {checked && <Icon name="check" className="w-3.5 h-3.5" strokeWidth={3} />}
        </span>
        {label && <span className="text-sm text-slate-700">{label}</span>}
      </label>
    );
  }
  function Radio({ label, checked, onChange, name, value, className = '' }) {
    return (
      <label className={cx('inline-flex items-center gap-2.5 cursor-pointer select-none', className)}>
        <input type="radio" className="sr-only" name={name} value={value} checked={checked} onChange={() => onChange && onChange(value)} />
        <span className={cx(
          'inline-flex items-center justify-center w-5 h-5 rounded-full border-2 transition-colors',
          checked ? 'border-brand-600' : 'border-slate-300',
        )}>
          {checked && <span className="w-2.5 h-2.5 rounded-full bg-brand-600" />}
        </span>
        {label && <span className="text-sm text-slate-700">{label}</span>}
      </label>
    );
  }

  /* ============================================================
   * EmptyState
   * ============================================================ */
  function EmptyState({ icon = 'inbox', title, description, action, className = '' }) {
    return (
      <div className={cx('text-center py-12 px-6', className)}>
        <div className="mx-auto w-14 h-14 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center mb-4">
          <Icon name={icon} className="w-7 h-7" />
        </div>
        {title && <h3 className="text-base font-semibold text-slate-900">{title}</h3>}
        {description && <p className="mt-1 text-sm text-slate-500 max-w-sm mx-auto">{description}</p>}
        {action && <div className="mt-5">{action}</div>}
      </div>
    );
  }

  /* ============================================================
   * Stat
   * ============================================================ */
  function Stat({ label, value, hint, icon, tone = 'slate' }) {
    const tones = {
      slate: 'bg-slate-50 text-slate-600',
      brand: 'bg-brand-50 text-brand-700',
      accent: 'bg-accent-50 text-accent-700',
      emerald: 'bg-emerald-50 text-emerald-700',
      amber: 'bg-amber-50 text-amber-700',
      rose: 'bg-rose-50 text-rose-700',
    };
    return (
      <Card padding="md">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
            <p className="mt-2 text-3xl font-extrabold tracking-tight text-slate-900">{value}</p>
            {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
          </div>
          {icon && (
            <span className={cx('inline-flex items-center justify-center w-10 h-10 rounded-xl', tones[tone])}>
              <Icon name={icon} className="w-5 h-5" />
            </span>
          )}
        </div>
      </Card>
    );
  }

  /* ============================================================
   * PageHeader
   * ============================================================ */
  function PageHeader({ title, subtitle, actions, breadcrumbs }) {
    return (
      <div className="mb-6 sm:mb-8">
        {breadcrumbs && breadcrumbs.length > 0 && (
          <nav className="flex items-center text-xs text-slate-500 mb-2 flex-wrap gap-1">
            {breadcrumbs.map((b, i) => (
              <span key={i} className="flex items-center gap-1">
                {i > 0 && <Icon name="chevron-right" className="w-3 h-3 text-slate-300" />}
                {b.href ? (
                  <a href={b.href} className="hover:text-brand-700">{b.label}</a>
                ) : (
                  <span className="text-slate-700 font-medium">{b.label}</span>
                )}
              </span>
            ))}
          </nav>
        )}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900">{title}</h1>
            {subtitle && <p className="mt-1 text-sm text-slate-500 max-w-2xl">{subtitle}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      </div>
    );
  }

  /* ============================================================
   * Skeleton
   * ============================================================ */
  function Skeleton({ className = 'h-4 w-full' }) {
    return <div className={cx('animate-pulse bg-slate-200 rounded-md', className)} />;
  }

  /* ============================================================
   * Toast system (queue + container)
   * ============================================================ */
  const toastListeners = new Set();
  let toastQueue = [];
  let toastId = 0;
  function emitToasts() { toastListeners.forEach(l => l(toastQueue)); }
  const toast = {
    show(message, opts = {}) {
      const id = ++toastId;
      const t = { id, message, kind: opts.kind || 'info', duration: opts.duration ?? 4000 };
      toastQueue = [...toastQueue, t];
      emitToasts();
      setTimeout(() => toast.dismiss(id), t.duration);
      return id;
    },
    success(m, o) { return toast.show(m, { ...o, kind: 'success' }); },
    info(m, o) { return toast.show(m, { ...o, kind: 'info' }); },
    warning(m, o) { return toast.show(m, { ...o, kind: 'warning' }); },
    error(m, o) { return toast.show(m, { ...o, kind: 'error' }); },
    dismiss(id) {
      toastQueue = toastQueue.filter(t => t.id !== id);
      emitToasts();
    },
    subscribe(fn) { toastListeners.add(fn); return () => toastListeners.delete(fn); },
    snapshot() { return toastQueue; },
  };
  function useToasts() {
    return useSyncExternalStore(toast.subscribe, toast.snapshot, toast.snapshot);
  }
  function ToastContainer() {
    const items = useToasts();
    const kindStyles = {
      success: 'bg-emerald-600 text-white',
      info: 'bg-slate-900 text-white',
      warning: 'bg-amber-500 text-white',
      error: 'bg-rose-600 text-white',
    };
    const kindIcon = {
      success: 'check-circle',
      info: 'info',
      warning: 'alert-triangle',
      error: 'alert-circle',
    };
    return (
      <div className="fixed z-[90] bottom-4 right-4 left-4 sm:left-auto sm:max-w-sm flex flex-col items-end gap-2 pointer-events-none">
        {items.map(t => (
          <div
            key={t.id}
            className={cx(
              'pointer-events-auto w-full sm:w-auto flex items-start gap-3 rounded-xl px-4 py-3 shadow-lg',
              kindStyles[t.kind],
            )}
            role="status"
          >
            <Icon name={kindIcon[t.kind]} className="w-5 h-5 mt-0.5 flex-shrink-0" />
            <p className="text-sm font-medium flex-1">{t.message}</p>
            <button onClick={() => toast.dismiss(t.id)} className="opacity-80 hover:opacity-100" aria-label="Stäng">
              <Icon name="x" className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>
    );
  }

  /* ============================================================
   * Hook: window size (for responsive bits in JS)
   * ============================================================ */
  function useMedia(query) {
    const get = () => window.matchMedia(query).matches;
    const [m, setM] = useState(get);
    useEffect(() => {
      const mq = window.matchMedia(query);
      const handler = () => setM(mq.matches);
      mq.addEventListener('change', handler);
      return () => mq.removeEventListener('change', handler);
    }, [query]);
    return m;
  }

  /* ============================================================
   * Export
   * ============================================================ */
  Object.assign(window, {
    cx,
    formatDate, formatDateLong, formatDateShort, formatTime, formatDateTime, formatRange,
    hoursUntil, relativeDay, initials,
    Button, Spinner, Card,
    Badge, StatusBadge, Avatar, BrandLogo,
    Modal, ConfirmDialog,
    Tabs, Field, Input, Textarea, Select, Checkbox, Radio,
    EmptyState, Stat, PageHeader, Skeleton,
    toast, ToastContainer,
    useMedia,
  });
})();
