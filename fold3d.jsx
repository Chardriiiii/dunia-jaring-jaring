// ===================================================================
// Vertex-based fold engine (shared by the 3D preview AND the validator).
//
// Every face is folded using its ACTUAL flat polygon vertices — the very same
// vertices the 2D editor draws (slot.verts when present, otherwise derived from
// kind + grid box). The hinge between a parent and child face is found
// geometrically as the edge their flat polygons share. This guarantees the 3D
// preview matches what the student laid out — for ANY arrangement, including
// "fan/kipas" nets where triangles cascade off other triangles' slant edges.
//
// Pipeline:
//   flat polygon verts (grid units, centred on the base)  ──►
//   per-face accumulated 4×4 transform A (fold each child about the world-space
//   image of its shared hinge)  ──►
//   world verts (for closure test)  +  CSS matrix3d (for the preview).
// ===================================================================

// ---- tiny row-major 4x4 matrix lib ----
function m4_identity() { return [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]; }
function m4_mul(a, b) {
  const o = new Array(16).fill(0);
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 4; c++)
      for (let k = 0; k < 4; k++)
        o[r*4+c] += a[r*4+k] * b[k*4+c];
  return o;
}
function m4_translate(x, y, z) { return [1,0,0,x, 0,1,0,y, 0,0,1,z, 0,0,0,1]; }
function m4_scale(s) { return [s,0,0,0, 0,s,0,0, 0,0,s,0, 0,0,0,1]; }
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

// ---- flat polygon geometry (grid units) ----
function f3_flatVerts(slot) {
  if (slot.verts) return slot.verts.map(p => [p[0], p[1]]);
  const { gx, gy, gw: w, gh: h, kind } = slot;
  switch (kind) {
    case 'square':  return [[gx,gy],[gx+w,gy],[gx+w,gy+h],[gx,gy+h]];
    case 'triUp':   return [[gx+w/2,gy],[gx+w,gy+h],[gx,gy+h]];
    case 'triDown': return [[gx,gy],[gx+w,gy],[gx+w/2,gy+h]];
    case 'triWest': return [[gx+w,gy],[gx+w,gy+h],[gx,gy+h/2]];
    case 'triEast': return [[gx,gy],[gx,gy+h],[gx+w,gy+h/2]];
    default:        return [[gx,gy],[gx+w,gy],[gx+w,gy+h],[gx,gy+h]];
  }
}
function f3_centroid2(verts) {
  let x = 0, y = 0;
  for (const p of verts) { x += p[0]; y += p[1]; }
  return [x / verts.length, y / verts.length];
}
// The shared hinge edge between two adjacent flat polygons = the (exactly two)
// vertices their outlines have in common.
function f3_sharedEdge(a, b) {
  const A = f3_flatVerts(a), B = f3_flatVerts(b), TOL = 0.04, pts = [];
  for (const pa of A) for (const pb of B) {
    if (Math.abs(pa[0]-pb[0]) < TOL && Math.abs(pa[1]-pb[1]) < TOL) {
      const m = [(pa[0]+pb[0])/2, (pa[1]+pb[1])/2];
      if (!pts.some(q => Math.abs(q[0]-m[0]) < TOL && Math.abs(q[1]-m[1]) < TOL)) pts.push(m);
    }
  }
  return pts.length >= 2 ? [pts[0], pts[1]] : null;
}

// ---- fold angle (rotation away from flat = 180° − dihedral) ----
function f3_foldAngle(shapeKey, parentSlot, childSlot) {
  if (shapeKey === 'cuboid') return 90;
  if (shapeKey === 'triPrism') {
    if (parentSlot.kind === 'square' && childSlot.kind === 'square') return 120; // ridge
    return 90; // triangle cap on a rectangle
  }
  if (shapeKey === 'triPyramid') return 109.47; // arccos(-1/3)
  if (shapeKey === 'sqPyramid') {
    const baseInvolved = parentSlot.kind === 'square' || childSlot.kind === 'square';
    return baseInvolved ? 125.26 : 70.53; // base→lateral : lateral→lateral
  }
  return 90;
}

// ---- fold tree ----
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
        node.children.push({ node: build(n.id) });
      }
    }
    return node;
  }
  return build(shape.basePos);
}

// ---- core: per-face accumulated transforms (grid-unit space) ----
// Returns { entries:[{id,slot,isBase,A}], bc:[cx,cy] }. `signs` (optional) maps
// a child face id → +1/-1 fold direction; faces not listed use a "fold away"
// heuristic so even incomplete (open) nets render sensibly.
function f3_transforms(shape, selected, progress, signs) {
  const tree = f3_buildTree(shape, selected);
  if (!tree) return null;
  const baseSlot = shape.slots.find(s => s.id === shape.basePos);
  const bc = f3_centroid2(f3_flatVerts(baseSlot));
  const fw = (g) => [g[0] - bc[0], g[1] - bc[1], 0]; // flat-world (grid units)

  const entries = [];
  function walk(node, A, isBase) {
    entries.push({ id: node.id, slot: node.slot, isBase, A });
    for (const ch of node.children) {
      const edge = f3_sharedEdge(node.slot, ch.node.slot);
      let A2 = A;
      if (edge) {
        const Q1 = m4_apply(A, fw(edge[0]));
        const Q2 = m4_apply(A, fw(edge[1]));
        let ax = [Q2[0]-Q1[0], Q2[1]-Q1[1], Q2[2]-Q1[2]];
        const al = Math.hypot(ax[0], ax[1], ax[2]) || 1;
        ax = [ax[0]/al, ax[1]/al, ax[2]/al];

        // fold direction
        let sign;
        if (signs && signs[ch.node.id] != null) {
          sign = signs[ch.node.id];
        } else {
          // fold the child's centroid toward −Z (behind the base)
          const cg = f3_centroid2(f3_flatVerts(ch.node.slot));
          const Cw = m4_apply(A, fw(cg));
          const rel = [Cw[0]-Q1[0], Cw[1]-Q1[1], Cw[2]-Q1[2]];
          const dz = ax[0]*rel[1] - ax[1]*rel[0]; // (ax × rel)_z
          sign = dz > 0 ? -1 : 1;
        }

        const ang = sign * f3_foldAngle(shape.meta.key, node.slot, ch.node.slot) * progress * Math.PI / 180;
        const R = m4_mul(m4_translate(Q1[0],Q1[1],Q1[2]),
                  m4_mul(m4_rotAxis(ax[0],ax[1],ax[2], ang),
                         m4_translate(-Q1[0],-Q1[1],-Q1[2])));
        A2 = m4_mul(R, A);
      }
      walk(ch.node, A2, false);
    }
  }
  walk(tree, m4_identity(), true);
  return { entries, bc, fw };
}

// ---- world vertices of every selected face (grid units) ----
function foldedFaces(shape, selected, progress, signs) {
  const r = f3_transforms(shape, selected, progress, signs);
  if (!r) return [];
  return r.entries.map(e => ({
    id: e.id,
    kind: e.slot.kind,
    verts: f3_flatVerts(e.slot).map(g => m4_apply(e.A, r.fw(g))),
  }));
}

// ---- closure test: watertight solid via Euler V−E+F = 2, every edge ×2 ----
function f3_facesClose(faces) {
  if (faces.length < 3) return false;
  const TOL = 0.12;
  const verts = [];
  const vid = (p) => {
    for (let i = 0; i < verts.length; i++) {
      const q = verts[i];
      if (Math.abs(q[0]-p[0]) < TOL && Math.abs(q[1]-p[1]) < TOL && Math.abs(q[2]-p[2]) < TOL) return i;
    }
    verts.push(p);
    return verts.length - 1;
  };
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

// ---- find a fold-sign assignment that closes the solid ----
function solveSigns(shape, selected) {
  const tree = f3_buildTree(shape, selected);
  if (!tree) return null;
  const hinges = [];
  (function collect(node) {
    for (const ch of node.children) { hinges.push(ch.node.id); collect(ch.node); }
  })(tree);
  if (hinges.length === 0) return f3_facesClose(foldedFaces(shape, selected, 1)) ? {} : null;
  if (hinges.length > 16) return f3_facesClose(foldedFaces(shape, selected, 1)) ? {} : null;

  const signs = {};
  let found = null;
  function dfs(i) {
    if (found) return;
    if (i === hinges.length) {
      if (f3_facesClose(foldedFaces(shape, selected, 1, signs))) found = { ...signs };
      return;
    }
    for (const s of [1, -1]) {
      signs[hinges[i]] = s;
      dfs(i + 1);
      if (found) return;
    }
  }
  dfs(0);
  return found;
}

function foldCloses(shape, selected) { return solveSigns(shape, selected) != null; }

// ---- preview: flat per-face render data (pixel space) ----
// Returns one entry per selected face: its REAL flat-polygon bounding box (in
// px), a clip-path polygon (px, relative to that box) tracing the exact face
// outline, and a matrix3d mapping the box into the folded world. Every face
// renders flat in ONE preserve-3d container, so the preview is identical to the
// validator geometry — for standard AND explicit-verts (slant) faces alike.
function f3_faceMatrices(shape, selected, progress, signs, cell) {
  const r = f3_transforms(shape, selected, progress, signs);
  if (!r) return [];
  const out = [];
  for (const e of r.entries) {
    const V = f3_flatVerts(e.slot);            // grid units
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of V) {
      if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
    }
    const w = Math.max(1e-3, (maxX - minX)) * cell;
    const h = Math.max(1e-3, (maxY - minY)) * cell;

    // clip-path polygon (px, relative to the bbox top-left)
    const clip = V.map(p => [ (p[0] - minX) * cell, (p[1] - minY) * cell ]);
    // centroid (px) for label placement
    const cg = f3_centroid2(V);
    const labelXY = [ (cg[0] - minX) * cell, (cg[1] - minY) * cell ];

    // local px → grid (÷cell, +bbox min) → flat-world (−base centroid) → A → ×cell
    let M = m4_mul(m4_scale(cell), e.A);
    M = m4_mul(M, m4_translate(minX - r.bc[0], minY - r.bc[1], 0));
    M = m4_mul(M, m4_scale(1 / cell));
    const c = [
      M[0], M[4], M[8], M[12],
      M[1], M[5], M[9], M[13],
      M[2], M[6], M[10], M[14],
      M[3], M[7], M[11], M[15],
    ];
    out.push({
      id: e.id, kind: e.slot.kind, isBase: e.isBase, w, h, clip, labelXY,
      matrix: 'matrix3d(' + c.map(n => +n.toFixed(6)).join(',') + ')',
    });
  }
  return out;
}

window.foldedFaces = foldedFaces;
window.foldCloses = foldCloses;
window.solveSigns = solveSigns;
window._f3 = { faceMatrices: f3_faceMatrices, flatVerts: f3_flatVerts };
