// 3D fold preview using nested CSS 3D transforms.
// Each face is a div positioned in its parent's local coordinate frame,
// folded around its shared edge with the parent.

const PREVIEW_CELL = 90; // pixels per grid unit in 3D preview

// Fold angle from flat (180° dihedral) to the target dihedral in the solid.
function getFoldAngle(shapeKey, parentSlot, childSlot) {
  if (shapeKey === 'cuboid') return 90;
  if (shapeKey === 'triPrism') {
    // rect-rect: cross-section equilateral triangle, dihedral 60° -> fold 120°
    if (parentSlot.kind === 'square' && childSlot.kind === 'square') return 120;
    return 90; // rect-triangle cap
  }
  if (shapeKey === 'triPyramid') return 109.47; // arccos(-1/3)
  if (shapeKey === 'sqPyramid') {
    // base-to-lateral fold = 180° - 54.74° = 125.26°
    // lateral-to-lateral fold = 180° - 70.53° = 109.47°
    if (parentSlot.kind === 'square' || childSlot.kind === 'square') return 125.26;
    return 109.47;
  }
  return 90;
}

// Edge geometry in face's local pixel coordinates.
// Returns { mid: [x,y], dir: [dx,dy] } for the named edge of a face.
function edgeGeom(faceKind, w, h, edge) {
  switch (faceKind) {
    case 'square':
      if (edge === 'top')    return { mid: [w/2, 0],   dir: [1, 0] };
      if (edge === 'bottom') return { mid: [w/2, h],   dir: [1, 0] };
      if (edge === 'left')   return { mid: [0, h/2],   dir: [0, 1] };
      if (edge === 'right')  return { mid: [w, h/2],   dir: [0, 1] };
      break;
    case 'triUp':
      // vertices: (w/2,0) apex, (0,h) BL, (w,h) BR
      if (edge === 'base')  return { mid: [w/2, h],     dir: [1, 0] };
      if (edge === 'left')  return { mid: [w/4, h/2],   dir: [-w/2, h] };
      if (edge === 'right') return { mid: [3*w/4, h/2], dir: [w/2, h] };
      break;
    case 'triDown':
      // vertices: (0,0) TL, (w,0) TR, (w/2,h) apex
      if (edge === 'base')  return { mid: [w/2, 0],     dir: [1, 0] };
      if (edge === 'left')  return { mid: [w/4, h/2],   dir: [w/2, h] };
      if (edge === 'right') return { mid: [3*w/4, h/2], dir: [-w/2, h] };
      break;
    case 'triWest':
      // vertices: (w,0) TR, (w,h) BR, (0, h/2) apex-left
      if (edge === 'base')  return { mid: [w, h/2],     dir: [0, 1] };
      if (edge === 'left')  return { mid: [w/2, h/4],   dir: [-w, h/2] };
      if (edge === 'right') return { mid: [w/2, 3*h/4], dir: [-w, -h/2] };
      break;
    case 'triEast':
      // vertices: (0,0) TL, (0,h) BL, (w, h/2) apex-right
      if (edge === 'base')  return { mid: [0, h/2],     dir: [0, 1] };
      if (edge === 'left')  return { mid: [w/2, h/4],   dir: [w, h/2] };
      if (edge === 'right') return { mid: [w/2, 3*h/4], dir: [w, -h/2] };
      break;
  }
  return { mid: [w/2, h/2], dir: [1, 0] };
}

function dimsFor(slot) {
  return { w: slot.gw * PREVIEW_CELL, h: slot.gh * PREVIEW_CELL };
}

function buildFoldTree(shape, selected) {
  if (!selected.has(shape.basePos)) return null;
  const visited = new Set([shape.basePos]);
  function build(id) {
    const slot = shape.slots.find(s => s.id === id);
    const node = { id, slot, children: [] };
    for (const n of (shape.adjacency[id] || [])) {
      if (selected.has(n.id) && !visited.has(n.id)) {
        visited.add(n.id);
        const childNode = build(n.id);
        const reverse = (shape.adjacency[n.id] || []).find(a => a.id === id);
        node.children.push({
          node: childNode,
          parentEdge: n.edge,    // edge of PARENT shared with child
          childHinge: reverse?.edge, // edge of CHILD shared with parent
        });
      }
    }
    return node;
  }
  return build(shape.basePos);
}

// ----- React components -----

function FacePane({ slot, tone, isBase, w, h }) {
  let shapeClass = 'face-shape';
  if (slot.kind === 'square') shapeClass += ' square';
  else if (slot.kind === 'triUp' || slot.kind === 'triDown' || slot.kind === 'triWest' || slot.kind === 'triEast') {
    shapeClass += ' triangle';
  }
  if (tone) shapeClass += ` tone-${tone}`;
  if (isBase) shapeClass += ' is-base';

  let clipPath;
  if (slot.kind === 'triUp')   clipPath = 'polygon(50% 0%, 100% 100%, 0% 100%)';
  if (slot.kind === 'triDown') clipPath = 'polygon(0% 0%, 100% 0%, 50% 100%)';
  if (slot.kind === 'triWest') clipPath = 'polygon(100% 0%, 100% 100%, 0% 50%)';
  if (slot.kind === 'triEast') clipPath = 'polygon(0% 0%, 100% 50%, 0% 100%)';

  return (
    <div className={shapeClass} style={{ width: w, height: h, clipPath }}>
      {isBase ? <span>ALAS</span> : null}
    </div>
  );
}

function FoldFace({ node, parentSlot, parentEdge, childHinge, shapeKey, tone, progress, foldDur, isBase, signs }) {
  const { w, h } = dimsFor(node.slot);

  let placement = {};
  if (isBase) {
    placement = {
      left: -w / 2,
      top: -h / 2,
      transform: 'translateZ(0px)',
    };
  } else {
    // Drive the fold from fold3d's EXACT matrix (shared with the validator) so
    // the preview always matches the closure geometry. A solved sign (from
    // window.solveSigns) is used when available; otherwise the heuristic in
    // f3_childMatrix applies.
    const sign = (signs && signs[node.slot.id] != null) ? signs[node.slot.id] : undefined;
    let transform;
    if (window._f3 && window._f3.childCssMatrix) {
      transform = window._f3.childCssMatrix(
        shapeKey, parentSlot, node.slot, parentEdge, childHinge, progress, sign, PREVIEW_CELL
      );
    } else {
      transform = 'translateZ(0px)';
    }
    placement = {
      left: 0,
      top: 0,
      transformOrigin: '0 0',
      transform,
    };
  }

  return (
    <div className="face-node" style={{
      ...placement,
      width: w, height: h,
      '--fold-dur': `${foldDur}ms`,
    }}>
      <FacePane slot={node.slot} tone={tone} isBase={isBase} w={w} h={h} />
      {node.children.map(child => (
        <FoldFace key={child.node.id}
                   node={child.node}
                   parentSlot={node.slot}
                   parentEdge={child.parentEdge}
                   childHinge={child.childHinge}
                   shapeKey={shapeKey}
                   tone={tone}
                   progress={progress}
                   foldDur={foldDur}
                   isBase={false}
                   signs={signs} />
      ))}
    </div>
  );
}

function FoldPreview({ shape, selected, progress, tone, sceneRot, foldDur }) {
  const tree = useMemo(() => buildFoldTree(shape, selected), [shape, selected]);
  // Solve correct fold directions once per arrangement (e.g. caps on lateral
  // faces). Falls back to per-face heuristic when no closing solution exists.
  const signs = useMemo(() => {
    if (typeof solveSigns !== 'function') return null;
    try { return solveSigns(shape, new Set(selected)); } catch (e) { return null; }
  }, [shape, selected]);

  if (!tree) {
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
      }}>
        <FoldFace node={tree}
                   shapeKey={shape.meta.key}
                   tone={tone}
                   progress={progress}
                   foldDur={foldDur}
                   isBase={true}
                   signs={signs} />
      </div>
    </div>
  );
}

window.FoldPreview = FoldPreview;
