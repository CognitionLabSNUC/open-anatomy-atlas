#!/usr/bin/env node
'use strict';
// Generates a tiny synthetic dataset in the *BodyParts3D file layout*
// (tab-separated lists + FJxxxx.obj meshes, millimetres, Z-up) from the
// built-in procedural mannequin. Used by the test-suite and handy for
// trying the import pipeline offline. Not real anatomy data.
//
//   node tools/make-sample-data.js <outDir>

const fs = require('fs');
const path = require('path');
const { genSphere, genCapsule, genBox } = require('../src/renderer/geometry.js');
const { PARTS } = require('../src/renderer/bodyModel.js');

const out = path.resolve(process.argv[2] || 'sample-data');
const objDir = path.join(out, 'partof_BP3D_4.0_obj_99');
fs.mkdirSync(objDir, { recursive: true });

// BodyParts3D-style names for the procedural parts
const RENAME = {
  thoracic_spine: 'thoracic vertebral column',
  cervical_spine: 'cervical vertebral column',
};

// Rotate so the figure faces +X (tests the builder's front detection) and is Z-up in mm.
function toRaw(x, y, z) {
  const S = 200;
  // y-up/front +Z  ->  z-up, front +X
  return [z * S, x * S, y * S]; // proper rotation (det +1), no mirroring
}

function rotMat(rot) {
  const [rx, ry, rz] = rot || [0, 0, 0];
  const cx = Math.cos(rx), sx = Math.sin(rx), cy = Math.cos(ry), sy = Math.sin(ry), cz = Math.cos(rz), sz = Math.sin(rz);
  return (x, y, z) => {
    let a = [x, y * cx - z * sx, y * sx + z * cx];
    a = [a[0] * cy + a[2] * sy, a[1], -a[0] * sy + a[2] * cy];
    return [a[0] * cz - a[1] * sz, a[0] * sz + a[1] * cz, a[2]];
  };
}

const parts = PARTS.concat([
  { id: 'sternum', label: 'Sternum', system: 'skeleton', shape: 'box', size: [0.18, 0.8, 0.08], pos: [0, 5.4, 0.55] },
]);

const elementRows = [];
const partsList = [];
const relations = [];
const concept = (fma, name) => { partsList.push([fma, 'BP' + fma.slice(3), name]); return fma; };

let fj = 1000, fma = 50000;
const leafBySystem = { skeleton: [], muscle: [], organ: [] };
const leftLimb = [];

for (const p of parts) {
  const g = p.shape === 'sphere' ? genSphere(p.size[0]) : p.shape === 'capsule' ? genCapsule(p.size[0], p.size[1]) : genBox(...p.size);
  const R = rotMat(p.rot);
  const lines = [`# ${p.label}`];
  for (let i = 0; i < g.positions.length; i += 3) {
    const r = R(g.positions[i], g.positions[i + 1], g.positions[i + 2]);
    const [X, Y, Z] = toRaw(r[0] + p.pos[0], r[1] + p.pos[1], r[2] + p.pos[2]);
    lines.push(`v ${X.toFixed(3)} ${Y.toFixed(3)} ${Z.toFixed(3)}`);
  }
  for (let i = 0; i < g.normals.length; i += 3) lines.push(`vn ${g.normals[i]} ${g.normals[i + 1]} ${g.normals[i + 2]}`);
  for (let i = 0; i < g.indices.length; i += 3) {
    const [a, b, c] = [g.indices[i] + 1, g.indices[i + 1] + 1, g.indices[i + 2] + 1];
    lines.push(`f ${a}//${a} ${b}//${b} ${c}//${c}`);
  }
  const elem = 'FJ' + (fj++);
  fs.writeFileSync(path.join(objDir, elem + '.obj'), lines.join('\n') + '\n');

  const name = (RENAME[p.id] || p.label.replace(/ \((Left|Right)\)/, (m, s) => '')).toLowerCase();
  const side = /\(Left\)/.test(p.label) ? 'left ' : /\(Right\)/.test(p.label) ? 'right ' : '';
  const id = concept('FMA' + (fma++), side + name);
  elementRows.push([id, side + name, elem]);
  leafBySystem[p.system].push({ id, elem });
  if (side === 'left ' && /humerus|radius|hand|biceps|deltoid/.test(p.id)) leftLimb.push({ id, elem });
}

// orphan mesh with no concept + a concept whose mesh is missing
fs.writeFileSync(path.join(objDir, 'FJ9999.obj'), 'v 0 0 0\nv 10 0 0\nv 0 10 0\nf 1 2 3\n');
const missing = concept('FMA99999', 'structure without mesh');
elementRows.push([missing, 'structure without mesh', 'FJ0001']);

const body = concept('FMA20394', 'human body');
const groups = { skeleton: concept('FMA23881', 'skeletal system'), muscle: concept('FMA72954', 'muscular system'), organ: concept('FMA9578', 'set of viscera') };
const limb = concept('FMA7186', 'left upper limb');
for (const [sys, gid] of Object.entries(groups)) {
  relations.push([body, 'human body', gid, partsList.find(r => r[0] === gid)[2]]);
  for (const l of leafBySystem[sys]) relations.push([gid, '', l.id, '']);
}
relations.push([body, 'human body', limb, 'left upper limb']);
for (const l of leftLimb) relations.push([limb, 'left upper limb', l.id, '']);

// composite concepts list all their element files (as BodyParts3D does)
const allLeaves = Object.values(leafBySystem).flat();
for (const l of allLeaves) elementRows.push([body, 'human body', l.elem]);
for (const [sys, gid] of Object.entries(groups)) for (const l of leafBySystem[sys]) elementRows.push([gid, '', l.elem]);

// is-a tree
const ent = concept('FMA62955', 'anatomical entity');
const isaGroups = { skeleton: concept('FMA5018', 'bone organ'), muscle: concept('FMA5022', 'muscle organ'), organ: concept('FMA67498', 'organ') };
const isaRel = [];
for (const [sys, gid] of Object.entries(isaGroups)) {
  isaRel.push([ent, 'anatomical entity', gid, '']);
  for (const l of leafBySystem[sys]) isaRel.push([gid, '', l.id, '']);
}

const tsv = (header, rows) => '﻿' + [header.join('\t'), ...rows.map(r => r.join('\t'))].join('\r\n') + '\r\n';
fs.writeFileSync(path.join(out, 'partof_parts_list_e.txt'), tsv(['concept id', 'representation id', 'en'], partsList));
fs.writeFileSync(path.join(out, 'isa_parts_list_e.txt'), tsv(['concept id', 'representation id', 'en'], partsList));
fs.writeFileSync(path.join(out, 'partof_inclusion_relation_list.txt'), tsv(['parent id', 'parent name', 'child id', 'child name'], relations));
fs.writeFileSync(path.join(out, 'isa_inclusion_relation_list.txt'), tsv(['parent id', 'parent name', 'child id', 'child name'], isaRel));
fs.writeFileSync(path.join(out, 'partof_element_parts.txt'), tsv(['concept id', 'name', 'element file id'], elementRows));
fs.writeFileSync(path.join(out, 'isa_element_parts.txt'), tsv(['concept id', 'name', 'element file id'], []));
console.log(`Sample dataset written to ${out} (${parts.length + 1} meshes)`);
