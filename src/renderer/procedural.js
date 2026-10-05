// Builds the built-in demo atlas (simplified mannequin) in exactly the same
// format the BodyParts3D builder produces, so the whole UI has one code path.
/* global PARTS, Geometry */

function buildProceduralAtlas() {
  const CAT = { skeleton: 'bone', muscle: 'muscle', organ: 'organ' };
  const brainLike = /brain/i;
  const pos = [], nor = [], idx = [];
  const elements = [];
  let v0 = 0;

  PARTS.forEach((p, i) => {
    const g = p.shape === 'sphere' ? Geometry.genSphere(p.size[0])
      : p.shape === 'capsule' ? Geometry.genCapsule(p.size[0], p.size[1])
      : Geometry.genBox(p.size[0], p.size[1], p.size[2]);
    const [rx, ry, rz] = p.rot || [0, 0, 0];
    const rot = (x, y, z) => {
      let a = [x, y * Math.cos(rx) - z * Math.sin(rx), y * Math.sin(rx) + z * Math.cos(rx)];
      a = [a[0] * Math.cos(ry) + a[2] * Math.sin(ry), a[1], -a[0] * Math.sin(ry) + a[2] * Math.cos(ry)];
      return [a[0] * Math.cos(rz) - a[1] * Math.sin(rz), a[0] * Math.sin(rz) + a[1] * Math.cos(rz), a[2]];
    };
    const S = 0.2; // ~1.7 m tall
    const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (let k = 0; k < g.positions.length; k += 3) {
      const r = rot(g.positions[k], g.positions[k + 1], g.positions[k + 2]);
      const q = [(r[0] + p.pos[0]) * S, (r[1] + p.pos[1] + 0.6) * S, (r[2] + p.pos[2]) * S];
      pos.push(q[0], q[1], q[2]);
      for (let a = 0; a < 3; a++) { b[a] = Math.min(b[a], q[a]); b[a + 3] = Math.max(b[a + 3], q[a]); }
      const n = rot(g.normals[k], g.normals[k + 1], g.normals[k + 2]);
      nor.push(Math.round(n[0] * 32767), Math.round(n[1] * 32767), Math.round(n[2] * 32767));
    }
    const o = idx.length;
    for (const t of g.indices) idx.push(t + v0);
    v0 += g.positions.length / 3;
    elements.push({ k: 'DEMO-' + p.id, c: -1, t: brainLike.test(p.label) ? 'nervous' : CAT[p.system], o, n: g.indices.length, b });
  });

  // concepts: body -> systems -> parts (part-of); same leaves grouped by type (is-a)
  const concepts = [];
  const add = (c) => { concepts.push(Object.assign({ pp: [], pc: [], ip: [], ic: [], el: [] }, c)); return concepts.length - 1; };
  const body = add({ id: 'DEMO-BODY', name: 'Human body (demo mannequin)' });
  const groups = {
    skeleton: add({ id: 'DEMO-SKEL', name: 'Skeletal system' }),
    muscle: add({ id: 'DEMO-MUSC', name: 'Muscular system' }),
    organ: add({ id: 'DEMO-ORG', name: 'Viscera' }),
  };
  const allEl = [];
  PARTS.forEach((p, i) => {
    const g = groups[p.system];
    const leaf = add({ id: 'DEMO-' + p.id, name: p.label, pp: [g], ip: [g], el: [i] });
    elements[i].c = leaf;
    concepts[g].pc.push(leaf); concepts[g].ic.push(leaf); concepts[g].el.push(i);
    allEl.push(i);
  });
  for (const g of Object.values(groups)) { concepts[g].pp.push(body); concepts[body].pc.push(g); }
  concepts[body].el = allEl;

  const P = new Float32Array(pos);
  const N = new Int16Array(nor.length + (nor.length % 2));
  N.set(nor);
  const I = new Uint32Array(idx);
  const bin = new ArrayBuffer(P.byteLength + N.byteLength + I.byteLength);
  new Uint8Array(bin, 0, P.byteLength).set(new Uint8Array(P.buffer));
  new Uint8Array(bin, P.byteLength, N.byteLength).set(new Uint8Array(N.buffer));
  new Uint8Array(bin, P.byteLength + N.byteLength, I.byteLength).set(new Uint8Array(I.buffer));

  const bb = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (const e of elements) for (let a = 0; a < 3; a++) { bb[a] = Math.min(bb[a], e.b[a]); bb[a + 3] = Math.max(bb[a + 3], e.b[a + 3]); }

  return {
    index: {
      format: 'open-anatomy-atlas/1',
      name: 'Demo mannequin',
      version: 'built-in',
      demo: true,
      attribution: 'Built-in simplified model (not anatomical data)',
      license: 'MIT',
      categories: null,
      bbox: bb,
      counts: { elements: elements.length, concepts: concepts.length, triangles: I.length / 3, vertices: P.length / 3 },
      buffers: { positions: [0, P.byteLength], normals: [P.byteLength, N.byteLength], indices: [P.byteLength + N.byteLength, I.byteLength] },
      elements,
      concepts,
      roots: { partof: [body], isa: Object.values(groups) },
    },
    bin,
  };
}
