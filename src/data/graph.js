'use strict';
// Turns a concept map + list of meshes into the atlas graph: every concept
// gets the closure of its meshes, each mesh gets its most specific concept as
// its label, both trees get roots, and every mesh gets a display category.

const { classify } = require('./classify');

// C: Map(id -> { id, name, pp:Set, pc:Set, ip:Set, ic:Set, direct:Set(meshKey), ...extra })
// meshes: [{ key, ... }]
// opts.category(meshIndex, ancestorNames) -> category | null   (optional override)
function buildGraph(C, meshes, opts = {}) {
  const elemIndex = new Map(meshes.map((m, i) => [m.key, i]));

  // element closure per concept (direct + descendants in both trees)
  const memo = new Map();
  const visiting = new Set();
  function closure(id) {
    if (memo.has(id)) return memo.get(id);
    const c = C.get(id);
    if (!c || visiting.has(id)) return new Set();
    visiting.add(id);
    const s = new Set();
    for (const e of c.direct) if (elemIndex.has(e)) s.add(elemIndex.get(e));
    for (const ch of c.pc) for (const e of closure(ch)) s.add(e);
    for (const ch of c.ic) for (const e of closure(ch)) s.add(e);
    visiting.delete(id);
    memo.set(id, s);
    return s;
  }
  for (const id of C.keys()) closure(id);

  const kept = [...C.values()].filter(c => memo.get(c.id).size > 0 && (c.name || opts.keepUnnamed));
  kept.sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
  const cIndex = new Map(kept.map((c, i) => [c.id, i]));

  // label each mesh with its most specific concept
  const best = new Array(meshes.length).fill(-1);
  const bestN = new Array(meshes.length).fill(Infinity);
  kept.forEach((c, ci) => {
    const set = memo.get(c.id);
    const n = set.size;
    for (const e of set) {
      if (n < bestN[e] || (n === bestN[e] && (c.name || '').length < (kept[best[e]].name || '').length)) {
        bestN[e] = n; best[e] = ci;
      }
    }
  });

  const map = (s) => [...s].filter(x => cIndex.has(x)).map(x => cIndex.get(x));
  const concepts = kept.map(c => {
    const o = { id: c.id, name: c.name || c.id, pp: map(c.pp), pc: map(c.pc), ip: map(c.ip), ic: map(c.ic), el: [...memo.get(c.id)].sort((a, b) => a - b) };
    if (c.la) o.la = c.la;
    if (c.def) o.def = c.def;
    return o;
  });

  // meshes no concept mentions get a concept of their own
  meshes.forEach((m, i) => {
    if (best[i] === -1) {
      concepts.push({ id: m.key, name: m.name || m.key, pp: [], pc: [], ip: [], ic: [], el: [i], orphan: !m.name });
      best[i] = concepts.length - 1;
    }
  });

  const roots = { partof: makeRoots(concepts, 'pp', 'pc', 'PARTOF', opts.otherLabel), isa: makeRoots(concepts, 'ip', 'ic', 'ISA', opts.otherLabel) };

  const cats = meshes.map((m, i) => {
    const names = ancestorNames(concepts, best[i]);
    return (opts.category && opts.category(i, names)) || classify(names);
  });

  return { concepts, best, cats, roots };
}

// Concepts with no parent in a tree are roots; ones that also have no children
// in that tree are gathered under a synthetic "Other structures" node.
function makeRoots(concepts, pKey, cKey, label, otherLabel = 'Other structures') {
  const roots = [], orphans = [];
  const otherChildren = cKey === 'pc' ? 'ic' : 'pc';
  concepts.forEach((c, i) => {
    if (c[pKey].length || c.synthetic) return;
    if (c[cKey].length) roots.push(i);
    else if (!c[otherChildren].length) orphans.push(i); // pure groupers of the other tree stay out
  });
  if (orphans.length) {
    const idx = concepts.length;
    const el = new Set();
    for (const o of orphans) { for (const e of concepts[o].el) el.add(e); concepts[o][pKey].push(idx); }
    concepts.push({ id: 'X-OTHER-' + label, name: otherLabel, pp: [], pc: [], ip: [], ic: [], el: [...el].sort((a, b) => a - b), synthetic: true });
    concepts[idx][cKey] = orphans;
    roots.push(idx);
  }
  return roots;
}

function ancestorNames(concepts, ci, depth = 10) {
  const names = [concepts[ci].name];
  let frontier = [ci];
  const seen = new Set([ci]);
  for (let d = 0; d < depth && frontier.length; d++) {
    const next = [];
    for (const f of frontier) for (const p of [...concepts[f].pp, ...concepts[f].ip]) {
      if (seen.has(p) || concepts[p].synthetic) continue;
      seen.add(p); next.push(p); names.push(concepts[p].name);
    }
    frontier = next;
  }
  return names;
}

function newConcept(C, id, name) {
  if (!id) return null;
  let c = C.get(id);
  if (!c) { c = { id, name: '', pp: new Set(), pc: new Set(), ip: new Set(), ic: new Set(), direct: new Set() }; C.set(id, c); }
  if (name && !c.name) c.name = name;
  return c;
}

function link(C, parentId, childId, tree /* 'p' | 'i' */) {
  const p = C.get(parentId), k = C.get(childId);
  if (!p || !k || p === k) return;
  p[tree + 'c'].add(k.id); k[tree + 'p'].add(p.id);
}

module.exports = { buildGraph, newConcept, link, ancestorNames };
