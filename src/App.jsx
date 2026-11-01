import { useEffect, useRef, useState } from "react";

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
  } catch {}
}

function parseStepSeconds(text) {
  const match = /(\d+)(?:\s*(?:-|to)\s*(\d+))?\s*(hours?|hrs?|minutes?|mins?|seconds?|secs?)\b/i.exec(text || "");
  if (!match) return null;
  const a = parseInt(match[1], 10);
  const b = match[2] ? parseInt(match[2], 10) : null;
  const value = b != null ? Math.max(a, b) : a;
  const unit = match[3].toLowerCase();
  if (unit.startsWith("h")) return value * 3600;
  if (unit.startsWith("m")) return value * 60;
  return value;
}

function formatClock(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function unlockAlarmAudio(ctxRef) {
  try {
    if (!ctxRef.current) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      ctxRef.current = new Ctx();
    }
    if (ctxRef.current.state === "suspended") ctxRef.current.resume().catch(() => {});
  } catch {}
}

function playAlarmBeeps(ctxRef) {
  const ctx = ctxRef.current;
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    const beepCount = 6;
    for (let i = 0; i < beepCount; i++) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "square";
      osc.frequency.value = 880;
      const start = now + i * 0.45;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.6, start + 0.02);
      gain.gain.setValueAtTime(0.6, start + 0.26);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.28);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.3);
    }
  } catch {}
  if (navigator.vibrate) navigator.vibrate([300, 150, 300, 150, 300, 150, 300]);
}

function resizeImageFile(file, maxDim = 1024, quality = 0.75) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Couldn't read that photo."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Couldn't read that photo."));
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          const scale = maxDim / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

const svgProps = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true" };
const IconCamera = () => (
  <svg width="15" height="15" {...svgProps}><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg>
);
const IconImage = () => (
  <svg width="15" height="15" {...svgProps}><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="2" /><path d="M21 16l-5-5-8 9" /></svg>
);
const IconRefresh = () => (
  <svg width="16" height="16" {...svgProps} strokeWidth="2.2"><path d="M20 11a8 8 0 0 0-14-4L4 9" /><path d="M4 4v5h5" /><path d="M4 13a8 8 0 0 0 14 4l2-2" /><path d="M20 20v-5h-5" /></svg>
);
const IconPlate = () => (
  <svg width="34" height="34" {...svgProps} strokeWidth="1.6"><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="4.5" /></svg>
);
const IconPan = () => (
  <svg width="26" height="26" {...svgProps} stroke="#fff"><path d="M6 13a6 6 0 0 1 12 0v1H6z" /><path d="M5 17h14" /><path d="M12 7V5" /></svg>
);

const imgCache = new Map();
const STOPWORDS = new Set(["with", "and", "the", "style", "simple", "easy", "quick", "for", "your", "from"]);

function dishWords(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/[^a-zñ\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOPWORDS.has(w));
}

async function fetchDishImage(name) {
  if (imgCache.has(name)) return imgCache.get(name);
  const url =
    "https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrlimit=5&prop=pageimages&piprop=thumbnail&pithumbsize=640&format=json&origin=*&gsrsearch=" +
    encodeURIComponent(name);
  try {
    const res = await fetch(url);
    const data = await res.json();
    const pages = Object.values(data?.query?.pages || {}).sort((a, b) => a.index - b.index);
    const wanted = dishWords(name);
    const need = Math.max(1, Math.ceil(wanted.length / 2));
    const hit = pages.find((pg) => {
      if (!pg.thumbnail?.source) return false;
      const titleWords = new Set(dishWords(pg.title));
      return wanted.filter((w) => titleWords.has(w)).length >= need;
    });
    const value = hit ? { src: hit.thumbnail.source, title: hit.title } : null;
    imgCache.set(name, value);
    return value;
  } catch {
    return null;
  }
}

function DishPhoto({ name, photo, onPhoto, onRemove }) {
  const inputRef = useRef(null);
  const [wiki, setWiki] = useState(() => (imgCache.has(name) ? imgCache.get(name) : undefined));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (photo) return;
    let off = false;
    fetchDishImage(name).then((v) => {
      if (!off) setWiki(v);
    });
    return () => {
      off = true;
    };
  }, [name, photo]);

  async function pick(file) {
    if (!file) return;
    setBusy(true);
    setErr("");
    try {
      onPhoto(await resizeImageFile(file, 800, 0.72));
    } catch (e) {
      setErr(e.message || "Couldn't read that photo.");
    } finally {
      setBusy(false);
    }
  }

  const src = photo || wiki?.src;

  return (
    <div className="dish-photo">
      {src ? (
        <img
          src={src}
          alt={photo ? `Your photo of ${name}` : name}
          loading="lazy"
          onError={() => {
            if (!photo) setWiki(null);
          }}
        />
      ) : (
        <div className={`dish-photo-ph ${wiki === undefined ? "dish-photo-loading" : ""}`}>
          <span className="dish-photo-emoji"><IconPlate /></span>
          {wiki === null && <span className="dish-photo-hint">No photo found online. Add a photo of your dish.</span>}
        </div>
      )}
      {photo && <span className="photo-credit">Your photo</span>}
      {!photo && wiki?.src && <span className="photo-credit">Photo: Wikipedia · {wiki.title}</span>}
      <div className="photo-actions">
        <button type="button" className="photo-btn" disabled={busy} onClick={() => inputRef.current?.click()}>
          {busy ? "Saving…" : photo ? "Change photo" : "Add your photo"}
        </button>
        {photo && (
          <button type="button" className="photo-btn" onClick={onRemove}>
            Remove
          </button>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          pick(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      {err && <div className="photo-err">{err}</div>}
    </div>
  );
}

export default function App() {
  const [tab, setTab] = useState("cook");
  const [ingredients, setIngredients] = useState(() => load("fc.ingredients", []));
  const [draft, setDraft] = useState("");
  const [budget, setBudget] = useState(() => load("fc.budget", 50));
  const [equipment, setEquipment] = useState(() => load("fc.equipment", EQUIPMENT[0]));
  const [servings, setServings] = useState(() => load("fc.servings", 1));
  const [recipes, setRecipes] = useState([]);
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(() => load("fc.saved", []));
  const [online, setOnline] = useState(navigator.onLine);
  const [quickAddUsage, setQuickAddUsage] = useState(() => load("fc.quickAddUsage", {}));
  const [photos, setPhotos] = useState(() => load("fc.photos", {}));
  const [photoWarn, setPhotoWarn] = useState("");
  const [lastQuery, setLastQuery] = useState(null);
  const [seenNames, setSeenNames] = useState([]);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState("");
  const [cookSessions, setCookSessions] = useState([]);
  const [activeCookId, setActiveCookId] = useState(null);
  const cameraInputRef = useRef(null);
  const galleryInputRef = useRef(null);
  const cookAudioCtxRef = useRef(null);

  useEffect(() => save("fc.ingredients", ingredients), [ingredients]);
  useEffect(() => save("fc.budget", budget), [budget]);
  useEffect(() => save("fc.equipment", equipment), [equipment]);
  useEffect(() => save("fc.servings", servings), [servings]);
  useEffect(() => save("fc.saved", saved), [saved]);
  useEffect(() => save("fc.quickAddUsage", quickAddUsage), [quickAddUsage]);
  useEffect(() => {
    try {
      localStorage.setItem("fc.photos", JSON.stringify(photos));
      setPhotoWarn("");
    } catch {
      setPhotoWarn("Your phone's storage for this app is full, so your dish photos may not be kept. Remove a few photos.");
    }
  }, [photos]);

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

  useEffect(() => {
    const anyRunning = cookSessions.some((s) => s.running && s.secondsLeft > 0);
    if (!anyRunning) return;
    const t = setTimeout(() => {
      setCookSessions((prev) =>
        prev.map((s) => (s.running && s.secondsLeft > 0 ? { ...s, secondsLeft: s.secondsLeft - 1 } : s))
      );
    }, 1000);
    return () => clearTimeout(t);
  }, [cookSessions]);

  useEffect(() => {
    const justDone = cookSessions.filter((s) => s.running && s.secondsLeft === 0);
    if (!justDone.length) return;
    setCookSessions((prev) => prev.map((s) => (s.running && s.secondsLeft === 0 ? { ...s, running: false } : s)));
    playAlarmBeeps(cookAudioCtxRef);
  }, [cookSessions]);

  function updateSession(id, patch) {
    setCookSessions((prev) =>
      prev.map((s) => (s.id === id ? { ...s, ...(typeof patch === "function" ? patch(s) : patch) } : s))
    );
  }

  function startCooking(recipe) {
    const id = recipe.name;
    setCookSessions((prev) => {
      if (prev.some((s) => s.id === id)) return prev;
      return [...prev, { id, recipe, stepIndex: 0, gathered: [], secondsLeft: parseStepSeconds((recipe.steps || [])[0]), running: false }];
    });
    setActiveCookId(id);
  }

  function openCooking(id) {
    setActiveCookId((cur) => (cur === id ? null : id));
  }

  function endCooking(id) {
    setCookSessions((prev) => prev.filter((s) => s.id !== id));
    setActiveCookId((cur) => (cur === id ? null : cur));
  }

  function confirmCookStep(id) {
    const session = cookSessions.find((s) => s.id === id);
    if (!session) return;
    const steps = session.recipe.steps || [];
    if (session.stepIndex < steps.length - 1) {
      const nextIndex = session.stepIndex + 1;
      updateSession(id, { stepIndex: nextIndex, secondsLeft: parseStepSeconds(steps[nextIndex]), running: false });
    } else {
      endCooking(id);
    }
  }

  function prevCookStep(id) {
    const session = cookSessions.find((s) => s.id === id);
    if (!session || session.stepIndex === 0) return;
    const steps = session.recipe.steps || [];
    const prevIndex = session.stepIndex - 1;
    updateSession(id, { stepIndex: prevIndex, secondsLeft: parseStepSeconds(steps[prevIndex]), running: false });
  }

  function toggleCookGathered(id, name) {
    updateSession(id, (s) => ({
      gathered: s.gathered.includes(name) ? s.gathered.filter((g) => g !== name) : [...s.gathered, name]
    }));
  }

  function adjustCookTimer(id, delta) {
    updateSession(id, (s) => ({ secondsLeft: Math.max(0, (s.secondsLeft ?? 0) + delta) }));
  }

  function resetCookTimer(id) {
    const session = cookSessions.find((s) => s.id === id);
    if (!session) return;
    updateSession(id, { secondsLeft: parseStepSeconds(session.recipe.steps?.[session.stepIndex]), running: false });
  }

  function setCookRunning(id, running) {
    if (running) unlockAlarmAudio(cookAudioCtxRef);
    updateSession(id, { running });
  }

  function bumpUsage(name) {
    const key = name.toLowerCase();
    setQuickAddUsage((prev) => ({
      ...prev,
      [key]: { name: prev[key]?.name || name, count: (prev[key]?.count || 0) + 1 }
    }));
  }

  function addIngredient(raw) {
    const items = raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!items.length) return;
    setIngredients((prev) => {
      const lower = new Set(prev.map((p) => p.toLowerCase()));
      const fresh = items.filter((i) => !lower.has(i.toLowerCase()));
      return [...prev, ...fresh];
    });
    items.forEach(bumpUsage);
    setDraft("");
  }

  function removeIngredient(name) {
    setIngredients((prev) => prev.filter((p) => p !== name));
  }

  function toggleQuick(name) {
    const exists = ingredients.some((i) => i.toLowerCase() === name.toLowerCase());
    if (exists) setIngredients((prev) => prev.filter((i) => i.toLowerCase() !== name.toLowerCase()));
    else addIngredient(name);
  }

  async function handlePhotos(fileList) {
    const files = Array.from(fileList || []).slice(0, 4);
    if (!files.length) return;
    setScanning(true);
    setScanError("");
    try {
      const images = await Promise.all(files.map((f) => resizeImageFile(f)));
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ images })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Couldn't scan the photo.");
      const found = data.ingredients || [];
      if (!found.length) {
        setScanError("Didn't spot any ingredients. Try a clearer or closer photo.");
      } else {
        setIngredients((prev) => {
          const lower = new Set(prev.map((p) => p.toLowerCase()));
          const fresh = found.filter((i) => !lower.has(i.toLowerCase()));
          return [...prev, ...fresh];
        });
        found.forEach(bumpUsage);
      }
    } catch (e) {
      setScanError(
        !navigator.onLine ? "You're offline. Reconnect to scan photos." : e.message || "Couldn't scan the photo."
      );
    } finally {
      setScanning(false);
    }
  }

  async function requestRecipes(payload, avoid, fresh, previous) {
    setLoading(true);
    setError("");
    setRecipes([]);
    setNote("");
    try {
      const res = await fetch("/api/recipes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...payload, avoid })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Something went wrong.");
      const list = data.recipes || [];
      setRecipes(list);
      setNote(data.note || "");
      if (!list.length && !data.note) setNote("No recipes found.");
      setSeenNames([...avoid, ...list.map((r) => r.name)]);
      if (fresh) {
        setIngredients([]);
        setDraft("");
      }
      setTimeout(() => document.getElementById("results")?.scrollIntoView({ behavior: "smooth" }), 50);
    } catch (e) {
      if (previous) {
        setRecipes(previous.recipes);
        setNote(previous.note);
      }
      setError(
        !navigator.onLine
          ? "You're offline. Reconnect to get new recipes (your saved ones still work)."
          : e.message || "Couldn't reach the server."
      );
    } finally {
      setLoading(false);
    }
  }

  function findRecipes() {
    const all = draft.trim() ? [...ingredients, draft.trim()] : ingredients;
    if (!all.length) {
      setError("Add at least one ingredient first.");
      return;
    }
    if (draft.trim()) addIngredient(draft);
    const payload = {
      ingredients: all.join(", "),
      budget: budget === "" ? null : budget,
      equipment,
      servings
    };
    setLastQuery(payload);
    requestRecipes(payload, [], true, null);
  }

  function reloadRecipes() {
    if (!lastQuery || loading) return;
    requestRecipes(lastQuery, seenNames, false, { recipes, note });
  }

  function setPhoto(name, dataUrl) {
    setPhotos((prev) => ({ ...prev, [name]: dataUrl }));
  }

  function removePhoto(name) {
    setPhotos((prev) => {
      const next = { ...prev };
      delete next[name];
      return next;
    });
  }

  const hasResults = loading || recipes.length > 0 || Boolean(note);

  const budgetLabel = BUDGETS.find((b) => b.value === budget)?.label || "Any";

  const usageCounts = Object.fromEntries(Object.values(quickAddUsage).map((u) => [u.name.toLowerCase(), u.count]));
  const quickAddPool = [...QUICK_ADD];
  Object.values(quickAddUsage).forEach((u) => {
    if (!quickAddPool.some((p) => p.toLowerCase() === u.name.toLowerCase())) quickAddPool.push(u.name);
  });
  quickAddPool.sort((a, b) => (usageCounts[b.toLowerCase()] || 0) - (usageCounts[a.toLowerCase()] || 0));
  const quickAddChips = (
    draft.trim() ? quickAddPool.filter((q) => q.toLowerCase().includes(draft.trim().toLowerCase())) : quickAddPool
  ).slice(0, 13);
  const quickAddButtons = quickAddChips.map((q) => {
    const on = ingredients.some((i) => i.toLowerCase() === q.toLowerCase());
    return (
      <button key={q} className={`chip ${on ? "chip-selected" : ""}`} disabled={scanning} onClick={() => toggleQuick(q)}>
        {on ? "✓ " : "+ "}
        {q}
      </button>
    );
  });

  const activeSession = cookSessions.find((s) => s.id === activeCookId) || null;

  const isSaved = (r) => saved.some((s) => s.name === r.name);
  function toggleSave(r) {
    setSaved((prev) => (isSaved(r) ? prev.filter((s) => s.name !== r.name) : [r, ...prev]));
  }

  return (
    <div className={`app ${tab === "cook" && hasResults ? "app-wide" : ""}`}>
      <header className="header">
        <div className="logo"><IconPan /></div>
        <div>
          <h1>Fridge Chef</h1>
          <p>Cook with what you have.</p>
        </div>
      </header>

      {!online && <div className="banner">Offline. Saved recipes still work.</div>}
      {photoWarn && <div className="banner">{photoWarn}</div>}

      <nav className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === "cook"} className={tab === "cook" ? "active" : ""} onClick={() => setTab("cook")}>
          Cook
        </button>
        <button role="tab" aria-selected={tab === "saved"} className={tab === "saved" ? "active" : ""} onClick={() => setTab("saved")}>
          Saved ({saved.length})
        </button>
      </nav>

      {tab === "cook" && (
        <main className={`cook-layout ${hasResults ? "has-results" : ""}`}>
          <div className="cook-left">
          <section className="card">
            <label className="label card-title" htmlFor="ing">What's in your fridge?</label>
            <div className="input-row">
              <input
                id="ing"
                value={draft}
                placeholder="e.g. egg, rice, onion"
                disabled={scanning}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === ",") {
                    e.preventDefault();
                    addIngredient(draft);
                  }
                }}
              />
              <button className="btn-small" onClick={() => addIngredient(draft)} disabled={scanning || !draft.trim()}>
                Add
              </button>
            </div>

            <div className="photo-row">
              <input
                ref={cameraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                hidden
                onChange={(e) => {
                  handlePhotos(e.target.files);
                  e.target.value = "";
                }}
              />
              <input
                ref={galleryInputRef}
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={(e) => {
                  handlePhotos(e.target.files);
                  e.target.value = "";
                }}
              />
              <button type="button" className="chip chip-photo" disabled={loading || scanning} onClick={() => cameraInputRef.current?.click()}>
                <IconCamera />Take photo
              </button>
              <button type="button" className="chip chip-photo" disabled={loading || scanning} onClick={() => galleryInputRef.current?.click()}>
                <IconImage />Upload photos
              </button>
            </div>
            {scanning && <div className="scan-hint">AI is scanning your photo…</div>}
            {scanError && <div className="error" role="alert">{scanError}</div>}

            {ingredients.length > 0 && (
              <div className="chips">
                {ingredients.map((i) => (
                  <span key={i} className="chip chip-on">
                    {i}
                    <button aria-label={`Remove ${i}`} disabled={scanning} onClick={() => removeIngredient(i)}>×</button>
                  </span>
                ))}
              </div>
            )}

            {quickAddChips.length > 0 && (
              draft.trim() ? (
                <>
                  <div className="sublabel">Matches</div>
                  <div className="chips">{quickAddButtons}</div>
                </>
              ) : (
                <details className="quick-add">
                  <summary>Quick add common items</summary>
                  <div className="chips">{quickAddButtons}</div>
                </details>
              )
            )}
          </section>

          <section className="card">
            <details className="options">
              <summary>
                Options
                <span className="options-hint">
                  {budgetLabel} · {equipment.split(" (")[0]} · {servings} serving{servings > 1 ? "s" : ""}
                </span>
              </summary>
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
            </details>
          </section>

          <button className="btn-primary" onClick={findRecipes} disabled={loading || !online}>
            {loading ? "Cooking up ideas…" : "Find recipes"}
          </button>

          {error && <div className="error" role="alert">{error}</div>}
          </div>

          <div className="cook-right">
          <div id="results">
            {recipes.length > 0 && !loading && lastQuery && (
              <div className="results-head">
                <div className="results-text">
                  <div className="results-title">{recipes.length} ideas for tonight</div>
                  <div className="results-based">Based on: {lastQuery.ingredients}</div>
                </div>
                <button type="button" className="btn-new" onClick={reloadRecipes} disabled={!online}>
                  <IconRefresh />New ideas
                </button>
              </div>
            )}
            {loading && (
              <div className="skeletons" aria-hidden="true">
                <div className="skeleton" /><div className="skeleton" /><div className="skeleton" />
              </div>
            )}
            {recipes.map((r) => (
              <RecipeCard
                key={r.name}
                recipe={r}
                saved={isSaved(r)}
                onToggleSave={() => toggleSave(r)}
                isCooking={cookSessions.some((s) => s.id === r.name)}
                photo={photos[r.name]}
                onPhoto={(d) => setPhoto(r.name, d)}
                onRemovePhoto={() => removePhoto(r.name)}
                onStartCooking={() => startCooking(r)}
              />
            ))}
            {note && <p className="note">{note}</p>}
            {recipes.length > 0 && !loading && lastQuery && (
              <button type="button" className="btn-reload" onClick={reloadRecipes} disabled={!online}>
                Not feeling these? Show different dishes
              </button>
            )}
          </div>
          </div>
        </main>
      )}

      {tab === "saved" && (
        <main>
          {saved.length === 0 ? (
            <div className="empty">
              <div className="empty-icon">
                <svg width="40" height="40" {...svgProps} strokeWidth="1.6"><path d="M6 4h12v17l-6-4-6 4z" /></svg>
              </div>
              <p>No saved recipes yet.</p>
            </div>
          ) : (
            saved.map((r) => (
              <RecipeCard
                key={r.name}
                recipe={r}
                saved
                onToggleSave={() => toggleSave(r)}
                isCooking={cookSessions.some((s) => s.id === r.name)}
                photo={photos[r.name]}
                onPhoto={(d) => setPhoto(r.name, d)}
                onRemovePhoto={() => removePhoto(r.name)}
                onStartCooking={() => startCooking(r)}
              />
            ))
          )}
        </main>
      )}

      <footer className="footer">Estimates only. Cook food thoroughly.</footer>

      {cookSessions.length > 0 && (
        <CookDock sessions={cookSessions} activeId={activeCookId} onOpen={openCooking} onEnd={endCooking} />
      )}

      {activeSession && (
        <CookMode
          key={activeSession.id}
          session={activeSession}
          onMinimize={() => setActiveCookId(null)}
          onStop={() => endCooking(activeSession.id)}
          onConfirm={() => confirmCookStep(activeSession.id)}
          onPrev={() => prevCookStep(activeSession.id)}
          onToggleGathered={(name) => toggleCookGathered(activeSession.id, name)}
          onAdjustTimer={(delta) => adjustCookTimer(activeSession.id, delta)}
          onResetTimer={() => resetCookTimer(activeSession.id)}
          onSetRunning={(running) => setCookRunning(activeSession.id, running)}
        />
      )}
    </div>
  );
}

function RecipeCard({ recipe: r, saved, onToggleSave, onStartCooking, isCooking, photo, onPhoto, onRemovePhoto }) {
  const buy = r.need_to_buy || [];
  return (
    <article className="card recipe">
      <DishPhoto name={r.name} photo={photo} onPhoto={onPhoto} onRemove={onRemovePhoto} />
      <div className="recipe-top">
        <h2>{r.name}</h2>
        <button className={`heart ${saved ? "heart-on" : ""}`} onClick={onToggleSave} aria-pressed={saved} aria-label={saved ? "Unsave recipe" : "Save recipe"}>
          {saved ? "♥" : "♡"}
        </button>
      </div>
      <p className="summary">{r.summary}</p>

      <div className="meta">
        <span>{r.time_minutes} min</span>
        <span>{r.difficulty}</span>
        <span>{r.estimated_extra_cost_php > 0 ? `About ₱${r.estimated_extra_cost_php} extra` : "No extra cost"}</span>
      </div>

      {r.uses?.length > 0 && (
        <div className="row">
          <div className="sublabel">You'll use</div>
          <div className="chips">
            {r.uses.map((u) => (
              <span key={u} className="chip chip-have">{u}</span>
            ))}
          </div>
        </div>
      )}

      <div className="row">
        <div className="sublabel">Need to buy</div>
        {buy.length === 0 ? (
          <span className="good">Nothing! You have it all.</span>
        ) : (
          <div className="chips">
            {buy.map((b) => (
              <span key={b} className="chip chip-buy">{b}</span>
            ))}
          </div>
        )}
      </div>

      <button className="btn-cook" onClick={onStartCooking}>
        {isCooking ? "Resume cooking" : "Start cooking"}
      </button>
    </article>
  );
}

function CookDock({ sessions, activeId, onOpen, onEnd }) {
  return (
    <div className="cook-dock">
      {sessions.map((s) => {
        const steps = s.recipe.steps || [];
        return (
          <div key={s.id} className={`cook-dock-tab ${activeId === s.id ? "active" : ""}`}>
            <button type="button" className="cook-dock-open" onClick={() => onOpen(s.id)}>
              <span className="cook-dock-name">{s.recipe.name}</span>
              <span className="cook-dock-progress">
                Step {s.stepIndex + 1}/{steps.length}
                {s.running ? ` · ${formatClock(s.secondsLeft)}` : ""}
              </span>
            </button>
            <button type="button" className="cook-dock-close" aria-label={`Stop cooking ${s.recipe.name}`} onClick={() => onEnd(s.id)}>
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}

function CookMode({ session, onMinimize, onStop, onConfirm, onPrev, onToggleGathered, onAdjustTimer, onResetTimer, onSetRunning }) {
  const r = session.recipe;
  const { stepIndex, secondsLeft, running, gathered } = session;

  useEffect(() => {
    let wakeLock;
    navigator.wakeLock?.request("screen").then((wl) => (wakeLock = wl)).catch(() => {});
    return () => wakeLock?.release().catch(() => {});
  }, []);

  const ingredients = [...(r.uses || []), ...(r.need_to_buy || [])];
  const steps = r.steps || [];
  const stepDuration = parseStepSeconds(steps[stepIndex]);

  return (
    <div className="cook-mode">
      <div className="cook-mode-inner">
        <div className="cook-top">
          <button className="cook-back" aria-label="Minimize cook mode" onClick={onMinimize}>—</button>
          <h2>{r.name}</h2>
          <button className="cook-stop" onClick={onStop}>Stop cooking</button>
        </div>

        {ingredients.length > 0 && (
          <section className="cook-section">
            <div className="sublabel">Gather these</div>
            <ul className="cook-checklist">
              {ingredients.map((ing) => (
                <li key={ing}>
                  <label>
                    <input type="checkbox" checked={gathered.includes(ing)} onChange={() => onToggleGathered(ing)} />
                    <span className={gathered.includes(ing) ? "done" : ""}>{ing}</span>
                  </label>
                </li>
              ))}
            </ul>
          </section>
        )}

        {steps.length > 0 && (
          <section className="cook-section">
            <div className="cook-progress-row">
              <div className="sublabel">Step {stepIndex + 1} of {steps.length}</div>
              <span className="cook-progress">{stepIndex}/{steps.length} done</span>
            </div>
            <div className="cook-progress-bar">
              <div className="cook-progress-fill" style={{ width: `${(stepIndex / steps.length) * 100}%` }} />
            </div>

            <p className="cook-step-text">{steps[stepIndex]}</p>

            {stepDuration != null && (
              <div className="cook-timer">
                <div className="cook-timer-main">
                  <span className={`cook-timer-clock ${secondsLeft === 0 ? "cook-timer-done" : ""}`}>
                    {formatClock(secondsLeft)}
                  </span>
                  <span className="cook-timer-rec">Recommended {formatClock(stepDuration)}</span>
                </div>
                <div className="cook-timer-actions">
                  <button type="button" className="chip" onClick={() => onAdjustTimer(-60)}>−1 min</button>
                  <button type="button" className="chip" onClick={() => onAdjustTimer(-10)}>−10s</button>
                  <button type="button" className="chip" onClick={() => onAdjustTimer(10)}>+10s</button>
                  <button type="button" className="chip" onClick={() => onAdjustTimer(60)}>+1 min</button>
                  {running ? (
                    <button type="button" className="chip" onClick={() => onSetRunning(false)}>⏸ Pause</button>
                  ) : (
                    <button type="button" className="chip" disabled={secondsLeft <= 0} onClick={() => onSetRunning(true)}>▶ Start</button>
                  )}
                  <button type="button" className="chip" onClick={onResetTimer}>↺ Use recommended</button>
                </div>
              </div>
            )}

            {stepDuration != null && secondsLeft > 0 && (
              <p className="cook-timer-wait">⏳ Finish the timer to continue.</p>
            )}

            <div className="cook-step-nav">
              <button type="button" className="chip" disabled={stepIndex === 0} onClick={onPrev}>
                ← Back
              </button>
              <button
                type="button"
                className="btn-primary cook-confirm"
                disabled={stepDuration != null && secondsLeft > 0}
                onClick={onConfirm}
              >
                {stepIndex < steps.length - 1 ? "✓ Confirm & next step" : "✓ Confirm — done cooking!"}
              </button>
            </div>
          </section>
        )}

        {r.substitutions?.length > 0 && (
          <section className="cook-section subs">
            <strong>Swap ideas</strong>
            <ul>
              {r.substitutions.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          </section>
        )}

        <button className="btn-primary" onClick={onMinimize}>Back to recipes</button>
      </div>
    </div>
  );
}
