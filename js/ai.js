const TFJS_URL = 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.20.0/dist/tf.min.js';
const MOBILENET_URL = 'https://cdn.jsdelivr.net/npm/@tensorflow-models/mobilenet@2.1.1/dist/mobilenet.min.js';

const CATEGORY_RULES = [
  ['Informatique', /laptop|notebook|computer|monitor|keyboard|printer|mouse|modem|screen|desktop/i],
  ['Électronique', /cellular telephone|mobile phone|smartphone|remote control|television|tv|ipod|mp3 player|loudspeaker|radio|camera|headphone|console|dvd|cd player|projector|videotape|home theater/i],
  ['Électroménager', /refrigerator|fridge|washer|microwave|toaster|dishwasher|stove|vacuum|mixer|blender|coffee maker|kettle|iron|sewing machine|waffle iron|espresso maker/i],
  ['Mobilier', /wardrobe|bookcase|bookshop|china cabinet|armoire|bench|rocking chair|folding chair|throne|studio couch|sofa|table lamp|desk|dresser|cradle|four-poster|couch|chair|table|chest|shelf|cabinet|stool|ottoman|bed|mirror/i],
  ['Musique', /guitar|electric guitar|acoustic guitar|piano|grand piano|upright|violin|fiddle|cello|harp|drum|accordion|banjo|harmonica|saxophone|organ|flute|trombone|trumpet/i],
  ['Bijoux & montres', /necklace|analog clock|digital watch|watch|ring|bracelet|brooch|ear|sunglasses|sunglass/i],
  ['Vêtements & accessoires', /jersey|sneaker|running shoe|shoe|sandal|loafer|bikini|swimming trunks|suit|gown|kimono|abaya|jean|diaper|cardigan|fur coat|poncho|raincoat|miniskirt|sock|tie|bow tie|backpack|handbag|purse|wallet|umbrella|hat|bonnet|cowboy hat|sombrero|helmet|mitten|scarf/i],
  ['Sport & loisirs', /bicycle|mountain bike|ball|racket|racquet|ski|skateboard|snowplow|snowmobile|paddle|canoe|kayak|surfboard|dumbbell|barbell|treadmill|ping-pong|trampoline|croquet|bobsled|tricycle|scooter/i],
  ['Art & décoration', /picture frame|painting|vase|lampshade|candle|candlestick|obelisk|statue|sculpture|trophy|plate|pitcher|punching bag|petrol pump/i],
  ['Outils', /hammer|screwdriver|drill|wrench|pliers|chain saw|power drill|shovel|pick|scissors|nail|tape|ladder|axe|spanner|lawn mower/i]
];

function loadScript(url) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-src="${url}"]`);
    if (existing) {
      if (existing.dataset.loaded === 'true') {
        resolve();
        return;
      }
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('Chargement IA impossible')));
      return;
    }
    const script = document.createElement('script');
    script.src = url;
    script.async = true;
    script.dataset.src = url;
    script.addEventListener('load', () => {
      script.dataset.loaded = 'true';
      resolve();
    });
    script.addEventListener('error', () => reject(new Error('Chargement IA impossible')));
    document.head.appendChild(script);
  });
}

let modelPromise = null;

export function aiAvailable() {
  return typeof window !== 'undefined' && navigator.onLine !== false;
}

export function loadModel() {
  if (!modelPromise) {
    modelPromise = (async () => {
      await loadScript(TFJS_URL);
      await loadScript(MOBILENET_URL);
      return window.mobilenet.load({ version: 2, alpha: 1.0 });
    })();
    modelPromise.catch(() => {
      modelPromise = null;
    });
  }
  return modelPromise;
}

function prettify(label) {
  const clean = label.split(',')[0].trim();
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

export function classifyPredictions(predictions) {
  for (const [category, pattern] of CATEGORY_RULES) {
    for (const prediction of predictions) {
      if (pattern.test(prediction.className)) {
        return {
          category,
          suggestion: prettify(prediction.className),
          confidence: prediction.probability
        };
      }
    }
  }
  const top = predictions[0];
  return {
    category: 'Autre',
    suggestion: top ? prettify(top.className) : '',
    confidence: top ? top.probability : 0
  };
}

export async function classifyPhoto(file) {
  const model = await loadModel();
  const bitmap = await createImageBitmap(file);
  try {
    const predictions = await model.classify(bitmap, 5);
    return classifyPredictions(predictions);
  } finally {
    bitmap.close();
  }
}
