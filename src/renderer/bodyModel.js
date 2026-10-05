// Defines a simplified labeled human figure as a list of parts, each with a
// primitive shape, transform, color, system (skeleton/muscle/organ) and an
// anatomical label. This is original/procedural geometry — not scan data —
// so it has no licensing dependency on any third-party anatomy dataset.

const SKELETON_COLOR = [0.92, 0.90, 0.82];
const MUSCLE_COLOR = [0.78, 0.25, 0.22];
const ORGAN_COLOR = [0.65, 0.35, 0.45];

// Each part: { id, label, system, shape: 'sphere'|'capsule'|'box',
//   size: [...], pos: [x,y,z], rot: [rx,ry,rz] (radians), color }
const PARTS = [
  // ---- Skeleton ----
  { id: 'skull', label: 'Skull', system: 'skeleton', shape: 'sphere', size: [0.6], pos: [0, 7.3, 0], color: SKELETON_COLOR },
  { id: 'cervical_spine', label: 'Cervical Spine', system: 'skeleton', shape: 'capsule', size: [0.12, 0.6], pos: [0, 6.6, 0], color: SKELETON_COLOR },
  { id: 'thoracic_spine', label: 'Thoracic Spine', system: 'skeleton', shape: 'capsule', size: [0.14, 1.6], pos: [0, 5.3, -0.1], color: SKELETON_COLOR },
  { id: 'rib_cage', label: 'Rib Cage', system: 'skeleton', shape: 'capsule', size: [0.5, 1.5], pos: [0, 5.3, 0], rot: [0, 0, Math.PI/2], color: SKELETON_COLOR },
  { id: 'pelvis', label: 'Pelvis', system: 'skeleton', shape: 'box', size: [1.5, 0.6, 0.9], pos: [0, 3.6, 0], color: SKELETON_COLOR },
  { id: 'humerus_l', label: 'Humerus (Left)', system: 'skeleton', shape: 'capsule', size: [0.14, 1.4], pos: [-0.85, 4.9, 0], color: SKELETON_COLOR },
  { id: 'humerus_r', label: 'Humerus (Right)', system: 'skeleton', shape: 'capsule', size: [0.14, 1.4], pos: [0.85, 4.9, 0], color: SKELETON_COLOR },
  { id: 'radius_ulna_l', label: 'Radius & Ulna (Left)', system: 'skeleton', shape: 'capsule', size: [0.11, 1.3], pos: [-0.9, 3.5, 0], color: SKELETON_COLOR },
  { id: 'radius_ulna_r', label: 'Radius & Ulna (Right)', system: 'skeleton', shape: 'capsule', size: [0.11, 1.3], pos: [0.9, 3.5, 0], color: SKELETON_COLOR },
  { id: 'hand_l', label: 'Hand (Left)', system: 'skeleton', shape: 'sphere', size: [0.22], pos: [-0.92, 2.65, 0], color: SKELETON_COLOR },
  { id: 'hand_r', label: 'Hand (Right)', system: 'skeleton', shape: 'sphere', size: [0.22], pos: [0.92, 2.65, 0], color: SKELETON_COLOR },
  { id: 'femur_l', label: 'Femur (Left)', system: 'skeleton', shape: 'capsule', size: [0.19, 1.9], pos: [-0.42, 2.3, 0], color: SKELETON_COLOR },
  { id: 'femur_r', label: 'Femur (Right)', system: 'skeleton', shape: 'capsule', size: [0.19, 1.9], pos: [0.42, 2.3, 0], color: SKELETON_COLOR },
  { id: 'tibia_fibula_l', label: 'Tibia & Fibula (Left)', system: 'skeleton', shape: 'capsule', size: [0.15, 1.9], pos: [-0.42, 0.55, 0], color: SKELETON_COLOR },
  { id: 'tibia_fibula_r', label: 'Tibia & Fibula (Right)', system: 'skeleton', shape: 'capsule', size: [0.15, 1.9], pos: [0.42, 0.55, 0], color: SKELETON_COLOR },
  { id: 'foot_l', label: 'Foot (Left)', system: 'skeleton', shape: 'box', size: [0.26, 0.2, 0.55], pos: [-0.42, -0.5, 0.15], color: SKELETON_COLOR },
  { id: 'foot_r', label: 'Foot (Right)', system: 'skeleton', shape: 'box', size: [0.26, 0.2, 0.55], pos: [0.42, -0.5, 0.15], color: SKELETON_COLOR },

  // ---- Muscles (major groups, simplified) ----
  { id: 'trapezius', label: 'Trapezius', system: 'muscle', shape: 'box', size: [0.9, 0.7, 0.3], pos: [0, 6.0, -0.3], color: MUSCLE_COLOR },
  { id: 'deltoid_l', label: 'Deltoid (Left)', system: 'muscle', shape: 'sphere', size: [0.28], pos: [-0.72, 5.55, 0], color: MUSCLE_COLOR },
  { id: 'deltoid_r', label: 'Deltoid (Right)', system: 'muscle', shape: 'sphere', size: [0.28], pos: [0.72, 5.55, 0], color: MUSCLE_COLOR },
  { id: 'pectoralis', label: 'Pectoralis Major', system: 'muscle', shape: 'box', size: [1.0, 0.6, 0.3], pos: [0, 5.6, 0.35], color: MUSCLE_COLOR },
  { id: 'biceps_l', label: 'Biceps Brachii (Left)', system: 'muscle', shape: 'capsule', size: [0.16, 1.0], pos: [-0.87, 4.95, 0.15], color: MUSCLE_COLOR },
  { id: 'biceps_r', label: 'Biceps Brachii (Right)', system: 'muscle', shape: 'capsule', size: [0.16, 1.0], pos: [0.87, 4.95, 0.15], color: MUSCLE_COLOR },
  { id: 'rectus_abdominis', label: 'Rectus Abdominis', system: 'muscle', shape: 'box', size: [0.65, 1.1, 0.25], pos: [0, 4.4, 0.45], color: MUSCLE_COLOR },
  { id: 'quadriceps_l', label: 'Quadriceps (Left)', system: 'muscle', shape: 'capsule', size: [0.24, 1.5], pos: [-0.42, 2.35, 0.2], color: MUSCLE_COLOR },
  { id: 'quadriceps_r', label: 'Quadriceps (Right)', system: 'muscle', shape: 'capsule', size: [0.24, 1.5], pos: [0.42, 2.35, 0.2], color: MUSCLE_COLOR },
  { id: 'gastrocnemius_l', label: 'Gastrocnemius (Left)', system: 'muscle', shape: 'capsule', size: [0.18, 1.1], pos: [-0.42, 0.65, -0.18], color: MUSCLE_COLOR },
  { id: 'gastrocnemius_r', label: 'Gastrocnemius (Right)', system: 'muscle', shape: 'capsule', size: [0.18, 1.1], pos: [0.42, 0.65, -0.18], color: MUSCLE_COLOR },
  { id: 'gluteus_maximus_l', label: 'Gluteus Maximus (Left)', system: 'muscle', shape: 'sphere', size: [0.38], pos: [-0.42, 3.5, -0.4], color: MUSCLE_COLOR },
  { id: 'gluteus_maximus_r', label: 'Gluteus Maximus (Right)', system: 'muscle', shape: 'sphere', size: [0.38], pos: [0.42, 3.5, -0.4], color: MUSCLE_COLOR },

  // ---- Organs (simplified, torso cavity) ----
  { id: 'heart', label: 'Heart', system: 'organ', shape: 'sphere', size: [0.32], pos: [-0.15, 5.6, 0.1], color: ORGAN_COLOR },
  { id: 'lung_l', label: 'Lung (Left)', system: 'organ', shape: 'capsule', size: [0.3, 0.9], pos: [-0.55, 5.6, -0.05], color: [0.85, 0.6, 0.6] },
  { id: 'lung_r', label: 'Lung (Right)', system: 'organ', shape: 'capsule', size: [0.3, 0.9], pos: [0.55, 5.6, -0.05], color: [0.85, 0.6, 0.6] },
  { id: 'liver', label: 'Liver', system: 'organ', shape: 'box', size: [0.75, 0.45, 0.5], pos: [0.3, 4.75, 0.15], color: [0.55, 0.22, 0.2] },
  { id: 'stomach', label: 'Stomach', system: 'organ', shape: 'sphere', size: [0.3], pos: [-0.25, 4.65, 0.2], color: [0.8, 0.5, 0.55] },
  { id: 'intestines', label: 'Intestines', system: 'organ', shape: 'sphere', size: [0.45], pos: [0, 4.0, 0.15], color: [0.75, 0.45, 0.4] },
  { id: 'kidney_l', label: 'Kidney (Left)', system: 'organ', shape: 'capsule', size: [0.1, 0.3], pos: [-0.45, 4.5, -0.3], color: [0.5, 0.2, 0.25] },
  { id: 'kidney_r', label: 'Kidney (Right)', system: 'organ', shape: 'capsule', size: [0.1, 0.3], pos: [0.45, 4.5, -0.3], color: [0.5, 0.2, 0.25] },
  { id: 'brain', label: 'Brain', system: 'organ', shape: 'sphere', size: [0.42], pos: [0, 7.35, -0.05], color: [0.88, 0.75, 0.7] },
];

// The list above was authored with the patient's left at -X. Mirror it so the
// figure faces +Z with the patient's left at +X (anatomically correct when
// viewed from the front: the patient's left appears on the viewer's right).
for (const p of PARTS) p.pos[0] = -p.pos[0];

if (typeof module !== 'undefined') module.exports = { PARTS };
