// ===================================================================
// Geometric fold simulator + closure validator.
// Mirrors the placement math in preview.jsx (FoldFace) but in plain
// matrices, so we can compute every face's final 3D vertices and check
// whether the net actually closes into a solid — instead of comparing
// against a hand-written list of "canonical" nets. This lets the editor
// accept ANY valid arrangement the student discovers (strip, fan/star,
// rectangles hung off a triangle's slanted side, …).
// ===================================================================

const F3_TRI_H = Math.sqrt(3) / 2;

// ---- tiny row-major 4x4 matrix lib ----
function m4_identity() {
  return [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
}
function m4_mul(a, b) {
  const o = new Array(16).fill(0);
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 4; c++)
      for (let k = 0; k < 4; k++)
        o[r*4+c] += a[r*4+k] * b[k*4+c];
  return o;
}
function m4_translate(x, y, z) {
  return [1,0,0,x, 0,1,0,y, 0,0,1,z, 0,0,0,1];
}
function m4_rotZ(rad) {
  const c = Math.cos(rad), s = Math.sin(rad);
  return [c,-s,0,0, s,c,0,0, 0,0,1,0, 0,0,0,1];
}
// rotation about an arbitrary unit axis (Rodrigues)
function m4_rotAxis(ux, uy, uz, rad) {
  const len = Math.hypot(ux, uy, uz) || 1;
  ux /= len; uy /= len; uz /= len;
  const c = Math.cos(rad), s = Math.sin(rad), t = 1 - c;
  return [
    t*ux*ux + c,     t*ux*uy - s*uz, t*ux*uz + s*uy, 0,
    t*ux*uy + s*uz,  t*uy*uy + c,    t*uy*uz - s*ux, 0,
    t*ux*uz - s*uy,  t*uy*uz + s*ux, t*uz*uz + c,    0,
    0,0,0,1,
  ];
}
function m4_apply(m, p) {
  const [x, y, z] = p;
  return [
    m[0]*x + m[1]*y + m[2]*z + m[3],
    m[4]*x + m[5]*y + m[6]*z + m[7],
    m[8]*x + m[9]*y + m[10]*z + m[11],
  ];
}

// Edge geometry in a face's local coords (grid units). Matches preview.jsx.
function f3_edgeGeom(kind, w, h, edge) {
  switch (kind) {
    case 'square':
      if (edge === 'top')    return { mid: [w/2, 0], dir: [1, 0] };
      if (edge === 'bottom') return { mid: [w/2, h], dir: [1, 0] };
      if (edge === 'left')   return { mid: [0, h/2], dir: [0, 1] };
      if (edge === 'right')  return { mid: [w, h/2], dir: [0, 1] };
      break;
    case 'triUp':
      if (edge === 'base')  return { mid: [w/2, h],     dir: [1, 0] };
      if (edge === 'left')  return { mid: [w/4, h/2],   dir: [-w/2, h] };
      if (edge === 'right') return { mid: [3*w/4, h/2], dir: [w/2, h] };
      break;
    case 'triDown':
      if (edge === 'base')  return { mid: [w/2, 0],     dir: [1, 0] };
      if (edge === 'left')  return { mid: [w/4, h/2],   dir: [w/2, h] };
      if (edge === 'right') return { mid: [3*w/4, h/2], dir: [-w/2, h] };
      break;
    case 'triWest':
      if (edge === 'base')  return { mid: [w, h/2],     dir: [0, 1] };
      if (edge === 'left')  return { mid: [w/2, h/4],   dir: [-w, h/2] };
      if (edge === 'right') return { mid: [w/2, 3*h/4], dir: [-w, -h/2] };
      break;
    case 'triEast':
      if (edge === 'base')  return { mid: [0, h/2],     dir: [0, 1] };
      if (edge === 'left')  return { mid: [w/2, h/4],   dir: [w, h/2] };
      if (edge === 'right') return { mid: [w/2, 3*h/4], dir: [w, -h/2] };
      break;
  }
  return { mid: [w/2, h/2], dir: [1, 0] };
}

// Local polygon vertices of a face (grid units).
function f3_localVerts(slot) {
  const w = slot.gw, h = slot.gh;
  switch (slot.kind) {
    case 'square':  return [[0,0],[w,0],[w,h],[0,h]];
    case 'triUp':   return [[w/2,0],[w,h],[0,h]];
    case 'triDown': return [[0,0],[w,0],[w/2,h]];
    case 'triWest': return [[w,0],[w,h],[0,h/2]];
    case 'triEast': return [[0,0],[0,h],[w,h/2]];
    default:        return [[0,0],[w,0],[w,h],[0,h]];
  }
}

// Same fold-angle table as preview.jsx.
function f3_foldAngle(shapeKey, parentSlot, childSlot) {
  if (shapeKey === 'cuboid') return 90;
  if (shapeKey === 'triPrism') {
    if (parentSlot.kind === 'square' && childSlot.kind === 'square') return 120;
    return 90;
  }
  if (shapeKey === 'triPyramid') return 109.47;
  if (shapeKey === 'sqPyramid') {
    if (parentSlot.kind === 'square' || childSlot.kind === 'square') return 125.26;
    return 109.47;
  }
  return 90;
}

// Build the fold tree (same traversal as preview.buildFoldTree).
function f3_buildTree(shape, selected) {
  if (!selected.has(shape.basePos)) return null;
  const slotById = {};
  for (const s of shape.slots) slotById[s.id] = s;
  const visited = new Set([shape.basePos]);
  function build(id) {
    const node = { id, slot: slotById[id], children: [] };
    for (const n of (shape.adjacency[id] || [])) {
      if (selected.has(n.id) && !visited.has(n.id)) {
        visited.add(n.id);
        const childNode = build(n.id);
        const reverse = (shape.adjacency[n.id] || []).find(a => a.id === id);
        node.children.push({ node: childNode, parentEdge: n.edge, childHinge: reverse && reverse.edge });
      }
    }
    return node;
  }
  return build(shape.basePos);
}

// Default fold sign from the 2D layout (mountain/valley heuristic). Correct for
// simple tree nets; can be wrong for a face hung off an already-folded face
// (e.g. a cap triangle on a lateral rectangle) — solveSigns() fixes those.
function f3_defaultSign(parentSlot, childSlot, parentEdge, childHinge) {
  const pe = f3_edgeGeom(parentSlot.kind, parentSlot.gw, parentSlot.gh, parentEdge);
  const ce = f3_edgeGeom(childSlot.kind, childSlot.gw, childSlot.gh, childHinge);
  const left = pe.mid[0] - ce.mid[0];
  const top  = pe.mid[1] - ce.mid[1];
  let axX = pe.dir[0], axY = pe.dir[1];
  const axLen = Math.hypot(axX, axY) || 1; axX /= axLen; axY /= axLen;
  let cdx = ce.dir[0], cdy = ce.dir[1];
  const cdl = Math.hypot(cdx, cdy) || 1; cdx /= cdl; cdy /= cdl;
  const theta = Math.atan2(axY, axX) - Math.atan2(cdy, cdx);
  const cosT = Math.cos(theta), sinT = Math.sin(theta);
  const c0x = childSlot.gw / 2 + left, c0y = childSlot.gh / 2 + top;
  const rdx = c0x - pe.mid[0], rdy = c0y - pe.mid[1];
  const offX = rdx * cosT - rdy * sinT;
  const offY = rdx * sinT + rdy * cosT;
  const crossZ = axX * offY - axY * offX;
  return crossZ < 0 ? 1 : -1;
}

// Local placement matrix of a child relative to its parent's local frame.
// `sign` is optional; when omitted the layout heuristic is used.
function f3_childMatrix(shapeKey, parentSlot, childSlot, parentEdge, childHinge, progress, sign) {
  const pe = f3_edgeGeom(parentSlot.kind, parentSlot.gw, parentSlot.gh, parentEdge);
  const ce = f3_edgeGeom(childSlot.kind, childSlot.gw, childSlot.gh, childHinge);
  const left = pe.mid[0] - ce.mid[0];
  const top  = pe.mid[1] - ce.mid[1];

  let axX = pe.dir[0], axY = pe.dir[1];
  const axLen = Math.hypot(axX, axY) || 1; axX /= axLen; axY /= axLen;
  let cdx = ce.dir[0], cdy = ce.dir[1];
  const cdl = Math.hypot(cdx, cdy) || 1; cdx /= cdl; cdy /= cdl;

  const theta = Math.atan2(axY, axX) - Math.atan2(cdy, cdx);
  if (sign == null) sign = f3_defaultSign(parentSlot, childSlot, parentEdge, childHinge);

  const angle = sign * f3_foldAngle(shapeKey, parentSlot, childSlot) * progress * Math.PI / 180;

  // CSS: translate(left,top) then [about origin o=ce.mid] rotate3d(axis,angle)·rotateZ(theta)
  const R = m4_mul(m4_rotAxis(axX, axY, 0, angle), m4_rotZ(theta));
  let M = m4_translate(left, top, 0);
  M = m4_mul(M, m4_translate(ce.mid[0], ce.mid[1], 0));
  M = m4_mul(M, R);
  M = m4_mul(M, m4_translate(-ce.mid[0], -ce.mid[1], 0));
  return M;
}

// Compute the 3D world vertices of every selected face at the given progress.
// `signs` (optional) maps a child slot id → +1/-1 fold direction; faces not in
// the map use the layout heuristic.
function foldedFaces(shape, selected, progress, signs) {
  const tree = f3_buildTree(shape, selected);
  if (!tree) return [];
  const out = [];
  function walk(node, worldMat) {
    const verts = f3_localVerts(node.slot).map(([x, y]) => m4_apply(worldMat, [x, y, 0]));
    out.push({ id: node.id, kind: node.slot.kind, verts });
    for (const child of node.children) {
      const sgn = signs ? signs[child.node.id] : undefined;
      const ml = f3_childMatrix(shape.meta.key, node.slot, child.node.slot, child.parentEdge, child.childHinge, progress, sgn);
      walk(child.node, m4_mul(worldMat, ml));
    }
  }
  walk(tree, m4_identity());
  return out;
}

// Closure test on a precomputed face list. Returns true iff the glued mesh is a
// watertight solid (every edge shared by exactly two faces; Euler V−E+F = 2).
function f3_facesClose(faces) {
  if (faces.length < 3) return false;
  const TOL = 0.12;
  const verts = [];
  function vid(p) {
    for (let i = 0; i < verts.length; i++) {
      const q = verts[i];
      if (Math.abs(q[0]-p[0]) < TOL && Math.abs(q[1]-p[1]) < TOL && Math.abs(q[2]-p[2]) < TOL) return i;
    }
    verts.push(p);
    return verts.length - 1;
  }
  const edgeCount = {};
  for (const f of faces) {
    const ids = f.verts.map(vid);
    for (let i = 0; i < ids.length; i++) {
      const a = ids[i], b = ids[(i+1) % ids.length];
      if (a === b) return false;
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      edgeCount[key] = (edgeCount[key] || 0) + 1;
    }
  }
  const F = faces.length, V = verts.length;
  const edges = Object.keys(edgeCount);
  const E = edges.length;
  for (const k of edges) if (edgeCount[k] !== 2) return false;
  return V - E + F === 2;
}

// Find a per-face fold-sign assignment that closes the solid. The layout
// heuristic is right for most hinges, so we DFS over only the hinges, trying the
// heuristic sign first; this resolves caps hung off already-folded faces.
function solveSigns(shape, selected) {
  const tree = f3_buildTree(shape, selected);
  if (!tree) return null;
  // collect hinge edges (child id + heuristic sign) in a flat list
  const hinges = [];
  (function collect(node) {
    for (const child of node.children) {
      const def = f3_defaultSign(node.slot, child.node.slot, child.parentEdge, child.childHinge);
      hinges.push({ id: child.node.id, def });
      collect(child.node);
    }
  })(tree);
  if (hinges.length === 0) return f3_facesClose(foldedFaces(shape, selected, 1)) ? {} : null;
  if (hinges.length > 16) {
    // too many to brute-force; fall back to heuristic only
    return f3_facesClose(foldedFaces(shape, selected, 1)) ? {} : null;
  }

  const signs = {};
  let found = null;
  function dfs(i) {
    if (found) return;
    if (i === hinges.length) {
      if (f3_facesClose(foldedFaces(shape, selected, 1, signs))) found = { ...signs };
      return;
    }
    // try heuristic sign first, then its opposite
    for (const s of [hinges[i].def, -hinges[i].def]) {
      signs[hinges[i].id] = s;
      dfs(i + 1);
      if (found) return;
    }
  }
  dfs(0);
  return found;
}

// Does the folded net close into a watertight solid (allowing the solver to
// pick correct fold directions)?
function foldCloses(shape, selected) {
  return solveSigns(shape, selected) != null;
}

// Flat (progress 0) world vertices of a child face placed off a parent that
// sits at `rootOffset` with no rotation. Used by shapes.jsx so the 2D editor
// layout of slant squares / cap triangles matches the fold exactly.
function flatChildVerts(parentSlot, childSlot, parentEdge, childHinge, parentMat) {
  const M = f3_childMatrix('triPrism', parentSlot, childSlot, parentEdge, childHinge, 0);
  const world = m4_mul(parentMat, M);
  const verts = f3_localVerts(childSlot).map(([x, y]) => {
    const p = m4_apply(world, [x, y, 0]);
    return [p[0], p[1]];
  });
  return { verts, mat: world };
}

// Per-child LOCAL transform as a CSS matrix3d() string, in PIXEL units (grid
// units × cell). This is the SAME matrix the validator folds with, so the 3D
// preview is guaranteed to match the closure geometry exactly — no CSS
// rotate3d/handedness divergence. `sign` may be undefined (uses heuristic).
function f3_childCssMatrix(shapeKey, parentSlot, childSlot, parentEdge, childHinge, progress, sign, cell) {
  const M = f3_childMatrix(shapeKey, parentSlot, childSlot, parentEdge, childHinge, progress, sign);
  // scale translation components to pixels (conjugate by uniform scale `cell`)
  const P = M.slice();
  P[3] *= cell; P[7] *= cell; P[11] *= cell;
  // CSS matrix3d is column-major
  const c = [
    P[0], P[4], P[8], P[12],
    P[1], P[5], P[9], P[13],
    P[2], P[6], P[10], P[14],
    P[3], P[7], P[11], P[15],
  ];
  return 'matrix3d(' + c.map(n => +n.toFixed(6)).join(',') + ')';
}

window.foldedFaces = foldedFaces;
window.foldCloses = foldCloses;
window.solveSigns = solveSigns;
window._f3 = {
  flatChildVerts,
  childCssMatrix: f3_childCssMatrix,
  translate: m4_translate,
  identity: m4_identity,
};
