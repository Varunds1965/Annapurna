/**
 * Discount Engine — Auto-applies the best available discount for a customer
 * Supports: festival offers, weekend specials, first-order, loyalty tiers, referral rewards
 */
const { pool } = require('../db/pool');

// Indian festival dates (can be extended)
const FESTIVALS = [
  { name: 'Diwali', month: 10, day: 31, discountPct: 25, minOrder: 300, maxDiscount: 150, code: 'DIWALI25' },
  { name: 'Holi', month: 3, day: 14, discountPct: 20, minOrder: 250, maxDiscount: 100, code: 'HOLI20' },
  { name: 'Pongal', month: 1, day: 15, discountPct: 15, minOrder: 200, maxDiscount: 75, code: 'PONGAL15' },
  { name: 'Republic Day', month: 1, day: 26, discountPct: 15, minOrder: 200, maxDiscount: 75, code: 'REPUBLIC15' },
  { name: 'Independence Day', month: 8, day: 15, discountPct: 15, minOrder: 200, maxDiscount: 75, code: 'INDIA15' },
  { name: 'Gandhi Jayanti', month: 10, day: 2, discountPct: 10, minOrder: 150, maxDiscount: 50, code: 'GANDHI10' },
  { name: 'New Year', month: 1, day: 1, discountPct: 20, minOrder: 250, maxDiscount: 100, code: 'NEWYEAR20' },
  { name: 'Christmas', month: 12, day: 25, discountPct: 20, minOrder: 250, maxDiscount: 100, code: 'XMAS20' },
  { name: 'Raksha Bandhan', month: 8, day: 9, discountPct: 15, minOrder: 200, maxDiscount: 75, code: 'RAKHI15' },
  { name: 'Eid', month: 3, day: 31, discountPct: 20, minOrder: 250, maxDiscount: 100, code: 'EID20' },
];

const WEEKEND_DISCOUNT = { pct: 10, minOrder: 200, maxDiscount: 50, code: 'WEEKEND10' };
const FIRST_ORDER_DISCOUNT = { pct: 50, minOrder: 100, maxDiscount: 75, code: 'WELCOME50' };
const LOYALTY_TIERS = [
  { name: 'Silver', minPoints: 0, discountPct: 5, maxDiscount: 30 },
  { name: 'Gold', minPoints: 500, discountPct: 10, maxDiscount: 75 },
  { name: 'Platinum', minPoints: 2000, discountPct: 15, maxDiscount: 150 },
];

/**
 * Get active festival offer for today
 */
function getActiveFestival() {
  const now = new Date();
  const today = { month: now.getMonth() + 1, day: now.getDate() };
  
  // Check if today is within ±2 days of any festival
  for (const f of FESTIVALS) {
    const festivalDate = new Date(now.getFullYear(), f.month - 1, f.day);
    const diffDays = Math.abs((now - festivalDate) / (1000 * 60 * 60 * 24));
    if (diffDays <= 2) {
      return {
        ...f,
        type: 'festival',
        label: `🎉 ${f.name} Special`,
        description: `Celebrate ${f.name} with ${f.discountPct}% off!`,
      };
    }
  }
  return null;
}

/**
 * Check if today is weekend
 */
function isWeekend() {
  const day = new Date().getDay();
  return day === 0 || day === 6; // Sunday or Saturday
}

/**
 * Get weekend offer if applicable
 */
function getWeekendOffer() {
  if (!isWeekend()) return null;
  return {
    ...WEEKEND_DISCOUNT,
    type: 'weekend',
    label: '🎉 Weekend Special',
    description: `${WEEKEND_DISCOUNT.pct}% off on weekends!`,
  };
}

/**
 * Check if customer is first-time
 */
async function isFirstTimeCustomer(customerId) {
  if (!customerId) return false;
  const result = await pool.query(
    'SELECT COUNT(*) as cnt FROM orders WHERE customer_id = $1',
    [customerId]
  );
  return parseInt(result.rows[0].cnt) === 0;
}

/**
 * Get first-order offer
 */
async function getFirstOrderOffer(customerId) {
  const isFirst = await isFirstTimeCustomer(customerId);
  if (!isFirst) return null;
  return {
    ...FIRST_ORDER_DISCOUNT,
    type: 'first_order',
    label: '🎉 First Order!',
    description: `${FIRST_ORDER_DISCOUNT.pct}% off your first order!`,
  };
}

/**
 * Get loyalty tier for a customer
 */
async function getLoyaltyTier(customerId) {
  if (!customerId) return null;
  const result = await pool.query(
    'SELECT loyalty_points FROM customers WHERE id = $1',
    [customerId]
  );
  if (result.rows.length === 0) return null;
  const points = parseInt(result.rows[0].loyalty_points) || 0;
  
  let tier = LOYALTY_TIERS[0];
  for (const t of LOYALTY_TIERS) {
    if (points >= t.minPoints) tier = t;
  }
  return { ...tier, points, type: 'loyalty', label: `⭐ ${tier.name} Member` };
}

/**
 * Calculate the best available discount for a customer
 * @param {number} customerId - Customer ID (optional for guest)
 * @param {number} orderTotal - Current cart total
 * @param {string} manualCouponCode - Manually entered coupon code (optional)
 * @returns {{ discount: number, appliedOffers: Array, finalTotal: number }}
 */
async function calculateBestDiscount(customerId, orderTotal, manualCouponCode = null) {
  const offers = [];
  let bestDiscount = 0;
  let bestOffer = null;

  // 1. Check festival offer
  const festival = getActiveFestival();
  if (festival && orderTotal >= festival.minOrder) {
    let disc = orderTotal * (festival.discountPct / 100);
    if (festival.maxDiscount) disc = Math.min(disc, festival.maxDiscount);
    offers.push({ ...festival, discount: Math.round(disc) });
    if (disc > bestDiscount) { bestDiscount = disc; bestOffer = festival; }
  }

  // 2. Check weekend offer
  const weekend = getWeekendOffer();
  if (weekend && orderTotal >= weekend.minOrder) {
    let disc = orderTotal * (weekend.pct / 100);
    if (weekend.maxDiscount) disc = Math.min(disc, weekend.maxDiscount);
    offers.push({ ...weekend, discount: Math.round(disc) });
    if (disc > bestDiscount) { bestDiscount = disc; bestOffer = weekend; }
  }

  // 3. Check first-order offer
  if (customerId) {
    const firstOrder = await getFirstOrderOffer(customerId);
    if (firstOrder && orderTotal >= firstOrder.minOrder) {
      let disc = orderTotal * (firstOrder.pct / 100);
      if (firstOrder.maxDiscount) disc = Math.min(disc, firstOrder.maxDiscount);
      offers.push({ ...firstOrder, discount: Math.round(disc) });
      if (disc > bestDiscount) { bestDiscount = disc; bestOffer = firstOrder; }
    }
  }

  // 4. Check loyalty tier
  if (customerId) {
    const loyalty = await getLoyaltyTier(customerId);
    if (loyalty && orderTotal > 0) {
      let disc = orderTotal * (loyalty.discountPct / 100);
      if (loyalty.maxDiscount) disc = Math.min(disc, loyalty.maxDiscount);
      offers.push({ ...loyalty, discount: Math.round(disc) });
      if (disc > bestDiscount) { bestDiscount = disc; bestOffer = loyalty; }
    }
  }

  // 5. Check manual coupon (if provided)
  if (manualCouponCode) {
    try {
      const { validateCoupon } = require('./couponValidator');
      const couponResult = await validateCoupon(manualCouponCode, orderTotal);
      if (couponResult.valid) {
        offers.push({ ...couponResult, type: 'coupon', label: `🏷️ ${manualCouponCode}`, discount: couponResult.discount });
        if (couponResult.discount > bestDiscount) {
          bestDiscount = couponResult.discount;
          bestOffer = { ...couponResult, type: 'coupon' };
        }
      }
    } catch (e) {
      // Invalid coupon, ignore
    }
  }

  const finalTotal = Math.max(0, orderTotal - bestDiscount);

  return {
    discount: Math.round(bestDiscount),
    appliedOffers: offers,
    bestOffer,
    finalTotal,
  };
}

/**
 * Get all active offers for display (homepage banners)
 */
async function getActiveOffers(customerId = null) {
  const offers = [];
  
  const festival = getActiveFestival();
  if (festival) offers.push({ type: 'festival', ...festival });
  
  const weekend = getWeekendOffer();
  if (weekend) offers.push({ type: 'weekend', ...weekend });
  
  if (customerId) {
    const firstOrder = await getFirstOrderOffer(customerId);
    if (firstOrder) offers.push({ type: 'first_order', ...firstOrder });
    
    const loyalty = await getLoyaltyTier(customerId);
    if (loyalty) offers.push({ type: 'loyalty', ...loyalty });
  }
  
  return offers;
}

module.exports = {
  calculateBestDiscount,
  getActiveOffers,
  getActiveFestival,
  getWeekendOffer,
  getFirstOrderOffer,
  getLoyaltyTier,
  FESTIVALS,
  LOYALTY_TIERS,
};