import { pickProvider, AiError, friendlyFor, extractJson, callGemini, callClaude } from "./_ai.js";

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
const CLAUDE_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";

const SYSTEM_PROMPT = `You look at photos of a fridge, pantry, or food items and identify edible ingredients.

Rules:
- List only actual food ingredients you can clearly see. Skip packaging text, brand names, and non-food objects.
- Use short, common ingredient names (e.g. "egg", "onion", "corned beef"), not full product names.
- No duplicates, no quantities, no descriptions.
- If you cannot confidently identify any food ingredients, return an empty list.

Respond with ONLY valid JSON, no markdown, no commentary, in exactly this shape:
{ "ingredients": ["egg", "onion"] }`;

const MAX_IMAGES = 4;
const MAX_TOTAL_BASE64_CHARS = 15_000_000;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Use POST." });
  }

  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  } catch {
    return res.status(400).json({ error: "Bad request." });
  }

  const rawImages = Array.isArray(body.images) ? body.images.slice(0, MAX_IMAGES) : [];
  if (!rawImages.length) {
    return res.status(400).json({ error: "No photo received." });
  }

  const images = [];
  for (const raw of rawImages) {
    const match = typeof raw === "string" && /^data:(image\/[a-zA-Z+]+);base64,(.+)$/.exec(raw);
    if (match) images.push({ mimeType: match[1], data: match[2] });
  }
  if (!images.length) {
    return res.status(400).json({ error: "Couldn't read the photo." });
  }

  const totalChars = images.reduce((n, img) => n + img.data.length, 0);
  if (totalChars > MAX_TOTAL_BASE64_CHARS) {
    return res.status(400).json({ error: "Photos are too large. Try fewer or smaller photos." });
  }

  const provider = pickProvider();
  if (!provider) {
    return res.status(500).json({
      error: "No AI key found. Add GEMINI_API_KEY (free) or ANTHROPIC_API_KEY in your environment settings."
    });
  }

  try {
    const text =
      provider === "gemini"
        ? await callGemini(GEMINI_MODEL, SYSTEM_PROMPT, "List the ingredients you see.", images, 0.2)
        : await callClaude(CLAUDE_MODEL, SYSTEM_PROMPT, "List the ingredients you see.", images);
    const parsed = extractJson(text);
    const ingredients = Array.isArray(parsed.ingredients)
      ? parsed.ingredients.filter((s) => typeof s === "string" && s.trim()).map((s) => s.trim()).slice(0, 30)
      : [];
    return res.status(200).json({ ingredients });
  } catch (err) {
    if (err instanceof AiError) return res.status(err.status).json({ error: err.friendly });
    console.error("scan handler failed:", err);
    return res.status(500).json({ error: "Couldn't read the photo. Please try again." });
  }
}
