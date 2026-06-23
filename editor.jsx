// 2D grid editor — renders slots for a shape and lets the user click to toggle them.

const { useState, useEffect, useRef, useMemo } = React;

function NetEditor({ shape, selected, setSelected, hintIds, tone, showLabels, getSlotColor }) {
  // Filter duplikat slot (untuk jaga-jaga)
  const uniqueSlots = useMemo(() => {
    const seen = new Set();
    return shape.slots.filter(s => {
      if (seen.has(s.id)) return false;
      seen.add(s.id);
      return true;
    });
  }, [shape.slots]);

  const slotIndex = useMemo(() => {
    const idx = {};
    for (const s of shape.slots) idx[s.id] = s;
    return idx;
  }, [shape]);

  // Compute bounding box of all slots to size SVG
  const bounds = useMemo(() => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const s of shape.slots) {
      if (s.verts) {
        for (const [vx, vy] of s.verts) {
          minX = Math.min(minX, vx); minY = Math.min(minY, vy);
          maxX = Math.max(maxX, vx); maxY = Math.max(maxY, vy);
        }
      } else {
        minX = Math.min(minX, s.gx);
        minY = Math.min(minY, s.gy);
        maxX = Math.max(maxX, s.gx + s.gw);
        maxY = Math.max(maxY, s.gy + s.gh);
      }
    }
    const pad = 0.2;
    return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
  }, [shape]);

  const CELL = 60;
  const svgW = (bounds.maxX - bounds.minX) * CELL;
  const svgH = (bounds.maxY - bounds.minY) * CELL;

  function toggleSlot(id) {
    if (id === shape.basePos) return;
    const isActive = selected.has(id);
    if (isActive) {
      const next = new Set(selected);
      next.delete(id);
      setSelected(next);
    } else {
      if (selected.size >= shape.meta.faceCount) return;
      const adj = shape.adjacency[id] || [];
      if (!adj.some(a => selected.has(a.id))) return;
      const next = new Set(selected);
      next.add(id);
      setSelected(next);
    }
  }

  const eligible = useMemo(() => {
    const elig = new Set();
    if (selected.size >= shape.meta.faceCount) return elig;
    for (const sid of selected) {
      for (const n of (shape.adjacency[sid] || [])) {
        if (!selected.has(n.id)) elig.add(n.id);
      }
    }
    return elig;
  }, [selected, shape]);

  function getPolygon(slot) {
    if (slot.verts) {
      const pts = slot.verts
        .map(([vx, vy]) => `${(vx - bounds.minX) * CELL},${(vy - bounds.minY) * CELL}`)
        .join(' ');
      return { type: 'poly', points: pts };
    }
    const x = (slot.gx - bounds.minX) * CELL;
    const y = (slot.gy - bounds.minY) * CELL;
    const w = slot.gw * CELL;
    const h = slot.gh * CELL;
    switch (slot.kind) {
      case 'square':   return { type: 'rect', x, y, w, h };
      case 'triUp':    return { type: 'poly', points: `${x + w/2},${y} ${x + w},${y + h} ${x},${y + h}` };
      case 'triDown':  return { type: 'poly', points: `${x},${y} ${x + w},${y} ${x + w/2},${y + h}` };
      case 'triWest':  return { type: 'poly', points: `${x + w},${y} ${x + w},${y + h} ${x},${y + h/2}` };
      case 'triEast':  return { type: 'poly', points: `${x},${y} ${x + w},${y + h/2} ${x},${y + h}` };
      default:         return { type: 'rect', x, y, w, h };
    }
  }

  function getCenter(slot) {
    if (slot.verts) {
      let sx = 0, sy = 0;
      for (const [vx, vy] of slot.verts) { sx += vx; sy += vy; }
      const n = slot.verts.length;
      return { x: (sx / n - bounds.minX) * CELL, y: (sy / n - bounds.minY) * CELL };
    }
    const x = (slot.gx - bounds.minX) * CELL;
    const y = (slot.gy - bounds.minY) * CELL;
    const w = slot.gw * CELL;
    const h = slot.gh * CELL;
    switch (slot.kind) {
      case 'triUp':   return { x: x + w/2, y: y + h * 0.66 };
      case 'triDown': return { x: x + w/2, y: y + h * 0.34 };
      case 'triWest': return { x: x + w * 0.34, y: y + h/2 };
      case 'triEast': return { x: x + w * 0.66, y: y + h/2 };
      default:        return { x: x + w/2, y: y + h/2 };
    }
  }

  function labelFor(slot, idx) {
    if (slot.id === shape.basePos) return 'ALAS';
    if (!showLabels) return '';
    return `${idx + 1}`;
  }

  const selectedList = [...selected];

  return (
    <div className="editor-grid" style={{ width: svgW, height: svgH }}>
      <svg width={svgW} height={svgH} viewBox={`0 0 ${svgW} ${svgH}`} style={{ display: 'block' }}>
        {/* Render in 2 passes: inactive (eligible/empty) first, then active on top */}
        {uniqueSlots.map(slot => {
          const isActive = selected.has(slot.id);
          if (isActive) return null;
          const isEligible = eligible.has(slot.id);
          if (!isEligible) return null;
          const poly = getPolygon(slot);
          const isHint = hintIds && hintIds.includes(slot.id);
          return (
            <g key={slot.id} data-slot-id={slot.id}
               className={`slot eligible tone-${tone} ${isHint ? 'hint' : ''}`}
               onClick={() => toggleSlot(slot.id)}>
              {poly.type === 'rect'
                ? <rect className="slot-fill" x={poly.x} y={poly.y} width={poly.w} height={poly.h} rx="4" />
                : <polygon className="slot-fill" points={poly.points} />
              }
            </g>
          );
        })}
        {uniqueSlots.map(slot => {
          const isActive = selected.has(slot.id);
          if (!isActive) return null;
          const poly = getPolygon(slot);
          const center = getCenter(slot);
          const isBase = slot.id === shape.basePos;
          const idx = selectedList.indexOf(slot.id);
          // ===== WARNA DIATUR DI SINI =====
          const color = getSlotColor ? getSlotColor(slot.id, idx) : '#818CF8';
          return (
            <g key={slot.id} data-slot-id={slot.id}
               className={`slot active tone-${tone} ${isBase ? 'base locked' : ''}`}
               onClick={() => toggleSlot(slot.id)}>
              {poly.type === 'rect'
                ? <rect className="slot-fill" x={poly.x} y={poly.y} width={poly.w} height={poly.h} rx="4" fill={color} stroke={color} />
                : <polygon className="slot-fill" points={poly.points} fill={color} stroke={color} />
              }
              <text className="slot-label" x={center.x} y={center.y}>
                {labelFor(slot, idx)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

window.NetEditor = NetEditor;
