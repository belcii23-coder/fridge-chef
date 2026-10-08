import { useState } from "react";
import { peso } from "./food.js";

// One checklist for everything you still need to buy, across all recipes.
export default function Shopping({ items, setItems, onGoCook }) {
  const [copied, setCopied] = useState(false);
  const todo = items.filter((i) => !i.done);
  const done = items.filter((i) => i.done);
  const sum = (list) => list.reduce((s, i) => s + (Number(i.price) || 0), 0);

  const toggle = (key) => setItems((prev) => prev.map((i) => (i.key === key ? { ...i, done: !i.done } : i)));
  const remove = (key) => setItems((prev) => prev.filter((i) => i.key !== key));

  async function copyList() {
    const text = todo.map((i) => `- ${i.name}${i.amount ? ` (${i.amount})` : ""}`).join("\n");
    try {
      await navigator.clipboard.writeText(`Shopping list\n${text}\nAbout ${peso(sum(todo))}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard can be blocked; the list is still on screen */
    }
  }

  if (!items.length) {
    return (
      <main className="saved">
        <div className="placeholder">
          <div className="placeholder-emoji">🛒</div>
          <h2>Your shopping list is empty</h2>
          <p>Open a recipe and tap an item under "Need to buy" (or "Add to shopping list"). Items from all your recipes show up here in one checklist.</p>
          <button className="btn-view placeholder-btn" onClick={onGoCook}>Find recipes</button>
        </div>
      </main>
    );
  }

  const row = (i) => (
    <li key={i.key} className={`shop-row ${i.done ? "shop-done" : ""}`}>
      <label>
        <input type="checkbox" checked={i.done} onChange={() => toggle(i.key)} />
        <span className="shop-text">
          <span className="shop-name">
            {i.name}
            {i.amount ? <small> · {i.amount}</small> : null}
          </span>
          <small className="shop-for">for {i.recipes.join(", ")}</small>
        </span>
      </label>
      <span className="shop-price">{i.price ? `≈ ${peso(i.price)}` : "—"}</span>
      <button className="shop-x" aria-label={`Remove ${i.name}`} onClick={() => remove(i.key)}>×</button>
    </li>
  );

  return (
    <main className="saved shopping">
      <section className="card">
        <div className="shop-total" role="status">
          <div>
            <span className="shop-total-label">Still to buy</span>
            <strong>{todo.length ? `≈ ${peso(sum(todo))}` : "All done 🎉"}</strong>
          </div>
          <small>{todo.length} item{todo.length === 1 ? "" : "s"} · rough estimate, real prices vary by store</small>
        </div>

        {todo.length > 0 && <ul className="shop-list">{todo.map(row)}</ul>}

        {done.length > 0 && (
          <>
            <div className="sublabel">In the basket · {peso(sum(done))}</div>
            <ul className="shop-list">{done.map(row)}</ul>
          </>
        )}

        <div className="shop-actions">
          <button className="btn-ghost" onClick={copyList} disabled={!todo.length}>{copied ? "✓ Copied" : "📋 Copy list"}</button>
          <button className="btn-ghost" onClick={() => setItems((prev) => prev.filter((i) => !i.done))} disabled={!done.length}>Clear checked</button>
          <button className="btn-ghost" onClick={() => setItems([])}>Clear all</button>
        </div>
      </section>
    </main>
  );
}
