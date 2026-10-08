// Small helpers for ingredients, the pantry and the shopping list.
// The matching rules are shared with the server (api/_rules.js) so both sides agree.

import { DIET_OPTIONS, canon, isInPantry } from "../api/_rules.js";

export { DIET_OPTIONS, canon, isInPantry };

// Suggestions for the "always at home" list.
export const PANTRY_SUGGEST = ["Salt", "Cooking oil", "Soy sauce", "Vinegar", "Sugar", "Pepper", "Garlic", "Onion", "Fish sauce", "Rice"];

/** Old saved recipes only have "uses" and "need_to_buy". Give them an ingredients list too. */
export function ensureIngredients(r) {
  if (Array.isArray(r.ingredients)) return r;
  const have = (r.uses || []).map((name) => ({ name, amount: "", kind: "main", status: "have", price_php: 0 }));
  const buy = (r.need_to_buy || []).map((name) => ({ name, amount: "", kind: "main", status: "buy", price_php: 0 }));
  return { ...r, ingredients: [...have, ...buy] };
}

/** Re-checks every ingredient against the current pantry, so changing the pantry updates old recipes too. */
export function withStatus(r, pantry) {
  const base = ensureIngredients(r);
  const ingredients = base.ingredients.map((i) => {
    let status = i.status;
    if (isInPantry(i.name, pantry)) status = "pantry";
    else if (status === "pantry") status = "buy"; // removed from the pantry since
    const price = status === "buy" ? i.price_php || 5 : 0;
    return { ...i, status, price_php: price };
  });
  const buy = ingredients.filter((i) => i.status === "buy");
  return {
    ...base,
    ingredients,
    need_to_buy: buy.map((i) => i.name),
    estimated_extra_cost_php: buy.reduce((s, i) => s + i.price_php, 0)
  };
}

export const peso = (n) => `₱${Math.round(n).toLocaleString("en-PH")}`;
