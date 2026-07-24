/**
 * AI Food Image Generation
 *
 * Generates a realistic photo of a menu item from its name, description,
 * ingredients, and category — used when a kitchen adds a dish without
 * uploading their own photo.
 *
 * Requires OPENAI_API_KEY in .env. This project has no other image-gen
 * credentials configured, so OpenAI's Images API (gpt-image-1) is used.
 * If you'd rather use a different provider (Stability, Replicate, Google),
 * only this file needs to change — everything else calls generateFoodImage().
 */
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

function buildPrompt({ name, description, ingredients, category }) {
  const ingredientPart = Array.isArray(ingredients) && ingredients.length
    ? ` Made with ${ingredients.slice(0, 8).join(', ')}.`
    : '';
  const categoryPart = category && category !== 'Other' ? ` A ${category.toLowerCase()} dish.` : '';
  const descPart = description ? ` ${description}.` : '';

  return (
    `Professional overhead food photography of "${name}", an Indian home-style dish.` +
    `${categoryPart}${descPart}${ingredientPart}` +
    ` Served on a simple ceramic plate or bowl, natural daylight, shallow depth of field, ` +
    `appetizing, realistic, high resolution restaurant menu photo. No text, no watermark, no people.`
  );
}

/**
 * @param {{name: string, description?: string, ingredients?: string[], category?: string}} item
 * @param {string} uploadDir - directory to save the generated image into
 * @returns {Promise<{success: true, filename: string} | {success: false, error: string}>}
 */
async function generateFoodImage(item, uploadDir) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return {
      success: false,
      error: 'OPENAI_API_KEY is not set in .env — AI photo generation is wired up but needs an API key to actually call the image model.',
    };
  }

  const prompt = buildPrompt(item);

  let response;
  try {
    response = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-image-1',
        prompt,
        size: '1024x1024',
        n: 1,
      }),
    });
  } catch (err) {
    return { success: false, error: `Could not reach the image generation API: ${err.message}` };
  }

  if (!response.ok) {
    let detail = '';
    try { detail = (await response.json()).error?.message || ''; } catch (e) { /* ignore */ }
    return { success: false, error: `Image generation failed (${response.status}): ${detail || response.statusText}` };
  }

  const data = await response.json();
  const b64 = data?.data?.[0]?.b64_json;
  if (!b64) {
    return { success: false, error: 'Image API returned no image data' };
  }

  if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
  const filename = `food_ai_${Date.now()}_${uuidv4().slice(0, 8)}.png`;
  fs.writeFileSync(path.join(uploadDir, filename), Buffer.from(b64, 'base64'));

  return { success: true, filename };
}

module.exports = { generateFoodImage, buildPrompt };
