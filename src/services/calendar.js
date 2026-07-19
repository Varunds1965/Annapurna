/**
 * Kitchen Prep Calendar — Fully self-contained
 * Stores prep schedule in the database. No external API needed.
 * When an order is placed, prep slots are calculated and stored.
 * The kitchen + admin dashboards display these as a calendar view.
 */

const { pool } = require('../db/pool');

const MEAL_SLOTS = {
  Breakfast: { label: 'Breakfast', startHour: 5, endHour: 9, color: '#D9A441' },
  Lunch:     { label: 'Lunch',     startHour: 9, endHour: 14, color: '#6B8F5C' },
  Dinner:    { label: 'Dinner',    startHour: 15, endHour: 20, color: '#C24A3B' },
};

const PREP_BUFFER_MINUTES = 120; // 2 hours prep

/**
 * Calculate when prep should start for a given meal on the order's day
 */
function calcPrepWindow(orderPlacedAt, mealSlot) {
  const placed = new Date(orderPlacedAt);
  const slot = MEAL_SLOTS[mealSlot];
  if (!slot) return null;

  // Prep starts at the beginning of the meal window minus prep buffer
  const prepStart = new Date(placed);
  prepStart.setHours(slot.startHour - 2, 0, 0, 0); // 2 hours before meal window

  // If order was placed after prep should have started, start ASAP
  if (prepStart < placed) {
    prepStart.setTime(placed.getTime());
  }

  const prepEnd = new Date(prepStart.getTime() + PREP_BUFFER_MINUTES * 60000);
  const mealStart = new Date(placed);
  mealStart.setHours(slot.startHour, 0, 0, 0);
  const mealEnd = new Date(placed);
  mealEnd.setHours(slot.endHour, 0, 0, 0);

  return { prepStart, prepEnd, mealStart, mealEnd };
}

/**
 * Create a prep calendar event in the database
 * Returns the event ID
 */
async function blockMealPrepSlot(order, mealSlot, startTime) {
  if (!order || !mealSlot) return null;
  
  const window = calcPrepWindow(order.placedAt || order.placed_at || new Date(), mealSlot);
  if (!window) return null;

  const itemsByMeal = order.itemsByMeal || order.items_by_meal || {};
  const items = itemsByMeal[mealSlot] || [];
  const totalQty = items.reduce((s, i) => s + (i.qty || 0), 0);
  if (totalQty === 0) return null;

  try {
    const result = await pool.query(
      `INSERT INTO kitchen_schedule (kitchen_id, order_id, meal_slot, blocked_from, blocked_until)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [order.kitchenId || order.kitchen_id || 'home-kitchen', order.id, mealSlot, window.prepStart.toISOString(), window.prepEnd.toISOString()]
    );
    console.log(`📅 Prep slot created for ${mealSlot} (ID: ${result.rows[0].id})`);
    return `local_${result.rows[0].id}`;
  } catch (err) {
    console.error('Failed to create prep slot:', err.message);
    return null;
  }
}

/**
 * Update prep slot status (mark as done/cancelled)
 */
async function updateEventStatus(eventId, newStatus) {
  if (!eventId || !eventId.startsWith('local_')) return;
  
  const id = parseInt(eventId.replace('local_', ''), 10);
  try {
    await pool.query(
      `UPDATE kitchen_schedule SET notes = COALESCE(notes || ', ', '') || $1 WHERE id = $2`,
      [`Status: ${newStatus} at ${new Date().toISOString()}`, id]
    );
    console.log(`📅 Prep slot ${eventId} updated to ${newStatus}`);
  } catch (err) {
    console.error('Failed to update prep slot:', err.message);
  }
}

/**
 * Get upcoming prep slots from the database
 */
async function getUpcomingPrepSlots(fromDate, toDate) {
  try {
    const result = await pool.query(
      `SELECT ks.*, o.customer_name, o.status as order_status
       FROM kitchen_schedule ks
       LEFT JOIN orders o ON ks.order_id = o.id
       WHERE ks.blocked_from >= $1 AND ks.blocked_from <= $2
       ORDER BY ks.blocked_from ASC`,
      [fromDate.toISOString(), toDate.toISOString()]
    );

    return result.rows.map(row => ({
      id: `local_${row.id}`,
      summary: `🍳 ${row.meal_slot} prep — ${row.customer_name || 'Unknown'}`,
      description: `Order: ${row.order_id}\nMeal: ${row.meal_slot}`,
      start: { dateTime: row.blocked_from.toISOString(), timeZone: 'Asia/Kolkata' },
      end: { dateTime: row.blocked_until.toISOString(), timeZone: 'Asia/Kolkata' },
      colorId: row.meal_slot === 'Breakfast' ? '5' : (row.meal_slot === 'Lunch' ? '10' : '3'),
      orderStatus: row.order_status,
      mealSlot: row.meal_slot,
      orderId: row.order_id,
    }));
  } catch (err) {
    console.error('Failed to get prep slots:', err.message);
    return [];
  }
}

/**
 * Get today's schedule summary for the dashboard
 */
async function getTodaySchedule() {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfDay = new Date(startOfDay.getTime() + 86400000);
  
  const events = await getUpcomingPrepSlots(startOfDay, endOfDay);
  
  const byMeal = { Breakfast: [], Lunch: [], Dinner: [] };
  events.forEach(e => {
    if (byMeal[e.mealSlot]) byMeal[e.mealSlot].push(e);
  });

  return {
    total: events.length,
    byMeal: Object.fromEntries(
      Object.entries(byMeal).map(([meal, evts]) => [meal, {
        count: evts.length,
        events: evts,
      }])
    ),
  };
}

module.exports = {
  blockMealPrepSlot,
  updateEventStatus,
  getUpcomingPrepSlots,
  getTodaySchedule,
  calcPrepWindow,
  MEAL_SLOTS,
};
