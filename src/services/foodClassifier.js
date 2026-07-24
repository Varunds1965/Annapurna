/**
 * Food Classifier — infers a category and allergen tags for a menu item
 * from its name, description, and ingredient list.
 *
 * This is a deliberately simple, dependency-free keyword classifier
 * (no external API calls, no network needed) so it runs instantly on
 * every menu item save. It's tuned for Indian home-kitchen menus but the
 * keyword lists are easy to extend.
 */

// Checked in order — first category whose keywords match wins.
const CATEGORY_RULES = [
  { category: 'Desserts & Sweets', keywords: ['halwa', 'kheer', 'payasam', 'gulab jamun', 'jamun', 'rasgulla', 'ladoo', 'laddu', 'barfi', 'jalebi', 'ice cream', 'kulfi', 'cake', 'pudding', 'dessert', 'sweet', 'payasa', 'halwa'] },
  { category: 'Beverages', keywords: ['juice', 'lassi', 'chai', 'coffee', 'buttermilk', 'milkshake', 'smoothie', 'drink', 'tea', 'sharbat', 'sherbet'] },
  { category: 'Dosa, Idli & Tiffin', keywords: ['dosa', 'idli', 'idly', 'uttapam', 'uthappam', 'vada', 'upma', 'pongal', 'appam', 'pesarattu'] },
  { category: 'Breads & Rotis', keywords: ['roti', 'naan', 'paratha', 'parata', 'chapati', 'chapathi', 'puri', 'poori', 'kulcha', 'bhatura', 'bhature'] },
  { category: 'Rice & Biryani', keywords: ['biryani', 'biriyani', 'pulao', 'pilaf', 'khichdi', 'khichri', 'curd rice', 'lemon rice', 'fried rice', 'jeera rice', 'rice'] },
  { category: 'Soups & Rasam', keywords: ['soup', 'rasam', 'shorba'] },
  { category: 'Salads & Raitas', keywords: ['salad', 'raita', 'kachumber'] },
  { category: 'Snacks & Starters', keywords: ['pakora', 'pakoda', 'samosa', 'tikka', 'cutlet', 'chaat', 'bhaji', 'bajji', 'fritter', 'snack', 'starter', 'kebab', 'roll', 'bonda', 'vada pav'] },
  { category: 'Curries & Gravies', keywords: ['curry', 'gravy', 'masala', 'dal', 'daal', 'sabzi', 'sabji', 'kurma', 'korma', 'kootu', 'poriyal'] },
];

const ALLERGEN_RULES = [
  { allergen: 'Dairy', keywords: ['milk', 'curd', 'yogurt', 'yoghurt', 'paneer', 'ghee', 'butter', 'cream', 'cheese', 'khoya', 'mawa'] },
  { allergen: 'Gluten', keywords: ['wheat', 'maida', 'atta', 'flour', 'semolina', 'rava', 'suji', 'bread', 'naan', 'roti', 'vermicelli'] },
  { allergen: 'Nuts', keywords: ['cashew', 'almond', 'peanut', 'pista', 'pistachio', 'walnut', 'groundnut', 'nut'] },
  { allergen: 'Soy', keywords: ['soy', 'soya', 'tofu'] },
  { allergen: 'Egg', keywords: ['egg', 'mayonnaise', 'mayo'] },
  { allergen: 'Sesame', keywords: ['sesame', 'til', 'gingelly'] },
];

function normalize(name, description, ingredients) {
  const parts = [name || '', description || '', ...(Array.isArray(ingredients) ? ingredients : [])];
  return parts.join(' ').toLowerCase();
}

// Word-boundary match so "steamed" doesn't false-match "tea", "meaty" doesn't
// match "eat", etc. Multi-word keywords (e.g. "curd rice") match as a phrase.
function containsKeyword(text, keyword) {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`).test(text);
}

/**
 * classifyFood
 * @param {string} name
 * @param {string} description
 * @param {string[]} ingredients
 * @returns {{ category: string, allergens: string[] }}
 */
function classifyFood(name, description, ingredients) {
  const text = normalize(name, description, ingredients);

  let category = 'Other';
  for (const rule of CATEGORY_RULES) {
    if (rule.keywords.some(kw => containsKeyword(text, kw))) {
      category = rule.category;
      break;
    }
  }

  const allergens = ALLERGEN_RULES
    .filter(rule => rule.keywords.some(kw => containsKeyword(text, kw)))
    .map(rule => rule.allergen);

  return { category, allergens };
}

module.exports = { classifyFood };
