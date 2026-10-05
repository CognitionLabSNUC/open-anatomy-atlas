'use strict';
// Assigns each structure to a display category (used for layer toggles and
// colours) from its own name, falling back to its ancestors' names.

const CATEGORIES = {
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

// Order matters: the first matching rule wins.
const RULES = [
  ['skin', /\bskin\b|integument/],
  ['fascia', /fascia\b|fasciae|fascial|tela subcutanea|subcutaneous tissue/],
  ['nervous', /(frontal|parietal|occipital|temporal|limbic|insular) lobe|nerve|nervous|plexus|ganglion|spinal cord|cauda equina|brain|cerebr|cerebell|\bpons\b|medulla oblongata|thalam|hippocamp|gyrus|midbrain|mesencephal|diencephal|optic chiasm|corpus callosum|basal nucle|caudate|putamen|amygdal|retina/],
  ['artery', /arter|aorta|arterial|arch of aorta|truncus|coronary|(pulmonary|brachiocephalic|c(o)?eliac|costocervical|thyrocervical) trunk/],
  ['vein', /\bvein|vena\b|venae|venous|dural sinus|sinus of dura|sagittal sinus|transverse sinus|sigmoid sinus/],
  ['muscle', /muscle|muscul|tendon|aponeuros|diaphragm|\bmm?\.|biceps|triceps|quadriceps|deltoid|pectoralis|trapezius|latissimus|gluteus|gastrocnemius|soleus|sartorius|rectus (abdominis|femoris|capitis)|oblique|transversus|serratus|rhomboid|levator|masseter|temporalis|platysma|sternocleidomastoid|iliopsoas|psoas|iliacus|adductor|abductor|flexor|extensor|supinator|pronator|tibialis|peroneus|fibularis|semitendinosus|semimembranosus|gracilis|piriformis|infraspinatus|supraspinatus|subscapularis|brachialis|brachioradialis|coracobrachialis|popliteus|plantaris|lumbrical|buccinator|orbicularis|occipitofrontalis|zygomaticus|risorius|mentalis|depressor|constrictor|genioglossus|hyoglossus|digastric|mylohyoid|stylohyoid|omohyoid|sternohyoid|thyrohyoid|scalen|splenius|erector spinae|multifidus|quadratus|opponens/],
  ['ligament', /ligament|joint capsule|articular capsule|menisc|labrum|retinacul/],
  ['cartilage', /cartilag|intervertebral dis[ck]|articular dis[ck]|epiglott/],
  ['bone', /bone|osse|vertebra|skull|crani|\bribs?\b|sternum|femur|tibia|fibula|humerus|radius|ulna|patella|pelvi|sacrum|coccyx|clavicle|scapula|mandible|maxilla|phalan|metacarp|metatars|carpal|tarsal|calcane|talus|navicular|cuneiform|cuboid|scaphoid|lunate|triquetr|pisiform|trapezium|trapezoid|capitate|hamate|tooth|teeth|molar|incisor|canine|premolar|hyoid|skelet|ossicle|malleus|incus|stapes|ethmoid|sphenoid|occipital bone|parietal bone|temporal bone|frontal bone|zygomat|nasal bone|lacrimal bone|vomer|palatine bone|\batlas\b|\baxis\b/],
];

function classifyName(name) {
  const s = String(name || '').toLowerCase();
  for (const [cat, re] of RULES) if (re.test(s)) return cat;
  return null;
}

// names: ordered from most specific (the structure itself) to most general.
function classify(names) {
  for (const n of names) {
    const c = classifyName(n);
    if (c) return c;
  }
  return 'organ';
}

module.exports = { CATEGORIES, classify, classifyName };
