const RULES = {
  'Électronique': { rate: 0.2, floor: 0.15 },
  'Informatique': { rate: 0.22, floor: 0.15 },
  'Électroménager': { rate: 0.12, floor: 0.2 },
  'Mobilier': { rate: 0.08, floor: 0.4 },
  'Vêtements & accessoires': { rate: 0.3, floor: 0.1 },
  'Bijoux & montres': { rate: 0, floor: 1 },
  'Sport & loisirs': { rate: 0.15, floor: 0.2 },
  'Musique': { rate: 0.05, floor: 0.6 },
  'Art & décoration': { rate: 0, floor: 1 },
  'Outils': { rate: 0.08, floor: 0.4 },
  'Autre': { rate: 0.15, floor: 0.2 }
};

function ageInYears(item) {
  const reference = item.purchaseDate || (item.createdAt || '').slice(0, 10);
  if (!reference) return 0;
  const then = new Date(reference);
  if (Number.isNaN(then.getTime())) return 0;
  const years = (Date.now() - then.getTime()) / (365.25 * 24 * 3600 * 1000);
  return Math.max(0, years);
}

export function estimateValue(item) {
  if (typeof item.price !== 'number' || Number.isNaN(item.price)) return null;
  const rule = RULES[item.category] || RULES['Autre'];
  const factor = Math.max(rule.floor, 1 - rule.rate * ageInYears(item));
  return Math.round(item.price * factor);
}

export function estimateExplanation(item, value) {
  if (value === null) return 'Renseignez un prix d’achat pour obtenir une estimation.';
  const rule = RULES[item.category] || RULES['Autre'];
  const years = Math.floor(ageInYears(item));
  if (rule.rate === 0) return `${item.category} : conservé à la valeur d’achat.`;
  return `Décote ${Math.round(rule.rate * 100)} %/an depuis ${years} an(s), valeur minimale ${Math.round(rule.floor * 100)} % de l’achat.`;
}
