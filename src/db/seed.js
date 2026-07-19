/**
 * Seed menu items into the database
 * Run: node src/db/seed.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { pool } = require('./pool');

const FOODS_BASIC = [
  { name:'Ragi dosa (2)', ingredients:['ragi flour','urad dal','curry leaves'], slots:['Breakfast'], price:40, cal:220, protein:6, fat:5, calcium:180, vd:0, b12:0, iron:2.5, tags:['ragi'], season:null },
  { name:'Moong dal + rice', ingredients:['moong dal','rice','turmeric','ghee'], slots:['Lunch','Dinner'], price:60, cal:320, protein:14, fat:6, calcium:60, vd:0, b12:0, iron:3.2, tags:['dal','rice'], season:null },
  { name:'Paneer bhurji', ingredients:['paneer','onion','tomato','capsicum'], slots:['Breakfast','Lunch','Dinner'], price:70, cal:260, protein:16, fat:18, calcium:300, vd:0.2, b12:0.3, iron:1.1, tags:['paneer','dairy'], season:null },
  { name:'Curd (1 cup)', ingredients:['fresh curd'], slots:['Breakfast','Lunch','Dinner'], price:20, cal:100, protein:6, fat:5, calcium:250, vd:0, b12:0.3, iron:0.1, tags:['dairy'], season:null },
  { name:'Spinach sabzi', ingredients:['spinach','garlic','onion'], slots:['Lunch','Dinner'], price:45, cal:120, protein:4, fat:6, calcium:150, vd:0, b12:0, iron:3.6, tags:['spinach'], season:null },
  { name:'Amla (2 pcs)', ingredients:['fresh amla'], slots:['Breakfast'], price:10, cal:20, protein:0.3, fat:0, calcium:12, vd:0, b12:0, iron:0.1, tags:['amla'], season:[10,11,12,1,2] },
  { name:'Milk (1 glass)', ingredients:['toned milk'], slots:['Breakfast','Dinner'], price:25, cal:150, protein:8, fat:8, calcium:280, vd:2.5, b12:1.1, iron:0.1, tags:['dairy'], season:null },
  { name:'Sprouts salad', ingredients:['moong sprouts','onion','lemon','coriander'], slots:['Breakfast','Lunch'], price:35, cal:110, protein:8, fat:2, calcium:40, vd:0, b12:0, iron:2.2, tags:['sprouts'], season:null },
  { name:'Banana', ingredients:['banana'], slots:['Breakfast'], price:10, cal:105, protein:1.3, fat:0.3, calcium:6, vd:0, b12:0, iron:0.3, tags:['banana'], season:null },
  { name:'Fortified cereal bowl', ingredients:['fortified wheat flakes','milk'], slots:['Breakfast'], price:45, cal:180, protein:5, fat:3, calcium:100, vd:3, b12:1.5, iron:4.0, tags:['cereal'], season:null },
  { name:'Ragi mudde + sambar', ingredients:['ragi','toor dal','mixed vegetables','tamarind'], slots:['Lunch','Dinner'], price:55, cal:280, protein:9, fat:5, calcium:200, vd:0, b12:0, iron:2.8, tags:['ragi'], season:null },
  { name:'Mixed nuts trail', ingredients:['almonds','walnuts','raisins'], slots:['Breakfast','Lunch'], price:50, cal:160, protein:4, fat:14, calcium:40, vd:0, b12:0, iron:1.0, tags:['nuts','almond'], season:null },
  { name:'Rajma curry', ingredients:['kidney beans','onion','tomato','garam masala'], slots:['Lunch','Dinner'], price:60, cal:230, protein:12, fat:4, calcium:50, vd:0, b12:0, iron:3.5, tags:['dal'], season:null },
  { name:'Mango bowl (seasonal)', ingredients:['fresh mango'], slots:['Breakfast','Lunch'], price:35, cal:90, protein:1, fat:0.5, calcium:15, vd:0, b12:0, iron:0.3, tags:['mango'], season:[4,5,6,7] },
  { name:'Jackfruit sabzi (seasonal)', ingredients:['raw jackfruit','coconut','mustard seeds'], slots:['Lunch','Dinner'], price:50, cal:150, protein:3, fat:6, calcium:40, vd:0, b12:0, iron:1.2, tags:['jackfruit'], season:[3,4,5,6,7] },
  { name:'Guava (2 pcs, seasonal)', ingredients:['fresh guava'], slots:['Breakfast'], price:20, cal:40, protein:1, fat:0.3, calcium:20, vd:0, b12:0, iron:0.3, tags:['guava'], season:[10,11,12,1,2] },
];

const FOODS_PREMIUM = [
  { name:'Avocado toast (multigrain)', ingredients:['avocado','multigrain bread','chili flakes'], slots:['Breakfast'], price:150, cal:280, protein:7, fat:16, calcium:40, vd:0, b12:0, iron:1.8, tags:['avocado'], season:null, prepExtra:30 },
  { name:'Kiwi + chia bowl', ingredients:['kiwi','chia seeds','honey'], slots:['Breakfast'], price:120, cal:180, protein:5, fat:6, calcium:80, vd:0, b12:0, iron:1.2, tags:['kiwi'], season:null, prepExtra:20 },
  { name:'Almond milk latte', ingredients:['almond milk','espresso'], slots:['Breakfast'], price:90, cal:90, protein:2, fat:4, calcium:180, vd:1, b12:0, iron:0.4, tags:['almond'], season:null, prepExtra:15 },
  { name:'Quinoa + roasted veg bowl', ingredients:['quinoa','zucchini','bell pepper','olive oil'], slots:['Lunch','Dinner'], price:160, cal:340, protein:12, fat:10, calcium:60, vd:0, b12:0, iron:3.0, tags:['quinoa'], season:null, prepExtra:30 },
  { name:'Blueberries (1 bowl)', ingredients:['imported blueberries'], slots:['Breakfast'], price:140, cal:85, protein:1, fat:0.5, calcium:9, vd:0, b12:0, iron:0.4, tags:['berries'], season:null, prepExtra:15 },
  { name:'Almonds (10)', ingredients:['almonds'], slots:['Breakfast','Lunch'], price:60, cal:70, protein:2.5, fat:6, calcium:30, vd:0, b12:0, iron:0.5, tags:['almond','nuts'], season:null, prepExtra:10 },
];

async function seed() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Clear existing menu items for home-kitchen
    await client.query("DELETE FROM menu_items WHERE kitchen_id = 'home-kitchen'");

    const insertSQL = `
      INSERT INTO menu_items (kitchen_id, name, ingredients, slots, price, cal, protein, fat, calcium, vd, b12, iron, tags, season, prep_extra_min, tier)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
    `;

    for (const item of [...FOODS_BASIC, ...FOODS_PREMIUM]) {
      await client.query(insertSQL, [
        'home-kitchen',
        item.name,
        item.ingredients,
        item.slots,
        item.price,
        item.cal || 0,
        item.protein || 0,
        item.fat || 0,
        item.calcium || 0,
        item.vd || 0,
        item.b12 || 0,
        item.iron || 0,
        item.tags || [],
        item.season || null,
        item.prepExtra || 0,
        item.prepExtra ? 'premium' : 'basic',
      ]);
    }

    await client.query('COMMIT');
    console.log(`✓ Seeded ${FOODS_BASIC.length + FOODS_PREMIUM.length} menu items for home-kitchen`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Seed failed:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
