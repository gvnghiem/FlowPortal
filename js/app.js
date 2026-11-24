/* FlowPortal – canvas editor, palette, inspector, panels, import/export. */
(function () {
  const FP = window.FP, ESC = FP.ESC;
  const $ = (s, r) => (r || document).querySelector(s);
  const svg = $('#svg'), cv = $('#cv');
  const NS = 'http://www.w3.org/2000/svg';

  const S = (FP.app = {
    model: { items: [], edges: [] },
    sel: new Set(),
    view: { x: 40, y: 40, k: 1 },
    mode: 'arch', snap: true, anim: false, tab: 'Inspect', flags: new Map(),
    name: 'Untitled diagram',
  });

  /* ---------------- helpers ---------------- */
  const byId = (id) => S.model.items.find((i) => i.id === id);
  const edgeById = (id) => S.model.edges.find((e) => e.id === id);
  const fam = (type) => { const t = FP.TYPES[type]; return t.icon ? 'arch' : t.group === 'Flow' ? 'flow' : 'uml'; };
  const snap = (v) => (S.snap ? Math.round(v / 10) * 10 : Math.round(v));
  function wrap(s, max) {
    const out = []; let cur = '';
    String(s == null ? '' : s).split(/\s+/).filter(Boolean).forEach((w) => {
      while (w.length > max) { if (cur) { out.push(cur); cur = ''; } out.push(w.slice(0, max)); w = w.slice(max); }
      if (cur && (cur + ' ' + w).length > max) { out.push(cur); cur = w; } else cur = cur ? cur + ' ' + w : w;
    });
    if (cur) out.push(cur);
    return out.length ? out : [''];
  }
  function tspans(lines, x, lh, first) { return lines.map((l, i) => `<tspan x="${x}" dy="${i === 0 ? first : lh}">${ESC(l)}</tspan>`).join(''); }
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('show'), 2600); }

  /* ---------------- history & persistence ---------------- */
  const hist = { undo: [], redo: [] };
  const dump = () => JSON.stringify(S.model);
  function snapshot() { const d = dump(); if (hist.undo[hist.undo.length - 1] !== d) { hist.undo.push(d); if (hist.undo.length > 80) hist.undo.shift(); } hist.redo.length = 0; syncHist(); }
  function restore(json) { S.model = JSON.parse(json); S.sel.clear(); renderAll(); persist(); }
  function undo() { if (!hist.undo.length) return; hist.redo.push(dump()); restore(hist.undo.pop()); syncHist(); }
  function redo() { if (!hist.redo.length) return; hist.undo.push(dump()); restore(hist.redo.pop()); syncHist(); }
  function syncHist() { $('#undo').disabled = !hist.undo.length; $('#redo').disabled = !hist.redo.length; }
  let pT;
  function persist() { clearTimeout(pT); pT = setTimeout(() => { try { localStorage.setItem('flowportal.v1', JSON.stringify({ name: S.name, model: S.model, view: S.view, mode: S.mode })); } catch (e) { /* storage unavailable */ } }, 250); }

  /* ---------------- geometry ---------------- */
  function fit(n) {
    const t = FP.TYPES[n.type]; if (!t) return;
    if (t.shape === 'class') {
      const a = (n.attrs || '').split('\n').filter(Boolean), m = (n.methods || '').split('\n').filter(Boolean);
      const st = t.stereotype || n.stereotype;
      const longest = Math.max((n.label || '').length * 7.4, ...a.map((l) => l.length * 6.6), ...m.map((l) => l.length * 6.6), 0);
      n.w = Math.max(t.w, Math.round(longest + 26));
      n.h = (st ? 44 : 30) + (a.length ? a.length * 16 + 10 : 10) + (m.length ? m.length * 16 + 10 : 10);
    } else if (t.icon) {
      const lines = wrap(n.label, Math.max(8, Math.floor((n.w - 16) / 6.4))).length;
      n.h = Math.max(t.h, 50 + lines * 13 + 8);
    } else if (['rect', 'pill', 'sub', 'para', 'doc', 'round', 'ellipse', 'component', 'box3d', 'diamond', 'note'].includes(t.shape)) {
      const k = t.shape === 'diamond' ? 0.55 : t.shape === 'ellipse' ? 0.75 : 0.88;
      const lines = wrap(n.label, Math.max(6, Math.floor((n.w * k) / 6.9))).length;
      n.h = Math.max(n.h, Math.min(400, lines * 16 + (t.shape === 'diamond' ? 44 : 26)));
    }
  }
  function boundary(n, tx, ty) {
    const cx = n.x + n.w / 2, cy = n.y + n.h / 2, dx = tx - cx, dy = ty - cy;
    if (!dx && !dy) return [cx, cy];
    const sh = FP.TYPES[n.type].shape; let s;
    if (sh === 'diamond') s = 1 / (Math.abs(dx) / (n.w / 2) + Math.abs(dy) / (n.h / 2));
    else if (sh === 'ellipse' || sh === 'initial' || sh === 'final') { const a = n.w / 2, b = n.h / 2; s = 1 / Math.sqrt((dx * dx) / (a * a) + (dy * dy) / (b * b)); }
    else s = Math.min(dx ? n.w / 2 / Math.abs(dx) : Infinity, dy ? n.h / 2 / Math.abs(dy) : Infinity);
    return [cx + dx * s, cy + dy * s];
  }
  function edgeGeom(e, ctx) {
    const a = byId(e.from), b = byId(e.to); if (!a || !b || a === b) return null;
    const ac = [a.x + a.w / 2, a.y + a.h / 2], bc = [b.x + b.w / 2, b.y + b.h / 2];
    let pts, lx, ly;
    if (a.type === 'lifeline' && b.type === 'lifeline') {
      const y = Math.min(a.y, b.y) + 76 + (ctx.seq[e.id] || 0) * 40;
      pts = [[ac[0], y], [bc[0], y]]; lx = (ac[0] + bc[0]) / 2; ly = y - 6;
    } else {
      const key = [e.from, e.to].sort().join('|'); const grp = ctx.pairs[key]; const off = (grp.indexOf(e.id) - (grp.length - 1) / 2) * 16;
      if (e.route === 'straight') {
        const p1 = boundary(a, bc[0], bc[1]), p2 = boundary(b, ac[0], ac[1]);
        const L = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) || 1, nx = (-(p2[1] - p1[1]) / L) * off, ny = ((p2[0] - p1[0]) / L) * off;
        pts = [[p1[0] + nx, p1[1] + ny], [p2[0] + nx, p2[1] + ny]]; lx = (pts[0][0] + pts[1][0]) / 2; ly = (pts[0][1] + pts[1][1]) / 2 - 7;
      } else {
        const dx = bc[0] - ac[0], dy = bc[1] - ac[1];
        if (Math.abs(dx) >= Math.abs(dy)) {
          const sx = dx >= 0 ? a.x + a.w : a.x, ex = dx >= 0 ? b.x : b.x + b.w, sy = ac[1] + off, ey = bc[1] + off, mx = (sx + ex) / 2;
          pts = Math.abs(sy - ey) < 1 ? [[sx, sy], [ex, ey]] : [[sx, sy], [mx, sy], [mx, ey], [ex, ey]]; lx = mx; ly = Math.abs(sy - ey) < 1 ? sy - 7 : (sy + ey) / 2;
        } else {
          const sy = dy >= 0 ? a.y + a.h : a.y, ey = dy >= 0 ? b.y : b.y + b.h, sx = ac[0] + off, ex = bc[0] + off, my = (sy + ey) / 2;
          pts = Math.abs(sx - ex) < 1 ? [[sx, sy], [ex, ey]] : [[sx, sy], [sx, my], [ex, my], [ex, ey]]; lx = Math.abs(sx - ex) < 1 ? sx + 4 : (sx + ex) / 2; ly = my - 5;
          if (Math.abs(sx - ex) < 1) ly = (sy + ey) / 2;
        }
      }
    }
    return { pts, lx, ly, d: 'M' + pts.map((p) => p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' L') };
  }
  function edgeCtx() {
    const seq = {}; let c = 0; const pairs = {};
    S.model.edges.forEach((e) => {
      const a = byId(e.from), b = byId(e.to); if (!a || !b) return;
      if (a.type === 'lifeline' && b.type === 'lifeline') seq[e.id] = c++;
      const k = [e.from, e.to].sort().join('|'); (pairs[k] = pairs[k] || []).push(e.id);
    });
    return { seq, pairs };
  }

  /* ---------------- rendering: nodes ---------------- */
  function nodeBody(n, o) {
    const t = FP.TYPES[n.type], { x, y, w, h } = n, cx = x + w / 2, cy = y + h / 2;
    const ink = '#0f172a';
    const lab = (lines, tx, ty, size, extra) => (o.preview ? '' : `<text x="${tx}" y="${ty}" text-anchor="${(extra && extra.anchor) || 'middle'}" font-size="${size}" fill="${(extra && extra.fill) || ink}" ${(extra && extra.bold) ? 'font-weight="600"' : ''}>${tspans(lines, tx, size + 3, 0)}</text>`);
    const center = (k) => { const L = wrap(n.label, Math.max(5, Math.floor((w * k) / 6.9))); return lab(L, cx, cy - ((L.length - 1) * 16) / 2 + 4.5, 13); };
    const f = t.fill, s = t.stroke;
    if (t.icon) {
      const dep = FP.deployOf(S.model, n), col = FP.DEPLOY[dep].color;
      const L = wrap(n.label, Math.max(8, Math.floor((w - 16) / 6.4)));
      const badge = (n.replicas || 1) > 1 && !o.preview ? `<g><rect x="${x + w - 34}" y="${y - 9}" width="30" height="17" rx="8.5" fill="${ink}"/><text x="${x + w - 19}" y="${y + 3}" text-anchor="middle" font-size="10.5" font-weight="700" fill="#fff">×${n.replicas}</text></g>` : '';
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="#fff" stroke="${col}" stroke-width="1.6"/>
        <rect x="${x}" y="${y + 6}" width="5" height="${h - 12}" rx="2.5" fill="${col}"/>
        <g transform="translate(${cx - 13},${y + 9}) scale(1.08)" fill="none" stroke="${col === FP.DEPLOY.none.color ? '#475569' : '#334155'}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${FP.ICONS[t.icon]}</g>
        ${lab(L, cx, y + 50, 11.5, { fill: '#1e293b' })}${badge}`;
    }
    switch (t.shape) {
      case 'rect': return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="${f}" stroke="${s}" stroke-width="1.6"/>${center(0.88)}`;
      case 'round': return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="18" fill="${f}" stroke="${s}" stroke-width="1.6"/>${center(0.8)}`;
      case 'pill': return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="${f}" stroke="${s}" stroke-width="1.6"/>${center(0.8)}`;
      case 'diamond': return `<polygon points="${cx},${y} ${x + w},${cy} ${cx},${y + h} ${x},${cy}" fill="${f}" stroke="${s}" stroke-width="1.6"/>${center(0.55)}`;
      case 'ellipse': return `<ellipse cx="${cx}" cy="${cy}" rx="${w / 2}" ry="${h / 2}" fill="${f}" stroke="${s}" stroke-width="1.6"/>${center(0.75)}`;
      case 'para': return `<polygon points="${x + 16},${y} ${x + w},${y} ${x + w - 16},${y + h} ${x},${y + h}" fill="${f}" stroke="${s}" stroke-width="1.6"/>${center(0.75)}`;
      case 'sub': return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="${f}" stroke="${s}" stroke-width="1.6"/><path d="M${x + 10} ${y}V${y + h}M${x + w - 10} ${y}V${y + h}" stroke="${s}" stroke-width="1.3"/>${center(0.75)}`;
      case 'doc': return `<path d="M${x} ${y}H${x + w}V${y + h - 8}Q${x + w * 0.75} ${y + h + 6} ${cx} ${y + h - 8}T${x} ${y + h - 8}Z" fill="${f}" stroke="${s}" stroke-width="1.6"/>${center(0.85)}`;
      case 'component': return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="${f}" stroke="${s}" stroke-width="1.6"/><rect x="${x - 8}" y="${y + 12}" width="16" height="8" fill="${f}" stroke="${s}" stroke-width="1.4"/><rect x="${x - 8}" y="${y + 30}" width="16" height="8" fill="${f}" stroke="${s}" stroke-width="1.4"/>${center(0.78)}`;
      case 'box3d': return `<rect x="${x}" y="${y + 12}" width="${w - 12}" height="${h - 12}" fill="${f}" stroke="${s}" stroke-width="1.6"/><polygon points="${x},${y + 12} ${x + 12},${y} ${x + w},${y} ${x + w - 12},${y + 12}" fill="#e2e8f0" stroke="${s}" stroke-width="1.4"/><polygon points="${x + w - 12},${y + 12} ${x + w},${y} ${x + w},${y + h - 12} ${x + w - 12},${y + h}" fill="#cbd5e1" stroke="${s}" stroke-width="1.4"/>${o.preview ? '' : `<text x="${x + (w - 12) / 2}" y="${y + 12 + (h - 12) / 2 + 4}" text-anchor="middle" font-size="13" fill="${ink}">${tspans(wrap(n.label, Math.floor((w - 24) / 6.9)), x + (w - 12) / 2, 16, 0)}</text>`}`;
      case 'note': { const L = wrap(n.label, Math.max(8, Math.floor((w - 18) / 6.4))); return `<path d="M${x} ${y}H${x + w - 14}L${x + w} ${y + 14}V${y + h}H${x}Z" fill="${f}" stroke="${s}" stroke-width="1.4"/><path d="M${x + w - 14} ${y}V${y + 14}H${x + w}" fill="none" stroke="${s}" stroke-width="1.2"/>${lab(L, x + 9, y + 20, 12, { anchor: 'start' })}`; }
      case 'initial': return `<circle cx="${cx}" cy="${cy}" r="${w / 2}" fill="${f}" stroke="${s}"/>`;
      case 'final': return `<circle cx="${cx}" cy="${cy}" r="${w / 2 - 1}" fill="#fff" stroke="${s}" stroke-width="1.8"/><circle cx="${cx}" cy="${cy}" r="${w / 2 - 7}" fill="${s}"/>`;
      case 'actor': return `<g stroke="${s}" stroke-width="1.8" fill="#fff" stroke-linecap="round"><circle cx="${cx}" cy="${y + 14}" r="10"/><path d="M${cx} ${y + 24}V${y + 54}M${cx - 18} ${y + 35}H${cx + 18}M${cx} ${y + 54}L${cx - 15} ${y + 76}M${cx} ${y + 54}L${cx + 15} ${y + 76}" fill="none"/></g><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="transparent"/>${lab(wrap(n.label, 14), cx, y + 91, 12)}`;
      case 'lifeline': return `<rect x="${x}" y="${y}" width="${w}" height="36" rx="4" fill="${f}" stroke="${s}" stroke-width="1.6"/>${lab(wrap(n.label, Math.floor((w - 12) / 7)).slice(0, 2), cx, y + 22 - (wrap(n.label, Math.floor((w - 12) / 7)).length > 1 ? 7 : 0), 13, { bold: true })}<path d="M${cx} ${y + 36}V${y + h}" stroke="${s}" stroke-width="1.3" stroke-dasharray="6 5"/><rect x="${cx - 8}" y="${y + 36}" width="16" height="${h - 36}" fill="transparent"/>`;
      case 'class': {
        const a = (n.attrs || '').split('\n').filter(Boolean), m = (n.methods || '').split('\n').filter(Boolean), st = t.stereotype || n.stereotype;
        const head = st ? 44 : 30, ay = y + head, my = ay + (a.length ? a.length * 16 + 10 : 10);
        if (o.preview) return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${f}" stroke="${s}" stroke-width="2"/><path d="M${x} ${y + 22}H${x + w}M${x} ${y + 46}H${x + w}" stroke="${s}" stroke-width="2"/>`;
        return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${f}" stroke="${s}" stroke-width="1.6"/>
          ${st ? `<text x="${cx}" y="${y + 15}" text-anchor="middle" font-size="11" fill="#475569">«${ESC(st)}»</text>` : ''}
          <text x="${cx}" y="${y + (st ? 33 : 20)}" text-anchor="middle" font-size="14" font-weight="700" ${st ? 'font-style="italic"' : ''} fill="${ink}">${ESC(n.label)}</text>
          <path d="M${x} ${ay}H${x + w}M${x} ${my}H${x + w}" stroke="${s}" stroke-width="1.2"/>
          ${a.map((l, i) => `<text x="${x + 10}" y="${ay + 16 + i * 16}" font-size="12" font-family="ui-monospace,Menlo,Consolas,monospace" fill="${ink}">${ESC(l)}</text>`).join('')}
          ${m.map((l, i) => `<text x="${x + 10}" y="${my + 16 + i * 16}" font-size="12" font-family="ui-monospace,Menlo,Consolas,monospace" fill="${ink}">${ESC(l)}</text>`).join('')}`;
      }
    }
    return '';
  }
  function handles(n) {
    const hy = n.type === 'lifeline' ? n.y + 18 : n.y + n.h / 2, cx = n.x + n.w / 2;
    const pts = n.type === 'lifeline' ? [[n.x, hy], [n.x + n.w, hy]] : [[n.x + n.w, hy], [n.x, hy], [cx, n.y], [cx, n.y + n.h]];
    return pts.map((p) => `<circle class="hd" data-h="${n.id}" cx="${p[0]}" cy="${p[1]}" r="6" fill="#2563eb" stroke="#fff" stroke-width="2"/>`).join('');
  }
  function nodeSvg(n, o) {
    o = o || {};
    const sel = !o.exp && S.sel.has(n.id);
    const flag = !o.exp && S.flags.get(n.id);
    const halo = flag ? `<rect x="${n.x - 5}" y="${n.y - 5}" width="${n.w + 10}" height="${n.h + 10}" rx="12" fill="none" stroke="${flag === 'error' ? '#dc2626' : flag === 'warn' ? '#d97706' : '#3b82f6'}" stroke-width="2.5" stroke-dasharray="5 4"/>` : '';
    const outline = sel ? `<rect x="${n.x - 4}" y="${n.y - 4}" width="${n.w + 8}" height="${n.h + 8}" rx="8" fill="none" stroke="#2563eb" stroke-width="1.8" stroke-dasharray="4 3"/>` : '';
    const rz = sel && S.sel.size === 1 && FP.TYPES[n.type].shape !== 'class' ? `<rect class="rz" data-rz="${n.id}" x="${n.x + n.w - 5}" y="${n.y + n.h - 5}" width="11" height="11" rx="2" fill="#fff" stroke="#2563eb" stroke-width="1.6"/>` : '';
    return `<g class="nd${sel ? ' sel' : ''}" data-id="${n.id}">${halo}${nodeBody(n, o)}${outline}${o.exp ? '' : handles(n) + rz}</g>`;
  }
  function zoneSvg(z, o) {
    o = o || {};
    const t = FP.ZONES[z.type] || FP.ZONES.pkg, sel = !o.exp && S.sel.has(z.id);
    const flag = !o.exp && S.flags.get(z.id);
    const lw = Math.max(40, Math.min(z.w - 16, z.label.length * 7.4 + 22));
    const rz = sel && S.sel.size === 1 ? `<rect class="rz" data-rz="${z.id}" x="${z.x + z.w - 6}" y="${z.y + z.h - 6}" width="12" height="12" rx="2" fill="#fff" stroke="#2563eb" stroke-width="1.6"/>` : '';
    const dep = t.deploy !== 'none' ? FP.DEPLOY[t.deploy].color : t.stroke;
    return `<g class="zn${sel ? ' sel' : ''}" data-id="${z.id}">
      <rect x="${z.x}" y="${z.y}" width="${z.w}" height="${z.h}" rx="14" fill="${t.fill}" fill-opacity=".72" stroke="${t.stroke}" stroke-width="1.6" ${t.dash ? `stroke-dasharray="${t.dash}"` : ''} pointer-events="none"/>
      <rect x="${z.x}" y="${z.y}" width="${z.w}" height="${z.h}" rx="14" fill="none" stroke="transparent" stroke-width="12" pointer-events="stroke"/>
      <path d="M${z.x + 1} ${z.y + 18}a14 14 0 0 1 14-14h${lw - 14}v26h-${lw}z" fill="${dep}" opacity=".16" pointer-events="all"/>
      <text x="${z.x + 12}" y="${z.y + 22}" font-size="12.5" font-weight="700" fill="${t.stroke}" pointer-events="none">${ESC(z.label)}</text>
      ${sel ? `<rect x="${z.x - 4}" y="${z.y - 4}" width="${z.w + 8}" height="${z.h + 8}" rx="16" fill="none" stroke="#2563eb" stroke-width="1.8" stroke-dasharray="4 3" pointer-events="none"/>` : ''}
      ${flag ? `<rect x="${z.x - 5}" y="${z.y - 5}" width="${z.w + 10}" height="${z.h + 10}" rx="16" fill="none" stroke="#d97706" stroke-width="2.5" stroke-dasharray="5 4" pointer-events="none"/>` : ''}${o.exp ? '' : rz}</g>`;
  }

  /* ---------------- rendering: edges ---------------- */
  function defsSvg() {
    let d = '';
    Object.keys(FP.EDGES).forEach((k) => {
      const e = FP.EDGES[k], c = e.color;
      const mk = (id, type, which) => {
        if (type === 'arrow') return `<marker id="${id}" viewBox="0 0 10 10" refX="${which === 'e' ? 9.5 : 0.5}" refY="5" markerWidth="11" markerHeight="11" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="${c}"/></marker>`;
        if (type === 'open') return `<marker id="${id}" viewBox="0 0 10 10" refX="9.5" refY="5" markerWidth="11" markerHeight="11" markerUnits="userSpaceOnUse" orient="auto"><path d="M0 0L10 5L0 10" fill="none" stroke="${c}" stroke-width="1.6"/></marker>`;
        if (type === 'tri') return `<marker id="${id}" viewBox="0 0 14 14" refX="13" refY="7" markerWidth="15" markerHeight="15" markerUnits="userSpaceOnUse" orient="auto"><path d="M1 1L13 7L1 13z" fill="#fff" stroke="${c}" stroke-width="1.5"/></marker>`;
        if (type === 'diamondF' || type === 'diamondE') return `<marker id="${id}" viewBox="0 0 18 12" refX="1" refY="6" markerWidth="18" markerHeight="12" markerUnits="userSpaceOnUse" orient="auto"><path d="M1 6L9 1L17 6L9 11z" fill="${type === 'diamondF' ? c : '#fff'}" stroke="${c}" stroke-width="1.4"/></marker>`;
        return '';
      };
      if (e.end) d += mk('me-' + k, e.end, 'e');
      if (e.start) d += mk('ms-' + k, e.start, 's');
    });
    return `<defs>${d}</defs>`;
  }
  function edgeSvg(e, ctx, o) {
    o = o || {};
    const g = edgeGeom(e, ctx); if (!g) return '';
    const k = FP.EDGES[e.kind] || FP.EDGES.flow, sel = !o.exp && S.sel.has(e.id);
    const w = k.width || 1.8;
    const lab = e.label ? (() => { const tw = Math.max(18, e.label.length * 6.6 + 10); return `<rect x="${g.lx - tw / 2}" y="${g.ly - 12}" width="${tw}" height="17" rx="4" fill="#f8fafc" fill-opacity=".92"/><text x="${g.lx}" y="${g.ly + 1}" text-anchor="middle" font-size="11.5" fill="#1e293b">${ESC(e.label)}</text>`; })() : '';
    const dots = S.anim && !o.exp && ['flow', 'async', 'secure', 'repl', 'msg'].includes(e.kind) ? `<path class="flowdots" d="${g.d}" fill="none" stroke="${k.color}" stroke-width="5" stroke-linecap="round" stroke-dasharray="0.1 15.9" opacity=".75" pointer-events="none"/>` : '';
    return `<g class="ed" data-eid="${e.id}">
      <path d="${g.d}" fill="none" stroke="transparent" stroke-width="14" pointer-events="stroke"/>
      ${sel ? `<path d="${g.d}" fill="none" stroke="#93c5fd" stroke-width="8" opacity=".6"/>` : ''}
      <path d="${g.d}" fill="none" stroke="${k.color}" stroke-width="${w}" ${k.dash ? `stroke-dasharray="${k.dash}"` : ''} stroke-linejoin="round" ${k.start ? `marker-start="url(#ms-${e.kind})"` : ''} ${k.end ? `marker-end="url(#me-${e.kind})"` : ''}/>
      ${dots}${lab}</g>`;
  }

  /* ---------------- render ---------------- */
  function sceneInner(o) {
    S.model.items.forEach(fit);
    const ctx = edgeCtx();
    const zs = S.model.items.filter((i) => i.cat === 'zone').sort((a, b) => b.w * b.h - a.w * a.h);
    const ns = S.model.items.filter((i) => i.cat === 'node');
    return zs.map((z) => zoneSvg(z, o)).join('') + S.model.edges.map((e) => edgeSvg(e, ctx, o)).join('') + ns.map((n) => nodeSvg(n, o)).join('');
  }
  let rq = 0;
  function render() { if (rq) return; rq = requestAnimationFrame(() => { rq = 0; drawNow(); }); }
  function drawNow() {
    const v = S.view;
    svg.innerHTML = defsSvg() + `<g id="vp" transform="translate(${v.x},${v.y}) scale(${v.k})">${sceneInner({})}<g id="ov"></g></g>`;
    applyView();
  }
  function applyView() {
    const v = S.view, vp = $('#vp'); if (vp) vp.setAttribute('transform', `translate(${v.x},${v.y}) scale(${v.k})`);
    cv.style.backgroundSize = `${20 * v.k}px ${20 * v.k}px`; cv.style.backgroundPosition = `${v.x}px ${v.y}px`;
    $('#zpct').textContent = Math.round(v.k * 100) + '%';
  }
  function renderAll() { drawNow(); renderStats(); renderInspector(); if (S.tab === 'Review') renderReview(); else updateReviewBadge(); persist(); }
  function changed() { render(); renderStats(); persist(); if (S.tab === 'Review') renderReview(); else updateReviewBadge(); }

  function renderStats() {
    const t = FP.topology(S.model), c = t.counts;
    const dots = ['onprem', 'dmz', 'cloud', 'edge', 'saas', 'none'].filter((k) => c[k]).map((k) => `<span><i style="background:${FP.DEPLOY[k].color}"></i>${FP.DEPLOY[k].name} ${c[k]}</span>`).join('');
    $('#stats').innerHTML = `<span class="chip" title="Where the architecture components are placed">${ESC(t.label)}</span>${dots || '<span class="muted">0 components</span>'}`;
  }

  /* ---------------- view ---------------- */
  const toWorld = (cx, cy) => { const r = svg.getBoundingClientRect(); return [(cx - r.left - S.view.x) / S.view.k, (cy - r.top - S.view.y) / S.view.k]; };
  function bbox(list) {
    if (!list.length) return null; let x1 = 1e9, y1 = 1e9, x2 = -1e9, y2 = -1e9;
    list.forEach((i) => { x1 = Math.min(x1, i.x); y1 = Math.min(y1, i.y); x2 = Math.max(x2, i.x + i.w); y2 = Math.max(y2, i.y + i.h); });
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  }
  function fitView() {
    S.model.items.forEach(fit); const b = bbox(S.model.items), r = svg.getBoundingClientRect();
    if (!b) { S.view = { x: 40, y: 40, k: 1 }; applyView(); return; }
    const k = Math.min(1.2, Math.max(0.15, Math.min((r.width - 80) / b.w, (r.height - 100) / b.h)));
    S.view = { k, x: (r.width - b.w * k) / 2 - b.x * k, y: (r.height - b.h * k) / 2 - b.y * k + 10 }; applyView(); persist();
  }
  function zoomAt(f, sx, sy) {
    const r = svg.getBoundingClientRect(); sx = sx == null ? r.left + r.width / 2 : sx; sy = sy == null ? r.top + r.height / 2 : sy;
    const [wx, wy] = toWorld(sx, sy); const k = Math.max(0.1, Math.min(3, S.view.k * f));
    S.view.k = k; S.view.x = sx - r.left - wx * k; S.view.y = sy - r.top - wy * k; applyView(); persist();
  }
  function focusIds(ids) {
    const list = ids.map(byId).filter(Boolean); S.sel = new Set(ids); if (list.length) {
      const b = bbox(list), r = svg.getBoundingClientRect();
      S.view.x = r.width / 2 - (b.x + b.w / 2) * S.view.k; S.view.y = r.height / 2 - (b.y + b.h / 2) * S.view.k;
    }
    drawNow(); renderInspector();
  }

  /* ---------------- model mutations ---------------- */
  function addNode(type, x, y, label) {
    const t = FP.TYPES[type]; snapshot();
    const n = { id: FP.uid(), cat: 'node', type, x: snap(x), y: snap(y), w: t.w, h: t.h, label: label == null ? t.name : label, deploy: 'auto', replicas: 1, notes: '', attrs: '', methods: '' };
    if (type === 'class') { n.label = 'ClassName'; n.attrs = '-id: int'; n.methods = '+operation(): void'; }
    if (type === 'iface') { n.label = 'IService'; n.methods = '+operation(): void'; }
    S.model.items.push(n); S.sel = new Set([n.id]); renderAll(); return n;
  }
  function addZone(type, x, y) {
    snapshot(); const z = { id: FP.uid(), cat: 'zone', type, x: snap(x), y: snap(y), w: 380, h: 240, label: FP.ZONES[type].name };
    S.model.items.push(z); S.sel = new Set([z.id]); renderAll(); return z;
  }
  function removeSel() {
    if (!S.sel.size) return; snapshot();
    S.model.items = S.model.items.filter((i) => !S.sel.has(i.id));
    S.model.edges = S.model.edges.filter((e) => !S.sel.has(e.id) && byId(e.from) && byId(e.to));
    S.sel.clear(); renderAll();
  }
  function duplicateSel() {
    const items = S.model.items.filter((i) => S.sel.has(i.id)); if (!items.length) return; snapshot();
    const map = {}; const fresh = [];
    items.forEach((i) => { const c = Object.assign({}, i, { id: FP.uid(), x: i.x + 30, y: i.y + 30 }); map[i.id] = c.id; fresh.push(c); });
    S.model.edges.filter((e) => map[e.from] && map[e.to]).forEach((e) => S.model.edges.push(Object.assign({}, e, { id: FP.uid(), from: map[e.from], to: map[e.to] })));
    S.model.items.push(...fresh); S.sel = new Set(fresh.map((c) => c.id)); renderAll();
  }
  function defaultEdge(a, b) {
    if (a.type === 'lifeline' && b.type === 'lifeline') return { kind: 'msg', route: 'straight' };
    if (fam(a.type) === 'uml' || fam(b.type) === 'uml' || S.mode === 'uml') return { kind: 'assoc', route: 'straight' };
    return { kind: 'flow', route: 'elbow' };
  }
  function connect(fromId, toId) {
    const a = byId(fromId), b = byId(toId); if (!a || !b || a === b || a.cat !== 'node' || b.cat !== 'node') return;
    snapshot(); const d = defaultEdge(a, b);
    const e = { id: FP.uid(), from: fromId, to: toId, label: '', kind: d.kind, route: d.route };
    S.model.edges.push(e); S.sel = new Set([e.id]); renderAll();
  }

  /* ---------------- pointer interaction ---------------- */
  let drag = null, space = false;
  function hit(ev) {
    const t = ev.target;
    if (t.closest) {
      const h = t.closest('[data-h]'); if (h) return { k: 'handle', id: h.dataset.h };
      const r = t.closest('[data-rz]'); if (r) return { k: 'resize', id: r.dataset.rz };
      const e = t.closest('[data-eid]'); if (e) return { k: 'edge', id: e.dataset.eid };
      const n = t.closest('[data-id]'); if (n) return { k: 'item', id: n.dataset.id };
    }
    return { k: 'bg' };
  }
  svg.addEventListener('pointerdown', (ev) => {
    svg.focus({ preventScroll: true });
    const h = hit(ev), [wx, wy] = toWorld(ev.clientX, ev.clientY);
    if (ev.button === 1 || (ev.button === 0 && (space || h.k === 'bg'))) {
      drag = { t: 'pan', sx: ev.clientX, sy: ev.clientY, vx: S.view.x, vy: S.view.y, moved: false, clear: h.k === 'bg' && !space && !ev.shiftKey };
      svg.setPointerCapture(ev.pointerId); svg.classList.add('pan'); return;
    }
    if (ev.button !== 0) return;
    if (h.k === 'handle') { drag = { t: 'connect', from: h.id, x: wx, y: wy }; svg.setPointerCapture(ev.pointerId); return; }
    if (h.k === 'resize') { const it = byId(h.id); drag = { t: 'resize', id: h.id, ox: it.w, oy: it.h, sx: wx, sy: wy, snap: false }; svg.setPointerCapture(ev.pointerId); return; }
    if (h.k === 'edge') { if (ev.shiftKey) S.sel.has(h.id) ? S.sel.delete(h.id) : S.sel.add(h.id); else S.sel = new Set([h.id]); drawNow(); renderInspector(); return; }
    if (h.k === 'item') {
      if (ev.shiftKey) { S.sel.has(h.id) ? S.sel.delete(h.id) : S.sel.add(h.id); }
      else if (!S.sel.has(h.id)) S.sel = new Set([h.id]);
      const moving = new Set([...S.sel].filter((id) => byId(id)));
      const it = byId(h.id);
      if (it && it.cat === 'zone' && !ev.altKey) {
        S.model.items.forEach((m) => {
          if (m.id === it.id) return; const cx = m.x + m.w / 2, cy = m.y + m.h / 2;
          if (cx >= it.x && cx <= it.x + it.w && cy >= it.y && cy <= it.y + it.h) moving.add(m.id);
        });
      }
      drag = { t: 'move', sx: wx, sy: wy, orig: [...moving].map((id) => { const m = byId(id); return [id, m.x, m.y]; }), moved: false };
      svg.setPointerCapture(ev.pointerId); drawNow(); renderInspector();
    }
  });
  svg.addEventListener('pointermove', (ev) => {
    if (!drag) return;
    const [wx, wy] = toWorld(ev.clientX, ev.clientY);
    if (drag.t === 'pan') {
      const dx = ev.clientX - drag.sx, dy = ev.clientY - drag.sy; if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
      S.view.x = drag.vx + dx; S.view.y = drag.vy + dy; applyView();
    } else if (drag.t === 'move') {
      if (!drag.moved) { if (Math.hypot(wx - drag.sx, wy - drag.sy) < 3 / S.view.k) return; drag.moved = true; snapshot(); }
      const dx = wx - drag.sx, dy = wy - drag.sy; const [id0, x0, y0] = drag.orig[0];
      const sdx = snap(x0 + dx) - x0, sdy = snap(y0 + dy) - y0;
      drag.orig.forEach(([id, x, y]) => { const m = byId(id); if (m) { m.x = x + sdx; m.y = y + sdy; } });
      render(); renderStats();
    } else if (drag.t === 'resize') {
      if (!drag.snap) { drag.snap = true; snapshot(); }
      const it = byId(drag.id), t = it.cat === 'zone' ? { min: 120 } : { min: 40 };
      it.w = Math.max(t.min, snap(drag.ox + wx - drag.sx)); it.h = Math.max(t.min, snap(drag.oy + wy - drag.sy)); render(); renderStats();
    } else if (drag.t === 'connect') {
      drag.x = wx; drag.y = wy; drawNow();
      const a = byId(drag.from), ov = $('#ov'); const ac = [a.x + a.w / 2, a.y + a.h / 2];
      const p = boundary(a, wx, wy);
      const under = document.elementsFromPoint(ev.clientX, ev.clientY).map((el) => el.closest && el.closest('.nd')).find((el) => el && el.dataset.id !== drag.from);
      ov.innerHTML = `<path d="M${p[0]} ${p[1]}L${wx} ${wy}" stroke="#2563eb" stroke-width="2" stroke-dasharray="5 4" fill="none"/>` + (under ? (() => { const b = byId(under.dataset.id); return `<rect x="${b.x - 6}" y="${b.y - 6}" width="${b.w + 12}" height="${b.h + 12}" rx="12" fill="rgba(37,99,235,.08)" stroke="#2563eb" stroke-width="2"/>`; })() : '');
    }
  });
  function endDrag(ev) {
    if (!drag) return; const d = drag; drag = null; svg.classList.remove('pan');
    try { svg.releasePointerCapture(ev.pointerId); } catch (e) { /* not captured */ }
    if (d.t === 'pan') { if (d.clear && !d.moved && S.sel.size) { S.sel.clear(); drawNow(); renderInspector(); } persist(); }
    else if (d.t === 'move') { if (d.moved) { renderAll(); } }
    else if (d.t === 'resize') { renderAll(); }
    else if (d.t === 'connect') {
      const under = document.elementsFromPoint(ev.clientX, ev.clientY).map((el) => el.closest && el.closest('.nd')).find((el) => el && el.dataset.id !== d.from);
      if (under) connect(d.from, under.dataset.id); else drawNow();
    }
  }
  svg.addEventListener('pointerup', endDrag);
  svg.addEventListener('pointercancel', endDrag);
  svg.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    if (ev.shiftKey) { S.view.x -= ev.deltaY; applyView(); return; }
    zoomAt(Math.exp(-ev.deltaY * (ev.ctrlKey ? 0.01 : 0.0016)), ev.clientX, ev.clientY);
  }, { passive: false });
  svg.addEventListener('dblclick', (ev) => {
    const h = hit(ev); if (h.k === 'item' || h.k === 'edge') { setTab('Inspect'); const i = $('#pInspect [data-f="label"]'); if (i) { i.focus(); i.select(); } }
  });
  svg.addEventListener('dragover', (ev) => ev.preventDefault());
  svg.addEventListener('drop', (ev) => {
    ev.preventDefault(); const d = ev.dataTransfer.getData('text/plain'); if (!d) return; const [kind, type] = d.split(':'); const [wx, wy] = toWorld(ev.clientX, ev.clientY);
    if (kind === 'node') { const t = FP.TYPES[type]; addNode(type, wx - t.w / 2, wy - t.h / 2); } else if (kind === 'zone') addZone(type, wx - 190, wy - 20);
  });

  document.addEventListener('keydown', (ev) => {
    const tag = (ev.target.tagName || '').toLowerCase(); const typing = tag === 'input' || tag === 'textarea' || tag === 'select';
    if (ev.code === 'Space' && !typing) { space = true; ev.preventDefault(); }
    if (typing) return;
    const mod = ev.ctrlKey || ev.metaKey;
    if (mod && ev.key.toLowerCase() === 'z') { ev.preventDefault(); ev.shiftKey ? redo() : undo(); }
    else if (mod && ev.key.toLowerCase() === 'y') { ev.preventDefault(); redo(); }
    else if (mod && ev.key.toLowerCase() === 'd') { ev.preventDefault(); duplicateSel(); }
    else if (mod && ev.key.toLowerCase() === 'a') { ev.preventDefault(); S.sel = new Set(S.model.items.map((i) => i.id)); drawNow(); renderInspector(); }
    else if (ev.key === 'Delete' || ev.key === 'Backspace') { ev.preventDefault(); removeSel(); }
    else if (ev.key === 'Escape') { S.sel.clear(); drawNow(); renderInspector(); }
    else if (ev.key.toLowerCase() === 'f' && !mod) fitView();
    else if (ev.key.startsWith('Arrow') && S.sel.size) {
      ev.preventDefault(); const st = ev.shiftKey ? 1 : 10; snapshot();
      const dx = ev.key === 'ArrowLeft' ? -st : ev.key === 'ArrowRight' ? st : 0, dy = ev.key === 'ArrowUp' ? -st : ev.key === 'ArrowDown' ? st : 0;
      S.model.items.forEach((i) => { if (S.sel.has(i.id)) { i.x += dx; i.y += dy; } }); drawNow(); persist();
    }
  });
  document.addEventListener('keyup', (ev) => { if (ev.code === 'Space') space = false; });

  /* ---------------- palette ---------------- */
  const ZONE_BY_MODE = { arch: ['onprem', 'dmz', 'edge', 'region', 'vpc', 'az', 'rack', 'k8s', 'saas'], flow: ['lane'], uml: ['pkg'] };
  function previewSvg(type) {
    const t = FP.TYPES[type]; const n = { id: 'p', type, x: 0, y: 0, w: t.w, h: t.h, label: '', deploy: 'none', replicas: 1, attrs: '', methods: '' };
    if (t.shape === 'lifeline') { n.h = 120; }
    if (t.shape === 'class') { n.w = 120; n.h = 70; }
    const W = n.w + 4, H = n.h + 4, sc = Math.min(54 / W, 34 / H, 1);
    if (t.icon) return `<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#334155" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${FP.ICONS[t.icon]}</svg>`;
    return `<svg width="${Math.round(W * sc)}" height="${Math.round(H * sc)}" viewBox="-2 -2 ${W} ${H}">${nodeBody(n, { preview: true })}</svg>`;
  }
  function zonePreview(type) {
    const t = FP.ZONES[type]; return `<svg width="46" height="30" viewBox="0 0 46 30"><rect x="2" y="2" width="42" height="26" rx="6" fill="${t.fill}" stroke="${t.stroke}" stroke-width="1.6" ${t.dash ? `stroke-dasharray="${t.dash.split(' ').map((v) => v * 0.6).join(' ')}"` : ''}/></svg>`;
  }
  function renderPalette() {
    const q = $('#q').value.trim().toLowerCase(), groups = {};
    Object.keys(FP.TYPES).forEach((k) => {
      const t = FP.TYPES[k]; if (!t.modes.includes(S.mode)) return; if (q && !(t.name + ' ' + t.group).toLowerCase().includes(q)) return;
      (groups[t.group] = groups[t.group] || []).push(['node', k, t.name, previewSvg(k)]);
    });
    const zl = (ZONE_BY_MODE[S.mode] || []).filter((k) => !q || FP.ZONES[k].name.toLowerCase().includes(q) || 'zone boundary'.includes(q));
    if (zl.length) groups[S.mode === 'arch' ? 'Zones & boundaries' : S.mode === 'flow' ? 'Swimlanes' : 'Boundaries'] = zl.map((k) => ['zone', k, FP.ZONES[k].name, zonePreview(k)]);
    $('#palList').innerHTML = Object.keys(groups).map((g) => `<div class="pg">${ESC(g)}</div><div class="pgrid">${groups[g].map((p) => `<div class="pi" draggable="true" data-add="${p[0]}:${p[1]}" title="Click to add, or drag onto the canvas">${p[3]}<span>${ESC(p[2])}</span></div>`).join('')}</div>`).join('') || '<p class="muted" style="padding:6px">No matches.</p>';
  }
  let addN = 0;
  $('#palList').addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-add]'); if (!el) return; const [kind, type] = el.dataset.add.split(':');
    const r = svg.getBoundingClientRect(), [wx, wy] = toWorld(r.left + r.width / 2, r.top + r.height / 2), off = (addN++ % 6) * 24;
    if (kind === 'node') { const t = FP.TYPES[type]; addNode(type, wx - t.w / 2 + off, wy - t.h / 2 + off); } else addZone(type, wx - 190 + off, wy - 120 + off);
  });
  $('#palList').addEventListener('dragstart', (ev) => { const el = ev.target.closest('[data-add]'); if (el) ev.dataTransfer.setData('text/plain', el.dataset.add); });
  $('#q').addEventListener('input', renderPalette);
  $('#modes').addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (b) setMode(b.dataset.mode); });
  function setMode(m) { S.mode = m; document.querySelectorAll('#modes button').forEach((b) => b.classList.toggle('on', b.dataset.mode === m)); renderPalette(); persist(); }

  /* ---------------- inspector ---------------- */
  const opt = (v, cur, label) => `<option value="${v}"${v === cur ? ' selected' : ''}>${ESC(label)}</option>`;
  function renderInspector() {
    const el = $('#pInspect'); const ids = [...S.sel];
    if (ids.length > 1) { el.innerHTML = `<h3>${ids.length} items selected</h3><p class="muted">Drag to move together. Zones carry what's inside them.</p><div class="btns"><button class="btn" data-act="dup">Duplicate</button><button class="btn dng" data-act="del">Delete</button></div>`; return; }
    if (!ids.length) {
      el.innerHTML = `<h3>Nothing selected</h3><p class="muted">Click a component to edit it. Click a connector to change its style.</p>
        <h4>Quick start</h4><ol class="chk"><li>Pick a <b>template</b> at the top, or drag components from the left.</li><li>Draw <b>zones</b> (on-prem, cloud region, AZ…) and drop components inside; the badge colour follows the zone.</li><li>Open <b>Review</b> for single points of failure and boundary risks.</li><li>Open <b>Scale</b> to size an architecture from your traffic and availability target.</li></ol>
        <h4>Shortcuts</h4><p class="muted" style="font-size:12.5px">Del remove · Ctrl+D duplicate · Ctrl+Z undo · arrows nudge (Shift = 1px) · F fit · Space+drag pan · Alt+drag a zone to move it without its contents</p>`;
      return;
    }
    const id = ids[0], it = byId(id), ed = it ? null : edgeById(id);
    if (ed) {
      el.innerHTML = `<h3>Connector</h3>
        <label class="fld"><span>Label</span><input data-f="label" value="${ESC(ed.label)}" placeholder="e.g. HTTPS, SQL, events"></label>
        <label class="fld"><span>Type</span><select data-f="kind">${Object.keys(FP.EDGES).map((k) => opt(k, ed.kind, FP.EDGES[k].name)).join('')}</select></label>
        <label class="fld"><span>Routing</span><select data-f="route">${opt('elbow', ed.route, 'Right angles')}${opt('straight', ed.route, 'Straight line')}</select></label>
        <div class="btns"><button class="btn" data-act="rev">Reverse direction</button><button class="btn dng" data-act="del">Delete</button></div>
        <div class="about">${ed.kind === 'secure' ? 'Private encrypted or dedicated link between sites. This is what keeps on-prem to cloud traffic off the public internet.' : ed.kind === 'repl' ? 'Data copied between nodes. Synchronous replication protects against loss but adds latency; asynchronous is faster but can lose recent writes on failover.' : ed.kind === 'async' ? 'Fire-and-forget or event-driven. The sender does not wait, which decouples failures and smooths load.' : 'Arrow direction shows who initiates the call.'}</div>`;
      return;
    }
    if (!it) { el.innerHTML = ''; return; }
    if (it.cat === 'zone') {
      const z = FP.ZONES[it.type];
      el.innerHTML = `<h3>Zone</h3>
        <label class="fld"><span>Name</span><input data-f="label" value="${ESC(it.label)}"></label>
        <label class="fld"><span>Kind</span><select data-f="type">${Object.keys(FP.ZONES).map((k) => opt(k, it.type, FP.ZONES[k].name)).join('')}</select></label>
        ${z.deploy !== 'none' ? `<p>Components inside count as <span class="dep"><i style="background:${FP.DEPLOY[z.deploy].color}"></i>${FP.DEPLOY[z.deploy].name}</span></p>` : ''}
        <div class="about">${ESC(z.about)}</div>
        <div class="btns"><button class="btn" data-act="dup">Duplicate</button><button class="btn dng" data-act="del">Delete</button></div>`;
      return;
    }
    const t = FP.TYPES[it.type], f = fam(it.type), dep = FP.deployOf(S.model, it);
    const types = Object.keys(FP.TYPES).filter((k) => fam(k) === f);
    el.innerHTML = `<h3>${ESC(t.name)}</h3>
      <label class="fld"><span>${t.shape === 'class' ? 'Class name' : 'Label'}</span><input data-f="label" value="${ESC(it.label)}"></label>
      <label class="fld"><span>Type</span><select data-f="type">${types.map((k) => opt(k, it.type, FP.TYPES[k].name)).join('')}</select></label>
      ${t.icon ? `<div class="row2">
        <label class="fld"><span>Instances</span><input type="number" min="1" max="999" data-f="replicas" value="${it.replicas || 1}"></label>
        <label class="fld"><span>Placement</span><select data-f="deploy">${opt('auto', it.deploy || 'auto', 'Auto (from zone)')}${Object.keys(FP.DEPLOY).filter((k) => k !== 'none').map((k) => opt(k, it.deploy, FP.DEPLOY[k].name)).join('')}</select></label></div>
        <p>Currently <span class="dep"><i style="background:${FP.DEPLOY[dep].color}"></i>${FP.DEPLOY[dep].name}</span></p>` : ''}
      ${t.shape === 'class' ? `<label class="fld"><span>Attributes (one per line)</span><textarea data-f="attrs">${ESC(it.attrs)}</textarea></label><label class="fld"><span>Operations (one per line)</span><textarea data-f="methods">${ESC(it.methods)}</textarea></label>` : ''}
      ${t.icon ? `<label class="fld"><span>Notes (capacity, SLA, owner…)</span><textarea data-f="notes" placeholder="Shown nowhere on the diagram; kept in the JSON">${ESC(it.notes)}</textarea></label>` : ''}
      <div class="about"><b>About this component.</b> ${ESC(t.about)}</div>
      <div class="btns"><button class="btn" data-act="dup">Duplicate</button><button class="btn dng" data-act="del">Delete</button></div>`;
  }
  let focusSnap = false;
  $('#pInspect').addEventListener('focusin', () => { if (!focusSnap) { snapshot(); focusSnap = true; } });
  $('#pInspect').addEventListener('focusout', () => { focusSnap = false; });
  $('#pInspect').addEventListener('input', (ev) => {
    const f = ev.target.dataset.f; if (!f) return; const id = [...S.sel][0]; const tgt = byId(id) || edgeById(id); if (!tgt) return;
    let v = ev.target.value; if (f === 'replicas') v = Math.max(1, parseInt(v, 10) || 1);
    if (f === 'type' || f === 'deploy' || f === 'kind' || f === 'route') return; // handled on change
    tgt[f] = v; changed();
  });
  $('#pInspect').addEventListener('change', (ev) => {
    const f = ev.target.dataset.f; if (!f) return; const id = [...S.sel][0]; const tgt = byId(id) || edgeById(id); if (!tgt) return;
    if (!['type', 'deploy', 'kind', 'route'].includes(f)) return;
    snapshot(); tgt[f] = ev.target.value;
    if (f === 'type' && tgt.cat === 'node') { const t = FP.TYPES[tgt.type]; if (!t.icon) { tgt.w = t.w; tgt.h = t.h; } else { tgt.w = t.w; } }
    renderAll();
  });
  $('#pInspect').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-act]'); if (!b) return; const a = b.dataset.act;
    if (a === 'del') removeSel(); else if (a === 'dup') duplicateSel();
    else if (a === 'rev') { const e = edgeById([...S.sel][0]); if (e) { snapshot(); [e.from, e.to] = [e.to, e.from]; renderAll(); } }
  });

  /* ---------------- tabs ---------------- */
  function setTab(t) {
    S.tab = t; document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.p === t));
    ['Inspect', 'Review', 'Scale', 'Learn'].forEach((p) => { $('#p' + p).hidden = p !== t; });
    if (t === 'Review') renderReview(); else { S.flags.clear(); drawNow(); }
    if (t === 'Scale' && !$('#pScale').dataset.ready) renderScale();
    if (t === 'Learn' && !$('#pLearn').dataset.ready) renderLearn();
  }
  $('#tabs').addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (b) setTab(b.dataset.p); });

  /* ---------------- review ---------------- */
  let revCache = [];
  function updateReviewBadge() {
    const r = FP.review(S.model).filter((f) => f.level === 'error' || f.level === 'warn'); const b = $('#rv'); b.hidden = !r.length; b.textContent = r.length;
  }
  function renderReview() {
    revCache = FP.review(S.model); S.flags.clear();
    revCache.forEach((f) => f.ids.forEach((id) => { const cur = S.flags.get(id), rank = { error: 3, warn: 2, info: 1 }; if (!cur || rank[f.level] > rank[cur]) S.flags.set(id, f.level); }));
    const L = { error: 'Risk', warn: 'Warning', info: 'Suggestion', ok: 'All clear' };
    $('#pReview').innerHTML = `<h3>Design review</h3><p class="muted">Automatic checks on the current diagram. Click a finding to jump to it.</p>` +
      revCache.map((f, i) => `<div class="find ${f.level}" data-i="${i}"><div><b>${L[f.level]}</b>${ESC(f.text)}</div></div>`).join('');
    const b = $('#rv'), n = revCache.filter((f) => f.level === 'error' || f.level === 'warn').length; b.hidden = !n; b.textContent = n;
    if (!drag) drawNow();
  }
  $('#pReview').addEventListener('click', (ev) => { const el = ev.target.closest('.find'); if (!el) return; const f = revCache[+el.dataset.i]; if (f && f.ids.length) focusIds([...new Set(f.ids)]); });

  /* ---------------- scale advisor ---------------- */
  const DEF = { dau: 50000, reqPerUser: 60, peakFactor: 3, rpsPerInstance: 200, readPct: 80, mbPerUser: 20, avail: '99.9', deploy: 'cloud', global: false, staticHeavy: true, async: true };
  let adv = Object.assign({}, DEF);
  function renderScale() {
    const el = $('#pScale'); el.dataset.ready = '1';
    const num = (k, label, min, max, step) => `<label class="fld"><span>${label}</span><input type="number" min="${min}" max="${max}" step="${step || 1}" data-a="${k}" value="${adv[k]}"></label>`;
    el.innerHTML = `<h3>Scale advisor</h3><p class="muted">Describe the workload and where it runs. You get a sizing and a pattern, and can draw it on the canvas. Numbers are planning heuristics, so validate with load tests.</p>
      <div class="row2">${num('dau', 'Daily active users', 1, 1e9)}${num('reqPerUser', 'Requests / user / day', 1, 1e5)}</div>
      <div class="row2">${num('peakFactor', 'Peak ÷ average', 1, 50, 0.5)}${num('rpsPerInstance', 'Req/s per app instance', 1, 5000)}</div>
      <div class="row2">${num('readPct', 'Reads % of traffic', 0, 100)}${num('mbPerUser', 'Stored MB per user', 0, 1e5, 0.5)}</div>
      <div class="row2"><label class="fld"><span>Availability target</span><select data-a="avail">${Object.keys(FP.AVAIL).map((k) => opt(k, adv.avail, k + '%')).join('')}</select></label>
      <label class="fld"><span>Where it runs</span><select data-a="deploy">${opt('cloud', adv.deploy, 'Cloud')}${opt('onprem', adv.deploy, 'On-prem')}${opt('hybrid', adv.deploy, 'Hybrid')}</select></label></div>
      <div class="pillgroup"><label><input type="checkbox" data-a="global"${adv.global ? ' checked' : ''}> Global users</label><label><input type="checkbox" data-a="staticHeavy"${adv.staticHeavy ? ' checked' : ''}> Static / media heavy</label><label><input type="checkbox" data-a="async"${adv.async ? ' checked' : ''}> Background jobs</label></div>
      <div id="advOut"></div>
      <div class="btns"><button class="btn pri" data-g="replace">Draw reference diagram</button><button class="btn" data-g="add">Add below current</button></div>`;
    runAdvisor();
  }
  function runAdvisor() {
    const i = Object.assign({}, adv, { readPct: adv.readPct / 100 }); const r = FP.advise(i);
    $('#advOut').innerHTML = r.cards.map((c) => `<div class="card"><h5>${ESC(c.title)}</h5>${c.text ? `<p>${ESC(c.text)}</p>` : ''}${c.list ? `<ul>${c.list.map((l) => `<li>${ESC(l)}</li>`).join('')}</ul>` : ''}</div>`).join('');
    runAdvisor.last = r;
  }
  $('#pScale').addEventListener('input', (ev) => {
    const k = ev.target.dataset.a; if (!k) return;
    if (ev.target.type === 'checkbox') adv[k] = ev.target.checked; else if (ev.target.tagName === 'SELECT') adv[k] = ev.target.value; else { const v = parseFloat(ev.target.value); adv[k] = isFinite(v) && v >= 0 ? v : DEF[k]; }
    if (adv.dau < 1) adv.dau = 1; if (adv.rpsPerInstance < 1) adv.rpsPerInstance = 1; if (adv.peakFactor < 1) adv.peakFactor = 1;
    runAdvisor();
  });
  $('#pScale').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-g]'); if (!b || !runAdvisor.last) return;
    const spec = FP.generate(runAdvisor.last.gen).spec;
    if (b.dataset.g === 'replace') { snapshot(); const g = FP.build(spec); S.model = { items: g.items, edges: g.edges }; S.sel.clear(); setMode('arch'); renderAll(); fitView(); toast('Reference diagram drawn. Ctrl+Z restores your previous one.'); }
    else { snapshot(); S.model.items.forEach(fit); const bb = bbox(S.model.items); const g = FP.build(spec, bb ? bb.x : 0, bb ? bb.y + bb.h + 80 : 0); S.model.items.push(...g.items); S.model.edges.push(...g.edges); renderAll(); fitView(); toast('Added below your diagram.'); }
    S.name = S.name === 'Untitled diagram' ? 'Reference architecture' : S.name; $('#name').value = S.name;
  });

  /* ---------------- learn ---------------- */
  function renderLearn() {
    const el = $('#pLearn'); el.dataset.ready = '1';
    el.innerHTML = `<h3>Reading the diagram</h3>
      <p>Every architecture component takes the colour of the <b>zone</b> it sits in, so you can see at a glance what runs where.</p>
      <p>${Object.keys(FP.DEPLOY).filter((k) => k !== 'none').map((k) => `<span class="dep" style="margin:2px 4px 2px 0"><i style="background:${FP.DEPLOY[k].color}"></i>${FP.DEPLOY[k].name}</span>`).join('')}</p>
      <p>A <b>×N</b> badge is the number of instances. <b>Dashed</b> arrows are asynchronous, <b>dotted</b> are replication, <b>thick brown</b> is a private link.</p>
      <h4>On-prem vs cloud vs hybrid</h4>
      <table class="tbl"><tr><th></th><th>On-prem</th><th>Cloud</th><th>Hybrid</th></tr>
      <tr><th>Capacity</th><td>Bought ahead; weeks to add</td><td>On demand; minutes</td><td>Burst to cloud, base on-prem</td></tr>
      <tr><th>Cost shape</th><td>Capex, steady</td><td>Opex, usage-based</td><td>Both; watch egress</td></tr>
      <tr><th>Failure domain</th><td>Rack, room, site</td><td>Zone, region</td><td>Each side plus the link</td></tr>
      <tr><th>You operate</th><td>Everything</td><td>Your workload</td><td>Two operating models</td></tr>
      <tr><th>Fits</th><td>Data residency, steady load, existing DCs</td><td>Spiky or fast-growing load</td><td>Migrations, regulated data with elastic front end</td></tr></table>
      <h4>Scale tiers (peak requests/second)</h4>
      <table class="tbl"><tr><th>Tier</th><th>Shape</th></tr>${FP.TIERS.map((t) => `<tr><td>${ESC(t.name.replace(/ · .*/, ''))}<br><span class="muted">${t.max === Infinity ? '100k+' : '&lt; ' + (t.max >= 1000 ? t.max / 1000 + 'k' : t.max)}</span></td><td>${ESC(t.pattern[0])}</td></tr>`).join('')}</table>
      <h4>Design checklist</h4>
      <ol class="chk"><li><b>Reliability:</b> no single point of failure; tested restore; failure domains named.</li><li><b>Security:</b> default-deny between zones; data stores never exposed to users.</li><li><b>Performance:</b> cache hot reads, queue slow work, measure at peak.</li><li><b>Cost:</b> know the unit cost per request; watch cross-zone and egress traffic.</li><li><b>Operations:</b> metrics, logs, traces, runbooks, on-call.</li><li><b>Evolvability:</b> stateless where possible; split services along data ownership.</li></ol>
      <h4>Newer patterns worth knowing</h4>
      <p class="muted" style="font-size:12.5px">Cell-based architecture (independent copies of the stack, each serving a slice of users, so a bad deploy or outage hits one cell); event-driven designs on a replayable log; serverless for spiky work; platform teams offering a paved road on Kubernetes; GitOps and infrastructure as code so topology is reproducible.</p>
      <h4>UML quick guide</h4>
      <p class="muted" style="font-size:12.5px">Class: structure. Sequence: who calls whom, in order. Use case: what actors want. Deployment node: where software runs, which links the UML view to the architecture view.</p>`;
  }

  /* ---------------- templates ---------------- */
  (function buildTpl() {
    const sel = $('#tpl'); const g = { arch: 'Architecture', flow: 'Workflow', uml: 'UML' }; const by = {};
    Object.keys(FP.TEMPLATES).forEach((k) => { const t = FP.TEMPLATES[k]; (by[t.mode] = by[t.mode] || []).push(k); });
    Object.keys(g).forEach((m) => { if (!by[m]) return; const og = document.createElement('optgroup'); og.label = g[m]; by[m].forEach((k) => { const o = document.createElement('option'); o.value = k; o.textContent = FP.TEMPLATES[k].name; og.appendChild(o); }); sel.appendChild(og); });
    sel.addEventListener('change', () => { if (sel.value) loadTemplate(sel.value); sel.value = ''; });
  })();
  function showBanner(title, text) { const b = $('#banner'); if (!title) { b.hidden = true; return; } b.innerHTML = `<button aria-label="Close">×</button><b>${ESC(title)}</b>${ESC(text)}`; b.hidden = false; }
  $('#banner').addEventListener('click', (ev) => { if (ev.target.tagName === 'BUTTON') $('#banner').hidden = true; });
  function loadTemplate(key, quiet) {
    const t = FP.TEMPLATES[key]; if (!quiet) snapshot();
    const g = FP.build(t.make()); S.model = { items: g.items, edges: g.edges }; S.sel.clear(); S.name = t.name; $('#name').value = t.name;
    setMode(t.mode); renderAll(); fitView(); showBanner(t.name, t.blurb); if (!quiet) toast('Template loaded. Ctrl+Z restores your previous diagram.');
  }

  /* ---------------- export / import ---------------- */
  function exportSvg() {
    S.model.items.forEach(fit); const b = bbox(S.model.items) || { x: 0, y: 0, w: 400, h: 300 }; const pad = 40;
    const x = b.x - pad, y = b.y - pad, w = b.w + pad * 2, h = b.h + pad * 2;
    return { w, h, xml: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${x} ${y} ${w} ${h}" font-family="Helvetica, Arial, sans-serif"><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#ffffff"/>${defsSvg()}${sceneInner({ exp: true })}<text x="${x + 12}" y="${y + h - 10}" font-size="10" fill="#94a3b8">${ESC(S.name)} · FlowPortal</text></svg>` };
  }
  function download(name, blob) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
  const slug = () => (S.name || 'diagram').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'diagram';
  function loadJson(txt) {
    const d = JSON.parse(txt); const m = d.model || d;
    if (!m || !Array.isArray(m.items) || !Array.isArray(m.edges)) throw new Error('Not a FlowPortal diagram');
    snapshot(); S.model = { items: m.items, edges: m.edges }; S.sel.clear(); if (d.name) { S.name = d.name; $('#name').value = d.name; } renderAll(); fitView();
  }
  $('#exp').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-x]'); if (!b) return; const x = b.dataset.x; $('#exp').open = false;
    if (x === 'svg') download(slug() + '.svg', new Blob([exportSvg().xml], { type: 'image/svg+xml' }));
    else if (x === 'json') download(slug() + '.flowportal.json', new Blob([JSON.stringify({ app: 'flowportal', version: 1, name: S.name, model: S.model }, null, 2)], { type: 'application/json' }));
    else if (x === 'png') {
      const e = exportSvg(), sc = Math.min(3, 6000 / Math.max(e.w, e.h)), img = new Image();
      img.onload = () => { const c = document.createElement('canvas'); c.width = Math.round(e.w * sc); c.height = Math.round(e.h * sc); const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height); c.toBlob((bl) => download(slug() + '.png', bl)); };
      img.onerror = () => toast('PNG export failed; use SVG instead.'); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(e.xml);
    } else if (x === 'import') $('#file').click();
    else if (x === 'clear') { snapshot(); S.model = { items: [], edges: [] }; S.sel.clear(); S.name = 'Untitled diagram'; $('#name').value = S.name; showBanner(); renderAll(); }
  });
  document.addEventListener('click', (ev) => { if (!ev.target.closest('#exp')) $('#exp').open = false; });
  $('#file').addEventListener('change', (ev) => {
    const f = ev.target.files[0]; if (!f) return; const r = new FileReader();
    r.onload = () => { try { loadJson(r.result); toast('Imported ' + f.name); } catch (e) { toast('Could not import: ' + e.message); } };
    r.readAsText(f); ev.target.value = '';
  });

  /* ---------------- toolbar ---------------- */
  $('#undo').onclick = undo; $('#redo').onclick = redo;
  $('#snap').onclick = (e) => { S.snap = !S.snap; e.currentTarget.classList.toggle('on', S.snap); };
  $('#anim').onclick = (e) => { S.anim = !S.anim; e.currentTarget.classList.toggle('on', S.anim); drawNow(); };
  $('#zin').onclick = () => zoomAt(1.25); $('#zout').onclick = () => zoomAt(0.8); $('#zfit').onclick = fitView;
  $('#name').addEventListener('input', (e) => { S.name = e.target.value; persist(); });
  window.addEventListener('resize', () => applyView());

  /* ---------------- boot ---------------- */
  renderPalette(); syncHist();
  let restored = false;
  try {
    const raw = localStorage.getItem('flowportal.v1');
    if (raw) { const d = JSON.parse(raw); if (d.model && d.model.items && d.model.items.length) { S.model = d.model; S.name = d.name || S.name; S.view = d.view || S.view; $('#name').value = S.name; setMode(d.mode || 'arch'); restored = true; } }
  } catch (e) { /* ignore corrupt storage */ }
  if (restored) { renderAll(); if (!d_ok()) fitView(); } else loadTemplate('hybrid', true);
  function d_ok() { const v = S.view; return v && isFinite(v.k) && isFinite(v.x) && isFinite(v.y); }
  updateReviewBadge();
})();
