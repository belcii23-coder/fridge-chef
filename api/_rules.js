// Food rules shared by the recipe function: pantry matching and dietary checks.
// (Files starting with "_" are not exposed as web endpoints on Vercel.)

export const DIET_OPTIONS = ["No pork", "Halal", "Vegetarian", "No seafood", "No beef", "No eggs", "No peanuts", "No dairy"];

/* ---------- name matching (English + common Filipino names) ---------- */

const strip = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// Order matters: longer phrases first.
const SYNONYMS = [
  [/\bdahon ng laurel\b|\blaurel\b|\bbay leaves\b|\bbay leaf\b/g, "bay leaf"],
  [/\bcooking oil\b|\bvegetable oil\b|\bmantika\b|\bcanola oil\b|\bcorn oil\b/g, "oil"],
  [/\bblack pepper\b|\bground pepper\b|\bground black pepper\b|\bpeppercorns?\b|\bpaminta\b/g, "pepper"],
  [/\bsoy sauce\b|\btoyo\b|\bsoya sauce\b/g, "soy sauce"],
  [/\bfish sauce\b|\bpatis\b/g, "fish sauce"],
  [/\bcane vinegar\b|\bwhite vinegar\b|\bsukang\b|\bsuka\b|\bvinegar\b/g, "vinegar"],
  [/\bsalt\b|\basin\b|\brock salt\b/g, "salt"],
  [/\bbrown sugar\b|\bwhite sugar\b|\basukal\b|\bsugar\b/g, "sugar"],
  [/\bgarlic cloves?\b|\bminced garlic\b|\bbawang\b|\bgarlic\b/g, "garlic"],
  [/\bsibuyas\b|\bred onions?\b|\bwhite onions?\b|\bonions?\b/g, "onion"],
  [/\bluya\b|\bginger\b/g, "ginger"],
  [/\bkamatis\b|\btomatoes\b|\btomato\b/g, "tomato"],
  [/\bkalamansi\b|\bcalamansi\b/g, "calamansi"],
  [/\bitlog\b|\beggs\b|\begg\b/g, "egg"],
  [/\bmanok\b/g, "chicken"],
  [/\bbaboy\b/g, "pork"],
  [/\bbaka\b/g, "beef"],
  [/\bkanin\b|\bsteamed rice\b|\bcooked rice\b|\bleftover rice\b|\bwhite rice\b|\bbigas\b/g, "rice"]
];

export function canon(name) {
  let s = strip(name);
  // drop amounts like "2 tbsp", "1/2 tsp"
  s = s.replace(/\b\d+([/.]\d+)?\s*(tbsp|tsp|cups?|pcs?|pieces?|cloves?|g|kg|ml|l)?\b/g, " ").replace(/\s+/g, " ").trim();
  for (const [re, to] of SYNONYMS) s = s.replace(re, to);
  return s.replace(/\s+/g, " ").trim();
}

const hasWord = (haystack, needle) => needle && new RegExp(`(^|\\s)${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`).test(haystack);

/** True if an ingredient is something the person always keeps at home. */
export function isInPantry(ingredientName, pantry) {
  const c = canon(ingredientName);
  if (!c) return false;
  // Tap water is free and always there, so it never goes on a shopping list.
  if (/^((cooking|tap|plain|warm|hot|cold|boiling|clean) )?water$/.test(c)) return true;
  return (pantry || []).some((p) => {
    const pc = canon(p);
    return pc && (c === pc || hasWord(c, pc));
  });
}

/* ---------- dietary checks (a safety net on top of what the AI was told) ---------- */

const list = (words) => new RegExp(`\\b(${words.join("|")})\\b`, "i");

const PORK = ["pork", "baboy", "bacon", "ham", "lechon", "chorizo", "longganisa", "tocino", "sisig", "bagnet", "chicharon", "lard", "spam", "liempo", "hotdogs?", "hot dogs?", "sausages?", "luncheon meat", "pata", "bola-bola", "lumpiang shanghai", "pork belly"];
const BEEF = ["beef", "baka", "corned beef", "bistek", "bulalo", "beef tapa", "tapa", "kare-kare"];
const POULTRY = ["chicken", "manok", "turkey", "duck", "itik", "quail", "meat", "ground meat", "lamb", "goat", "kambing", "carabao"];
const SEAFOOD = ["fish", "isda", "tuna", "sardines?", "sardinas", "bangus", "milkfish", "tilapia", "galunggong", "tuyo", "daing", "dilis", "anchov(y|ies)", "shrimps?", "hipon", "prawns?", "squid", "pusit", "crabs?", "alimango", "alimasag", "mussels?", "tahong", "oysters?", "talaba", "clams?", "halaan", "seafood", "salmon", "tinapa", "fish sauce", "patis", "bagoong", "shrimp paste", "oyster sauce", "fish balls?", "kikiam", "dried fish"];
const ALCOHOL = ["wine", "beer", "rum", "brandy", "gin", "vodka", "whiskey", "whisky", "sake", "mirin", "alcohol", "lambanog", "liquor", "cooking wine", "tuba"];
const GELATIN = ["gelatin", "lard"];
const BROTH_CUBES = ["(chicken|beef|pork|meat|fish|shrimp) (cube|cubes|broth|stock|bouillon|powder)"];
const EGGS = ["eggs?", "itlog", "salted eggs?", "quail eggs?", "mayonnaise", "mayo"];
const PEANUTS = ["peanuts?", "mani", "peanut butter", "satay", "kare-kare"];
const DAIRY = ["milk", "gatas", "cheese", "keso", "butter", "cream", "yogurt", "evaporated milk", "condensed milk", "whey", "ghee", "cheddar", "mozzarella", "queso de bola"];

const RULES = {
  "No pork": [list(PORK)],
  Halal: [list(PORK), list(ALCOHOL), list(GELATIN)],
  Vegetarian: [list(PORK), list(BEEF), list(POULTRY), list(SEAFOOD), list(GELATIN), list(BROTH_CUBES)],
  "No seafood": [list(SEAFOOD)],
  "No beef": [list(BEEF), list(["beef (cube|broth|stock)"])],
  "No eggs": [list(EGGS)],
  "No peanuts": [list(PEANUTS)],
  "No dairy": [list(DAIRY)]
};

// Phrases that contain a dairy/nut word but are not dairy/nut-free problems.
const SAFE_PHRASES = /coconut (milk|cream)|peanut butter|cocoa butter|shea butter|almond milk|soy milk|oat milk|rice milk|cream of tartar|butterfly/gi;

/** Returns the diet rules a recipe breaks, e.g. ["No pork (pork belly)"]. Empty = looks fine. */
export function dietViolations(recipe, diets) {
  const active = (diets || []).filter((d) => RULES[d]);
  if (!active.length) return [];

  const parts = [recipe.name, ...(recipe.ingredients || []).map((i) => i.name), ...(recipe.steps || [])];
  const text = parts.join(" | ").toLowerCase();

  const found = [];
  for (const diet of active) {
    // "peanut butter" must still count for No peanuts, so only strip safe phrases for other rules
    const haystack = diet === "No peanuts" ? text : text.replace(SAFE_PHRASES, " ");
    for (const re of RULES[diet]) {
      const m = haystack.match(re);
      if (m) {
        found.push(`${diet} (${m[0]})`);
        break;
      }
    }
  }
  return found;
}
