// SnapCal - photo calorie tracker. Static, browser-only; data in localStorage.
// AI estimates go straight from the browser to the Anthropic API with the user's own key.
import { FOODS } from "./foods.js";

const MODEL = "claude-opus-5-5";
const STORE = "snapcal.v1";
const KEY_STORE = "snapcal.apiKey";

// ---------------------------------------------------------------- state
const blank = () => ({ profile: null, days: {}, weights: [] });
let state = load();
let current = todayStr();
let draft = null; // { items: [], photo: dataURL|null, note: string }

function load() {
  try { return Object.assign(blank(), JSON.parse(localStorage.getItem(STORE)) || {}); }
  catch { return blank(); }
}
function save() { try { localStorage.setItem(STORE, JSON.stringify(state)); } catch {} }
function getKey() { try { return localStorage.getItem(KEY_STORE) || ""; } catch { return ""; } }

function todayStr(d = new Date()) {
  const z = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}
function shiftDay(s, n) { const d = new Date(s + "T12:00:00"); d.setDate(d.getDate() + n); return todayStr(d); }
const $ = (id) => document.getElementById(id);
const r0 = (x) => Math.round(x);
const r1 = (x) => Math.round(x * 10) / 10;

// ---------------------------------------------------------------- goal math
// Mifflin-St Jeor BMR x activity, minus/plus the weekly change (7700 kcal per kg).
function computeGoal(p) {
  if (!p) return null;
  const kg = p.units === "imperial" ? p.weight * 0.453592 : p.weight;
  const cm = p.units === "imperial" ? p.height * 2.54 : p.height;
  const bmr = 10 * kg + 6.25 * cm - 5 * p.age + (p.sex === "male" ? 5 : -161);
  const tdee = bmr * p.activity;
  const floor = p.sex === "male" ? 1500 : 1200;
  const kcal = Math.max(floor, Math.round((tdee + (p.goal * 7700) / 7) / 10) * 10);
  const protein = Math.round(kg * (p.goal < 0 ? 1.8 : 1.6));
  const fat = Math.round((kcal * 0.28) / 9);
  const carbs = Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4));
  return { kcal, protein, carbs, fat, bmr: Math.round(bmr), tdee: Math.round(tdee), floored: kcal === floor };
}

// ---------------------------------------------------------------- render: today
function dayMeals(d = current) { return state.days[d] || []; }
function totals(meals) {
  const t = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
  meals.forEach((m) => m.items.forEach((i) => { t.kcal += i.kcal; t.protein += i.protein; t.carbs += i.carbs; t.fat += i.fat; }));
  return t;
}

function renderToday() {
  const goal = computeGoal(state.profile);
  const t = totals(dayMeals());
  const isToday = current === todayStr();
  $("day-label").textContent = isToday ? "Today" : new Date(current + "T12:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  $("next-day").disabled = isToday;

  const target = goal ? goal.kcal : 0;
  const left = target - t.kcal;
  $("kcal-goal").textContent = goal ? goal.kcal.toLocaleString() : "Set goal";
  $("kcal-eaten").textContent = r0(t.kcal).toLocaleString();
  $("kcal-left").textContent = goal ? Math.abs(r0(left)).toLocaleString() : r0(t.kcal).toLocaleString();
  $("kcal-left-label").textContent = !goal ? "kcal eaten" : left >= 0 ? "kcal left" : "kcal over";
  const C = 2 * Math.PI * 52;
  const frac = goal ? Math.min(1, t.kcal / target) : 0;
  const ring = $("ring-fill");
  ring.style.strokeDasharray = `${C}`;
  ring.style.strokeDashoffset = `${C * (1 - frac)}`;
  ring.classList.toggle("over", !!goal && left < 0);

  for (const m of ["protein", "carbs", "fat"]) {
    const g = goal ? goal[m] : 0;
    $(`m-${m}`).textContent = goal ? `${r0(t[m])} / ${g} g` : `${r0(t[m])} g`;
    $(`b-${m}`).style.width = `${goal ? Math.min(100, (t[m] / g) * 100) : 0}%`;
  }

  const wrap = $("meals");
  const meals = dayMeals();
  if (!meals.length) {
    wrap.innerHTML = `<div class="empty card"><p><strong>Nothing logged ${isToday ? "yet today" : "on this day"}.</strong></p><p class="muted">Snap a photo of your plate, describe what you ate, or search the food list.</p></div>`;
    return;
  }
  const order = ["breakfast", "lunch", "dinner", "snack"];
  wrap.innerHTML = order.filter((k) => meals.some((m) => m.type === k)).map((k) => {
    const ms = meals.filter((m) => m.type === k);
    const kc = r0(totals(ms).kcal);
    return `<div class="meal-group"><div class="meal-group-head"><h3>${k[0].toUpperCase() + k.slice(1)}</h3><span>${kc} kcal</span></div>
      ${ms.map((m) => `<article class="meal card">
        ${m.thumb ? `<img src="${m.thumb}" alt="" class="meal-thumb">` : `<div class="meal-thumb placeholder">${m.source === "search" ? "🔎" : m.source === "text" ? "✍️" : "🍽"}</div>`}
        <div class="meal-body">
          <div class="meal-title">${escapeHtml(m.items.map((i) => i.name).join(", "))}</div>
          <div class="meal-macros">${r0(totals([m]).kcal)} kcal · P ${r0(totals([m]).protein)} · C ${r0(totals([m]).carbs)} · F ${r0(totals([m]).fat)}</div>
        </div>
        <button class="icon-btn small" data-del="${m.id}" aria-label="Delete meal">🗑</button>
      </article>`).join("")}</div>`;
  }).join("");
}

function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

// ---------------------------------------------------------------- render: progress
function renderProgress() {
  const units = state.profile?.units === "imperial" ? "lb" : "kg";
  $("weight-unit").textContent = units;
  const ws = [...state.weights].sort((a, b) => a.date.localeCompare(b.date)).slice(-30);
  if (ws.length >= 2) {
    const d = r1(ws[ws.length - 1].value - ws[0].value);
    $("weight-delta").textContent = `${d > 0 ? "+" : ""}${d} ${units} since ${ws[0].date.slice(5)}`;
  } else $("weight-delta").textContent = "";
  $("weight-chart").innerHTML = ws.length ? lineChart(ws.map((w) => ({ x: w.date.slice(5), y: w.value })), units) : `<p class="muted small-text">Log your weight to see the trend.</p>`;

  const goal = computeGoal(state.profile);
  const days = Array.from({ length: 7 }, (_, i) => shiftDay(todayStr(), i - 6));
  const vals = days.map((d) => ({ x: new Date(d + "T12:00:00").toLocaleDateString(undefined, { weekday: "narrow" }), y: r0(totals(dayMeals(d)).kcal) }));
  const logged = vals.filter((v) => v.y > 0);
  $("week-avg").textContent = logged.length ? `avg ${r0(logged.reduce((s, v) => s + v.y, 0) / logged.length).toLocaleString()} kcal on ${logged.length} logged day${logged.length > 1 ? "s" : ""}` : "";
  $("week-chart").innerHTML = barChart(vals, goal?.kcal);
}

function lineChart(pts, unit) {
  const W = 320, H = 140, P = 26;
  const ys = pts.map((p) => p.y), lo = Math.min(...ys) - 0.5, hi = Math.max(...ys) + 0.5;
  const X = (i) => P + (pts.length === 1 ? (W - 2 * P) / 2 : (i * (W - 2 * P)) / (pts.length - 1));
  const Y = (v) => H - P - ((v - lo) / (hi - lo)) * (H - 2 * P);
  const path = pts.map((p, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(p.y).toFixed(1)}`).join(" ");
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Weight trend">
    <line x1="${P}" y1="${H - P}" x2="${W - P}" y2="${H - P}" class="axis"/>
    <path d="${path}" class="line"/>
    ${pts.map((p, i) => `<circle cx="${X(i)}" cy="${Y(p.y)}" r="3.5" class="dot"><title>${p.x}: ${p.y} ${unit}</title></circle>`).join("")}
    <text x="${P}" y="14" class="lbl">${r1(hi - 0.5)} ${unit}</text>
    <text x="${P}" y="${H - 8}" class="lbl">${pts[0].x}</text>
    <text x="${W - P}" y="${H - 8}" class="lbl" text-anchor="end">${pts[pts.length - 1].x}</text>
  </svg>`;
}

function barChart(vals, goal) {
  const W = 320, H = 150, P = 22, bw = (W - 2 * P) / vals.length;
  const max = Math.max(goal || 0, ...vals.map((v) => v.y), 500) * 1.1;
  const Y = (v) => H - P - (v / max) * (H - 2 * P);
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Calories over the last 7 days">
    ${goal ? `<line x1="${P}" x2="${W - P}" y1="${Y(goal)}" y2="${Y(goal)}" class="goal-line"/><text x="${W - P}" y="${Y(goal) - 4}" class="lbl" text-anchor="end">goal ${goal}</text>` : ""}
    ${vals.map((v, i) => `<rect x="${P + i * bw + bw * 0.18}" y="${Y(v.y)}" width="${bw * 0.64}" height="${H - P - Y(v.y)}" rx="4" class="${goal && v.y > goal ? "bar over" : "bar"}"><title>${v.y} kcal</title></rect>
      <text x="${P + i * bw + bw / 2}" y="${H - 6}" class="lbl" text-anchor="middle">${v.x}</text>`).join("")}
  </svg>`;
}

// ---------------------------------------------------------------- AI
const ITEM_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          portion: { type: "string" },
          grams: { type: "number" },
          kcal: { type: "number" },
          protein_g: { type: "number" },
          carbs_g: { type: "number" },
          fat_g: { type: "number" },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
        },
        required: ["name", "portion", "grams", "kcal", "protein_g", "carbs_g", "fat_g", "confidence"],
        additionalProperties: false,
      },
    },
    note: { type: "string" },
  },
  required: ["items", "note"],
  additionalProperties: false,
};

const SYSTEM = `You estimate the nutrition of a meal for a calorie-tracking app.
List each distinct food or drink you can see (or that the user describes) as its own item, with a short portion description, an estimated weight in grams, and calories, protein, carbohydrate and fat for that portion.
Base portions on visual cues such as plate size, utensils and hands. Include cooking oil, sauces and dressings as separate items when they are visible or very likely. Use typical restaurant or home-cooking values.
Set confidence to low when the portion or the food is hard to identify. Use the note for one short sentence about the biggest uncertainty, or to say the image does not show food (then return no items).`;

let sdkPromise = null;
function loadSdk() {
  sdkPromise ??= import("https://esm.sh/@anthropic-ai/sdk@latest");
  return sdkPromise;
}

async function analyze({ imageB64, text }) {
  const apiKey = getKey();
  if (!apiKey) throw new Error("NO_KEY");
  const { default: Anthropic } = await loadSdk();
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  const content = [];
  if (imageB64) content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: imageB64 } });
  content.push({ type: "text", text: text ? `What I ate: ${text}` : "Estimate the nutrition of this meal." });

  const res = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 4000,
    system: SYSTEM,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: { type: "json_schema", schema: ITEM_SCHEMA } },
    messages: [{ role: "user", content }],
  });
  if (res.stop_reason === "refusal") throw new Error("The model declined to analyze this one. Try another photo or describe the meal.");
  if (res.stop_reason === "max_tokens") throw new Error("The answer was cut off. Try a photo with fewer dishes.");
  const textBlock = res.content.find((b) => b.type === "text");
  if (!textBlock) throw new Error("No answer came back. Please try again.");
  const out = JSON.parse(textBlock.text);
  return {
    note: out.note || "",
    items: out.items.map((i) => ({
      name: i.name, portion: i.portion, grams: i.grams, confidence: i.confidence,
      kcal: i.kcal, protein: i.protein_g, carbs: i.carbs_g, fat: i.fat_g,
      base: { grams: i.grams || 1, kcal: i.kcal, protein: i.protein_g, carbs: i.carbs_g, fat: i.fat_g },
    })),
  };
}

function friendlyError(e) {
  if (e.message === "NO_KEY") return "Add your Anthropic API key in Settings to analyze photos, or try the sample meal.";
  const s = e?.status;
  if (s === 401) return "That API key was rejected. Check it in Settings.";
  if (s === 429) return "Rate limited. Wait a moment and try again.";
  if (s >= 500) return "The AI service is busy. Please try again shortly.";
  if (e instanceof SyntaxError) return "The answer could not be read. Please try again.";
  return e.message || "Something went wrong.";
}

// Downscale to keep uploads small (max 1024 px, JPEG).
function prepareImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, 1024 / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      const dataUrl = c.toDataURL("image/jpeg", 0.85);
      const t = document.createElement("canvas");
      const ts = 96 / Math.max(c.width, c.height);
      t.width = Math.round(c.width * ts); t.height = Math.round(c.height * ts);
      t.getContext("2d").drawImage(c, 0, 0, t.width, t.height);
      URL.revokeObjectURL(url);
      resolve({ dataUrl, b64: dataUrl.split(",")[1], thumb: t.toDataURL("image/jpeg", 0.7) });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Could not read that image.")); };
    img.src = url;
  });
}

// ---------------------------------------------------------------- review sheet
function guessMealType() {
  const h = new Date().getHours();
  return h < 10.5 ? "breakfast" : h < 15 ? "lunch" : h < 21 ? "dinner" : "snack";
}

function openReview({ photo = null, thumb = null, source = "photo", loading = false, loadingText = "Analyzing your plate…" }) {
  draft = { items: [], photo, thumb, source, note: "" };
  $("review-photo").hidden = !photo;
  if (photo) $("review-photo").src = photo;
  $("analyzing").hidden = !loading;
  $("analyzing-text").textContent = loadingText;
  $("meal-type").value = guessMealType();
  renderDraft();
  openSheet("review-sheet");
}

function renderDraft() {
  const wrap = $("review-items");
  $("review-note").hidden = !draft.note;
  $("review-note").textContent = draft.note;
  wrap.innerHTML = draft.items.map((it, idx) => `
    <div class="item">
      <div class="item-main">
        <input class="item-name" data-i="${idx}" data-f="name" value="${escapeHtml(it.name)}" aria-label="Food name">
        <div class="item-sub">${escapeHtml(it.portion || "")}${it.confidence ? ` · <span class="conf ${it.confidence}">${it.confidence} confidence</span>` : ""}</div>
        <div class="item-macros">P ${r0(it.protein)} · C ${r0(it.carbs)} · F ${r0(it.fat)}</div>
      </div>
      <div class="item-side">
        <label class="grams"><input type="number" min="0" step="5" data-i="${idx}" data-f="grams" value="${r0(it.grams)}" aria-label="Grams">g</label>
        <strong>${r0(it.kcal)} kcal</strong>
        <button class="icon-btn small" data-rm="${idx}" aria-label="Remove item">✕</button>
      </div>
    </div>`).join("");
  const t = totals([{ items: draft.items }]);
  $("review-total").innerHTML = draft.items.length ? `<span>Total</span><strong>${r0(t.kcal)} kcal</strong><span class="muted">P ${r0(t.protein)} · C ${r0(t.carbs)} · F ${r0(t.fat)}</span>` : "";
  $("save-meal").disabled = !draft.items.length;
}

function scaleItem(it, grams) {
  const f = grams / (it.base.grams || 1);
  Object.assign(it, { grams, kcal: it.base.kcal * f, protein: it.base.protein * f, carbs: it.base.carbs * f, fat: it.base.fat * f });
}

// ---------------------------------------------------------------- sample
const SAMPLE = {
  note: "Sample result for a teriyaki chicken rice bowl. This is a canned example, not a live analysis.",
  items: [
    ["Teriyaki chicken thigh", "about 1 palm-size portion", 140, 290, 30, 9, 14, "medium"],
    ["Steamed white rice", "about 1 cup", 160, 208, 4.3, 45, 0.4, "high"],
    ["Steamed broccoli", "about 1/2 cup", 80, 28, 2, 5.6, 0.3, "high"],
    ["Teriyaki sauce", "about 1 tbsp", 18, 16, 1, 3, 0, "low"],
    ["Sesame seeds", "a sprinkle", 3, 17, 0.5, 0.7, 1.5, "low"],
  ],
};
const SAMPLE_SVG = `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 260'><rect width='400' height='260' fill='#f3e6d1'/><circle cx='200' cy='130' r='110' fill='#fff' stroke='#d9d9d3' stroke-width='4'/><path d='M110 130 a90 90 0 0 1 90-90 v90z' fill='#fbfaf4'/><g fill='#f4f1e8' stroke='#e5e0d0'>${Array.from({ length: 26 }, (_, i) => `<ellipse cx='${125 + (i % 6) * 13}' cy='${70 + Math.floor(i / 6) * 13}' rx='6' ry='3.5'/>`).join("")}</g><g fill='#9b5a23'><rect x='205' y='60' width='60' height='28' rx='10'/><rect x='215' y='95' width='62' height='26' rx='10'/><rect x='200' y='128' width='58' height='26' rx='10'/></g><g fill='#3e8f4c'><circle cx='150' cy='175' r='16'/><circle cx='175' cy='192' r='14'/><circle cx='128' cy='196' r='12'/></g><g fill='#fff8e0'><circle cx='225' cy='70' r='2'/><circle cx='240' cy='104' r='2'/><circle cx='222' cy='138' r='2'/></g></svg>`)}`;

function loadSample() {
  openReview({ photo: SAMPLE_SVG, thumb: SAMPLE_SVG, source: "sample" });
  draft.note = SAMPLE.note;
  draft.items = SAMPLE.items.map(([name, portion, grams, kcal, protein, carbs, fat, confidence]) => ({
    name, portion, grams, kcal, protein, carbs, fat, confidence, base: { grams, kcal, protein, carbs, fat },
  }));
  renderDraft();
}

// ---------------------------------------------------------------- sheets & toast
function openSheet(id) {
  document.querySelectorAll(".sheet").forEach((s) => (s.hidden = s.id !== id));
  $("sheet-backdrop").hidden = false;
  document.body.classList.add("sheet-open");
}
function closeSheets() {
  document.querySelectorAll(".sheet").forEach((s) => (s.hidden = true));
  $("sheet-backdrop").hidden = true;
  document.body.classList.remove("sheet-open");
}
let toastTimer;
function toast(msg) {
  const t = $("toast");
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 3600);
}

// ---------------------------------------------------------------- settings
function fillProfileForm() {
  const f = $("profile-form");
  const p = state.profile || { units: "imperial", sex: "male", age: 25, height: 70, weight: 170, activity: 1.375, goal: -0.5 };
  for (const k of Object.keys(p)) if (f.elements[k]) f.elements[k].value = p[k];
  updateUnitLabels();
  previewGoal();
  $("api-key").value = getKey() ? "••••••••••••" : "";
}
function readProfileForm() {
  const f = $("profile-form").elements;
  return { units: f.units.value, sex: f.sex.value, age: +f.age.value, height: +f.height.value, weight: +f.weight.value, activity: +f.activity.value, goal: +f.goal.value };
}
function updateUnitLabels() {
  const imp = $("profile-form").elements.units.value === "imperial";
  $("h-label").textContent = imp ? "Height (in)" : "Height (cm)";
  $("w-label").textContent = imp ? "Weight (lb)" : "Weight (kg)";
}
function previewGoal() {
  const p = readProfileForm();
  if (!p.age || !p.height || !p.weight) { $("goal-preview").textContent = ""; return; }
  const g = computeGoal(p);
  $("goal-preview").innerHTML = `<strong>${g.kcal.toLocaleString()} kcal / day</strong> · protein ${g.protein} g · carbs ${g.carbs} g · fat ${g.fat} g<br><span class="muted">BMR ${g.bmr.toLocaleString()} · maintenance ≈ ${g.tdee.toLocaleString()} kcal${g.floored ? " · held at a safe minimum" : ""}</span>`;
}

// ---------------------------------------------------------------- events
function bind() {
  document.querySelectorAll(".tab").forEach((b) => b.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("active", x === b));
    const v = b.dataset.view;
    $("view-today").hidden = v !== "today";
    $("view-progress").hidden = v !== "progress";
    if (v === "progress") renderProgress();
  }));
  $("prev-day").addEventListener("click", () => { current = shiftDay(current, -1); renderToday(); });
  $("next-day").addEventListener("click", () => { if (current < todayStr()) { current = shiftDay(current, 1); renderToday(); } });
  $("day-label").addEventListener("click", () => { current = todayStr(); renderToday(); });

  $("sheet-backdrop").addEventListener("click", closeSheets);
  document.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", closeSheets));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSheets(); });

  $("photo-input").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try {
      const img = await prepareImage(file);
      openReview({ photo: img.dataUrl, thumb: img.thumb, source: "photo", loading: true });
      const out = await analyze({ imageB64: img.b64 });
      draft.items = out.items; draft.note = out.note;
    } catch (err) {
      draft && (draft.note = friendlyError(err));
    } finally {
      $("analyzing").hidden = true;
      draft && renderDraft();
    }
  });

  $("btn-describe").addEventListener("click", () => { $("describe-text").value = ""; openSheet("describe-sheet"); setTimeout(() => $("describe-text").focus(), 50); });
  $("describe-go").addEventListener("click", async () => {
    const text = $("describe-text").value.trim();
    if (!text) return;
    openReview({ source: "text", loading: true, loadingText: "Estimating…" });
    try {
      const out = await analyze({ text });
      draft.items = out.items; draft.note = out.note;
    } catch (err) { draft.note = friendlyError(err); }
    finally { $("analyzing").hidden = true; renderDraft(); }
  });

  $("btn-search").addEventListener("click", () => { $("search-input").value = ""; renderSearch(""); openSheet("search-sheet"); setTimeout(() => $("search-input").focus(), 50); });
  $("search-input").addEventListener("input", (e) => renderSearch(e.target.value));
  $("search-results").addEventListener("click", (e) => {
    const li = e.target.closest("[data-food]");
    if (!li) return;
    const [name, portion, grams, kcal, protein, carbs, fat] = FOODS[+li.dataset.food];
    const item = { name, portion, grams, kcal, protein, carbs, fat, confidence: null, base: { grams, kcal, protein, carbs, fat } };
    if (draft && draft.addingTo) { draft.items.push(item); draft.addingTo = false; openSheet("review-sheet"); renderDraft(); return; }
    openReview({ source: "search" });
    draft.items = [item];
    renderDraft();
  });
  $("btn-sample").addEventListener("click", loadSample);

  $("review-items").addEventListener("input", (e) => {
    const i = e.target.dataset.i; if (i === undefined) return;
    const it = draft.items[+i];
    if (e.target.dataset.f === "grams") { scaleItem(it, Math.max(0, +e.target.value || 0)); renderDraftTotalsOnly(+i); }
    else it.name = e.target.value;
  });
  $("review-items").addEventListener("change", (e) => { if (e.target.dataset.f === "grams") renderDraft(); });
  $("review-items").addEventListener("click", (e) => {
    const rm = e.target.closest("[data-rm]"); if (!rm) return;
    draft.items.splice(+rm.dataset.rm, 1); renderDraft();
  });
  $("add-item").addEventListener("click", () => { draft.addingTo = true; $("search-input").value = ""; renderSearch(""); openSheet("search-sheet"); });
  $("save-meal").addEventListener("click", () => {
    if (!draft?.items.length) return;
    const meal = {
      id: Date.now().toString(36), type: $("meal-type").value, source: draft.source, thumb: draft.thumb && !draft.thumb.startsWith("data:image/svg") ? draft.thumb : null,
      items: draft.items.map(({ name, portion, grams, kcal, protein, carbs, fat }) => ({ name, portion, grams, kcal, protein, carbs, fat })),
      at: new Date().toISOString(),
    };
    (state.days[current] ||= []).push(meal);
    save(); closeSheets(); renderToday();
    toast(`Saved ${r0(totals([meal]).kcal)} kcal to ${meal.type}.`);
  });

  $("meals").addEventListener("click", (e) => {
    const b = e.target.closest("[data-del]"); if (!b) return;
    state.days[current] = dayMeals().filter((m) => m.id !== b.dataset.del);
    save(); renderToday();
  });

  $("open-settings").addEventListener("click", () => { fillProfileForm(); openSheet("settings-sheet"); });
  $("profile-form").addEventListener("input", (e) => { if (e.target.name === "units") updateUnitLabels(); previewGoal(); });
  $("profile-form").addEventListener("submit", (e) => {
    e.preventDefault();
    state.profile = readProfileForm();
    if (!state.weights.some((w) => w.date === todayStr())) state.weights.push({ date: todayStr(), value: state.profile.weight });
    save(); closeSheets(); renderToday(); toast("Goal saved.");
  });
  $("key-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const v = $("api-key").value.trim();
    if (!v || v.startsWith("•")) return;
    try { localStorage.setItem(KEY_STORE, v); } catch {}
    $("api-key").value = "••••••••••••"; toast("API key saved in this browser.");
  });
  $("forget-key").addEventListener("click", () => { try { localStorage.removeItem(KEY_STORE); } catch {} $("api-key").value = ""; toast("API key removed."); });

  $("weight-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const v = +$("weight-input").value; if (!v) return;
    state.weights = state.weights.filter((w) => w.date !== todayStr()).concat({ date: todayStr(), value: v });
    if (state.profile) state.profile.weight = v;
    save(); $("weight-input").value = ""; renderProgress(); toast("Weight logged.");
  });
  $("export-csv").addEventListener("click", exportCsv);
  $("clear-data").addEventListener("click", () => {
    if (!confirm("Delete all meals, weights and your goal from this browser?")) return;
    state = blank(); save(); renderToday(); renderProgress(); toast("All data cleared.");
  });
}

function renderDraftTotalsOnly(idx) {
  const it = draft.items[idx];
  const row = $("review-items").children[idx];
  row.querySelector("strong").textContent = `${r0(it.kcal)} kcal`;
  row.querySelector(".item-macros").textContent = `P ${r0(it.protein)} · C ${r0(it.carbs)} · F ${r0(it.fat)}`;
  const t = totals([{ items: draft.items }]);
  $("review-total").innerHTML = `<span>Total</span><strong>${r0(t.kcal)} kcal</strong><span class="muted">P ${r0(t.protein)} · C ${r0(t.carbs)} · F ${r0(t.fat)}</span>`;
}

function renderSearch(q) {
  const s = q.trim().toLowerCase();
  const hits = FOODS.map((f, i) => [f, i]).filter(([f]) => !s || f[0].toLowerCase().includes(s)).slice(0, 30);
  $("search-results").innerHTML = hits.length ? hits.map(([f, i]) => `<li data-food="${i}"><div><strong>${escapeHtml(f[0])}</strong><span class="muted">${escapeHtml(f[1])}</span></div><b>${f[3]} kcal</b></li>`).join("") : `<li class="muted">No match. Try "Describe" instead.</li>`;
}

function exportCsv() {
  const rows = [["date", "meal", "food", "portion", "grams", "kcal", "protein_g", "carbs_g", "fat_g"]];
  Object.keys(state.days).sort().forEach((d) => state.days[d].forEach((m) => m.items.forEach((i) => rows.push([d, m.type, i.name, i.portion || "", r0(i.grams), r0(i.kcal), r1(i.protein), r1(i.carbs), r1(i.fat)]))));
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = `snapcal-${todayStr()}.csv`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------------------------------------------------------------- boot
bind();
renderToday();
if (!state.profile) { fillProfileForm(); openSheet("settings-sheet"); }
