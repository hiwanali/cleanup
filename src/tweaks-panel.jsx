/*
 * Design-tweaks panel.
 * Liten flytande panel nere till höger för att snabbt prova hörnradie och accentfärg.
 * Inställningar sparas i localStorage.
 */
(function () {
  const { useState, useEffect } = React;

  const ROUND_OPTIONS = ['Skarp', 'Standard', 'Rundad'];
  const ACCENT_OPTIONS = [
    { name: 'Orange', vars: { a50: '255 242 238', a100: '255 225 214', a500: '242 96 60', a600: '224 74 38', a700: '187 58 29' } },
    { name: 'Korall',  vars: { a50: '255 240 240', a100: '255 220 220', a500: '244 80 80', a600: '220 60 60', a700: '180 45 45' } },
    { name: 'Grön',    vars: { a50: '236 253 245', a100: '209 250 229', a500:  '16 185 129', a600:  '5 150 105', a700:  '4 120 87' } },
    { name: 'Lila',    vars: { a50: '243 232 255', a100: '230 213 255', a500: '139  92 246', a600: '124  58 237', a700: '109  40 217' } },
    { name: 'Cyan',    vars: { a50: '236 254 255', a100: '207 250 254', a500:  '6 182 212', a600:  '8 145 178', a700: '14 116 144' } },
  ];

  const LS_KEY = 'cleanup_tweaks_v1';

  function applyTweaks({ round, accent }) {
    document.body.dataset.round = round;
    const a = ACCENT_OPTIONS.find(x => x.name === accent) || ACCENT_OPTIONS[0];
    const root = document.documentElement.style;
    Object.entries(a.vars).forEach(([k, v]) => root.setProperty(`--${k}`, v));
  }

  function loadTweaks() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return { round: 'Standard', accent: 'Orange' };
      return { round: 'Standard', accent: 'Orange', ...JSON.parse(raw) };
    } catch (_) { return { round: 'Standard', accent: 'Orange' }; }
  }
  function saveTweaks(t) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(t)); } catch (_) {}
  }

  function TweaksPanel() {
    const [open, setOpen] = useState(false);
    const [tweaks, setTweaks] = useState(loadTweaks);

    useEffect(() => {
      applyTweaks(tweaks);
      saveTweaks(tweaks);
    }, [tweaks]);

    return (
      <>
        <button
          onClick={() => setOpen(o => !o)}
          className="fixed bottom-4 left-4 z-[70] w-11 h-11 rounded-full bg-white border border-slate-300 shadow-lg flex items-center justify-center text-slate-600 hover:text-brand-700 hover:border-brand-300 transition-colors"
          aria-label="Design-inställningar"
          title="Design-tweaks"
        >
          <Icon name="palette" className="w-5 h-5" />
        </button>

        {open && (
          <div className="fixed bottom-20 left-4 z-[70] w-72 bg-white border border-slate-200 rounded-2xl shadow-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-bold text-slate-900">Design</h4>
              <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-600 p-1" aria-label="Stäng">
                <Icon name="x" className="w-4 h-4" />
              </button>
            </div>

            <div className="mb-4">
              <p className="text-xs font-semibold uppercase text-slate-500 mb-2">Hörnradie</p>
              <div className="grid grid-cols-3 gap-1.5">
                {ROUND_OPTIONS.map(opt => (
                  <button
                    key={opt}
                    onClick={() => setTweaks(t => ({ ...t, round: opt }))}
                    className={cx(
                      'h-9 text-xs font-semibold rounded-lg border transition-colors',
                      tweaks.round === opt
                        ? 'bg-brand-600 border-brand-600 text-white'
                        : 'border-slate-200 text-slate-600 hover:border-brand-300 hover:text-brand-700',
                    )}
                  >{opt}</button>
                ))}
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase text-slate-500 mb-2">Accentfärg</p>
              <div className="grid grid-cols-5 gap-1.5">
                {ACCENT_OPTIONS.map(opt => {
                  const active = tweaks.accent === opt.name;
                  return (
                    <button
                      key={opt.name}
                      title={opt.name}
                      onClick={() => setTweaks(t => ({ ...t, accent: opt.name }))}
                      className={cx(
                        'h-9 rounded-lg border-2 transition-transform',
                        active ? 'border-slate-900 scale-110' : 'border-transparent hover:scale-105',
                      )}
                      style={{ background: `rgb(${opt.vars.a600})` }}
                      aria-label={opt.name}
                    />
                  );
                })}
              </div>
            </div>

            <p className="mt-4 text-[11px] text-slate-400">Inställningarna sparas lokalt i din webbläsare.</p>
          </div>
        )}
      </>
    );
  }

  window.TweaksPanel = TweaksPanel;
  // Applicera direkt vid load så vi slipper "blink"
  applyTweaks(loadTweaks());
})();
