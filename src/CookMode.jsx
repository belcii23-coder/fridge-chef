import { useCallback, useEffect, useRef, useState } from "react";
import { canon } from "./food.js";

// Full-screen, big-text, one-step-at-a-time cooking view with timers.
// You can cook several dishes at once: switch between them with the tabs, and every timer keeps running.

/** Finds times in a step, e.g. "simmer for 10 to 15 minutes" -> [{seconds: 900, label: "15 min"}] */
export function findTimers(step) {
  const out = [];
  const re = /(\d+(?:\.\d+)?)(?:\s*(?:-|–|to)\s*(\d+(?:\.\d+)?))?\s*(hours?|hrs?|minutes?|mins?|seconds?|secs?)\b/gi;
  let m;
  while ((m = re.exec(step))) {
    const n = Number(m[2] || m[1]);
    const unit = m[3].toLowerCase();
    const mult = unit.startsWith("h") ? 3600 : unit.startsWith("m") ? 60 : 1;
    const seconds = Math.round(n * mult);
    if (seconds >= 5 && seconds <= 3 * 3600) out.push({ seconds, label: m[0].replace(/\s+/g, " ") });
  }
  return out;
}

const mmss = (s) => {
  s = Math.max(0, Math.ceil(s - 0.05)); // small cushion so a fresh 15:00 timer never flashes 15:01
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(h ? 2 : 1, "0");
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
};

const MIN_SECONDS = 5;
const MAX_SECONDS = 6 * 3600;
const clampSeconds = (s) => Math.min(Math.max(Math.round(s), MIN_SECONDS), MAX_SECONDS);

// Timer keys look like "Pork Adobo::2" (dish name, step number).
const keyOf = (dish, step) => `${dish}::${step}`;
const splitKey = (k) => {
  const i = k.lastIndexOf("::");
  return { dish: k.slice(0, i), step: Number(k.slice(i + 2)) };
};

/** A loud, repeating-friendly alarm: four quick two-tone beeps. */
function alarmSound(ctx) {
  try {
    if (!ctx || ctx.state === "closed") return;
    ctx.resume?.()?.catch?.(() => {});
    [988, 784, 988, 784].forEach((freq, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "square";
      o.frequency.value = freq;
      const t = ctx.currentTime + i * 0.28;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
      o.connect(g);
      g.connect(ctx.destination);
      o.start(t);
      o.stop(t + 0.24);
    });
  } catch {
    /* sound is a bonus */
  }
}

/** Minutes box that lets you type freely (even an empty box) and applies the value when you leave it. */
function MinutesInput({ seconds, onChange, label }) {
  const shown = String(Math.round((seconds / 60) * 100) / 100);
  const [text, setText] = useState(shown);
  useEffect(() => setText(shown), [shown]);
  const apply = () => {
    const n = parseFloat(text);
    if (Number.isFinite(n) && n > 0) onChange(clampSeconds(n * 60));
    else setText(shown);
  };
  return (
    <label className="min-input">
      <input
        type="number"
        inputMode="decimal"
        min="0.1"
        step="0.5"
        value={text}
        aria-label={label}
        onChange={(e) => setText(e.target.value)}
        onBlur={apply}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      />
      <span>min</span>
    </label>
  );
}

export default function CookMode({ dishes, choices = [], minimized, onAddDish, onRemoveDish, onMinimize, onRestore, onClose }) {
  const [active, setActive] = useState(dishes[0]?.name);
  const [prog, setProg] = useState({}); // dish name -> { idx, have }  (idx: -1 = get-ready checklist, steps.length = finished)
  const [timers, setTimers] = useState({}); // "dish::step" -> { total, endAt, left, state }
  const [plan, setPlan] = useState({}); // "dish::step" -> seconds chosen before the timer starts
  const [ringing, setRinging] = useState([]);
  const [showAdd, setShowAdd] = useState(false);
  const [wake, setWake] = useState("");
  const [, force] = useState(0);
  const audioRef = useRef(null);
  const lockRef = useRef(null);
  const closeRef = useRef(null);
  const timersRef = useRef({});
  const dishesRef = useRef(dishes);
  timersRef.current = timers;
  dishesRef.current = dishes;

  const r = dishes.find((d) => d.name === active) || dishes[0];
  const steps = r?.steps || [];
  const P = (name) => prog[name] || { idx: -1, have: {} };
  const idx = r ? P(r.name).idx : -1;
  const have = r ? P(r.name).have : {};
  const setIdxFor = (name, fn) =>
    setProg((p) => {
      const cur = p[name] || { idx: -1, have: {} };
      return { ...p, [name]: { ...cur, idx: typeof fn === "function" ? fn(cur.idx) : fn } };
    });
  const toggleHave = (name, item) =>
    setProg((p) => {
      const cur = p[name] || { idx: -1, have: {} };
      return { ...p, [name]: { ...cur, have: { ...cur.have, [item]: !cur.have[item] } } };
    });

  /* when a new dish is added, jump to it */
  const prevCount = useRef(dishes.length);
  useEffect(() => {
    if (dishes.length > prevCount.current) setActive(dishes[dishes.length - 1].name);
    prevCount.current = dishes.length;
  }, [dishes]);

  /* if the active dish was removed, fall back to the first one */
  useEffect(() => {
    if (!dishes.some((d) => d.name === active)) setActive(dishes[0]?.name);
  }, [dishes, active]);

  function ensureAudio() {
    try {
      if (!audioRef.current || audioRef.current.state === "closed") {
        audioRef.current = new (window.AudioContext || window.webkitAudioContext)();
      }
      audioRef.current.resume?.()?.catch?.(() => {});
    } catch {
      /* ignore */
    }
  }

  /* sound can only start after a tap, so unlock it as soon as cook mode opens and on every tap */
  useEffect(() => {
    ensureAudio();
    const unlock = () => ensureAudio();
    document.addEventListener("pointerdown", unlock);
    return () => {
      document.removeEventListener("pointerdown", unlock);
      try { audioRef.current?.close()?.catch?.(() => {}); } catch { /* ignore */ }
      audioRef.current = null;
    };
  }, []);

  /* keep the screen on while cooking */
  useEffect(() => {
    let cancelled = false;
    async function lock() {
      try {
        if (!("wakeLock" in navigator)) return setWake("Your browser may dim the screen while you cook.");
        lockRef.current = await navigator.wakeLock.request("screen");
        if (cancelled) lockRef.current.release();
      } catch {
        setWake("Couldn't keep the screen on. It may dim while you cook.");
      }
    }
    lock();
    const onVis = () => document.visibilityState === "visible" && lock();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVis);
      lockRef.current?.release?.().catch?.(() => {});
    };
  }, []);

  /* full-screen: lock page scroll, remember focus (only while it covers the page) */
  useEffect(() => {
    if (minimized) return;
    const prevFocus = document.activeElement;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = prev;
      prevFocus?.focus?.();
    };
  }, [minimized]);

  /* tick: timers are based on the clock, so they stay right if the phone sleeps for a bit */
  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now();
      const finished = Object.entries(timersRef.current)
        .filter(([, t]) => t.state === "running" && now >= t.endAt)
        .map(([k]) => k);
      if (finished.length) {
        setTimers((prev) => {
          const next = { ...prev };
          for (const k of finished) if (next[k]) next[k] = { ...next[k], state: "done", left: 0 };
          return next;
        });
        setRinging((p) => [...new Set([...p, ...finished])]);
        try {
          if (document.hidden && "Notification" in window && Notification.permission === "granted") {
            for (const k of finished) {
              const { dish, step } = splitKey(k);
              new Notification("⏰ Timer done!", { body: `${dish} · step ${step + 1}`, tag: k });
            }
          }
        } catch {
          /* notifications are a bonus */
        }
      }
      force((n) => n + 1);
    }, 250);
    return () => clearInterval(id);
  }, []);

  /* the alarm keeps ringing (sound, buzz, flashing tab title) until you dismiss it */
  const isRinging = ringing.length > 0;
  useEffect(() => {
    if (!isRinging) return;
    const ring = () => {
      alarmSound(audioRef.current);
      try { navigator.vibrate?.([400, 200, 400, 200, 400]); } catch { /* ignore */ }
    };
    ring();
    const id = setInterval(ring, 2500);
    const title = document.title;
    let on = false;
    const tid = setInterval(() => {
      on = !on;
      document.title = on ? "⏰ Timer done!" : title;
    }, 1000);
    return () => {
      clearInterval(id);
      clearInterval(tid);
      document.title = title;
    };
  }, [isRinging]);

  const go = useCallback(
    (d) => {
      if (!r) return;
      setIdxFor(r.name, (i) => Math.min(Math.max(i + d, -1), (r.steps || []).length));
    },
    [r] // eslint-disable-line react-hooks/exhaustive-deps
  );

  useEffect(() => {
    const onKey = (e) => {
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName || "")) return;
      if (minimized) return;
      if (e.key === "Escape") (showAdd ? setShowAdd(false) : onMinimize());
      else if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [go, onMinimize, minimized, showAdd]);

  function startTimer(key, seconds) {
    ensureAudio();
    try {
      if ("Notification" in window && Notification.permission === "default") Notification.requestPermission();
    } catch {
      /* ignore */
    }
    const s = clampSeconds(seconds);
    setTimers((p) => ({ ...p, [key]: { total: s, endAt: Date.now() + s * 1000, left: s, state: "running" } }));
  }
  function pauseTimer(key) {
    setTimers((p) => ({ ...p, [key]: { ...p[key], state: "paused", left: Math.max(0, (p[key].endAt - Date.now()) / 1000) } }));
  }
  function resumeTimer(key) {
    setTimers((p) => ({ ...p, [key]: { ...p[key], state: "running", endAt: Date.now() + p[key].left * 1000 } }));
  }
  function clearTimer(key) {
    setTimers((p) => {
      const { [key]: _x, ...rest } = p;
      return rest;
    });
    setRinging((p) => p.filter((k) => k !== key));
  }
  /** Add or remove time on a timer that is already running or paused. */
  function nudgeTimer(key, deltaSeconds) {
    setTimers((p) => {
      const t = p[key];
      if (!t || t.state === "done") return p;
      if (t.state === "running") {
        const now = Date.now();
        const newLeft = Math.max(MIN_SECONDS, (t.endAt - now) / 1000 + deltaSeconds);
        return { ...p, [key]: { ...t, endAt: now + newLeft * 1000, total: Math.max(t.total + deltaSeconds, newLeft) } };
      }
      const newLeft = Math.max(MIN_SECONDS, t.left + deltaSeconds);
      return { ...p, [key]: { ...t, left: newLeft, total: Math.max(t.total + deltaSeconds, newLeft) } };
    });
  }
  function stopAlarm() {
    for (const k of ringing) clearTimer(k);
  }
  function endCooking() {
    const busy = Object.values(timers).some((t) => t.state !== "done");
    if (busy && !window.confirm("You still have timers running. Stop cooking and clear them?")) return;
    onClose();
  }
  function finishDish(name) {
    for (const k of Object.keys(timers)) if (splitKey(k).dish === name) clearTimer(k);
    onRemoveDish(name);
  }

  const left = (t) => (t.state === "running" ? Math.max(0, (t.endAt - Date.now()) / 1000) : t.left);

  /* ---------- small bar shown while you browse other recipes ---------- */
  if (minimized) {
    const running = Object.entries(timers)
      .filter(([, t]) => t.state === "running")
      .sort((a, b) => left(a[1]) - left(b[1]));
    let summary = "Tap to go back to cooking";
    if (isRinging) summary = `⏰ ${splitKey(ringing[0]).dish} timer is done!`;
    else if (running.length) summary = `⏱ ${splitKey(running[0][0]).dish} · ${mmss(left(running[0][1]))}${running.length > 1 ? ` (+${running.length - 1} more)` : ""}`;
    return (
      <div className={`cook-mini ${isRinging ? "ringing" : ""}`} role="status" aria-live="polite">
        <button className="cook-mini-main" onClick={onRestore}>
          <strong>👩‍🍳 Cooking {dishes.length} dish{dishes.length === 1 ? "" : "es"}</strong>
          <span>{summary}</span>
        </button>
        {isRinging && <button className="cook-mini-stop" onClick={stopAlarm}>Stop alarm</button>}
      </div>
    );
  }

  if (!r) return null;

  const stepNo = idx; // 0-based step index
  const text = steps[stepNo] || "";
  const found = stepNo >= 0 && stepNo < steps.length ? findTimers(text) : [];
  const ings = r.ingredients || [];

  // Ingredients mentioned in this step, shown as small cards so you don't have to scroll back.
  const stepCanon = canon(text);
  const usedNow = ings.filter((i) => {
    const c = canon(i.name);
    return c && new RegExp(`(^|\\s)${c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`).test(stepCanon);
  });

  const allTimers = Object.entries(timers);
  const progress = idx < 0 ? 0 : Math.min(100, Math.round(((idx + 1) / (steps.length + 1)) * 100));
  const addable = choices.filter((c) => !dishes.some((d) => d.name === c.name));

  const timerKey = keyOf(r.name, idx);
  // The recipe's own time (written in the step) comes first, then the AI's suggested minutes for this step.
  const aiMinutes = Number(r.step_minutes?.[stepNo]) || 0;
  const aiSeconds = aiMinutes > 0 ? clampSeconds(aiMinutes * 60) : 0;
  const suggested = found[0]?.seconds || aiSeconds || 0;
  const suggestedLabel = found[0] ? found[0].label : aiSeconds ? `${aiMinutes} min` : "";
  const planned = plan[timerKey] ?? (suggested || undefined);
  const t = timers[timerKey];

  return (
    <div className="cook" role="dialog" aria-modal="true" aria-labelledby="cook-title">
      <div className="cook-top">
        <div className="cook-title">
          <h2 id="cook-title">{r.name}</h2>
          <small>
            {idx < 0 ? "Get ready" : idx >= steps.length ? "All done" : `Step ${idx + 1} of ${steps.length}`}
          </small>
        </div>
        <div className="cook-top-btns">
          <button className="cook-min" onClick={onMinimize} title="Browse recipes while your timers keep running">▾ Minimize</button>
          <button ref={closeRef} className="modal-close" onClick={endCooking} aria-label="Stop cooking">×</button>
        </div>
      </div>

      <div className="cook-tabs" role="tablist" aria-label="Dishes you are cooking">
        {dishes.map((d) => {
          const hasRing = ringing.some((k) => splitKey(k).dish === d.name);
          const hasTimer = allTimers.some(([k, tm]) => splitKey(k).dish === d.name && tm.state === "running");
          return (
            <button
              key={d.name}
              role="tab"
              aria-selected={d.name === r.name}
              className={`cook-tab ${d.name === r.name ? "active" : ""} ${hasRing ? "ringing" : ""}`}
              onClick={() => {
                setActive(d.name);
                setShowAdd(false);
              }}
            >
              {hasRing ? "⏰ " : hasTimer ? "⏱ " : ""}
              {d.name}
            </button>
          );
        })}
        <button className="cook-tab cook-tab-add" onClick={() => setShowAdd((v) => !v)} aria-expanded={showAdd}>
          ＋ Add dish
        </button>
      </div>
      <div className="cook-progress" aria-hidden="true"><span style={{ width: `${progress}%` }} /></div>

      {isRinging && (
        <div className="cook-alarm" role="alert">
          <span>⏰ {ringing.length === 1 ? `${splitKey(ringing[0]).dish} · step ${splitKey(ringing[0]).step + 1}` : `${ringing.length} timers`} done!</span>
          <button onClick={stopAlarm}>Stop alarm</button>
        </div>
      )}

      {allTimers.length > 0 && (
        <div className="cook-timers" aria-live="polite">
          {allTimers.map(([k, tm]) => {
            const { dish, step } = splitKey(k);
            const rings = ringing.includes(k);
            return (
              <button
                key={k}
                className={`timer-pill ${rings ? "ringing" : ""}`}
                onClick={() => {
                  if (rings) return clearTimer(k);
                  setActive(dish);
                  setIdxFor(dish, step);
                  setShowAdd(false);
                }}
              >
                {rings
                  ? `⏰ ${dish} · step ${step + 1} is done! Tap to dismiss`
                  : `⏱ ${dishes.length > 1 ? `${dish} · ` : ""}Step ${step + 1} · ${mmss(left(tm))}${tm.state === "paused" ? " (paused)" : ""}`}
              </button>
            );
          })}
        </div>
      )}

      <div className="cook-body">
        {showAdd && (
          <div className="cook-add">
            <div className="sublabel">Cook another dish at the same time</div>
            {addable.length ? (
              <ul className="cook-add-list">
                {addable.map((c) => (
                  <li key={c.name}>
                    <button
                      onClick={() => {
                        onAddDish(c);
                        setShowAdd(false);
                      }}
                    >
                      <strong>{c.name}</strong>
                      <small>{c.time_minutes ? `${c.time_minutes} min` : ""}{c.difficulty ? ` · ${c.difficulty}` : ""}</small>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="hint">No other recipes on screen. Tap Minimize, open any recipe and press "Start cooking". It joins this session and your timers keep running.</p>
            )}
            <button className="cook-add-minimize" onClick={onMinimize}>▾ Minimize and pick a recipe</button>
          </div>
        )}

        {!showAdd && idx < 0 && (
          <div>
            <p className="cook-lead">Gather everything first. Tick it off as you go.</p>
            {["main", "pampalasa"].map((kind) => {
              const list = ings.filter((i) => (kind === "pampalasa" ? i.kind === "pampalasa" : i.kind !== "pampalasa"));
              if (!list.length) return null;
              return (
                <div key={kind}>
                  <div className="sublabel">{kind === "pampalasa" ? "Pampalasa (seasonings)" : "Ingredients"}</div>
                  <ul className="prep-list">
                    {list.map((i) => (
                      <li key={i.name}>
                        <label>
                          <input type="checkbox" checked={!!have[i.name]} onChange={() => toggleHave(r.name, i.name)} />
                          <span>
                            {i.name}
                            {i.amount ? <small> · {i.amount}</small> : null}
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
            {wake && <p className="hint">{wake}</p>}
          </div>
        )}

        {!showAdd && idx >= 0 && idx < steps.length && (
          <div>
            <p className="cook-step">{text}</p>

            <div className="cook-timer-box">
              {t ? (
                <div className={`timer ${t.state}`}>
                  <div className="timer-time" aria-label="Time left">{t.state === "done" ? "Time's up!" : mmss(left(t))}</div>
                  {t.state !== "done" && (
                    <div className="timer-adjust" aria-label="Change the time">
                      <button onClick={() => nudgeTimer(timerKey, -60)} aria-label="Take off one minute">−1 min</button>
                      <button onClick={() => nudgeTimer(timerKey, 60)} aria-label="Add one minute">+1 min</button>
                    </div>
                  )}
                  <div className="timer-btns">
                    {t.state === "running" && <button onClick={() => pauseTimer(timerKey)}>Pause</button>}
                    {t.state === "paused" && <button onClick={() => resumeTimer(timerKey)}>Resume</button>}
                    {t.state === "done" && <button onClick={() => clearTimer(timerKey)}>Dismiss</button>}
                    {t.state !== "done" && <button onClick={() => clearTimer(timerKey)}>Reset</button>}
                  </div>
                </div>
              ) : planned ? (
                <div className="timer-plan">
                  <div className="timer-suggest">
                    {suggested ? (
                      <>
                        <strong>Suggested time: {suggestedLabel}</strong>
                        <span> · optional. Use it, change it, or skip it.</span>
                      </>
                    ) : (
                      <strong>Your own timer · optional</strong>
                    )}
                  </div>
                  {found.length > 1 && (
                    <div className="timer-choices" aria-label="Times found in this step">
                      {found.map((f) => (
                        <button key={f.label} className={planned === f.seconds ? "on" : ""} onClick={() => setPlan((p) => ({ ...p, [timerKey]: f.seconds }))}>
                          {f.label}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="timer-set">
                    <button onClick={() => setPlan((p) => ({ ...p, [timerKey]: clampSeconds(planned - 60) }))} aria-label="One minute less">−</button>
                    <MinutesInput seconds={planned} label="Timer minutes" onChange={(s) => setPlan((p) => ({ ...p, [timerKey]: s }))} />
                    <button onClick={() => setPlan((p) => ({ ...p, [timerKey]: clampSeconds(planned + 60) }))} aria-label="One minute more">+</button>
                  </div>
                  <button className="timer-start" onClick={() => startTimer(timerKey, planned)}>
                    ⏱ Start {mmss(planned)} timer
                    {suggested && planned !== suggested ? <small>(suggested {suggestedLabel})</small> : suggested ? <small>(suggested)</small> : null}
                  </button>
                  <div className="timer-plan-links">
                    {suggested > 0 && planned !== suggested && (
                      <button className="timer-link" onClick={() => setPlan((p) => ({ ...p, [timerKey]: suggested }))}>Use suggested time</button>
                    )}
                    <button className="timer-link" onClick={() => setPlan((p) => ({ ...p, [timerKey]: 0 }))}>No timer for this step</button>
                  </div>
                </div>
              ) : (
                <button className="timer-add" onClick={() => setPlan((p) => ({ ...p, [timerKey]: 300 }))}>⏱ Set a timer for this step</button>
              )}
            </div>

            {usedNow.length > 0 && (
              <div className="use-now">
                <div className="sublabel">Use now</div>
                <div className="chips flush">
                  {usedNow.map((i) => (
                    <span key={i.name} className={`chip ${i.kind === "pampalasa" ? "chip-buy" : "chip-have"}`}>
                      {i.name}
                      {i.amount ? ` · ${i.amount}` : ""}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {!showAdd && idx >= steps.length && (
          <div className="cook-finish">
            <div className="placeholder-emoji">🎉</div>
            <h2>Sarap! Enjoy your {r.name}</h2>
            <p>Taste once more and add salt, pepper or sugar if it needs it. Check that everything is cooked through before you eat.</p>
            {dishes.length > 1 && <p className="hint">Tap "Done with this dish" to close it. Your other dishes and their timers keep going.</p>}
          </div>
        )}
      </div>

      <div className="cook-nav">
        <button className="cook-back" onClick={() => go(-1)} disabled={idx < 0}>← Back</button>
        {idx < steps.length ? (
          <button className="cook-next" onClick={() => go(1)}>
            {idx < 0 ? "Start cooking →" : idx === steps.length - 1 ? "Finish ✓" : "Next step →"}
          </button>
        ) : (
          <button className="cook-next" onClick={() => finishDish(r.name)}>{dishes.length > 1 ? "Done with this dish" : "Close"}</button>
        )}
      </div>
    </div>
  );
}
