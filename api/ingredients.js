// Serverless function: receives a photo, asks the AI which ingredients it can see.
// The photo is only sent to the AI for this one request. It is not stored by this app.

import { AiError, NO_KEY_MESSAGE, askAi, extractJson, pickProvider, readBody } from "./_lib.js";

const SYSTEM_PROMPT = `You identify food ingredients in photos for a cooking app used by students in the Philippines.

Rules:
- List only edible food items and ingredients you can actually see: fresh produce, eggs, meat, fish, rice, noodles, canned or packaged food, bread, condiments.
- Use short, common names that a person would type (for example "egg", "canned sardines", "cabbage", "soy sauce"). Use English names, but keep Filipino names where they are the common name (for example "kangkong", "calamansi", "bagoong").
- Do not guess items that are hidden, blurry, or not clearly visible. Do not list containers, utensils, or non-food objects.
- List at most 20 items, without duplicates.
- If you cannot see any food, return an empty list and a short friendly note asking for a clearer photo.

Respond with ONLY valid JSON, no markdown, in exactly this shape:
{"ingredients": ["item", "item"], "note": "optional short note, or empty string"}`;

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_BASE64_LENGTH = 4_000_000; // roughly 3 MB of image data

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Use POST." });
  }

  const body = readBody(req);
  if (!body) return res.status(400).json({ error: "Bad request." });

  // Accept either a data URL ("data:image/jpeg;base64,....") or separate fields.
  let mimeType = String(body.mimeType || "");
  let data = String(body.image || "");
  const match = data.match(/^data:([\w/+.-]+);base64,(.*)$/s);
  if (match) {
    mimeType = match[1];
    data = match[2];
  }

  if (!data) return res.status(400).json({ error: "No photo received." });
  if (!ALLOWED_TYPES.includes(mimeType)) {
    return res.status(400).json({ error: "Please use a JPG, PNG, or WebP photo." });
  }
  if (data.length > MAX_BASE64_LENGTH) {
    return res.status(413).json({ error: "That photo is too large. Try a smaller one." });
  }

  const provider = pickProvider();
  if (!provider) return res.status(500).json({ error: NO_KEY_MESSAGE });

  try {
    const text = await askAi(provider, SYSTEM_PROMPT, "What food ingredients can you see in this photo?", {
      mimeType,
      data
    });
    const parsed = extractJson(text);
    const ingredients = Array.isArray(parsed.ingredients)
      ? [...new Set(parsed.ingredients.map((i) => String(i).trim()).filter(Boolean))].slice(0, 20)
      : [];
    return res.status(200).json({
      ingredients,
      note: typeof parsed.note === "string" ? parsed.note : "",
      provider
    });
  } catch (err) {
    if (err instanceof AiError) return res.status(err.status).json({ error: err.friendly });
    console.error("ingredients handler failed:", err);
    return res.status(500).json({ error: "Couldn't read that photo. Please try again." });
  }
}
