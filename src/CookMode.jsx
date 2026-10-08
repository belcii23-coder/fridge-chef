import { useCallback, useEffect, useRef, useState } from "react";
import { canon } from "./food.js";

// Full-screen, big-text, one-step-at-a-time cooking view with timers.

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

function beep(ctx) {
  try {
    if (!ctx) return;
    for (let i = 0; i < 3; i++) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = 880;
      g.gain.value = 0.2;
      o.connect(g);
      g.connect(ctx.destination);
      const t = ctx.currentTime + i * 0.35;
      o.start(t);
      o.stop(t + 0.2);
    }
  } catch {
    /* sound is a bonus */
  }
}

export default function CookMode({ recipe: r, onClose }) {
  const steps = r.steps || [];
  const [idx, setIdx] = useState(-1); // -1 = get-ready checklist, steps.length = finished
  const [have, setHave] = useState({}); // checklist ticks
  const [timers, setTimers] = useState({}); // "step-n" -> { total, endAt, left, state }
  const [, force] = useState(0);
  const [ringing, setRinging] = useState([]);
  const [wake, setWake] = useState("");
  const audioRef = useRef(null);
  const lockRef = useRef(null);
  const closeRef = useRef(null);
  const timersRef = useRef({});
  timersRef.current = timers;

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

  /* full-screen: lock page scroll, remember focus */
  useEffect(() => {
    const prevFocus = document.activeElement;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = prev;
      prevFocus?.focus?.();
      try { audioRef.current?.close(); } catch { /* ignore */ }
    };
  }, []);

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
        beep(audioRef.current);
        try { navigator.vibrate?.([300, 150, 300, 150, 300]); } catch { /* ignore */ }
      }
      force((n) => n + 1);
    }, 250);
    return () => clearInterval(id);
  }, []);

  const go = useCallback((d) => setIdx((i) => Math.min(Math.max(i + d, -1), steps.length)), [steps.length]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [go, onClose]);

  function startTimer(key, seconds) {
    // Sound can only start from a tap, so prepare it here.
    try {
      if (!audioRef.current) audioRef.current = new (window.AudioContext || window.webkitAudioContext)();
      audioRef.current.resume?.();
    } catch { /* ignore */ }
    setTimers((p) => ({ ...p, [key]: { total: seconds, endAt: Date.now() + seconds * 1000, left: seconds, state: "running" } }));
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

  const left = (t) => (t.state === "running" ? Math.max(0, (t.endAt - Date.now()) / 1000) : t.left);

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

  const activeOther = Object.entries(timers).filter(([k, t]) => t.state !== "done" || ringing.includes(k));
  const progress = idx < 0 ? 0 : Math.min(100, Math.round(((idx + 1) / (steps.length + 1)) * 100));

  return (
    <div className="cook" role="dialog" aria-modal="true" aria-labelledby="cook-title">
      <div className="cook-top">
        <div className="cook-title">
          <h2 id="cook-title">{r.name}</h2>
          <small>
            {idx < 0 ? "Get ready" : idx >= steps.length ? "All done" : `Step ${idx + 1} of ${steps.length}`}
          </small>
        </div>
        <button ref={closeRef} className="modal-close" onClick={onClose} aria-label="Exit cook mode">×</button>
      </div>
      <div className="cook-progress" aria-hidden="true"><span style={{ width: `${progress}%` }} /></div>

      {activeOther.length > 0 && (
        <div className="cook-timers" aria-live="polite">
          {activeOther.map(([k, t]) => {
            const n = Number(k.split("-")[1]);
            const isRinging = ringing.includes(k);
            return (
              <button key={k} className={`timer-pill ${isRinging ? "ringing" : ""}`} onClick={() => (isRinging ? clearTimer(k) : setIdx(n))}>
                {isRinging ? `⏰ Step ${n + 1} timer is done! Tap to dismiss` : `⏱ Step ${n + 1} · ${mmss(left(t))}${t.state === "paused" ? " (paused)" : ""}`}
              </button>
            );
          })}
        </div>
      )}

      <div className="cook-body">
        {idx < 0 && (
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
                          <input type="checkbox" checked={!!have[i.name]} onChange={() => setHave((h) => ({ ...h, [i.name]: !h[i.name] }))} />
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

        {idx >= 0 && idx < steps.length && (
          <div>
            <p className="cook-step">{text}</p>

            {found.length > 0 && (() => {
              const f = found[0]; // one timer per step keeps it simple
              const k = `step-${idx}`;
              const t = timers[k];
              return (
                <div className="cook-timer-box">
                  {t ? (
                    <div className={`timer ${t.state}`}>
                      <div className="timer-time" aria-label="Time left">{t.state === "done" ? "Time's up!" : mmss(left(t))}</div>
                      <div className="timer-btns">
                        {t.state === "running" && <button onClick={() => pauseTimer(k)}>Pause</button>}
                        {t.state === "paused" && <button onClick={() => resumeTimer(k)}>Resume</button>}
                        {t.state === "done" && <button onClick={() => clearTimer(k)}>Dismiss</button>}
                        {t.state !== "done" && <button onClick={() => clearTimer(k)}>Reset</button>}
                      </div>
                    </div>
                  ) : (
                    <button className="timer-start" onClick={() => startTimer(k, f.seconds)}>
                      ⏱ Start {mmss(f.seconds)} timer
                      <small>({f.label})</small>
                    </button>
                  )}
                </div>
              );
            })()}

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

        {idx >= steps.length && (
          <div className="cook-finish">
            <div className="placeholder-emoji">🎉</div>
            <h2>Sarap! Enjoy your {r.name}</h2>
            <p>Taste once more and add salt, pepper or sugar if it needs it. Check that everything is cooked through before you eat.</p>
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
          <button className="cook-next" onClick={onClose}>Close</button>
        )}
      </div>
    </div>
  );
}
