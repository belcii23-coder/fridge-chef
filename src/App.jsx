import { useEffect, useRef, useState } from "react";
import { getDishPhoto, hideDishPhoto, removeMyPhoto, setMyPhoto } from "./dishPhoto.js";
import { DIET_OPTIONS, PANTRY_SUGGEST, canon, peso, withStatus } from "./food.js";
import CookMode from "./CookMode.jsx";
import Shopping from "./Shopping.jsx";

const QUICK_ADD = [
  "Egg", "Rice", "Onion", "Garlic", "Sardines", "Corned beef", "Hotdog",
  "Cabbage", "Tomato", "Eggplant", "Potato", "Chicken", "Instant noodles"
];

const BUDGETS = [
  { label: "No extra spending", value: 0 },
  { label: "Up to ₱50", value: 50 },
  { label: "Up to ₱100", value: 100 },
  { label: "Up to ₱200", value: 200 },
  { label: "Any", value: "" }
];

const EQUIPMENT = [
  "Full kitchen (stove, pans, pots)",
  "One pot only",
  "Rice cooker only",
  "Microwave only"
];

const PROVIDER_NAMES = { gemini: "Google Gemini", claude: "Claude" };

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage can be blocked; the app still works without it */
  }
}

// Shrinks a photo in the browser before upload so it is fast and small.
function shrinkImage(file, maxSize = 1024, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That file doesn't look like a photo. Try a JPG or PNG."));
    };
    img.src = url;
  });
}

async function postJson(path, payload) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}

// Loads a reference photo for a recipe (null = none found, undefined = still loading)
function useDishPhoto(recipe) {
  const [photo, setPhoto] = useState(undefined);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const again = () => setTick((t) => t + 1);
    window.addEventListener("fc-photo-hidden", again);
    return () => window.removeEventListener("fc-photo-hidden", again);
  }, []);
  useEffect(() => {
    let stale = false; // ignore the answer if this card changed or went away meanwhile
    setPhoto(undefined);
    getDishPhoto(recipe)
      .then((p) => !stale && setPhoto(p))
      .catch(() => !stale && setPhoto(null));
    return () => {
      stale = true;
    };
  }, [recipe.name, recipe.photo_query, tick]);
  return photo;
}

function DishPhoto({ recipe, className = "" }) {
  const photo = useDishPhoto(recipe);
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [photo?.url]);

  if (photo === undefined) return <div className={`dish-photo dish-loading ${className}`} aria-hidden="true" />;
  if (!photo || broken) {
    return (
      <label className={`dish-photo dish-fallback ${className}`} title="Add your own photo of this dish">
        <span aria-hidden="true">🍲</span>
        <small>📷 Add photo</small>
        <input
          type="file"
          accept="image/*"
          hidden
          aria-label={`Add your own photo of ${recipe.name}`}
          onClick={(e) => e.stopPropagation()}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            try {
              setMyPhoto(recipe, await shrinkImage(file, 720, 0.75));
            } catch {
              /* a bad file just does nothing */
            }
          }}
        />
      </label>
    );
  }
  return (
    <div className={`dish-photo ${className}`}>
      <img src={photo.url} alt={`Photo: ${photo.title} (similar to ${recipe.name})`} loading="lazy" onError={() => setBroken(true)} />
    </div>
  );
}

function PhotoCredit({ recipe }) {
  const photo = useDishPhoto(recipe);
  const fileRef = useRef(null);
  const [msg, setMsg] = useState("");

  async function onFile(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const url = await shrinkImage(file, 720, 0.75);
      setMsg(setMyPhoto(recipe, url) ? "" : "Couldn't save the photo (device storage is full).");
    } catch (err) {
      setMsg(err.message || "Couldn't read that photo.");
    }
  }

  const addBtn = (label) => (
    <button className="link" onClick={() => fileRef.current?.click()}>{label}</button>
  );

  return (
    <div className="photo-credit">
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={onFile} data-testid="my-photo-input" />
      {photo?.mine ? (
        <p>
          This is your own photo. {addBtn("Replace it")} · <button className="link" onClick={() => removeMyPhoto(recipe)}>Remove</button>
        </p>
      ) : photo ? (
        <p>
          Photo: <a href={photo.page} target="_blank" rel="noopener noreferrer">{photo.title}</a>
          {photo.author ? ` by ${photo.author}` : ""}
          {photo.license ? `, ${photo.license}` : ""}, via Wikimedia Commons. It may not match your dish exactly.{" "}
          <button className="link" onClick={() => hideDishPhoto(recipe)}>Wrong photo? Hide it</button> · {addBtn("📷 Add my photo")}
        </p>
      ) : photo === null ? (
        <p>No matching photo found. {addBtn("📷 Add my own photo")}</p>
      ) : null}
      {msg && <p role="alert">{msg}</p>}
    </div>
  );
}

function AiBadge({ children = "AI" }) {
  return <span className="ai-badge">✨ {children}</span>;
}

export default function App() {
  const [tab, setTab] = useState("cook");
  const [ingredients, setIngredients] = useState([]); // starts empty every time: last time's ingredients should not mix with a new search
  const [draft, setDraft] = useState("");
  const [budget, setBudget] = useState(() => load("fc.budget", 50));
  const [equipment, setEquipment] = useState(() => load("fc.equipment", EQUIPMENT[0]));
  const [servings, setServings] = useState(() => load("fc.servings", 1));
  const [showOptions, setShowOptions] = useState(false);
  const [recipes, setRecipes] = useState([]);
  const [note, setNote] = useState("");
  const [provider, setProvider] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(() => load("fc.saved", []));
  const [online, setOnline] = useState(navigator.onLine);
  const [open, setOpen] = useState(null); // recipe shown in the pop-up
  const [scan, setScan] = useState({ state: "idle", preview: "", message: "" });
  const [pantry, setPantry] = useState(() => load("fc.pantry", []));
  const [diet, setDiet] = useState(() => load("fc.diet", []));
  const [disliked, setDisliked] = useState(() => load("fc.disliked", []));
  const [shopping, setShopping] = useState(() => load("fc.shopping", []));
  const [pantryDraft, setPantryDraft] = useState("");
  const [showPantry, setShowPantry] = useState(false);
  const [swapping, setSwapping] = useState({}); // recipe name -> true while a replacement is loading
  const [swapError, setSwapError] = useState({}); // recipe name -> message
  const [more, setMore] = useState(false);
  const [cooking, setCooking] = useState(null); // recipe shown in cook mode

  const takeRef = useRef(null);
  const uploadRef = useRef(null);
  const resultsRef = useRef(null);

  useEffect(() => {
    try {
      localStorage.removeItem("fc.ingredients"); // older versions saved the list; forget it
    } catch {
      /* ignore */
    }
  }, []);
  useEffect(() => save("fc.budget", budget), [budget]);
  useEffect(() => save("fc.equipment", equipment), [equipment]);
  useEffect(() => save("fc.servings", servings), [servings]);
  useEffect(() => save("fc.saved", saved), [saved]);
  useEffect(() => save("fc.pantry", pantry), [pantry]);
  useEffect(() => save("fc.diet", diet), [diet]);
  useEffect(() => save("fc.disliked", disliked), [disliked]);
  useEffect(() => save("fc.shopping", shopping), [shopping]);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  function addIngredients(list) {
    const items = list.map((s) => s.trim()).filter(Boolean);
    if (!items.length) return;
    setIngredients((prev) => {
      const lower = new Set(prev.map((p) => p.toLowerCase()));
      const fresh = [];
      for (const i of items) {
        if (!lower.has(i.toLowerCase())) {
          lower.add(i.toLowerCase());
          fresh.push(i);
        }
      }
      return [...prev, ...fresh];
    });
  }

  function addFromDraft() {
    addIngredients(draft.split(","));
    setDraft("");
  }

  function removeIngredient(name) {
    setIngredients((prev) => prev.filter((p) => p !== name));
  }

  function toggleQuick(name) {
    const exists = ingredients.some((i) => i.toLowerCase() === name.toLowerCase());
    if (exists) setIngredients((prev) => prev.filter((i) => i.toLowerCase() !== name.toLowerCase()));
    else addIngredients([name]);
  }

  const MAX_SCAN_PHOTOS = 5;

  async function onPhotoChosen(e) {
    const picked = Array.from(e.target.files || []);
    e.target.value = ""; // lets the same photos be picked again later
    if (!picked.length) return;

    const files = picked.slice(0, MAX_SCAN_PHOTOS);
    const skipped = picked.length - files.length;
    setError("");

    const found = [];
    let failed = 0;
    let lastError = "";
    let lastPreview = "";
    let lastNote = "";
    for (let i = 0; i < files.length; i++) {
      const label = files.length > 1 ? `AI is looking at photo ${i + 1} of ${files.length}…` : "AI is looking at your photo…";
      setScan({ state: "working", preview: lastPreview || URL.createObjectURL(files[i]), message: label });
      try {
        const image = await shrinkImage(files[i]);
        lastPreview = image;
        const data = await postJson("/api/ingredients", { image });
        if (data.ingredients?.length) {
          addIngredients(data.ingredients);
          found.push(...data.ingredients);
        } else if (data.note) {
          lastNote = data.note;
        }
      } catch (err) {
        failed++;
        lastError = err.message || "Couldn't read that photo.";
      }
    }

    if (failed === files.length) {
      setScan({ state: "idle", preview: "", message: "" });
      setError(!navigator.onLine ? "You're offline. Reconnect to scan a photo." : lastError);
      return;
    }

    const unique = new Set(found.map((f) => f.toLowerCase())).size;
    const extra = [
      failed ? `${failed} photo${failed > 1 ? "s" : ""} couldn't be read.` : "",
      skipped ? `Only the first ${MAX_SCAN_PHOTOS} photos were scanned.` : ""
    ]
      .filter(Boolean)
      .join(" ");

    if (unique) {
      setScan({
        state: "done",
        preview: lastPreview,
        message: `AI spotted ${unique} item${unique === 1 ? "" : "s"} in ${files.length - failed} photo${files.length - failed === 1 ? "" : "s"} and added ${unique === 1 ? "it" : "them"} to your list. Remove anything that's wrong. ${extra}`.trim()
      });
    } else {
      setScan({
        state: "empty",
        preview: lastPreview,
        message: `${lastNote || "AI couldn't spot any food in that photo. Try a clearer, closer shot."} ${extra}`.trim()
      });
    }
  }

  async function findRecipes() {
    // Include whatever is still typed in the box so nothing gets lost.
    const typed = draft.split(",").map((s) => s.trim()).filter(Boolean);
    const all = [...ingredients, ...typed.filter((t) => !ingredients.some((i) => i.toLowerCase() === t.toLowerCase()))];
    if (!all.length) {
      setError("Add at least one ingredient first.");
      return;
    }
    if (typed.length) {
      addIngredients(typed);
      setDraft("");
    }

    setLoading(true);
    setError("");
    setRecipes([]);
    setNote("");
    try {
      const data = await postJson("/api/recipes", requestBody(all, { exclude: disliked }));
      setRecipes(data.recipes || []);
      setProvider(data.provider || "");
      setNote(data.note || (!data.recipes?.length ? "No recipes found. Try adding more ingredients." : ""));
      setTimeout(() => {
        if (window.matchMedia("(max-width: 859px)").matches) {
          resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      }, 60);
    } catch (e) {
      setError(friendlyError(e, "You're offline. Reconnect to get new recipes (your saved ones still work)."));
    } finally {
      setLoading(false);
    }
  }

  const requestBody = (all, extra = {}) => ({
    ingredients: all.join(", "),
    budget: budget === "" ? null : budget,
    equipment,
    servings,
    diet,
    pantry,
    ...extra
  });

  const friendlyError = (e, offlineMsg) =>
    !navigator.onLine ? offlineMsg : e.message || "Couldn't reach the server.";

  // Replace ONE recipe with a new idea. If forget is true, the dish is also hidden from future searches.
  async function swapRecipe(r, forget) {
    if (swapping[r.name]) return;
    const nextDisliked = forget ? [...new Set([...disliked, r.name])].slice(-50) : disliked;
    if (forget) setDisliked(nextDisliked);
    setSwapping((m) => ({ ...m, [r.name]: true }));
    setSwapError((m) => ({ ...m, [r.name]: "" }));
    try {
      const data = await postJson(
        "/api/recipes",
        requestBody(ingredients, { count: 1, exclude: [...new Set([...nextDisliked, ...recipes.map((x) => x.name)])] })
      );
      const fresh = data.recipes?.[0];
      if (!fresh) throw new Error(data.note || "Couldn't find another idea. Try adding more ingredients.");
      setRecipes((prev) => prev.map((x) => (x.name === r.name ? fresh : x)));
    } catch (e) {
      setSwapError((m) => ({ ...m, [r.name]: friendlyError(e, "You're offline. Reconnect to swap recipes.") }));
    } finally {
      setSwapping((m) => {
        const { [r.name]: _drop, ...rest } = m;
        return rest;
      });
    }
  }

  // Add up to 3 more ideas under the current ones.
  async function moreIdeas() {
    setMore(true);
    setError("");
    try {
      const data = await postJson(
        "/api/recipes",
        requestBody(ingredients, { count: 3, exclude: [...new Set([...disliked, ...recipes.map((x) => x.name)])] })
      );
      const fresh = (data.recipes || []).filter((x) => !recipes.some((y) => y.name === x.name));
      if (!fresh.length) setNote(data.note || "No more new ideas with these ingredients. Try adding some.");
      setRecipes((prev) => [...prev, ...fresh]);
    } catch (e) {
      setError(friendlyError(e, "You're offline. Reconnect to get more ideas."));
    } finally {
      setMore(false);
    }
  }

  /* ---------- pantry, diet, shopping ---------- */
  const inPantry = (name) => pantry.some((p) => canon(p) === canon(name));
  function togglePantry(name) {
    setPantry((prev) => (prev.some((p) => canon(p) === canon(name)) ? prev.filter((p) => canon(p) !== canon(name)) : [...prev, name]));
  }
  function addPantryFromDraft() {
    const items = pantryDraft.split(",").map((s) => s.trim()).filter((s) => s && !inPantry(s));
    if (items.length) setPantry((prev) => [...prev, ...items].slice(0, 40));
    setPantryDraft("");
  }
  const toggleDiet = (d) => setDiet((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));

  const shopKey = (name) => canon(name) || name.toLowerCase();
  const onList = (name) => shopping.some((i) => i.key === shopKey(name));
  function addToShopping(recipe, ing) {
    setShopping((prev) => {
      const key = shopKey(ing.name);
      const hit = prev.find((i) => i.key === key);
      if (!hit) return [...prev, { key, name: ing.name, amount: ing.amount || "", price: ing.price_php || 0, recipes: [recipe.name], done: false }];
      if (hit.recipes.includes(recipe.name)) return prev;
      return prev.map((i) => (i.key === key ? { ...i, recipes: [...i.recipes, recipe.name] } : i));
    });
  }
  function toggleShopping(recipe, ing) {
    if (onList(ing.name)) setShopping((prev) => prev.filter((i) => i.key !== shopKey(ing.name)));
    else addToShopping(recipe, ing);
  }
  function addAllToShopping(recipe) {
    withStatus(recipe, pantry).ingredients.filter((i) => i.status === "buy").forEach((i) => addToShopping(recipe, i));
  }

  const isSaved = (r) => saved.some((s) => s.name === r.name);
  function toggleSave(r) {
    setSaved((prev) => (isSaved(r) ? prev.filter((s) => s.name !== r.name) : [r, ...prev]));
  }

  const budgetLabel = BUDGETS.find((b) => b.value === budget)?.label || "Any";
  const providerName = PROVIDER_NAMES[provider];

  return (
    <div className="app">
      <header className="header">
        <div className="logo">🍳</div>
        <div className="header-text">
          <h1>
            Fridge Chef <AiBadge>AI-powered</AiBadge>
          </h1>
          <p>Tell the AI what's in your fridge. Get recipes you can cook now.</p>
        </div>
        <nav className="tabs" role="tablist" aria-label="Sections">
          <button role="tab" aria-selected={tab === "cook"} className={tab === "cook" ? "active" : ""} onClick={() => setTab("cook")}>
            Cook
          </button>
          <button role="tab" aria-selected={tab === "shopping"} className={tab === "shopping" ? "active" : ""} onClick={() => setTab("shopping")}>
            Shopping{shopping.filter((i) => !i.done).length > 0 ? ` (${shopping.filter((i) => !i.done).length})` : ""}
          </button>
          <button role="tab" aria-selected={tab === "saved"} className={tab === "saved" ? "active" : ""} onClick={() => setTab("saved")}>
            Saved{saved.length > 0 ? ` (${saved.length})` : ""}
          </button>
        </nav>
      </header>

      {!online && <div className="banner">You're offline. Saved recipes still work.</div>}

      {tab === "cook" && (
        <main className="layout">
          <div className="panel">
            <section className="card">
              <label className="label" htmlFor="ing">My ingredients</label>
              <div className="input-row">
                <input
                  id="ing"
                  value={draft}
                  placeholder="e.g. egg, rice, onion"
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addFromDraft();
                    }
                  }}
                />
                <button className="btn-small" onClick={addFromDraft} disabled={!draft.trim()}>
                  Add
                </button>
              </div>

              <div className="photo-row">
                <button className="btn-photo" onClick={() => takeRef.current?.click()} disabled={scan.state === "working" || !online}>
                  📷 Take photo
                </button>
                <button className="btn-photo" onClick={() => uploadRef.current?.click()} disabled={scan.state === "working" || !online}>
                  🖼️ Upload photos
                </button>
                <AiBadge>AI scans it</AiBadge>
                <input ref={takeRef} type="file" accept="image/*" capture="environment" hidden onChange={onPhotoChosen} />
                <input ref={uploadRef} type="file" accept="image/*" multiple hidden onChange={onPhotoChosen} />
              </div>

              {scan.state !== "idle" && (
                <div className={`scan scan-${scan.state}`} role="status" aria-live="polite">
                  {scan.preview && <img src={scan.preview} alt="Your photo" />}
                  <p>
                    {scan.state === "working" && <span className="spinner" aria-hidden="true" />}
                    {scan.message}
                  </p>
                  {scan.state !== "working" && (
                    <button className="link" onClick={() => setScan({ state: "idle", preview: "", message: "" })}>
                      Dismiss
                    </button>
                  )}
                </div>
              )}

              {ingredients.length > 0 && (
                <div className="chips">
                  {ingredients.map((i) => (
                    <span key={i} className="chip chip-on">
                      {i}
                      <button aria-label={`Remove ${i}`} onClick={() => removeIngredient(i)}>×</button>
                    </span>
                  ))}
                  <button className="link" onClick={() => setIngredients([])}>Clear all</button>
                </div>
              )}

              <details className="quick">
                <summary>Quick add common items</summary>
                <div className="chips">
                  {QUICK_ADD.map((q) => {
                    const on = ingredients.some((i) => i.toLowerCase() === q.toLowerCase());
                    return (
                      <button key={q} className={`chip ${on ? "chip-selected" : ""}`} onClick={() => toggleQuick(q)}>
                        {on ? "✓ " : "+ "}
                        {q}
                      </button>
                    );
                  })}
                </div>
              </details>
            </section>

            <section className="card options">
              <button className="options-toggle" onClick={() => setShowOptions((v) => !v)} aria-expanded={showOptions}>
                <span>
                  <strong>Options</strong>
                  <small>
                    {budgetLabel} · {equipment.split(" (")[0]} · {servings} serving{servings > 1 ? "s" : ""}
                  </small>
                </span>
                <span aria-hidden="true">{showOptions ? "▴" : "▾"}</span>
              </button>
              {showOptions && (
                <div className="options-body">
                  <div className="grid">
                    <div>
                      <label className="label" htmlFor="budget">Budget to buy extras</label>
                      <select id="budget" value={budget} onChange={(e) => setBudget(e.target.value === "" ? "" : Number(e.target.value))}>
                        {BUDGETS.map((b) => (
                          <option key={b.label} value={b.value}>{b.label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="label" htmlFor="equip">Equipment</label>
                      <select id="equip" value={equipment} onChange={(e) => setEquipment(e.target.value)}>
                        {EQUIPMENT.map((e) => (
                          <option key={e}>{e}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="servings">
                    <span className="label">Servings</span>
                    <div className="stepper">
                      <button aria-label="Fewer servings" onClick={() => setServings((s) => Math.max(1, s - 1))}>−</button>
                      <span>{servings}</span>
                      <button aria-label="More servings" onClick={() => setServings((s) => Math.min(6, s + 1))}>+</button>
                    </div>
                  </div>
                </div>
              )}
            </section>

            <section className="card options">
              <button className="options-toggle" onClick={() => setShowPantry((v) => !v)} aria-expanded={showPantry}>
                <span>
                  <strong>Pantry &amp; diet</strong>
                  <small>
                    {pantry.length ? `${pantry.length} staple${pantry.length > 1 ? "s" : ""} at home` : "No staples set"} ·{" "}
                    {diet.length ? diet.join(", ") : "No diet filter"}
                  </small>
                </span>
                <span aria-hidden="true">{showPantry ? "▴" : "▾"}</span>
              </button>
              {showPantry && (
                <div className="options-body">
                  <div className="label">Always at home</div>
                  <p className="hint">Tap what you always have. The AI will use it and won't tell you to buy it.</p>
                  <div className="chips flush">
                    {[...PANTRY_SUGGEST, ...pantry.filter((p) => !PANTRY_SUGGEST.some((q) => canon(q) === canon(p)))].map((q) => {
                      const on = inPantry(q);
                      return (
                        <button key={q} className={`chip ${on ? "chip-selected" : ""}`} aria-pressed={on} onClick={() => togglePantry(q)}>
                          {on ? "✓ " : "+ "}
                          {q}
                        </button>
                      );
                    })}
                  </div>
                  <div className="input-row pantry-add">
                    <input
                      aria-label="Add your own staple"
                      value={pantryDraft}
                      placeholder="Add your own, e.g. oyster sauce"
                      onChange={(e) => setPantryDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addPantryFromDraft();
                        }
                      }}
                    />
                    <button className="btn-small" onClick={addPantryFromDraft} disabled={!pantryDraft.trim()}>Add</button>
                  </div>

                  <div className="label diet-label">Diet &amp; allergies</div>
                  <p className="hint">The AI must follow these, and the app double-checks every recipe.</p>
                  <div className="chips flush">
                    {DIET_OPTIONS.map((d) => {
                      const on = diet.includes(d);
                      return (
                        <button key={d} className={`chip ${on ? "chip-selected" : ""}`} aria-pressed={on} onClick={() => toggleDiet(d)}>
                          {on ? "✓ " : ""}
                          {d}
                        </button>
                      );
                    })}
                  </div>

                  {disliked.length > 0 && (
                    <p className="hint disliked-line">
                      {disliked.length} dish{disliked.length > 1 ? "es" : ""} hidden from suggestions.{" "}
                      <button className="link" onClick={() => setDisliked([])}>Show them again</button>
                    </p>
                  )}
                </div>
              )}
            </section>

            <button className="btn-primary" onClick={findRecipes} disabled={loading || !online}>
              {loading ? "AI is cooking up ideas…" : "✨ Find recipes with AI"}
            </button>
            {error && <div className="error" role="alert">{error}</div>}
          </div>

          <section className="results" ref={resultsRef} aria-live="polite">
            {loading && (
              <div className="skeletons" aria-hidden="true">
                <div className="skeleton" /><div className="skeleton" /><div className="skeleton" />
              </div>
            )}

            {!loading && recipes.length === 0 && (
              <div className="placeholder">
                <div className="placeholder-emoji">🍽️</div>
                <h2>Your recipes will show up here</h2>
                <p>Add what you have, or snap a photo, then let the AI suggest what to cook.</p>
                {note && <p className="note">💡 {note}</p>}
              </div>
            )}

            {recipes.length > 0 && (
              <>
                <div className="results-head">
                  <h2>
                    <AiBadge>AI-suggested</AiBadge> Recipes for you
                  </h2>
                  <p>
                    {providerName ? `Made by ${providerName}. ` : ""}AI can make mistakes, so check that ingredients are fresh and food is cooked through.
                  </p>
                </div>
                <div className="recipe-list">
                  {recipes.map((r) => (
                    <RecipeCard
                      key={r.name}
                      recipe={withStatus(r, pantry)}
                      saved={isSaved(r)}
                      onToggleSave={() => toggleSave(r)}
                      onOpen={() => setOpen(r)}
                      onSwap={() => swapRecipe(r, false)}
                      onDislike={() => swapRecipe(r, true)}
                      busy={!!swapping[r.name]}
                      error={swapError[r.name]}
                    />
                  ))}
                </div>
                <button className="btn-more" onClick={moreIdeas} disabled={more || !online || recipes.length >= 9}>
                  {more ? "Finding more ideas…" : recipes.length >= 9 ? "That's plenty of ideas!" : "✨ More ideas"}
                </button>
                {note && <p className="note">💡 {note}</p>}
              </>
            )}
          </section>
        </main>
      )}

      {tab === "shopping" && (
        <Shopping items={shopping} setItems={setShopping} onGoCook={() => setTab("cook")} />
      )}

      {tab === "saved" && (
        <main className="saved">
          {saved.length === 0 ? (
            <div className="placeholder">
              <div className="placeholder-emoji">🔖</div>
              <h2>No saved recipes yet</h2>
              <p>Tap the heart on any recipe to keep it here. Saved recipes work offline.</p>
            </div>
          ) : (
            <div className="recipe-list recipe-grid">
              {saved.map((r) => (
                <RecipeCard key={r.name} recipe={withStatus(r, pantry)} saved onToggleSave={() => toggleSave(r)} onOpen={() => setOpen(r)} />
              ))}
            </div>
          )}
        </main>
      )}

      <footer className="footer">
        Recipes and photo reading are created by AI and may contain mistakes. Dish photos come from Wikimedia Commons and may not look exactly like your result. Prices are rough estimates. Diet filters help, but always check labels if you have an allergy.
        Photos are sent to the AI only to read your ingredients and are not saved by this app.
      </footer>

      {open && (
        <RecipeModal
          recipe={withStatus(open, pantry)}
          saved={isSaved(open)}
          onToggleSave={() => toggleSave(open)}
          onClose={() => setOpen(null)}
          onList={onList}
          onToggleItem={(ing) => toggleShopping(open, ing)}
          onAddAll={() => addAllToShopping(open)}
          onCook={() => {
            setCooking(withStatus(open, pantry));
            setOpen(null);
          }}
        />
      )}
      {cooking && <CookMode recipe={cooking} onClose={() => setCooking(null)} />}
    </div>
  );
}

function RecipeCard({ recipe: r, saved, onToggleSave, onOpen, onSwap, onDislike, busy, error }) {
  const buy = r.need_to_buy || [];
  return (
    <article className={`card recipe ${busy ? "recipe-busy" : ""}`}>
      <div className="recipe-row">
        <DishPhoto recipe={r} className="thumb" />
        <div className="recipe-main">
          <div className="recipe-top">
            <h3>{r.name}</h3>
            <button className={`heart ${saved ? "heart-on" : ""}`} onClick={onToggleSave} aria-pressed={saved} aria-label={saved ? "Unsave recipe" : "Save recipe"}>
              {saved ? "♥" : "♡"}
            </button>
          </div>
          <p className="summary">{r.summary}</p>
          <div className="meta">
            <span>⏱ {r.time_minutes} min</span>
            <span>👩‍🍳 {r.difficulty}</span>
            <span>💰 {r.estimated_extra_cost_php > 0 ? `≈ ₱${r.estimated_extra_cost_php}` : "No extra cost"}</span>
          </div>
        </div>
      </div>
      <p className="buy-line">
        {buy.length === 0 ? (
          <span className="good">✓ You have everything</span>
        ) : (
          <>
            <span className="buy-label">Need:</span> {buy.join(", ")}
          </>
        )}
      </p>
      {error && <p className="swap-error" role="alert">{error}</p>}
      <div className="card-actions">
        <button className="btn-view" onClick={onOpen} disabled={busy}>View recipe</button>
        {onSwap && (
          <>
            <button className="btn-ghost" onClick={onSwap} disabled={busy} aria-label={`Swap ${r.name} for another idea`}>
              {busy ? "Swapping…" : "↻ Swap"}
            </button>
            <button className="btn-ghost" onClick={onDislike} disabled={busy} aria-label={`I don't like ${r.name}`}>
              👎 Not for me
            </button>
          </>
        )}
      </div>
      {busy && <div className="card-busy" aria-hidden="true" />}
    </article>
  );
}

function RecipeModal({ recipe: r, saved, onToggleSave, onClose, onList, onToggleItem, onAddAll, onCook }) {
  const closeRef = useRef(null);
  const mains = r.ingredients.filter((i) => i.kind !== "pampalasa");
  const spices = r.ingredients.filter((i) => i.kind === "pampalasa");
  const buyItems = r.ingredients.filter((i) => i.status === "buy");
  const allListed = buyItems.length > 0 && buyItems.every((i) => onList(i.name));

  const row = (i) => (
    <li key={i.name} className={`ing ing-${i.status}`}>
      <span className="ing-name">
        {i.name}
        {i.amount ? <small> · {i.amount}</small> : null}
      </span>
      {i.status === "buy" ? (
        <button className={`ing-buy ${onList(i.name) ? "ing-buy-on" : ""}`} aria-pressed={onList(i.name)} onClick={() => onToggleItem(i)}>
          {onList(i.name) ? "✓ On list" : `+ Buy${i.price_php ? ` ≈ ${peso(i.price_php)}` : ""}`}
        </button>
      ) : (
        <span className="ing-tag">{i.status === "pantry" ? "In pantry" : "Have"}</span>
      )}
    </li>
  );

  useEffect(() => {
    const previouslyFocused = document.activeElement;
    closeRef.current?.focus();
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      previouslyFocused?.focus?.();
    };
  }, [onClose]);

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div className="modal-head">
          <div>
            <h2 id="modal-title">{r.name}</h2>
            <div className="meta">
              <span>⏱ {r.time_minutes} min</span>
              <span>👩‍🍳 {r.difficulty}</span>
              <span>💰 {r.estimated_extra_cost_php > 0 ? `≈ ₱${r.estimated_extra_cost_php} extra` : "No extra cost"}</span>
            </div>
          </div>
          <button ref={closeRef} className="modal-close" onClick={onClose} aria-label="Close recipe">×</button>
        </div>

        <div className="modal-body">
          <DishPhoto recipe={r} className="photo-banner" />
          <PhotoCredit recipe={r} />
          <div className="modal-cols">
            <div>
              <div className="sublabel">Ingredients</div>
              <ul className="ing-list">{mains.map(row)}</ul>
              {spices.length > 0 && (
                <>
                  <div className="sublabel">Pampalasa (seasonings)</div>
                  <ul className="ing-list">{spices.map(row)}</ul>
                </>
              )}
              {buyItems.length === 0 ? (
                <p className="good all-set">Nothing to buy! You have it all 🎉</p>
              ) : (
                <button className="btn-addall" onClick={onAddAll} disabled={allListed}>
                  {allListed ? "✓ All added to shopping list" : `🛒 Add ${buyItems.length} to shopping list · ≈ ${peso(r.estimated_extra_cost_php)}`}
                </button>
              )}
              {r.substitutions?.length > 0 && (
                <div className="subs">
                  <strong>Swap ideas</strong>
                  <ul>
                    {r.substitutions.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            <div>
              <div className="sublabel">Steps</div>
              <ol className="steps">
                {(r.steps || []).map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
            </div>
          </div>
          <p className="ai-note">✨ This recipe was written by AI. Check that ingredients are fresh and food is cooked through.</p>
        </div>

        <div className="modal-foot">
          <button className={`btn-save ${saved ? "btn-save-on" : ""}`} onClick={onToggleSave} aria-pressed={saved}>
            {saved ? "♥ Saved" : "♡ Save recipe"}
          </button>
          <button className="btn-done" onClick={onCook}>👩‍🍳 Start cooking</button>
        </div>
      </div>
    </div>
  );
}
