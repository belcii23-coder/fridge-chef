// Serverless function: receives ingredients, asks an AI for recipes, returns JSON.
// Your API key stays here on the server and never reaches the browser.

import { AiError, NO_KEY_MESSAGE, askAi, extractJson, pickProvider, readBody } from "./_lib.js";
import { DIET_OPTIONS, canon, dietViolations, isInPantry } from "./_rules.js";

function buildSystemPrompt(count) {
  return `You are Fridge Chef, a friendly cooking helper for students living on their own in the Philippines.
The user tells you what ingredients they have. Suggest simple, realistic dishes they can cook right now.

Rules:
- Suggest exactly ${count} dish${count === 1 ? "" : "es"}. The "recipes" array must always contain ${count} item${count === 1 ? "" : "s"}. Filipino dishes are the TOP PRIORITY: all ${count === 1 ? "the dish" : "dishes"} should be Filipino (home-style ulam, sabaw, ginisa, prito, nilaga and so on) whenever any Filipino dish can be made from the ingredients. Only suggest a non-Filipino dish if no Filipino dish is realistic, and then say so in the note.
- Think of the real, traditional Filipino dishes that these ingredients are known for FIRST, and use their authentic names and methods. Examples: minced pork + misua = "Misua with Bola-bola" (meatballs shaped from the minced pork with egg, onion and a little flour or breadcrumbs, simmered in broth with the misua added last); ground pork + eggs = "Giniling" or "Tortang Giniling"; sardines = "Ginisang Sardinas"; eggplant + egg = "Tortang Talong"; corned beef + potato = "Ginisang Corned Beef"; pork or chicken + soy sauce + vinegar = "Adobo". Always use the Filipino dish name, not an English description (write "Misua with Bola-bola", never "Misua Soup with Pork Balls"; "Tortang Talong", never "Eggplant Omelette"). Only fall back to a generic "soup" or "stir fry" when no classic dish fits.
- Rank by how few extra ingredients are needed. The best dish uses only what the user already has.
- Respect the budget (in Philippine pesos) for any extra ingredients the user would need to buy. If no budget is given, keep extras minimal.
- Respect the equipment limit. If they only have a rice cooker or one pot, do not require an oven or multiple pans.
- Use simple English. Taglish touches in dish names are fine (e.g. "Sinangag").
- If "Dietary rules" are given, they are STRICT. Never include a forbidden ingredient anywhere, including sauces, broth cubes, fish sauce, shrimp paste, oyster sauce, lard or alcohol. Halal means no pork, no alcohol, no lard or gelatin. Vegetarian means no meat, no fish or seafood, and no fish sauce, bagoong or oyster sauce.
- If "Do not suggest" dishes are given, suggest different dishes.

COMPLETE INGREDIENT LIST (very important):
- "ingredients" lists EVERYTHING the dish needs, with a realistic amount for the stated servings, for example "2 cloves", "1 tbsp", "1/2 cup", "1 small can".
- A Filipino dish is not complete without its pampalasa. Always include the seasonings and condiments the real dish uses, such as salt, pepper, soy sauce (toyo), vinegar (suka), fish sauce (patis), garlic (bawang), onion (sibuyas), tomato (kamatis), ginger (luya), bay leaf (laurel), sugar, calamansi, cooking oil, cooking water or broth. Mark them with "kind": "pampalasa". Main foods (meat, vegetables, eggs, rice, noodles) are "kind": "main".
- "status" is "have" if the user listed it, "pantry" if it is in their Always-at-home list, otherwise "buy".
- For every "buy" item give "price_php", a rough price in pesos for just the amount needed (a whole small pack is fine, for example salt or soy sauce sachet around 5 to 10).
- Never leave seasonings out because they are "obvious". Do not say "season to taste" without naming the seasoning.

COMPLETE STEPS (very important):
- 5 to 9 short, beginner-friendly steps in the right cooking order.
- Every ingredient in the list must appear in a step, and each pampalasa must be added in a step with its amount and when to add it (for example "Add 2 tbsp soy sauce and 1/4 cup vinegar. Do not stir until it boils.").
- Use the real Filipino technique where it applies: gisa (sauté garlic, onion, tomato in oil), simmering until tender, and so on.
- The last cooking step must be a taste check ("Tikman: add a pinch of salt, pepper or sugar if needed") before serving.

OTHER FIELDS:
- "substitutions" gives 0 to 2 short tips like "No vinegar? Use calamansi juice."
- "photo_query" is the core dish only, as it would appear in a photo file name, 1 to 3 words, lowercase, with no side dishes or extras. Use the real Filipino or common name, for example "pork adobo", "tortang talong", "sinangag" (not "sinangag at hotdog"), "lechon kawali", "sinigang na baboy", "tapsilog".
- "photo_english" is another well-known name of the SAME dish (an English name or a popular nickname), 1 to 3 words, lowercase, used to find a photo, for example "garlic fried rice" for sinangag, "eggplant omelette" for tortang talong, "pork stew" for humba, "hotsilog" for sinangag with hotdog and egg. It must be a prepared dish, never a raw ingredient. Use an empty string if there is none.
- Know the silog family: tapsilog (tapa), longsilog (longganisa), tocilog (tocino), hotsilog (hotdog), spamsilog (spam), cornsilog (corned beef), bangsilog (bangus), dangsilog (daing). When a meal is garlic fried rice + egg + one of these, use the silog name as the dish name or as "photo_query".

Respond with ONLY valid JSON, no markdown, no commentary, in exactly this shape:
{
  "recipes": [
    {
      "name": "string",
      "photo_query": "core dish name for finding a photo",
      "photo_english": "English name of the same dish, or empty",
      "summary": "one short sentence",
      "time_minutes": 20,
      "difficulty": "Easy" | "Medium",
      "ingredients": [
        { "name": "pork belly", "amount": "250 g", "kind": "main", "status": "have", "price_php": 0 },
        { "name": "soy sauce", "amount": "3 tbsp", "kind": "pampalasa", "status": "pantry", "price_php": 0 },
        { "name": "bay leaf", "amount": "2 pcs", "kind": "pampalasa", "status": "buy", "price_php": 5 }
      ],
      "steps": ["step 1", "step 2"],
      "substitutions": ["optional tips"]
    }
  ],
  "note": "optional one-line friendly tip, or empty string"
}
If the input is not a list of food ingredients, return {"recipes": [], "note": "short friendly message asking for ingredients"}.`;
}

/* ---------- clean up whatever the AI returned ---------- */

const text = (v, max) => String(v ?? "").trim().slice(0, max);
const splitList = (v) => (Array.isArray(v) ? v : String(v || "").split(/[,\n]/)).map((s) => text(s, 60)).filter(Boolean);

function normalizeRecipe(raw, userList, pantry) {
  if (!raw || typeof raw !== "object") return null;
  const name = text(raw.name, 80);
  if (!name) return null;

  // Accept the new "ingredients" shape; fall back to the old uses/need_to_buy shape if that's all we got.
  let items = Array.isArray(raw.ingredients) ? raw.ingredients : null;
  if (!items) {
    items = [
      ...splitList(raw.uses).map((n) => ({ name: n, kind: "main", status: "have" })),
      ...splitList(raw.need_to_buy).map((n) => ({ name: n, kind: "main", status: "buy" }))
    ];
  }

  const seen = new Set();
  const ingredients = [];
  for (const it of items) {
    const o = typeof it === "string" ? { name: it } : it;
    const n = text(o?.name, 60);
    if (!n) continue;
    const key = canon(n) || n.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const kind = o.kind === "pampalasa" ? "pampalasa" : "main";
    let status = o.status === "have" || o.status === "pantry" ? o.status : "buy";
    // The server is the judge of pantry/have, so the AI can't tell people to buy salt they own.
    if (isInPantry(n, pantry)) status = "pantry";
    else if (userList.some((u) => u && (canon(u) === canon(n) || canon(n).split(" ").includes(canon(u))))) status = "have";
    else if (status === "pantry") status = "buy"; // the AI claimed pantry but it isn't in their list

    const price = status === "buy" ? Math.max(0, Math.min(Math.round(Number(o.price_php) || 0), 2000)) : 0;
    ingredients.push({ name: n, amount: text(o.amount, 30), kind, status, price_php: price });
  }

  const steps = (Array.isArray(raw.steps) ? raw.steps : []).map((s) => text(s, 400)).filter(Boolean).slice(0, 12);

  const buy = ingredients.filter((i) => i.status === "buy");
  return {
    name,
    photo_query: text(raw.photo_query, 40),
    photo_english: text(raw.photo_english, 40),
    summary: text(raw.summary, 200),
    time_minutes: Math.min(Math.max(parseInt(raw.time_minutes, 10) || 20, 1), 600),
    difficulty: raw.difficulty === "Medium" ? "Medium" : "Easy",
    ingredients,
    steps,
    substitutions: splitList(raw.substitutions).slice(0, 2),
    // kept for older screens and for the shopping list
    uses: ingredients.filter((i) => i.status !== "buy").map((i) => i.name),
    need_to_buy: buy.map((i) => i.name),
    estimated_extra_cost_php: buy.reduce((sum, i) => sum + i.price_php, 0)
  };
}

// A recipe is "complete" if it has real ingredients, real steps and its pampalasa.
function isComplete(r) {
  return r.ingredients.length >= 3 && r.steps.length >= 3 && r.ingredients.some((i) => i.kind === "pampalasa");
}

const sameDish = (a, b) => canon(a.name) === canon(b.name);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Use POST." });
  }

  const body = readBody(req);
  if (!body) return res.status(400).json({ error: "Bad request." });

  const ingredients = String(body.ingredients || "").trim().slice(0, 1000);
  const equipment = String(body.equipment || "Full kitchen (stove, pans, pots)").slice(0, 100);
  const budget = Number.isFinite(Number(body.budget)) && Number(body.budget) > 0 ? Number(body.budget) : null;
  const servings = Math.min(Math.max(parseInt(body.servings, 10) || 1, 1), 6);
  const count = Math.min(Math.max(parseInt(body.count, 10) || 3, 1), 3);
  const diet = (Array.isArray(body.diet) ? body.diet : []).filter((d) => DIET_OPTIONS.includes(d));
  const pantry = (Array.isArray(body.pantry) ? body.pantry : []).map((p) => text(p, 40)).filter(Boolean).slice(0, 40);
  const exclude = (Array.isArray(body.exclude) ? body.exclude : []).map((p) => text(p, 80)).filter(Boolean).slice(0, 30);

  if (!ingredients) {
    return res.status(400).json({ error: "Please enter at least one ingredient." });
  }

  const provider = pickProvider();
  if (!provider) return res.status(500).json({ error: NO_KEY_MESSAGE });

  const userList = ingredients.split(/[,\n]/).map((s) => canon(s)).filter(Boolean);
  const system = buildSystemPrompt(count);

  const baseMessage = [
    `Ingredients I have: ${ingredients}`,
    pantry.length ? `Always at home (free to use, never "buy"): ${pantry.join(", ")}` : null,
    diet.length ? `Dietary rules (strict): ${diet.join(", ")}` : null,
    exclude.length ? `Do not suggest these dishes: ${exclude.join(", ")}` : null,
    `Equipment: ${equipment}`,
    `Servings: ${servings}`,
    budget ? `Budget for extra ingredients: up to PHP ${budget}` : "Budget for extra ingredients: keep it minimal"
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const good = [];
    const backup = []; // dishes that pass the diet check but are missing steps or seasonings
    let feedback = "";
    let blocked = 0; // dishes thrown away for breaking a diet rule
    let lastNote = "";
    let gotAnyAnswer = false;

    for (let attempt = 0; attempt < 3 && good.length < count; attempt++) {
      let parsed;
      try {
        const known = [...exclude, ...good.map((g) => g.name)];
        const message =
          baseMessage +
          (attempt > 0 && known.length ? `\nAlready covered, suggest different dishes: ${known.join(", ")}` : "") +
          (attempt > 0 ? `\nYou need to give ${count - good.length} more dish${count - good.length === 1 ? "" : "es"}.` : "") +
          feedback;
        parsed = extractJson(await askAi(provider, system, message));
        if (!Array.isArray(parsed.recipes)) throw new Error("Missing recipes array");
      } catch (err) {
        if (gotAnyAnswer || good.length || backup.length) break; // keep what we have
        throw err;
      }
      gotAnyAnswer = true;
      if (typeof parsed.note === "string" && parsed.note.trim()) lastNote = parsed.note.trim().slice(0, 200);

      // The AI said the input isn't food.
      if (parsed.recipes.length === 0 && lastNote && attempt === 0) break;

      const problems = [];
      for (const raw of parsed.recipes) {
        const r = normalizeRecipe(raw, userList, pantry);
        if (!r) continue;
        if (good.some((g) => sameDish(g, r)) || exclude.some((e) => canon(e) === canon(r.name))) continue;

        const violations = dietViolations(r, diet);
        if (violations.length) {
          blocked++;
          problems.push(`"${r.name}" breaks the rules: ${violations.join(", ")}`);
          continue;
        }
        if (isComplete(r)) {
          if (good.length < count) good.push(r);
        } else if (!backup.some((b) => sameDish(b, r))) {
          backup.push(r);
          problems.push(`"${r.name}" was missing ingredients, pampalasa or steps`);
        }
      }
      feedback = problems.length ? `\nFix these problems from your last answer: ${problems.join("; ")}.` : "";
    }

    // Top up with incomplete-but-safe dishes only if we found nothing complete.
    const recipes = good.length ? good : backup.slice(0, count);

    let note = lastNote;
    if (!recipes.length && diet.length && blocked) {
      note = `I couldn't find a dish that fits ${diet.join(", ")} with those ingredients. Try adding more ingredients or loosening a filter.`;
    } else if (recipes.length && recipes.length < count && !note) {
      note = "I could only find some dishes that fit your ingredients and rules. Add a few more ingredients for more ideas.";
    }

    return res.status(200).json({ recipes, note, provider });
  } catch (err) {
    if (err instanceof AiError) return res.status(err.status).json({ error: err.friendly });
    console.error("recipes handler failed:", err);
    return res.status(500).json({ error: "Couldn't read the recipes. Please try again." });
  }
}
