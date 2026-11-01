import { pickProvider, AiError, friendlyFor, extractJson, callGemini, callClaude } from "./_ai.js";

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
const CLAUDE_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";

const SYSTEM_PROMPT = `You are Fridge Chef, a friendly cooking helper for students living on their own in the Philippines.
The user tells you what ingredients they have. Suggest simple, realistic dishes they can cook right now.

Rules:
- Suggest exactly 3 dishes. Prefer Filipino dishes and home-style cooking, but other cuisines are fine if they fit the ingredients better.
- Rank by how few extra ingredients are needed. The best dish uses only what the user already has.
- Do not assume salt, oil, soy sauce, or garlic unless the user listed them; if a dish needs them, put them in "need_to_buy" (they are cheap).
- Respect the budget (in Philippine pesos) for any extra ingredients the user would need to buy. If no budget is given, keep extras minimal.
- Respect the equipment limit. If they only have a rice cooker or one pot, do not require an oven or multiple pans.
- Keep steps short, clear, and beginner-friendly (4 to 8 steps).
- Use simple English. Taglish touches in dish names are fine (e.g. "Sinangag").
- "estimated_extra_cost_php" is the rough cost in pesos of only the ingredients in "need_to_buy" (0 if none).
- "substitutions" gives 0 to 2 short tips like "No vinegar? Use calamansi juice."

Respond with ONLY valid JSON, no markdown, no commentary, in exactly this shape:
{
  "recipes": [
    {
      "name": "string",
      "summary": "one short sentence",
      "time_minutes": 20,
      "difficulty": "Easy" | "Medium",
      "uses": ["ingredients from the user's list"],
      "need_to_buy": ["extra ingredients, empty array if none"],
      "estimated_extra_cost_php": 0,
      "steps": ["step 1", "step 2"],
      "substitutions": ["optional tips"]
    }
  ],
  "note": "optional one-line friendly tip, or empty string"
}
If the input is not a list of food ingredients, return {"recipes": [], "note": "short friendly message asking for ingredients"}.`;

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

  const ingredients = String(body.ingredients || "").trim().slice(0, 1000);
  const equipment = String(body.equipment || "Full kitchen (stove, pans, pots)").slice(0, 100);
  const budget = Number.isFinite(Number(body.budget)) && Number(body.budget) > 0 ? Number(body.budget) : null;
  const servings = Math.min(Math.max(parseInt(body.servings, 10) || 1, 1), 6);
  const avoid = Array.isArray(body.avoid)
    ? body.avoid.map((s) => String(s).slice(0, 80)).filter(Boolean).slice(0, 30)
    : [];

  if (!ingredients) {
    return res.status(400).json({ error: "Please enter at least one ingredient." });
  }

  const provider = pickProvider();
  if (!provider) {
    return res.status(500).json({
      error: "No AI key found. Add GEMINI_API_KEY (free) or ANTHROPIC_API_KEY in your environment settings."
    });
  }

  const userMessage = [
    `Ingredients I have: ${ingredients}`,
    `Equipment: ${equipment}`,
    `Servings: ${servings}`,
    budget ? `Budget for extra ingredients: up to PHP ${budget}` : "Budget for extra ingredients: keep it minimal",
    ...(avoid.length
      ? [`Already suggested, so give 3 different dishes and do not repeat or lightly rename any of these: ${avoid.join("; ")}`]
      : [])
  ].join("\n");

  try {
    const text =
      provider === "gemini"
        ? await callGemini(GEMINI_MODEL, SYSTEM_PROMPT, userMessage)
        : await callClaude(CLAUDE_MODEL, SYSTEM_PROMPT, userMessage);
    const parsed = extractJson(text);
    if (!Array.isArray(parsed.recipes)) throw new Error("Missing recipes array");
    return res.status(200).json(parsed);
  } catch (err) {
    if (err instanceof AiError) return res.status(err.status).json({ error: err.friendly });
    console.error("recipes handler failed:", err);
    return res.status(500).json({ error: "Couldn't read the recipes. Please try again." });
  }
}
