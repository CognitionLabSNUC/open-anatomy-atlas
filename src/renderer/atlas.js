// Read-only queries over a loaded atlas index (names, trees, search, boxes).

const DEFAULT_CATEGORIES = {
  bone:      { label: 'Bones & teeth',      color: [0.89, 0.86, 0.78] },
  cartilage: { label: 'Cartilage & discs',  color: [0.66, 0.80, 0.86] },
  ligament:  { label: 'Ligaments & joints', color: [0.80, 0.77, 0.58] },
  muscle:    { label: 'Muscles & tendons',  color: [0.72, 0.24, 0.22] },
  artery:    { label: 'Arteries',           color: [0.85, 0.12, 0.13] },
  vein:      { label: 'Veins',              color: [0.22, 0.34, 0.78] },
  nervous:   { label: 'Nervous system',     color: [0.95, 0.82, 0.32] },
  organ:     { label: 'Organs & viscera',   color: [0.80, 0.50, 0.52] },
  skin:      { label: 'Skin',               color: [0.92, 0.75, 0.64] },
  fascia:    { label: 'Fasciae',            color: [0.86, 0.84, 0.70] },
  lymph:     { label: 'Lymphatic system',   color: [0.45, 0.74, 0.42] },
};

const GENERIC_CLASS = /^(anatomical entity|physical anatomical entity|material anatomical entity|immaterial anatomical entity|anatomical structure|anatomical set|anatomical cluster|cardinal organ part|cardinal body part|organ region|organ zone|organ component|organ part|organ segment|segment of organ|zone of .*|region of organ.*|subdivision of .*|portion of tissue|body part|set of .*organs?)$/;

class Atlas {
  constructor(index) {
    this.index = index;
    this.elements = index.elements;
    this.concepts = index.concepts;
    this.categories = index.categories || DEFAULT_CATEGORIES;
    this.lower = this.concepts.map(c => (c.side ? `${c.name} (${c.side})` : c.name).toLowerCase());
    this.catCount = {};
    for (const e of this.elements) this.catCount[e.t] = (this.catCount[e.t] || 0) + 1;
  }

  get isDemo() { return !!this.index.demo; }

  conceptOf(el) { return this.elements[el].c; }

  displayName(ci) {
    const c = this.concepts[ci];
    const n = c.side ? `${c.name} (${c.side})` : c.name;
    return n.charAt(0).toUpperCase() + n.slice(1);
  }

  // Latin name and definition: from the atlas itself (Z-Anatomy) or, for other
  // atlases, from the Z-Anatomy glossary when it is installed.
  glossaryOf(ci) {
    const c = this.concepts[ci];
    if (c.la || c.def) return { la: c.la, def: c.def };
    if (!this.glossary) return null;
    const key = c.name.toLowerCase().replace(/\b(left|right)\b/g, ' ').replace(/\(\s*\)/g, '').replace(/\s+/g, ' ').trim();
    return this.glossary[key] || null;
  }

  // Why a mesh might not be a direct measurement.
  mirrorNote(ci) {
    const c = this.concepts[ci];
    if (c.mirrored) return 'Mirror image of the other side, added by this app because the source data models this structure on one side only.';
    if (c.el.length && c.el.every(e => /^FJ\d+M$/.test(this.elements[e].k))) return 'BodyParts3D models this side as a mirror image of the other side.';
    return null;
  }

  fmaLabel(ci) {
    const id = this.concepts[ci].id;
    const m = /^FMA(\d+)$/.exec(id);
    return m ? `FMA ${m[1]}` : null;
  }

  // Most common category among a concept's meshes.
  categoryOf(ci) {
    const count = {};
    for (const e of this.concepts[ci].el) { const t = this.elements[e].t; count[t] = (count[t] || 0) + 1; }
    return Object.entries(count).sort((a, b) => b[1] - a[1])[0]?.[0] || 'organ';
  }

  bbox(elList) {
    const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (const e of elList) {
      const eb = this.elements[e].b;
      for (let a = 0; a < 3; a++) { if (eb[a] < b[a]) b[a] = eb[a]; if (eb[a + 3] > b[a + 3]) b[a + 3] = eb[a + 3]; }
    }
    return b[0] === Infinity ? null : b;
  }

  roots(tree) { return this.sortByName(this.index.roots[tree] || []); }

  children(ci, tree) { return this.sortByName(this.concepts[ci][tree === 'isa' ? 'ic' : 'pc']); }

  parents(ci, tree) { return this.concepts[ci][tree === 'isa' ? 'ip' : 'pp']; }

  sortByName(list) { return list.slice().sort((a, b) => this.lower[a].localeCompare(this.lower[b])); }

  // Path from a root down to ci, following the most specific parent each step.
  breadcrumb(ci, tree = 'partof') {
    const walk = (t) => {
      const path = [ci];
      const seen = new Set([ci]);
      let cur = ci;
      for (let i = 0; i < 16; i++) {
        const ps = this.parents(cur, t).filter(p => !seen.has(p) && !this.concepts[p].synthetic);
        if (!ps.length) break;
        ps.sort((a, b) => this.concepts[a].el.length - this.concepts[b].el.length);
        cur = ps[0]; seen.add(cur); path.unshift(cur);
      }
      return path;
    };
    // Prefer "where it is" (part-of); use the type hierarchy only when nothing else exists.
    let path = walk(tree);
    if (path.length === 1 && tree === 'partof') path = walk('isa');
    // Upper-ontology classes ("anatomical entity", "organ zone" ...) tell a learner nothing.
    path = path.filter((p, i) => i === path.length - 1 || !GENERIC_CLASS.test(this.concepts[p].name.toLowerCase()));
    return path.length > 6 ? path.slice(-6) : path;
  }

  search(q, limit = 60) {
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    const out = [];
    for (let i = 0; i < this.lower.length; i++) {
      if (this.concepts[i].synthetic) continue;
      const s = this.lower[i];
      if (!terms.every(t => s.includes(t))) continue;
      let score = s.length + (this.concepts[i].el.length > 40 ? 400 : 0); // prefer specific structures over big groups
      if (s.startsWith(terms[0])) score -= 1000;
      else if (s.includes(' ' + terms[0])) score -= 500;
      out.push([score, i]);
    }
    out.sort((a, b) => a[0] - b[0]);
    return out.slice(0, limit).map(x => x[1]);
  }
}
