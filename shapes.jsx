// ===================================================================
// Shape geometry + validation
// Each shape exposes:
//   meta: { key, name, faceCount, faceComposition, uniqueNetText, faceTint }
//   slots: [{ id, kind, gx, gy, gw, gh }] — abstract grid positions
//          kind = 'square' | 'triUp' | 'triDown' | 'triWest' | 'triEast'
//   basePos: id of the locked base slot
//   adjacency: { id: [{ id, edge }] }
//   canonicalNets: [ Set<slotId> ] — every valid arrangement
//   fold3D(selected, progress, t) -> array of {id, transform, faceTone}
//     used by the 3D preview to position each face in CSS 3D space.
// ===================================================================

const TRI_H = Math.sqrt(3) / 2;
const PYR_SLANT_H = 0.866; // visual height of triangle attached to square base in the pyramid net

// -------------------- helpers --------------------
function rot90(o)  { return o.map(([r, c]) => [c, -r]); }
function refl(o)   { return o.map(([r, c]) => [r, -c]); }
function normalize(o) {
  const minR = Math.min(...o.map(p => p[0]));
  const minC = Math.min(...o.map(p => p[1]));
  return o.map(([r, c]) => [r - minR, c - minC]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}
function allSyms(offsets) {
  const out = []; let cur = offsets;
  for (let i = 0; i < 4; i++) { out.push(cur); cur = rot90(cur); }
  cur = refl(offsets);
  for (let i = 0; i < 4; i++) { out.push(cur); cur = rot90(cur); }
  return out;
}
function setEq(a, b) {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

// ===================================================================
// CUBOID (Balok) — 5×5 square grid, 11 hexominoes that fold to cube
// ===================================================================
function buildCuboid() {
  const slots = [];
  const ROWS = 5, COLS = 5;
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++)
    slots.push({ id: `s_${r}_${c}`, kind: 'square', gx: c, gy: r, gw: 1, gh: 1 });
  const basePos = 's_2_2';

  const adjacency = {};
  for (const s of slots) {
    const m = s.id.match(/s_(\d+)_(\d+)/); const r = +m[1], c = +m[2];
    const list = [];
    for (const [dr, dc, edge] of [[-1,0,'top'],[1,0,'bottom'],[0,-1,'left'],[0,1,'right']]) {
      const id = `s_${r+dr}_${c+dc}`;
      if (slots.some(t => t.id === id)) list.push({ id, edge });
    }
    adjacency[s.id] = list;
  }

  // The 11 hexominoes that fold into a cube (each in compact form, base at any filled cell).
  // 1-4-1 family (6), 1-3-2 family (3), 2-2-2 staircase (1), 3-3 stair (1).
  const HEX = [
    // 1-4-1 family: row of 4, cap above at column t, cap below at column b
    // (t, b) pairs that are non-equivalent under D4 of the strip: (0,0),(0,1),(0,2),(0,3),(1,1),(1,2)
    [[1,0,0,0],[1,1,1,1],[1,0,0,0]],   // t=0,b=0
    [[1,0,0,0],[1,1,1,1],[0,1,0,0]],   // t=0,b=1
    [[1,0,0,0],[1,1,1,1],[0,0,1,0]],   // t=0,b=2
    [[1,0,0,0],[1,1,1,1],[0,0,0,1]],   // t=0,b=3
    [[0,1,0,0],[1,1,1,1],[0,1,0,0]],   // t=1,b=1
    [[0,1,0,0],[1,1,1,1],[0,0,1,0]],   // t=1,b=2
    // 1-3-2 family: 3 cells in middle, 1 above attached to leftmost, 2 below shifted right
    [[1,0,0],[1,1,1],[0,1,1]],         // 1-3-2 (a)
    [[0,1,0],[1,1,1],[0,0,1]],         // 1-3-2 (b)  ('zig-zag')
    [[0,0,1],[1,1,1],[1,1,0]],         // 1-3-2 (c)
    // 2-2-2 staircase
    [[1,1,0,0],[0,1,1,0],[0,0,1,1]],
    // 3-3 offset
    [[1,1,1,0],[0,1,1,1]],
  ];

  const canonicalNets = [];
  const seen = new Set();
  for (const bm of HEX) {
    const cells = [];
    for (let r = 0; r < bm.length; r++) for (let c = 0; c < bm[r].length; c++)
      if (bm[r][c]) cells.push([r, c]);
    for (const [br, bc] of cells) {
      const offsets = cells.map(([r, c]) => [r - br, c - bc]);
      for (const sym of allSyms(offsets)) {
        const norm = normalize(sym);
        // translate so base lands at (2,2) on our 5x5 grid
        // sym is relative to base. base offset is (0,0) after subtraction. Find that point.
        // Use raw (non-normalized) sym to keep base offset known.
        // Place base at (2,2): for each cell in sym, place at (2 + dr, 2 + dc)
        const set = new Set();
        let ok = true;
        for (const [dr, dc] of sym) {
          const rr = 2 + dr, cc = 2 + dc;
          if (rr < 0 || rr >= ROWS || cc < 0 || cc >= COLS) { ok = false; break; }
          set.add(`s_${rr}_${cc}`);
        }
        if (!ok || !set.has(basePos)) continue;
        const k = [...set].sort().join('|');
        if (seen.has(k)) continue;
        seen.add(k);
        canonicalNets.push(set);
      }
    }
  }

  // 3D fold (cube): each face is one of 6 cube positions.
  // Approach: BFS from base, each face inherits parent's cube position via edge mapping.
  // Compute parent edge -> child cube face. Use a face state {pos, axes} where pos is one of
  // 'bottom'|'top'|'front'|'back'|'left'|'right' and axes encode which 2D direction maps to which cube edge.
  const CUBE_INIT = { pos: 'bottom', up: 'N' }; // up=N means the +y axis of 2D maps to the "north" cube edge of bottom (which is the back of cube)
  // Mapping table: given current pos+up, and edge=(top/bottom/left/right) where we fold to child,
  // returns child's pos and up.
  // Cube net topology: at each face, the 4 neighbor faces depend on orientation.
  // I'll encode by direction vectors. Each face is a plane with center and 2 in-plane orthonormal vectors (right and up).
  // Folding over an edge by 90° brings the child to the corresponding cube face.

  function cubeFold(selected) {
    // Returns map of slotId -> { center3D: [x,y,z], normal3D, right3D, up3D, cubeFace: string }
    // Use 3D math.
    const out = {};
    if (!selected.has(basePos)) return out;
    // Base face at z=0, centered at (0,0,0). right=(1,0,0), up=(0,1,0), normal=(0,0,1) (pointing UP out of cube).
    // But the cube interior is BELOW (z<0) of base if base is "bottom" of cube. Hmm — convention matters.
    // For folding, treat base as bottom; other faces fold UP from base.
    // base center: (0, 0, 0), normal: (0, 0, 1) [outward from cube]
    // ... actually let's just compute and see.
    out[basePos] = {
      center: [0, 0, 0], right: [1, 0, 0], up: [0, -1, 0], normal: [0, 0, -1]
      // We flip y so that "top" 2D direction (smaller row index) is +Y in 3D? Actually let me re-think.
      // In 2D grid, row increases DOWN. Let 2D right = +X, 2D down = +Y.
      // For the base face flat, mapping: right→+X3D, down→+Y3D, normal=+Z3D (out of page toward viewer).
    };
    out[basePos] = {
      center: [0, 0, 0], right: [1, 0, 0], up: [0, 1, 0], normal: [0, 0, 1]
    };
    // BFS through selected
    const visited = new Set([basePos]);
    const queue = [basePos];
    while (queue.length) {
      const curId = queue.shift();
      const cur = out[curId];
      const m = curId.match(/s_(\d+)_(\d+)/); const cr = +m[1], cc = +m[2];
      for (const n of adjacency[curId]) {
        if (!selected.has(n.id) || visited.has(n.id)) continue;
        visited.add(n.id);
        // Compute child placement: child is adjacent to parent across edge n.edge.
        // First, in 2D, child's center is offset from parent's by (dr, dc) = (0,1) for right, etc.
        // Edge direction (which way child sticks out of parent) and rotation axis (the shared edge):
        let edgeAxis, edgeOffset;
        if (n.edge === 'right')  { edgeAxis = cur.up;  edgeOffset = scale(cur.right, 1); }
        if (n.edge === 'left')   { edgeAxis = cur.up;  edgeOffset = scale(cur.right, -1); }
        if (n.edge === 'top')    { edgeAxis = cur.right; edgeOffset = scale(cur.up, -1); }
        if (n.edge === 'bottom') { edgeAxis = cur.right; edgeOffset = scale(cur.up, 1); }
        // Child flat (before folding) center = parent.center + edgeOffset
        // Then rotate child about the shared edge axis by 90° (positive direction = fold "up" toward cube interior).
        // Shared edge passes through (parent.center + edgeOffset/2)... but for rotating the center, we rotate the center about a point on the edge.
        // Simpler: child flat center is at parent + edgeOffset. The hinge axis is edgeAxis, passing through midpoint of shared edge = parent.center + edgeOffset/2.
        // After rotating by 90° about hinge axis:
        const hinge = add(cur.center, scale(edgeOffset, 0.5));
        const flatCenter = add(cur.center, edgeOffset);
        // Direction we want to rotate: fold toward cube interior. For base, interior is +Z direction.
        // Rotation angle: 90° (PI/2). Sign depends on which way "inward" is.
        // Inward direction at the edge: cross(edgeAxis, edgeOffset_normalized) gives a vector perpendicular to edge in the plane of parent.
        // To fold up (out of plane toward parent's normal direction), we want child's new center to gain a +normal component.
        // Use rotation matrix about edgeAxis by +90° and check, else flip.
        const angle = Math.PI / 2;
        const newCenter = rotateAbout(flatCenter, hinge, edgeAxis, angle);
        const newRight = rotateVec(cur.right, edgeAxis, angle);
        const newUp = rotateVec(cur.up, edgeAxis, angle);
        // Check direction: child's center should have larger normal-component than parent
        const dot1 = dot(sub(newCenter, hinge), cur.normal);
        let useAngle = angle;
        if (dot1 < 0) {
          useAngle = -angle;
          const c2 = rotateAbout(flatCenter, hinge, edgeAxis, useAngle);
          const r2 = rotateVec(cur.right, edgeAxis, useAngle);
          const u2 = rotateVec(cur.up, edgeAxis, useAngle);
          const n2 = cross(r2, u2);
          out[n.id] = { center: c2, right: r2, up: u2, normal: n2 };
        } else {
          const n2 = cross(newRight, newUp);
          out[n.id] = { center: newCenter, right: newRight, up: newUp, normal: n2 };
        }
        queue.push(n.id);
      }
    }
    return out;
  }

  return {
    meta: {
      key: 'cuboid',
      name: 'Kubus',
      shortName: 'Kubus',
      faceComposition: '6 persegi',
      faceCount: 6,
      uniqueNetCount: 11,
      uniqueNetText: 'Kubus memiliki 11 jaring-jaring unik (di luar rotasi & cermin).',
      faceTint: 'indigo',
       geometricValidation: true,
    },
    slots, basePos, adjacency, canonicalNets,
    gridSize: { w: 5, h: 5 },
    cubeFold,
  };
}

// -------------------- 3D math helpers (used by all shapes) --------------------
function add(a, b) { return [a[0]+b[0], a[1]+b[1], a[2]+b[2]]; }
function sub(a, b) { return [a[0]-b[0], a[1]-b[1], a[2]-b[2]]; }
function scale(a, s) { return [a[0]*s, a[1]*s, a[2]*s]; }
function dot(a, b) { return a[0]*b[0] + a[1]*b[1] + a[2]*b[2]; }
function cross(a, b) { return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]; }
function len(a) { return Math.sqrt(dot(a, a)); }
function norm(a) { const l = len(a); return l ? scale(a, 1/l) : [0,0,0]; }
function rotateVec(v, axis, angle) {
  // Rodrigues' rotation
  const k = norm(axis), c = Math.cos(angle), s = Math.sin(angle);
  const term1 = scale(v, c);
  const term2 = scale(cross(k, v), s);
  const term3 = scale(k, dot(k, v) * (1 - c));
  return add(add(term1, term2), term3);
}
function rotateAbout(point, pivot, axis, angle) {
  return add(rotateVec(sub(point, pivot), axis, angle), pivot);
}

// ===================================================================
// TRIANGULAR PRISM (Prisma Segitiga) — flexible 2D grid editor.
// Supports BOTH horizontal-row and vertical-column arrangements.
// Rectangles live on a 5×5 grid; every cell can attach a triangle on
// any of its 4 edges (triUp/triDown/triWest/triEast).
// A valid net is either:
//   - 3 consecutive rectangles in a ROW + 1 triUp + 1 triDown anywhere
//     along that row (9 sub-variants), OR
//   - 3 consecutive rectangles in a COLUMN + 1 triWest + 1 triEast
//     anywhere along that column (9 sub-variants).
// ===================================================================
function buildTriangularPrism() {
  const slots = [];
  const SIZE = 5;

  // Rectangle slots in a SIZE×SIZE grid
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      slots.push({ id: `r_${r}_${c}`, kind: 'square', gx: c, gy: r, gw: 1, gh: 1 });
    }
  }

  // 4 triangle slots per rect cell — they can attach on any side
  const triIds = [];
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      slots.push({ id: `tT_${r}_${c}`, kind: 'triUp',   gx: c,         gy: r - TRI_H, gw: 1,     gh: TRI_H });
      slots.push({ id: `tB_${r}_${c}`, kind: 'triDown', gx: c,         gy: r + 1,     gw: 1,     gh: TRI_H });
      slots.push({ id: `tL_${r}_${c}`, kind: 'triWest', gx: c - TRI_H, gy: r,         gw: TRI_H, gh: 1     });
      slots.push({ id: `tR_${r}_${c}`, kind: 'triEast', gx: c + 1,     gy: r,         gw: TRI_H, gh: 1     });
      triIds.push(`tT_${r}_${c}`, `tB_${r}_${c}`, `tL_${r}_${c}`, `tR_${r}_${c}`);
    }
  }

  // A square face that hangs off a triangle's slant edge, plus a triangular cap
  // on that square's far edge. slot.verts here is DISPLAY-ONLY (the 3D fold uses
  // slot.kind, not verts), so we lay them out as a clean OUTWARD-facing net —
  // each rectangle pushed away from the triangle's centroid so the three
  // rectangles fan out symmetrically at 120°, exactly like a paper net.
  const slotById = {};
  for (const s of slots) slotById[s.id] = s;

  function triLocalVerts(kind, w, h) {
    if (kind === 'triUp')   return [[w/2, 0], [w, h], [0, h]];
    if (kind === 'triDown') return [[0, 0], [w, 0], [w/2, h]];
    if (kind === 'triWest') return [[w, 0], [w, h], [0, h/2]];
    return [[0, 0], [0, h], [w, h/2]]; // triEast
  }
  function slantGeom(kind, w, h, edge) {
    if (kind === 'triUp')   return edge === 'left' ? { mid: [w/4, h/2], dir: [-w/2, h] } : { mid: [3*w/4, h/2], dir: [w/2, h] };
    if (kind === 'triDown') return edge === 'left' ? { mid: [w/4, h/2], dir: [w/2, h] }  : { mid: [3*w/4, h/2], dir: [-w/2, h] };
    if (kind === 'triWest') return edge === 'left' ? { mid: [w/2, h/4], dir: [-w, h/2] } : { mid: [w/2, 3*h/4], dir: [-w, -h/2] };
    return edge === 'left' ? { mid: [w/2, h/4], dir: [w, h/2] } : { mid: [w/2, 3*h/4], dir: [w, -h/2] };
  }

  for (const tid of triIds) {
    const t = slotById[tid];
    const tv = triLocalVerts(t.kind, t.gw, t.gh);
    let cx = 0, cy = 0; tv.forEach(p => { cx += p[0]; cy += p[1]; }); cx /= 3; cy /= 3;

    for (const edge of ['left', 'right']) {
      const g = slantGeom(t.kind, t.gw, t.gh, edge);
      // edge endpoints (local), |dir| == 1 (unit triangle side)
      const Ax = g.mid[0] - g.dir[0]/2, Ay = g.mid[1] - g.dir[1]/2;
      const Bx = g.mid[0] + g.dir[0]/2, By = g.mid[1] + g.dir[1]/2;
      // outward unit normal — flipped to point away from the triangle centroid
      let Nx = -g.dir[1], Ny = g.dir[0];
      const nl = Math.hypot(Nx, Ny) || 1; Nx /= nl; Ny /= nl;
      if ((g.mid[0] - cx) * Nx + (g.mid[1] - cy) * Ny < 0) { Nx = -Nx; Ny = -Ny; }

      const ox = t.gx, oy = t.gy;
      const v0 = [ox + Ax,        oy + Ay];
      const v1 = [ox + Bx,        oy + By];
      const v2 = [ox + Bx + Nx,   oy + By + Ny];
      const v3 = [ox + Ax + Nx,   oy + Ay + Ny];
      const sVerts = [v0, v1, v2, v3];

      const sId = `s_${tid}_${edge[0].toUpperCase()}`;
      slots.push({
        id: sId,
        kind: 'square', gw: 1, gh: 1,
        gx: Math.min(...sVerts.map(v => v[0])),
        gy: Math.min(...sVerts.map(v => v[1])),
        verts: sVerts,
        slantOf: tid, slantEdge: edge,
      });

      // Cap triangle on the square's far edge (v3—v2), apex pushed further out.
      const mx = (v2[0] + v3[0]) / 2, my = (v2[1] + v3[1]) / 2;
      const apex = [mx + Nx * TRI_H, my + Ny * TRI_H];
      const capVerts = [v3, v2, apex];
      slots.push({
        id: `cap_${sId}`,
        kind: 'triDown', gw: 1, gh: TRI_H,
        gx: Math.min(...capVerts.map(v => v[0])),
        gy: Math.min(...capVerts.map(v => v[1])),
        verts: capVerts,
        capOf: sId,
      });
    }
  }

  const basePos = 'r_2_2'; // center of the grid

  // Adjacency
  const slotIdSet = new Set(slots.map(s => s.id));
  const adjacency = {};
  for (const s of slots) {
    if (s.capOf) {
      // Triangle capping a slant square's far edge.
      adjacency[s.id] = [{ id: s.capOf, edge: 'base' }];
    } else if (s.slantOf) {
      // Square hung off a triangle slant: hinge is its 'top' edge;
      // its far ('bottom') edge can take a cap triangle.
      const list = [{ id: s.slantOf, edge: 'top' }];
      const capId = `cap_${s.id}`;
      if (slotIdSet.has(capId)) list.push({ id: capId, edge: 'bottom' });
      adjacency[s.id] = list;
    } else if (s.kind === 'square') {
      const m = s.id.match(/^r_(\d+)_(\d+)$/);
      const r = +m[1], c = +m[2];
      const list = [];
      const dirs = [[-1, 0, 'top'], [1, 0, 'bottom'], [0, -1, 'left'], [0, 1, 'right']];
      for (const [dr, dc, edge] of dirs) {
        const nid = `r_${r + dr}_${c + dc}`;
        if (slotIdSet.has(nid)) list.push({ id: nid, edge });
      }
      list.push({ id: `tT_${r}_${c}`, edge: 'top' });
      list.push({ id: `tB_${r}_${c}`, edge: 'bottom' });
      list.push({ id: `tL_${r}_${c}`, edge: 'left' });
      list.push({ id: `tR_${r}_${c}`, edge: 'right' });
      adjacency[s.id] = list;
    } else {
      // A triangle: base attaches to its host square; both slants can take a square face.
      const m = s.id.match(/^t[TBLR]_(\d+)_(\d+)$/);
      const r = +m[1], c = +m[2];
      const list = [{ id: `r_${r}_${c}`, edge: 'base' }];
      const lId = `s_${s.id}_L`, rId = `s_${s.id}_R`;
      if (slotIdSet.has(lId)) list.push({ id: lId, edge: 'left' });
      if (slotIdSet.has(rId)) list.push({ id: rId, edge: 'right' });
      adjacency[s.id] = list;
    }
  }

  // Canonical nets
  const canonicalNets = [];

  // === Horizontal arrangement: 3 consecutive rects in a row, triangles top + bottom ===
  for (let row = 0; row < SIZE; row++) {
    for (let sc = 0; sc + 2 < SIZE; sc++) {
      for (let tc = sc; tc < sc + 3; tc++) {
        for (let bc = sc; bc < sc + 3; bc++) {
          const set = new Set();
          for (let i = 0; i < 3; i++) set.add(`r_${row}_${sc + i}`);
          set.add(`tT_${row}_${tc}`);
          set.add(`tB_${row}_${bc}`);
          if (set.has(basePos)) canonicalNets.push(set);
        }
      }
    }
  }

  // === Vertical arrangement: 3 consecutive rects in a column, triangles left + right ===
  for (let col = 0; col < SIZE; col++) {
    for (let sr = 0; sr + 2 < SIZE; sr++) {
      for (let lr = sr; lr < sr + 3; lr++) {
        for (let rr = sr; rr < sr + 3; rr++) {
          const set = new Set();
          for (let i = 0; i < 3; i++) set.add(`r_${sr + i}_${col}`);
          set.add(`tL_${lr}_${col}`);
          set.add(`tR_${rr}_${col}`);
          if (set.has(basePos)) canonicalNets.push(set);
        }
      }
    }
  }

  return {
    meta: {
      key: 'triPrism',
      name: 'Prisma Segitiga',
      shortName: 'Prisma Segitiga',
      faceComposition: '2 segitiga + 3 persegi panjang',
      faceCount: 5,
      uniqueNetCount: 9,
      uniqueNetText: 'Prisma segitiga memiliki 9 jaring-jaring unik. Susun mendatar maupun tegak — atau tempelkan persegi panjang pada sisi miring segitiga (model kipas).',
      faceTint: 'mint',
      geometricValidation: true,
    },
    slots, basePos, adjacency, canonicalNets,
    gridSize: { w: SIZE, h: SIZE },
  };
}

// ===================================================================
// TRIANGULAR PYRAMID (Limas Segitiga / Tetrahedron)
// ===================================================================
function buildTriPyramid() {
  const slots = [];
  for (let r = 0; r < 3; r++) {
    for (let k = 0; k < 9; k++) {
      const kind = ((r + k) % 2 === 0) ? 'triUp' : 'triDown';
      slots.push({ id: `t_${r}_${k}`, kind, gx: k * 0.5, gy: r * TRI_H, gw: 1, gh: TRI_H });
    }
  }
  const basePos = 't_1_3';

  const adjacency = {};
  for (const s of slots) {
    const m = s.id.match(/t_(\d+)_(\d+)/); const r = +m[1], k = +m[2];
    const list = [];
    if (k > 0) list.push({ id: `t_${r}_${k-1}`, edge: 'left' });
    if (k < 8) list.push({ id: `t_${r}_${k+1}`, edge: 'right' });
    const isUp = ((r + k) % 2 === 0);
    if (isUp && r < 2) list.push({ id: `t_${r+1}_${k}`, edge: 'base' });
    if (!isUp && r > 0) list.push({ id: `t_${r-1}_${k}`, edge: 'base' });
    adjacency[s.id] = list.filter(n => slots.some(t => t.id === n.id));
  }

  // All connected 4-triangle trees containing basePos (each is a valid tetrahedron net since K4 has any spanning tree work).
  function genConnected(graph, start, size) {
    const out = []; const seen = new Set();
    function dfs(set) {
      if (set.size === size) {
        const k = [...set].sort().join('|');
        if (!seen.has(k)) { seen.add(k); out.push(new Set(set)); }
        return;
      }
      const frontier = new Set();
      for (const id of set) for (const n of graph[id] || []) if (!set.has(n.id)) frontier.add(n.id);
      for (const f of frontier) { set.add(f); dfs(set); set.delete(f); }
    }
    dfs(new Set([start]));
    return out;
  }
  function countEdges(graph, set) {
    let n = 0; const arr = [...set];
    for (let i = 0; i < arr.length; i++) for (let j = i+1; j < arr.length; j++)
      if ((graph[arr[i]] || []).some(x => x.id === arr[j])) n++;
    return n;
  }
  const candidates = genConnected(adjacency, basePos, 4).filter(s => countEdges(adjacency, s) === 3);

  return {
    meta: {
      key: 'triPyramid',
      name: 'Limas Segitiga',
      shortName: 'Limas Segitiga',
      faceComposition: '4 segitiga',
      faceCount: 4,
      uniqueNetCount: 2,
      uniqueNetText: 'Limas segitiga memiliki 2 jaring-jaring unik. Susunan yang bertabrakan saat dilipat tidak dihitung benar.',
      faceTint: 'rose',
      geometricValidation: true,
    },
    slots, basePos, adjacency, canonicalNets: candidates,
    gridSize: { w: 5, h: 3 * TRI_H },
  };
}

// ===================================================================
// SQUARE PYRAMID (Limas Segiempat)
// ===================================================================
function buildSquarePyramid() {
  const h = PYR_SLANT_H;
  const slots = [];

  // 3x3 grid of squares (visual scaffold; only the center is used as base)
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++)
    slots.push({ id: `sq_${r}_${c}`, kind: 'square', gx: c, gy: r, gw: 1, gh: 1 });

  // Primary triangles on every square (allows experimenting with wrong placements)
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
    slots.push({ id: `triT_${r}_${c}`, kind: 'triUp',   gx: c,       gy: r - h, gw: 1, gh: h });
    slots.push({ id: `triB_${r}_${c}`, kind: 'triDown', gx: c,       gy: r + 1, gw: 1, gh: h });
    slots.push({ id: `triL_${r}_${c}`, kind: 'triWest', gx: c - h,   gy: r,     gw: h, gh: 1 });
    slots.push({ id: `triR_${r}_${c}`, kind: 'triEast', gx: c + 1,   gy: r,     gw: h, gh: 1 });
  }

  // Secondary "slant" triangles: a lateral face hung off a SLANT edge of one of
  // the 4 primary triangles around the base. This enables "fan/kipas" nets where
  // faces cascade off each other (e.g. base + top face + left & right faces
  // fanning from the top face's slants + bottom face) instead of every triangle
  // attaching directly to the base. Each is an equilateral face whose BASE edge
  // hinges onto the parent's slant edge — the same robust pattern the prism uses,
  // so the 3D fold closes correctly.
  const sqLocalCentroid = (kind, w, hh) => {
    const vs = kind === 'triUp'   ? [[w/2,0],[w,hh],[0,hh]]
             : kind === 'triDown' ? [[0,0],[w,0],[w/2,hh]]
             : kind === 'triWest' ? [[w,0],[w,hh],[0,hh/2]]
             :                      [[0,0],[0,hh],[w,hh/2]];
    return [(vs[0][0]+vs[1][0]+vs[2][0])/3, (vs[0][1]+vs[1][1]+vs[2][1])/3];
  };
  const sqSlantGeom = (kind, w, hh, edge) => {
    if (kind === 'triUp')   return edge === 'left' ? { mid:[w/4,hh/2],   dir:[-w/2,hh] } : { mid:[3*w/4,hh/2], dir:[w/2,hh] };
    if (kind === 'triDown') return edge === 'left' ? { mid:[w/4,hh/2],   dir:[w/2,hh]  } : { mid:[3*w/4,hh/2], dir:[-w/2,hh] };
    if (kind === 'triWest') return edge === 'left' ? { mid:[w/2,hh/4],   dir:[-w,hh/2] } : { mid:[w/2,3*hh/4], dir:[-w,-hh/2] };
    return                         edge === 'left' ? { mid:[w/2,hh/4],   dir:[w,hh/2]  } : { mid:[w/2,3*hh/4], dir:[w,-hh/2] };
  };
  // secondary id -> [primary id, which slant edge of the primary]
  const secDefs = {
    triTL_s: ['triT_1_1','left'],  triTR_s: ['triT_1_1','right'],
    triBL_s: ['triB_1_1','left'],  triBR_s: ['triB_1_1','right'],
    triLT_s: ['triL_1_1','left'],  triLB_s: ['triL_1_1','right'],
    triRT_s: ['triR_1_1','left'],  triRB_s: ['triR_1_1','right'],
  };
  const sqSlotById = {};
  for (const s of slots) sqSlotById[s.id] = s;
  const secInfo = {}; // id -> { prim, edge } for adjacency wiring below
  for (const sid in secDefs) {
    const [primId, edge] = secDefs[sid];
    const p = sqSlotById[primId];
    const g = sqSlantGeom(p.kind, p.gw, p.gh, edge);
    const Mx = p.gx + g.mid[0], My = p.gy + g.mid[1];
    let Nx = -g.dir[1], Ny = g.dir[0];
    const nl = Math.hypot(Nx, Ny) || 1; Nx /= nl; Ny /= nl;
    // point the normal AWAY from the primary's body
    const pc = sqLocalCentroid(p.kind, p.gw, p.gh);
    const toPx = (p.gx + pc[0]) - Mx, toPy = (p.gy + pc[1]) - My;
    if (Nx * toPx + Ny * toPy > 0) { Nx = -Nx; Ny = -Ny; }
    const b1 = [Mx - 0.5 * g.dir[0], My - 0.5 * g.dir[1]];
    const b2 = [Mx + 0.5 * g.dir[0], My + 0.5 * g.dir[1]];
    const apex = [Mx + Nx * h, My + Ny * h];
    slots.push({
      id: sid, kind: 'triUp', gw: 1, gh: h,
      gx: Math.min(b1[0], b2[0], apex[0]),
      gy: Math.min(b1[1], b2[1], apex[1]),
      verts: [b1, b2, apex],
      slantOf: primId, slantEdge: edge,
    });
    secInfo[sid] = { prim: primId, edge };
  }

  const basePos = 'sq_1_1';
  const adjacency = {};
  for (const s of slots) {
    if (s.kind === 'square') {
      const m = s.id.match(/sq_(\d+)_(\d+)/); const r = +m[1], c = +m[2];
      const list = [];
      for (const [dr, dc, edge] of [[-1,0,'top'],[1,0,'bottom'],[0,-1,'left'],[0,1,'right']]) {
        const id = `sq_${r+dr}_${c+dc}`;
        if (slots.some(t => t.id === id)) list.push({ id, edge });
      }
      list.push({ id: `triT_${r}_${c}`, edge: 'top' });
      list.push({ id: `triB_${r}_${c}`, edge: 'bottom' });
      list.push({ id: `triL_${r}_${c}`, edge: 'left' });
      list.push({ id: `triR_${r}_${c}`, edge: 'right' });
      adjacency[s.id] = list;
    } else if (s.id.match(/^tri[TBLR]_\d+_\d+$/)) {
      const m = s.id.match(/tri[TBLR]_(\d+)_(\d+)/); const r = +m[1], c = +m[2];
      adjacency[s.id] = [{ id: `sq_${r}_${c}`, edge: 'base' }];
    }
  }

  // Slant adjacencies for secondaries: each secondary's BASE edge hinges onto
  // the parent primary's slant edge (parentEdge = 'left'/'right'), and the
  // secondary's own hinge is its 'base' edge.
  for (const sid in secInfo) {
    const { prim, edge } = secInfo[sid];
    adjacency[sid] = [{ id: prim, edge: 'base' }];
    adjacency[prim].push({ id: sid, edge });
  }

  // Enumerate valid nets. Each face role (N/S/W/E) must be covered exactly once.
  // Each secondary needs its primary present (the primary lives in a DIFFERENT face role).
  const roleOptions = {
    N: ['triT_1_1', 'triLT_s', 'triRT_s'],
    S: ['triB_1_1', 'triLB_s', 'triRB_s'],
    W: ['triL_1_1', 'triTL_s', 'triBL_s'],
    E: ['triR_1_1', 'triTR_s', 'triBR_s'],
  };
  // role + required primary slot id (in some OTHER role) for each secondary
  const requiredFor = {
    triLT_s: { role: 'W', primary: 'triL_1_1' },
    triLB_s: { role: 'W', primary: 'triL_1_1' },
    triRT_s: { role: 'E', primary: 'triR_1_1' },
    triRB_s: { role: 'E', primary: 'triR_1_1' },
    triTL_s: { role: 'N', primary: 'triT_1_1' },
    triTR_s: { role: 'N', primary: 'triT_1_1' },
    triBL_s: { role: 'S', primary: 'triB_1_1' },
    triBR_s: { role: 'S', primary: 'triB_1_1' },
  };
  const canonicalNets = [];
  for (const n of roleOptions.N) for (const s of roleOptions.S)
  for (const w of roleOptions.W) for (const e of roleOptions.E) {
    const picks = { N: n, S: s, W: w, E: e };
    let ok = true;
    for (const id of [n, s, w, e]) {
      const req = requiredFor[id];
      if (req && picks[req.role] !== req.primary) { ok = false; break; }
    }
    if (ok) canonicalNets.push(new Set(['sq_1_1', n, s, w, e]));
  }

  return {
    meta: {
      key: 'sqPyramid',
      name: 'Limas Segiempat',
      shortName: 'Limas Segiempat',
      faceComposition: '1 persegi + 4 segitiga',
      faceCount: 5,
      uniqueNetCount: 8,
      uniqueNetText: 'Limas segiempat memiliki 8 jaring-jaring unik. Susunan yang bertabrakan saat dilipat tidak dihitung benar.',
      faceTint: 'amber',
      geometricValidation: true,
    },
    slots, basePos, adjacency, canonicalNets,
    gridSize: { w: 3, h: 3 },
  };
}

// ===================================================================
// Assemble + validate
// ===================================================================
const SHAPES = {
  cuboid:     buildCuboid(),
  triPrism:   buildTriangularPrism(),
  triPyramid: buildTriPyramid(),
  sqPyramid:  buildSquarePyramid(),
};

// For geometrically-validated shapes, prune canonicalNets down to the nets that
// ACTUALLY fold closed (the generators over-produce — e.g. the pyramids include
// connected arrangements that collide when folded). This keeps the hint system
// from steering toward an impossible net. Validation itself runs foldCloses, so
// this only affects hints. fold3d (window.foldCloses) loads before this file.
if (typeof foldCloses === 'function') {
  for (const key of Object.keys(SHAPES)) {
    const shape = SHAPES[key];
    if (shape.meta.geometricValidation && Array.isArray(shape.canonicalNets)) {
      shape.canonicalNets = shape.canonicalNets.filter(net => {
        try { return foldCloses(shape, net); } catch (e) { return true; }
      });
    }
  }
}

function validateNet(shapeKey, selectedSet) {
  const shape = SHAPES[shapeKey];
  const required = shape.meta.faceCount;
  const sel = new Set(selectedSet);
  if (!sel.has(shape.basePos)) return { ok: false, code: 'base', reason: 'Sisi alas tidak boleh dihilangkan.' };
  if (sel.size < required) return { ok: false, code: 'count_low', reason: `Jaring-jaring belum lengkap. Butuh ${required} sisi (sekarang ${sel.size}).` };
  if (sel.size > required) return { ok: false, code: 'count_high', reason: `Sisi terlalu banyak. Hanya boleh ${required} sisi (sekarang ${sel.size}).` };
  // Connectivity from base
  const visited = new Set([shape.basePos]);
  const queue = [shape.basePos];
  while (queue.length) {
    const cur = queue.shift();
    for (const n of (shape.adjacency[cur] || [])) {
      if (sel.has(n.id) && !visited.has(n.id)) { visited.add(n.id); queue.push(n.id); }
    }
  }
  if (visited.size !== sel.size) return { ok: false, code: 'disconnect', reason: 'Ada sisi yang terpisah dari sisi alas. Semua sisi harus terhubung satu sama lain.' };
  // Geometric validation: simulate the fold and check the solid actually closes.
  // Accepts ANY correct arrangement (strip, vertical, or fan/star with squares
  // on the triangle's slant sides) — not just a hand-listed set of nets.
  if (shape.meta.geometricValidation && typeof foldCloses === 'function') {
    if (foldCloses(shape, sel)) return { ok: true, code: 'ok', reason: 'Selamat! Jaring-jaring kamu benar dan membentuk bangun ruang.' };
    return { ok: false, code: 'overlap', reason: 'Sisi tumpang tindih ketika dilipat. Coba susunan lain!' };
  }
  // Match canonical
  for (const net of shape.canonicalNets) {
    if (setEq(net, sel)) return { ok: true, code: 'ok', reason: 'Selamat! Jaring-jaring kamu benar dan membentuk bangun ruang.' };
  }
  return { ok: false, code: 'overlap', reason: 'Sisi tumpang tindih ketika dilipat. Coba susunan lain!' };
}

// Returns array of slot IDs that could be added next to progress toward a valid net.
function getHints(shapeKey, selectedSet) {
  const shape = SHAPES[shapeKey];
  const sel = new Set(selectedSet);

  // Find canonical nets that the user's selection is a subset of.
  const compatibleNets = shape.canonicalNets.filter(net => {
    for (const s of sel) if (!net.has(s)) return false;
    return true;
  });
  if (compatibleNets.length === 0) return [];

  // Collect every slot that:
  // (a) appears in at least one compatible net,
  // (b) is not already selected,
  // (c) is adjacent to some currently selected slot.
  const hints = new Set();
  for (const net of compatibleNets) {
    for (const id of net) {
      if (sel.has(id)) continue;
      const adj = shape.adjacency[id] || [];
      if (adj.some(a => sel.has(a.id))) hints.add(id);
    }
  }
  return [...hints];
}

// Backward-compat single-hint helper (returns first hint, or null).
function getHint(shapeKey, selectedSet) {
  const all = getHints(shapeKey, selectedSet);
  return all.length ? all[0] : null;
}

window.SHAPES = SHAPES;
window.validateNet = validateNet;
window.getHint = getHint;
window.getHints = getHints;
