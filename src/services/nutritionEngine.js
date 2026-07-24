/**
 * Nutrition Engine
 *
 * Computes a customer's rough daily nutrient targets from their profile
 * (age, weight, height, gender, goal), boosts targets for any nutrient
 * they've flagged as a deficiency, and scores menu items by how well
 * they help close those gaps — while deprioritizing disliked foods.
 *
 * This is intentionally simple (standard RDA-style baselines, not a
 * clinical tool) — the goal is a genuinely useful "best fit for you"
 * ranking, not medical-grade nutrition advice.
 */

const BASE_TARGETS = {
  // Reasonable adult daily baselines (mg/mcg as applicable)
  protein: 55,   // grams
  calcium: 1000, // mg
  iron: 18,      // mg
  vd: 15,        // mcg (Vitamin D)
  b12: 2.4,       // mcg
};

const GOAL_MULTIPLIERS = {
  weight_loss: { protein: 1.15, calories: 0.85 },
  weight_gain: { protein: 1.25, calories: 1.15 },
  muscle_gain: { protein: 1.4, calories: 1.1 },
  maintain: { protein: 1.0, calories: 1.0 },
};

/**
 * Rough calorie estimate (simplified Mifflin-St Jeor, no activity factor
 * beyond a flat "lightly active" multiplier — this is a ballpark, not a
 * clinical calculation).
 */
function estimateCalories({ age, weight, height, gender }) {
  if (!age || !weight || !height) return 2000; // sensible fallback
  const base = gender === 'female'
    ? (10 * weight) + (6.25 * height) - (5 * age) - 161
    : (10 * weight) + (6.25 * height) - (5 * age) + 5;
  return Math.round(base * 1.375); // lightly active
}

/**
 * @param {{age?, weight?, height?, gender?, goal?, deficiencies?: string[]}} profile
 * @returns {{calories, protein, calcium, iron, vd, b12}}
 */
function computeTargets(profile) {
  const goal = GOAL_MULTIPLIERS[profile.goal] || GOAL_MULTIPLIERS.maintain;
  const calories = Math.round(estimateCalories(profile) * goal.calories);

  const targets = {
    calories,
    protein: Math.round(BASE_TARGETS.protein * goal.protein),
    calcium: BASE_TARGETS.calcium,
    iron: BASE_TARGETS.iron,
    vd: BASE_TARGETS.vd,
    b12: BASE_TARGETS.b12,
  };

  // Deficiency → boost that nutrient's target by 1.3x, so items rich in
  // it score higher (mirrors the "dislike → nutrition boost" idea).
  const deficiencies = Array.isArray(profile.deficiencies) ? profile.deficiencies : [];
  const NUTRIENT_KEY_MAP = { Protein: 'protein', Calcium: 'calcium', Iron: 'iron', 'Vitamin D': 'vd', B12: 'b12' };
  deficiencies.forEach(d => {
    const key = NUTRIENT_KEY_MAP[d];
    if (key) targets[key] = Math.round(targets[key] * 1.3 * 100) / 100;
  });

  return targets;
}

/**
 * Score a single menu item against a customer's targets.
 * Higher score = better fit for what this customer currently needs.
 * Disliked-food matches are heavily deprioritized rather than hidden.
 *
 * @param {object} item - menu item row (cal, protein, calcium, iron, vd, b12, name, ingredients)
 * @param {object} targets - from computeTargets()
 * @param {string[]} dislikedFoods - free-text list of foods the customer dislikes
 * @returns {{score: number, disliked: boolean}}
 */
function scoreItem(item, targets, dislikedFoods = []) {
  const NUTRIENTS = ['protein', 'calcium', 'iron', 'vd', 'b12'];
  let score = 0;
  NUTRIENTS.forEach(key => {
    const target = targets[key] || 1;
    const amount = parseFloat(item[key]) || 0;
    // Contribution toward this meal's fair share (~35% of daily target per meal), capped so
    // one mega-dense item doesn't dominate the score.
    score += Math.min(amount / (target * 0.35), 1.5);
  });

  const text = `${item.name || ''} ${(item.ingredients || []).join(' ')}`.toLowerCase();
  const disliked = dislikedFoods.some(d => d.trim() && text.includes(d.trim().toLowerCase()));
  if (disliked) score *= 0.15;

  return { score: Math.round(score * 100) / 100, disliked };
}

module.exports = { computeTargets, scoreItem, estimateCalories };
