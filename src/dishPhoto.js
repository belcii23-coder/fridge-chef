// Finds a real photo of a dish on Wikimedia Commons (free, no API key).
//
// Commons is the photo library behind Wikipedia. It has many user-uploaded photos of
// Filipino dishes, named like "Chicken adobo.jpg" or "Tortang Talong 2019.jpg".
// We search the photo file names, pick the best-matching one, and credit the author.
//
// For each recipe we try these searches in order and stop at the first good match:
//   1. photo_query    - the dish's specific name, suggested by the AI (e.g. "pork adobo")
//   2. the recipe name
//
// A photo is only used when its file name closely matches the dish name. There is no "similar dish"
// fallback any more, because it was often wrong (an omelette showing a pork cutlet).
// If nothing matches well, the app shows a plate icon, and the person can add their own photo.

const CACHE_KEY = "fc.photos.v3"; // v3: stricter matching, so older loose matches are not reused
const memory = new Map(); // query -> Promise<photo|null> (this session)

function readCache() {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) || "{}");
  } catch {
    return {};
  }
}

function writeCache(query, photo) {
  try {
    const cache = readCache();
    cache[query] = photo;
    const keys = Object.keys(cache);
    if (keys.length > 120) for (const k of keys.slice(0, keys.length - 120)) delete cache[k];
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    /* storage can be blocked; photos still work for this session */
  }
}

const norm = (s) => String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

// Words that don't help tell dishes apart.
// Month names and "meal" show up in file names ("Pork Silog, May 2025") but say nothing about the dish.
const FILLER = new Set(["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december", "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec", "meal", "photo", "image", "combo", "special", "version", "filipino", "philippine", "philippines", "style", "recipe", "with", "and", "the", "dish", "food", "homemade"]);
const words = (s) =>
  norm(s)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !FILLER.has(w) && !/^\d+$/.test(w)); // ignore years and numbers

// How well a file name matches the search.
//   ratio: the share of search words found in the title (all of them for short names, 3/4 for longer ones)
//   rank:  ratio, minus a small penalty for extra unrelated words, so
//          "Chicken adobo" beats "Chicken adobo, grape custard, fruits and wine"
function matchScore(query, title) {
  const q = words(query);
  if (!q.length) return { ratio: 0, rank: 0 };
  const t = words(title);
  const tset = new Set(t);
  const matched = q.filter((w) => tset.has(w)).length;
  const ratio = matched / q.length;
  const extra = Math.max(0, t.length - matched);
  return { ratio, rank: ratio - 0.03 * Math.min(extra, 8) };
}

const stripHtml = (html) =>
  String(html || "")
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

async function searchCommons(query) {
  const params = new URLSearchParams({
    action: "query",
    generator: "search",
    gsrsearch: `${query} filetype:bitmap`,
    gsrnamespace: "6", // 6 = files
    gsrlimit: "10",
    prop: "imageinfo",
    iiprop: "url|mime|extmetadata",
    iiurlwidth: "640",
    iiextmetadatafilter: "Artist|LicenseShortName",
    format: "json",
    formatversion: "2",
    origin: "*"
  });
  const res = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`);
  if (!res.ok) throw new Error(`Commons returned ${res.status}`);
  const data = await res.json();
  const pages = [...(data?.query?.pages || [])].sort((a, b) => (a.index ?? 99) - (b.index ?? 99));

  let best = null;
  for (const p of pages) {
    const info = p.imageinfo?.[0];
    if (!info?.thumburl || !/^image\/(jpeg|png|webp)$/.test(info.mime || "")) continue;
    const title = p.title.replace(/^File:/, "").replace(/\.[a-z0-9]+$/i, "");
    const { ratio, rank } = matchScore(query, title);
    // keep the best rank; on a tie, keep the earlier (more relevant) search result
    const qLen = words(query).length;
    const needed = qLen <= 2 ? 1 : 0.75;
    // Extra words in the title usually mean a different dish ("Katsu omelette with pork cutlet" is not "pork omelette").
    const extraWords = words(title).length - words(title).filter((w) => words(query).includes(w)).length;
    if (ratio >= needed && extraWords <= (qLen <= 2 ? 1 : 2) && (!best || rank > best.rank)) {
      best = {
        rank,
        photo: {
          url: info.thumburl,
          title,
          page: info.descriptionurl || `https://commons.wikimedia.org/wiki/${encodeURIComponent(p.title.replace(/ /g, "_"))}`,
          author: stripHtml(info.extmetadata?.Artist?.value).slice(0, 60),
          license: stripHtml(info.extmetadata?.LicenseShortName?.value).slice(0, 30)
        }
      };
    }
  }
  return best?.photo || null;
}

// Lookups are shared between cards and pop-ups, so one component leaving never cancels them.
function lookup(query) {
  const key = norm(query).trim();
  if (!key) return Promise.resolve(null);

  const cached = readCache()[key];
  if (cached) return Promise.resolve(cached);
  if (memory.has(key)) return memory.get(key);

  const promise = searchCommons(query)
    .then((photo) => {
      if (photo) writeCache(key, photo); // only remember successes
      return photo;
    })
    .catch(() => {
      memory.delete(key); // network hiccup: allow a retry next time
      return null;
    });
  memory.set(key, promise);
  return promise;
}

// "Not the right photo?" - the person can hide a photo they don't like for a recipe.
const HIDDEN_KEY = "fc.photos.hidden";
const hiddenList = () => {
  try {
    return JSON.parse(localStorage.getItem(HIDDEN_KEY) || "[]");
  } catch {
    return [];
  }
};

export function hideDishPhoto(recipe) {
  try {
    const list = hiddenList();
    if (!list.includes(recipe.name)) localStorage.setItem(HIDDEN_KEY, JSON.stringify([...list, recipe.name].slice(-200)));
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event("fc-photo-hidden"));
}

/* ---------- the person's own photo of a dish (stays on this device) ---------- */
const MINE_KEY = "fc.myphotos";
const mine = () => {
  try {
    return JSON.parse(localStorage.getItem(MINE_KEY) || "{}");
  } catch {
    return {};
  }
};

/** Returns true if saved, false if the browser had no room. */
export function setMyPhoto(recipe, dataUrl) {
  try {
    const all = mine();
    delete all[recipe.name];
    all[recipe.name] = dataUrl; // newest last
    const names = Object.keys(all);
    for (const n of names.slice(0, Math.max(0, names.length - 30))) delete all[n];
    localStorage.setItem(MINE_KEY, JSON.stringify(all));
    window.dispatchEvent(new Event("fc-photo-hidden"));
    return true;
  } catch {
    return false;
  }
}

export function removeMyPhoto(recipe) {
  try {
    const all = mine();
    delete all[recipe.name];
    localStorage.setItem(MINE_KEY, JSON.stringify(all));
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event("fc-photo-hidden"));
}

export async function getDishPhoto(recipe) {
  const own = mine()[recipe.name];
  if (own) return { url: own, title: "Your photo", mine: true };
  if (hiddenList().includes(recipe.name)) return null;
  // Tagalog names often have photos under the core dish name or under its English name,
  // while long names like "Sinangag at Hotdog" match nothing. So we try several forms.
  const core = String(recipe.name || "").split(/\s+(?:at|with|and|na may|may|sa|na)\s+/i)[0];
  // The shortened name is only trusted when it still has 2+ words ("tortang itlog"); a single word
  // like "misua" would match any noodle photo.
  const coreQuery = words(core).length >= 2 ? core : "";
  const queries = [recipe.photo_query, recipe.photo_english, coreQuery, recipe.name].filter(
    (q, i, a) => typeof q === "string" && q.trim() && a.findIndex((x) => String(x).toLowerCase() === q.toLowerCase()) === i
  );
  for (const q of queries) {
    const photo = await lookup(q);
    if (photo) return photo;
  }
  return null;
}
