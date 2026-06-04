// 3D fold preview — FLAT single-container render.
//
// All faces live in ONE `preserve-3d` scene, each positioned by a matrix3d that
// fold3d.jsx computes from the face's REAL flat polygon (the same vertices the
// 2D editor draws). The fold geometry is therefore identical to the validator —
// what you lay out is exactly what folds, for every arrangement (strip, fan,
// slant faces, …). No nested per-face frames, so no drift.

const PREVIEW_CELL = 90; // pixels per grid unit in the 3D preview

const { useMemo } = React;

// One folded face: a div the size of the face's flat bounding box, clipped to
// the exact polygon outline and mapped into the folded world by `matrix`.
function FaceTile({ face, tone }) {
  const isTri = face.kind !== 'square';
  let cls = 'face-shape';
  cls += isTri ? ' triangle' : ' square';
  if (tone) cls += ` tone-${tone}`;
  if (face.isBase) cls += ' is-base';

  const clipPath = 'polygon(' +
    face.clip.map(p => `${p[0].toFixed(2)}px ${p[1].toFixed(2)}px`).join(', ') +
    ')';

  return (
    <div className="face-node" style={{
      position: 'absolute', left: 0, top: 0,
      width: face.w, height: face.h,
      transform: face.matrix,
      transformOrigin: '0 0',
    }}>
      <div className={cls} style={{ width: face.w, height: face.h, clipPath }}>
        {face.isBase ? (
          <span className="face-label" style={{
            position: 'absolute',
            left: face.labelXY[0], top: face.labelXY[1],
            transform: 'translate(-50%, -50%)',
          }}>ALAS</span>
        ) : null}
      </div>
    </div>
  );
}

function FoldPreview({ shape, selected, progress, tone, sceneRot, foldDur }) {
  // Solve correct fold directions for this arrangement; falls back to the
  // "fold away" heuristic inside fold3d when no closing solution exists (so even
  // an incomplete, open net still previews sensibly while being built).
  const signs = useMemo(() => {
    if (typeof solveSigns !== 'function') return null;
    try { return solveSigns(shape, new Set(selected)); } catch (e) { return null; }
  }, [shape, selected]);

  const faces = useMemo(() => {
    if (!selected.has(shape.basePos)) return null;
    if (!(window._f3 && window._f3.faceMatrices)) return null;
    try {
      return window._f3.faceMatrices(shape, selected, progress, signs, PREVIEW_CELL);
    } catch (e) {
      return null;
    }
  }, [shape, selected, progress, signs]);

  if (!faces || faces.length === 0) {
    return (
      <div className="preview-empty">
        <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M32 8 L56 24 L56 48 L32 56 L8 48 L8 24 Z" />
          <path d="M32 8 L32 56 M8 24 L56 24 M8 48 L56 48" opacity="0.3" />
        </svg>
        <div>Mulai menyusun jaring-jaring di sebelah kiri. Bangun ruang akan muncul di sini saat sisi-sisinya terhubung.</div>
      </div>
    );
  }

  return (
    <div className="preview-scene">
      <div className="scene-rot" style={{
        transform: `rotateX(${sceneRot.x}deg) rotateY(${sceneRot.y}deg) rotateZ(${sceneRot.z || 0}deg)`,
        transition: foldDur ? `transform 0ms` : undefined,
      }}>
        {faces.map(f => <FaceTile key={f.id} face={f} tone={tone} />)}
      </div>
    </div>
  );
}

window.FoldPreview = FoldPreview;
