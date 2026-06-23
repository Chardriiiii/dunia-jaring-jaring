// Main app — shape selection, scoring, tutorial, validation flow.

const { useState, useEffect, useRef, useMemo, useCallback } = React;

// ============================================================
// PALET WARNA PER SISI (indeks 0 = ALAS, sisanya urutan pemilihan)
// ============================================================
const FACE_COLORS = {
  cuboid: [
    '#4338CA', // alas
    '#818CF8', // sisi 1
    '#34D399', // sisi 2
    '#FBBF24', // sisi 3
    '#FB7185', // sisi 4
    '#A78BFA', // sisi 5
    '#60A5FA', // sisi 6 (cadangan)
  ],
  triPrism: [
    '#065F46', // alas
    '#34D399',
    '#FBBF24',
    '#FB7185',
    '#A78BFA',
    '#60A5FA',
  ],
  triPyramid: [
    '#881337', // alas
    '#FB7185',
    '#FBBF24',
    '#A78BFA',
    '#60A5FA',
  ],
  sqPyramid: [
    '#78350F', // alas
    '#FCD34D',
    '#FB7185',
    '#A78BFA',
    '#60A5FA',
    '#34D399',
  ],
};

// SVG icon mark for each shape (small thumbnail in shape picker)
function ShapeIcon({ kind }) {
  switch (kind) {
    case 'cuboid':
      return (
        <svg viewBox="0 0 60 60" fill="none">
          <path d="M12 22 L30 14 L48 22 L48 42 L30 50 L12 42 Z" fill="#C7CCFF" stroke="#4338CA" strokeWidth="1.5" strokeLinejoin="round" />
          <path d="M12 22 L30 30 L48 22 M30 30 L30 50" stroke="#4338CA" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>);

    case 'triPrism':
      return (
        <svg viewBox="0 0 60 60" fill="none">
          <path d="M12 42 L24 18 L36 42 Z M36 42 L48 38 L36 14 L24 18" fill="#B7E8D2" stroke="#047857" strokeWidth="1.5" strokeLinejoin="round" />
          <path d="M24 18 L36 14 M24 42 L12 42" stroke="#047857" strokeWidth="1.5" />
        </svg>);

    case 'triPyramid':
      return (
        <svg viewBox="0 0 60 60" fill="none">
          <path d="M30 10 L50 46 L10 46 Z" fill="#FBC7D9" stroke="#BE123C" strokeWidth="1.5" strokeLinejoin="round" />
          <path d="M30 10 L30 46 M10 46 L30 36 L50 46" stroke="#BE123C" strokeWidth="1.5" strokeLinejoin="round" opacity="0.7" />
        </svg>);

    case 'sqPyramid':
      return (
        <svg viewBox="0 0 60 60" fill="none">
          <path d="M30 8 L52 44 L8 44 Z" fill="#FCD9A8" stroke="#B45309" strokeWidth="1.5" strokeLinejoin="round" />
          <path d="M8 44 L30 50 L52 44 M30 8 L30 50" stroke="#B45309" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>);

    default:return null;
  }
}

function App() {
  const [shapeKey, setShapeKey] = useState('cuboid');
  const shape = SHAPES[shapeKey];

  // Selected slots for the current shape
  const [selectedByShape, setSelectedByShape] = useState(() => {
    const o = {};
    for (const k of Object.keys(SHAPES)) o[k] = new Set([SHAPES[k].basePos]);
    return o;
  });
  const selected = selectedByShape[shapeKey];
  function setSelected(next) {
    setSelectedByShape((prev) => ({ ...prev, [shapeKey]: next }));
  }

  // Undo stack
  const [historyByShape, setHistoryByShape] = useState(() => {
    const o = {};
    for (const k of Object.keys(SHAPES)) o[k] = [];
    return o;
  });

  // ============================================================
  // FUNGSI WARNA UNTUK EDITOR DAN PREVIEW
  // ============================================================
  const getSlotColor = useCallback((slotId, index) => {
    const palette = FACE_COLORS[shapeKey] || ['#4338CA', '#818CF8', '#34D399', '#FBBF24', '#FB7185', '#A78BFA'];
    if (slotId === shape.basePos) return palette[0];
    // index adalah urutan dalam selected list (0-based)
    const idx = (index !== undefined && index !== null) ? (index + 1) % palette.length : 1;
    return palette[idx];
  }, [shapeKey, shape.basePos]);

  const getFaceColor = useCallback((faceId) => {
    const selectedList = [...selected];
    const idx = selectedList.indexOf(faceId);
    return getSlotColor(faceId, idx);
  }, [selected, getSlotColor]);
  // ============================================================

  const pushHistory = useCallback((snapshot) => {
    setHistoryByShape((prev) => ({
      ...prev,
      [shapeKey]: [...(prev[shapeKey] || []).slice(-19), snapshot]
    }));
  }, [shapeKey]);

  function handleSelectedChange(next) {
    pushHistory(new Set(selected));
    setSelected(next);
    setFeedback(null);
    if (progress > 0) setProgress(0);
  }

  function handleUndo() {
    const hist = historyByShape[shapeKey] || [];
    if (hist.length === 0) return;
    const prev = hist[hist.length - 1];
    setHistoryByShape((p) => ({ ...p, [shapeKey]: hist.slice(0, -1) }));
    setSelected(prev);
    setFeedback(null);
    setProgress(0);
  }

  function handleReset() {
    pushHistory(new Set(selected));
    setSelected(new Set([shape.basePos]));
    setFeedback(null);
    setProgress(0);
  }

  // Tutorial
  const [showTutorial, setShowTutorial] = useState(() => {
    try {return localStorage.getItem('pmbt_tut_seen') !== '1';} catch (e) {return true;}
  });
  function dismissTutorial() {
    setShowTutorial(false);
    try {localStorage.setItem('pmbt_tut_seen', '1');} catch (e) {}
  }

  // Progress tracking
  const [correctByShape, setCorrectByShape] = useState(() => {
    try { return JSON.parse(localStorage.getItem('pmbt_correct') || '{}'); } catch (e) { return {}; }
  });
  useEffect(() => {
    try { localStorage.setItem('pmbt_correct', JSON.stringify(correctByShape)); } catch (e) {}
  }, [correctByShape]);
  const correctCount = (correctByShape[shapeKey] || []).length;

  // Feedback
  const [feedback, setFeedback] = useState(null);

  // Hint
  const [hintIds, setHintIds] = useState([]);
  function handleHint() {
    const all = getHints(shapeKey, selected);
    if (all.length) {
      setHintIds(all);
      setFeedback({ kind: 'info', text: 'Coba klik sisi yang menyala (garis tebal ungu) di papan jaring-jaring.' });
      setTimeout(() => setHintIds([]), 4500);
    } else {
      setFeedback({ kind: 'info', text: 'Tidak ada petunjuk yang bisa diberikan untuk susunan saat ini. Coba urungkan atau mulai ulang.' });
    }
  }

  // Tweaks
  const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
    "foldSpeed": "normal",
    "showLabels": true
  } /*EDITMODE-END*/;
  const [t, setTweak] = window.useTweaks(TWEAK_DEFAULTS);

  // Fold preview
  const [progress, setProgress] = useState(0);
  const [validated, setValidated] = useState(false);
  const [sceneRot, setSceneRot] = useState({ x: -28, y: -22, z: 0 });

  useEffect(() => {
    window.__appState = { progress, validated, selected, shapeKey };
  });

  function handleValidate() {
    const result = validateNet(shapeKey, selected);
    if (result.ok) {
      setFeedback({ kind: 'ok', text: result.reason });
      const key = [...selected].sort().join('|');
      setCorrectByShape((m) => {
        const found = m[shapeKey] || [];
        if (found.includes(key)) return m;
        return { ...m, [shapeKey]: [...found, key] };
      });
      setValidated(true);
      celebrate();
      animateProgressTo(1, foldDuration());
    } else {
      setFeedback({ kind: 'err', text: result.reason });
      setValidated(false);
    }
  }

  function foldDuration() {
    if (t.foldSpeed === 'slow') return 1800;
    if (t.foldSpeed === 'fast') return 700;
    return 1200;
  }
  const animRef = useRef(null);
  function animateProgressTo(target, dur) {
    if (animRef.current) clearTimeout(animRef.current);
    const start = progress;
    const t0 = Date.now();
    const tick = () => {
      const k = Math.min(1, (Date.now() - t0) / dur);
      const eased = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      setProgress(start + (target - start) * eased);
      if (k < 1) animRef.current = setTimeout(tick, 16);else
      animRef.current = null;
    };
    tick();
  }

  useEffect(() => {
    if (validated) setValidated(false);
  }, [selected]);

  function celebrate() {
    const colors = ['#FCD34D', '#A78BFA', '#34D399', '#FB7185', '#60A5FA', '#F472B6'];
    const container = document.createElement('div');
    container.className = 'celebrate-burst';
    document.body.appendChild(container);
    for (let i = 0; i < 60; i++) {
      const c = document.createElement('div');
      c.className = 'confetti';
      c.style.background = colors[i % colors.length];
      c.style.left = Math.random() * 100 + 'vw';
      c.style.animationDelay = Math.random() * 0.25 + 's';
      c.style.animationDuration = 1.4 + Math.random() * 0.6 + 's';
      c.style.transform = `rotate(${Math.random() * 360}deg)`;
      container.appendChild(c);
    }
    setTimeout(() => container.remove(), 2500);
  }

  // Scene drag-to-rotate
  const sceneRef = useRef(null);
  const rotRef = useRef(sceneRot);
  useEffect(() => { rotRef.current = sceneRot; }, [sceneRot]);

  useEffect(() => {
    const el = sceneRef.current;
    if (!el) return;
    let dragging = false;
    let startX, startY, startRot;
    let live = null;
    let rafId = 0;
    let sceneEl = null;

    function paint() {
      rafId = 0;
      if (!sceneEl || !live) return;
      sceneEl.style.transform =
        `rotateX(${live.x}deg) rotateY(${live.y}deg) rotateZ(${live.z || 0}deg)`;
    }
    function schedule() { if (!rafId) rafId = requestAnimationFrame(paint); }

    function onDown(e) {
      dragging = true;
      const p = e.touches ? e.touches[0] : e;
      startX = p.clientX; startY = p.clientY;
      startRot = { ...rotRef.current };
      live = { ...startRot };
      sceneEl = el.querySelector('.scene-rot');
      if (sceneEl) sceneEl.style.transition = 'none';
      el.style.cursor = 'grabbing';
    }
    function onMove(e) {
      if (!dragging) return;
      if (e.cancelable) e.preventDefault();
      const p = e.touches ? e.touches[0] : e;
      const dx = p.clientX - startX;
      const dy = p.clientY - startY;
      if (e.shiftKey) {
        live = { x: startRot.x, y: startRot.y, z: startRot.z + dx * 0.7 };
      } else {
        live = { x: startRot.x - dy * 0.8, y: startRot.y + dx * 0.8, z: startRot.z };
      }
      schedule();
    }
    function onUp() {
      if (!dragging) return;
      dragging = false;
      el.style.cursor = 'grab';
      if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
      if (sceneEl) sceneEl.style.transition = '';
      if (live) { rotRef.current = live; setSceneRot(live); }
    }

    el.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    el.addEventListener('touchstart', onDown, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onUp);
    el.style.cursor = 'grab';
    return () => {
      el.removeEventListener('mousedown', onDown);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      el.removeEventListener('touchstart', onDown);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onUp);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, []);

  const narrationText = useMemo(() => {
    if (!validated) {
      if (selected.size < shape.meta.faceCount) {
        return {
          step: selected.size,
          text: <>Klik sisi-sisi yang bersebelahan dengan <strong>alas</strong> untuk menyusun jaring-jaring. Butuh <strong>{shape.meta.faceCount - selected.size} sisi lagi</strong> untuk <strong>{shape.meta.shortName}</strong>.</>
        };
      }
      return { step: selected.size, text: <>Semua sisi terkumpul! Klik <strong>Validasi &amp; Lipat</strong> untuk memeriksa apakah jaring-jaring ini bisa membentuk {shape.meta.shortName}.</> };
    }
    const stepIdx = Math.floor(progress * 5);
    const steps = [
    <>Jaring-jaring berhasil terbentuk! Geser slider untuk mulai melipat.</>,
    <>Sisi-sisi mulai terangkat dari bidang alas. Sudut antar-sisi mengecil dari 180°.</>,
    <>Setiap sisi berotasi mengelilingi rusuk yang menjadi engselnya.</>,
    <>Sisi-sisi saling mendekat. Hampir membentuk <strong>{shape.meta.shortName}</strong>!</>,
    <>Semua sisi berjumpa di rusuk-rusuk. <strong>{shape.meta.shortName}</strong> terbentuk sempurna.</>,
    <>Selesai! Inilah <strong>{shape.meta.shortName}</strong> dengan {shape.meta.faceComposition}.</>];

    return { step: stepIdx + 1, text: steps[Math.min(steps.length - 1, stepIdx)] };
  }, [selected, validated, progress, shape]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">
            <svg viewBox="0 0 32 32" fill="none">
              <path d="M16 4 L28 12 L28 22 L16 28 L4 22 L4 12 Z" stroke="white" strokeWidth="2" strokeLinejoin="round" />
              <path d="M16 4 L16 16 M4 12 L16 16 L28 12 M16 16 L16 28" stroke="white" strokeWidth="2" strokeLinejoin="round" opacity="0.7" />
            </svg>
          </div>
          <div className="brand-text">
            <div className="t1">Dunia Jaring-jaring</div>
            <div className="t2">Susun • Validasi • Lipat menjadi bangun ruang</div>
          </div>
        </div>

        <div className="topbar-stats">
          <div className="stat-pill">
            <span className="lbl">Benar &middot; {shape.meta.shortName}</span>
            <span className="val">{correctCount}</span>
          </div>
        </div>

        <div className="topbar-actions">
          <button className="btn btn-ghost" onClick={() => setShowTutorial(true)}>
            <svg className="ico" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="10" cy="10" r="8" /><path d="M10 14v.01M9 7.5a1.5 1.5 0 113 0c0 1-1.5 1.5-1.5 2.5" /></svg>
            Bantuan
          </button>
        </div>
      </header>

      {/* Shape picker */}
      <div className="shape-picker">
        {Object.values(SHAPES).map((s) =>
        <button key={s.meta.key}
        className={`shape-card ${shapeKey === s.meta.key ? 'selected' : ''}`}
        onClick={() => {setShapeKey(s.meta.key);setFeedback(null);setProgress(0);setValidated(false);}}>
            <div className="ico-3d"><ShapeIcon kind={s.meta.key} /></div>
            <div className="info">
              <div className="nm">{s.meta.shortName}</div>
              <div className="sub">{s.meta.faceComposition} • {s.meta.faceCount} sisi</div>
            </div>
          </button>
        )}
      </div>

      {/* Main side-by-side */}
      <div className="main-grid">
        {/* LEFT: Editor */}
        <div className="panel">
          <div className="panel-head">
            <h2><span className="step-dot">1</span> Pilih sisi-sisi untuk menyusun jaring-jaring</h2>
            <div className="hint">{shape.meta.uniqueNetText}</div>
          </div>

          <div className="editor-wrap">
            <NetEditor
              shape={shape}
              selected={selected}
              setSelected={handleSelectedChange}
              hintIds={hintIds}
              tone={shape.meta.faceTint}
              showLabels={t.showLabels}
              getSlotColor={getSlotColor}   // <-- DISINI
            />
          </div>

          <div className="editor-toolbar">
            <div className={`counter ${selected.size === shape.meta.faceCount ? 'full' : ''}`}>
              <span className="val">{selected.size}</span>
              <span>/ {shape.meta.faceCount} sisi</span>
            </div>
            <div className="grp">
              <button className="btn" onClick={handleHint}>
                <svg className="ico" viewBox="0 0 20 20" fill="currentColor"><path d="M10 2a6 6 0 00-3.3 11.02V15a1 1 0 001 1h4.6a1 1 0 001-1v-1.98A6 6 0 0010 2z" /><path d="M7.5 18.5a1 1 0 011-1h3a1 1 0 110 2h-3a1 1 0 01-1-1z" /></svg>
                Petunjuk
              </button>
              <button className="btn" onClick={handleUndo} disabled={!(historyByShape[shapeKey] || []).length}>
                <svg className="ico" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 14L4 9l5-5" /><path d="M4 9h10a4 4 0 014 4v3" /></svg>
                Urungkan
              </button>
              <button className="btn" onClick={handleReset}>
                <svg className="ico" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 10a7 7 0 1112-4.95" /><path d="M14 2v4h-4" /></svg>
                Reset
              </button>
              <button className="btn btn-primary" onClick={handleValidate}>
                <svg className="ico" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M4 11l4 4 8-9" /></svg>
                Validasi &amp; Lipat
              </button>
            </div>
          </div>

          {feedback ?
          <div className={`feedback ${feedback.kind}`}>
              <svg className="ico" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
                {feedback.kind === 'ok' ?
              <path d="M4 10l4 4 8-9" strokeLinecap="round" strokeLinejoin="round" /> :
              feedback.kind === 'err' ?
              <><circle cx="10" cy="10" r="8" /><path d="M7 7l6 6M13 7l-6 6" strokeLinecap="round" /></> :
              <><circle cx="10" cy="10" r="8" /><path d="M10 6v5M10 14v.01" strokeLinecap="round" /></>}
              </svg>
              <div><strong>{feedback.kind === 'ok' ? 'Benar! ' : feedback.kind === 'err' ? 'Belum tepat. ' : ''}</strong>{feedback.text}</div>
            </div> :
          null}
        </div>

        {/* RIGHT: 3D preview */}
        <div className="panel">
          <div className="panel-head">
            <h2><span className="step-dot">2</span> Pratinjau lipatan 3D</h2>
            <div className="hint">Seret dengan mouse untuk memutar bebas (tahan Shift untuk twist) &mdash; atau pakai tombol</div>
          </div>

          <div className="preview-wrap" ref={sceneRef}>
            <FoldPreview
              shape={shape}
              selected={selected}
              progress={progress}
              tone={shape.meta.faceTint}
              sceneRot={sceneRot}
              foldDur={foldDuration()}
              getFaceColor={getFaceColor}   // <-- DISINI
            />

            <div className="scene-controls" onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}>
              <button className="sc-reset" title="Reset tampilan" onClick={() => setSceneRot({ x: -28, y: -22, z: 0 })}>
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 10a7 7 0 1112-4.95" /><path d="M14 2v4h-4" /></svg>
                Reset
              </button>
            </div>

            {selected.size >= 2 && !validated ?
            <div className="preview-tip">
                <svg viewBox="0 0 20 20" fill="currentColor"><path d="M10 2a8 8 0 100 16 8 8 0 000-16zm-1 5a1 1 0 112 0v4a1 1 0 11-2 0V7zm1 8a1 1 0 110-2 1 1 0 010 2z" /></svg>
                Geser <strong>Progres Lipatan</strong> untuk melihat susunanmu melipat &mdash; sisi yang tumpang tindih akan jelas terlihat.
              </div> :
            null}
          </div>

          <div className="fold-control">
            <div className="fold-label">
              <span>Progres Lipatan</span>
              <span className="pct">{Math.round(progress * 100)}%</span>
            </div>
            <input type="range"
            className="fold-slider"
            min="0" max="100" step="1"
            value={Math.round(progress * 100)}
            onChange={(e) => setProgress(Number(e.target.value) / 100)}
            style={{ '--pos': `${Math.round(progress * 100)}%` }} />
            <div className="fold-quick">
              <button className={progress === 0 ? 'active' : ''} onClick={() => animateProgressTo(0, 400)}>0%</button>
              <button className={progress > 0.4 && progress < 0.6 ? 'active' : ''} onClick={() => animateProgressTo(0.5, 600)}>50%</button>
              <button className={progress === 1 ? 'active' : ''} onClick={() => animateProgressTo(1, foldDuration())}>100%</button>
            </div>
          </div>

          <div className="narration">
            <div className="narration-step">{narrationText.step}</div>
            <div className="narration-body">{narrationText.text}</div>
          </div>
        </div>
      </div>

      {/* Tutorial modal */}
      {showTutorial ? <TutorialModal onClose={dismissTutorial} /> : null}

      {/* Tweaks panel */}
      <TweakControls t={t} setTweak={setTweak} />
    </div>);

}

// Tutorial Modal
function TutorialModal({ onClose }) {
  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-mark">
          <svg viewBox="0 0 32 32" fill="none">
            <path d="M16 4 L28 12 L28 22 L16 28 L4 22 L4 12 Z" stroke="white" strokeWidth="2" strokeLinejoin="round" />
            <path d="M16 4 L16 16 M4 12 L16 16 L28 12 M16 16 L16 28" stroke="white" strokeWidth="2" strokeLinejoin="round" opacity="0.7" />
          </svg>
        </div>
        <h2>Selamat datang!</h2>
        <p>Validator Jaring-jaring membantu kamu memahami bagaimana jaring-jaring 2D dilipat menjadi bangun ruang. Ikuti tiga langkah berikut:</p>
        <div className="step-list">
          <div className="step">
            <div className="step-num">1</div>
            <div className="step-body"><strong>Pilih bangun ruang.</strong> Klik salah satu dari empat bangun di atas (kubus, prisma segitiga, limas segitiga, atau limas segiempat).</div>
          </div>
          <div className="step">
            <div className="step-num">2</div>
            <div className="step-body"><strong>Susun jaring-jaring.</strong> Klik kotak/segitiga yang bersebelahan dengan <strong>alas</strong> (kotak gelap) untuk menempelkan sisi-sisi. Setiap sisi baru harus bersentuhan dengan sisi yang sudah ada.</div>
          </div>
          <div className="step">
            <div className="step-num">3</div>
            <div className="step-body"><strong>Validasi &amp; Lipat.</strong> Kalau jumlah sisi sudah pas, klik tombol <strong>Validasi &amp; Lipat</strong>. Bila jaring-jaring valid, kamu bisa menggunakan slider untuk melihat lipatannya secara 3D.</div>
          </div>
        </div>
        <div className="modal-actions">
          <button className="btn btn-primary" onClick={onClose}>Mulai bermain</button>
        </div>
      </div>
    </div>);

}

// Tweaks controls
function TweakControls({ t, setTweak }) {
  const { TweaksPanel, TweakSection, TweakRadio, TweakToggle } = window;
  return (
    <TweaksPanel>
      <TweakSection label="Tampilan">
        <TweakRadio label="Kecepatan lipat" value={t.foldSpeed}
        onChange={(v) => setTweak('foldSpeed', v)}
        options={[{ value: 'slow', label: 'Lambat' }, { value: 'normal', label: 'Normal' }, { value: 'fast', label: 'Cepat' }]} />
        <TweakToggle label="Tampilkan label sisi"
        value={t.showLabels}
        onChange={(v) => setTweak('showLabels', v)} />
      </TweakSection>
    </TweaksPanel>);

}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
