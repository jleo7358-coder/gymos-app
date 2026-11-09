// AI food recognition with Google Gemini (your own free API key, stored only on this phone).
// Photos/descriptions go straight from the phone to Google; nothing else is sent.

import { getKV, setKV, deleteKV } from './store.js';
import { cleanNutrients } from './nutrients.js';

const API = 'https://generativelanguage.googleapis.com/v1beta';
// Bump when the automatic model choice changes, so older automatic picks are redone.
const PICK_VERSION = 'auto2';
export class AIError extends Error {
  constructor(message, { status = 0, timeout = false, detail = '' } = {}) { super(message); this.status = status; this.timeout = timeout; this.detail = detail; }
}

export const ai = {
  get key() { return getKV('gemini.key', '') || ''; },
  setKey(k) { return k ? setKV('gemini.key', k.replace(/\s+/g, '')) : deleteKV('gemini.key'); },
  get model() { return getKV('gemini.model', '') || ''; },
  /** picked = chosen by hand in AI settings (otherwise it was chosen automatically). */
  setModel(m, picked = false) {
    setKV('gemini.modelPick', m ? (picked ? 'user' : PICK_VERSION) : '');
    return m ? setKV('gemini.model', m) : deleteKV('gemini.model');
  },
  get hasKey() { return !!this.key; },
};

async function call(path, { method = 'GET', body = null, timeoutMs = 60000 } = {}) {
  if (!ai.key) throw new AIError('Add your Gemini API key first (Food → ⋯ → AI settings).');
  if (!navigator.onLine) throw new AIError('You are offline. AI analysis needs an internet connection.');
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    // Key goes in a header (not the URL), works for both "AIza…" and newer "AQ.…" keys.
    const headers = { 'x-goog-api-key': ai.key };
    if (body) headers['Content-Type'] = 'application/json';
    res = await fetch(`${API}/${path}`, {
      method, signal: ctrl.signal, headers,
      body: body ? JSON.stringify(body) : null,
    });
  } catch (e) {
    if (e && e.name === 'AbortError') throw new AIError('Gemini took too long to answer. Try again, or choose a different model in AI settings.', { timeout: true });
    throw new AIError("Couldn't reach Google Gemini. Check your connection.");
  } finally { clearTimeout(t); }
  let j = null;
  try { j = await res.json(); } catch {}
  if (!res.ok) {
    const msg = (j && j.error && j.error.message) || '';
    const err = (text) => new AIError(text, { status: res.status, detail: `${res.status}${msg ? ' · ' + msg.slice(0, 200) : ''}` });
    if ((res.status === 400 || res.status === 401) && /api key/i.test(msg)) throw err('That API key was rejected by Google. Check it in AI settings.');
    if (res.status === 403) throw err('This API key is not allowed to use Gemini. Create a key in Google AI Studio.');
    if (res.status === 429) throw err('Free Gemini limit reached for now. Wait a minute (or until tomorrow) and try again.');
    if (res.status === 404) throw err('The selected Gemini model is unavailable. Tap “Test key” in AI settings to pick another.');
    if (res.status >= 500) throw err('Gemini is having problems right now. Try again shortly.');
    throw err(msg ? `Gemini: ${msg.slice(0, 160)}` : `Gemini error (${res.status}).`);
  }
  return j;
}

function versionOf(name) { const m = /gemini-(\d+(?:\.\d+)?)/.exec(name); return m ? parseFloat(m[1]) : 0; }

/** Lists usable models and picks the best fast one (newest stable "flash"). */
export async function discoverModels() {
  const j = await call('models?pageSize=200', { timeoutMs: 20000 });
  const models = ((j && j.models) || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => m.name.replace(/^models\//, ''))
    .filter((n) => /^gemini/.test(n) && !/(image|tts|audio|live|embedding|learnlm|robotics|computer-use|native)/i.test(n));
  // Prefer a stable, versioned "flash" model: fast, generous free limits. "-latest" aliases
  // and previews can point at slower experimental models, so they rank lower.
  const rank = (n) => {
    let r = versionOf(n) * 10;
    if (/flash/.test(n)) r += 100;
    if (/lite/.test(n)) r -= 30;
    if (/latest/.test(n)) r -= 40;
    if (/preview|exp|thinking/.test(n)) r -= 50;
    if (/pro/.test(n)) r -= 60; // slower and tighter free limits
    return r;
  };
  models.sort((a, b) => rank(b) - rank(a));
  return models;
}

async function modelName() {
  const pick = getKV('gemini.modelPick', '');
  if (ai.model && (pick === 'user' || pick === PICK_VERSION)) return ai.model;
  const list = await discoverModels();
  if (!list.length) throw new AIError('No Gemini models are available for this key.');
  await ai.setModel(list[0]);
  return list[0];
}

/** Resize/compress a photo to a JPEG (max 1024 px) and return base64. */
export async function imageToBase64(file, max = 1024) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = () => reject(new AIError("Couldn't read that photo.")); i.src = url; });
    const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.naturalWidth * s)); c.height = Math.max(1, Math.round(img.naturalHeight * s));
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const data = c.toDataURL('image/jpeg', 0.82);
    return { base64: data.split(',')[1], preview: c.toDataURL('image/jpeg', 0.5) };
  } finally { URL.revokeObjectURL(url); }
}

const NUM = { type: 'NUMBER' };
const ITEM_SCHEMA = {
  type: 'OBJECT',
  properties: {
    name: { type: 'STRING' }, portion: { type: 'STRING' }, grams: NUM, confidence: NUM,
    calories: NUM, protein_g: NUM, carbs_g: NUM, fat_g: NUM,
    fibre_g: NUM, sugars_g: NUM, saturated_fat_g: NUM, salt_g: NUM,
    vitamin_a_ug: NUM, vitamin_c_mg: NUM, vitamin_d_ug: NUM, vitamin_e_mg: NUM, vitamin_k_ug: NUM,
    thiamin_mg: NUM, riboflavin_mg: NUM, niacin_mg: NUM, vitamin_b6_mg: NUM, folate_ug: NUM, vitamin_b12_ug: NUM,
    calcium_mg: NUM, iron_mg: NUM, magnesium_mg: NUM, potassium_mg: NUM, zinc_mg: NUM, phosphorus_mg: NUM, selenium_ug: NUM, iodine_ug: NUM,
  },
  required: ['name', 'portion', 'grams', 'calories', 'protein_g', 'carbs_g', 'fat_g', 'fibre_g', 'sugars_g', 'saturated_fat_g', 'salt_g', 'confidence'],
};
const SCHEMA = {
  type: 'OBJECT',
  properties: { items: { type: 'ARRAY', items: ITEM_SCHEMA }, notes: { type: 'STRING' }, is_food: { type: 'BOOLEAN' } },
  required: ['items', 'is_food'],
};
const MAP = {
  calories: 'kcal', protein_g: 'protein', carbs_g: 'carbs', fat_g: 'fat', fibre_g: 'fibre', sugars_g: 'sugars',
  saturated_fat_g: 'satFat', salt_g: 'salt', vitamin_a_ug: 'vitA', vitamin_c_mg: 'vitC', vitamin_d_ug: 'vitD',
  vitamin_e_mg: 'vitE', vitamin_k_ug: 'vitK', thiamin_mg: 'thiamin', riboflavin_mg: 'riboflavin', niacin_mg: 'niacin',
  vitamin_b6_mg: 'vitB6', folate_ug: 'folate', vitamin_b12_ug: 'vitB12', calcium_mg: 'calcium', iron_mg: 'iron',
  magnesium_mg: 'magnesium', potassium_mg: 'potassium', zinc_mg: 'zinc', phosphorus_mg: 'phosphorus', selenium_ug: 'selenium', iodine_ug: 'iodine',
};

const SYSTEM = `You are a precise nutrition analyst for a UK food-tracking app. Identify every distinct food or drink and estimate each one's portion weight in grams (or ml for drinks) and its nutrition FOR THAT PORTION, using UK/EU food composition data (e.g. McCance & Widdowson, USDA where needed). Carbohydrate excludes fibre (UK labelling). Salt = sodium × 2.5. Split mixed plates into components (e.g. "chicken breast", "white rice", "curry sauce") unless it is one product. Use visual cues (plate ~26 cm, cutlery, hands, packaging) for size. Include cooking oil/butter/sauces you can reasonably infer. Give vitamins/minerals when you can estimate them. confidence is 0–1. If the image or text contains no food, set is_food false and return an empty items list. Keep names short (max 5 words), portion as a human description like "1 medium bowl" or "2 slices".`;

const LABEL = `This is a photo of a nutrition label / packaging. Read the values exactly as printed. Return ONE item whose grams is 100 and whose nutrition is PER 100 g (or per 100 ml), converting from per-serving if only that is printed. Put the product name (and brand if visible) in name, and the stated serving size in portion (e.g. "1 bar (45 g)"). Convert energy from kJ if needed (kcal = kJ / 4.184).`;

/** Keep "thinking" short: food estimates don't need it and it is the main cause of slow answers. */
function thinkingFor(model) {
  if (/gemini-(3|4)|latest/.test(model)) return { thinkingLevel: 'low' };
  if (/2\.5-flash/.test(model)) return { thinkingBudget: 0 };
  if (/2\.5-pro/.test(model)) return { thinkingBudget: 128 };
  return null;
}

async function generate(model, body, timeoutMs) {
  const think = getKV('gemini.noThinkCfg', '') === model ? null : thinkingFor(model);
  const withThink = think ? { ...body, generationConfig: { ...body.generationConfig, thinkingConfig: think } } : body;
  try {
    return await call(`models/${encodeURIComponent(model)}:generateContent`, { method: 'POST', body: withThink, timeoutMs });
  } catch (e) {
    // This model doesn't accept that thinking setting: remember and send without it.
    if (think && e instanceof AIError && e.status === 400 && /think/i.test(e.message)) {
      setKV('gemini.noThinkCfg', model);
      return call(`models/${encodeURIComponent(model)}:generateContent`, { method: 'POST', body, timeoutMs });
    }
    throw e;
  }
}

/** Other models to try when the first one fails (each model has its own free quota). */
async function alternatives(current) {
  try {
    const list = (await discoverModels()).filter((m) => m !== current && /flash/.test(m));
    const lite = list.filter((m) => /lite/.test(m));
    const rest = list.filter((m) => !/lite/.test(m));
    return [...lite.slice(0, 1), ...rest.slice(0, 1), ...lite.slice(1, 2)];
  } catch { return []; }
}

const SHAPE = `Reply with ONLY a JSON object, no markdown, in exactly this shape:
{"is_food": true, "notes": "", "items": [{"name": "", "portion": "", "grams": 0, "confidence": 0.8, "calories": 0, "protein_g": 0, "carbs_g": 0, "fat_g": 0, "fibre_g": 0, "sugars_g": 0, "saturated_fat_g": 0, "salt_g": 0, "vitamin_c_mg": 0, "vitamin_d_ug": 0, "calcium_mg": 0, "iron_mg": 0, "potassium_mg": 0, "magnesium_mg": 0}]}
All numbers are plain numbers. Leave out vitamin/mineral fields you cannot estimate.`;

function parseJSON(raw) {
  const t = String(raw || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try { return JSON.parse(t); } catch {}
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch {} }
  return null;
}

/**
 * mode: 'photo' | 'label' | 'text'. onStatus(text) reports progress.
 * Tries the chosen model, then a simpler request, then other models, so one busy or
 * failing model doesn't stop you logging.
 * Returns { items: [{name, portion, grams, confidence, base(per 100 g), totals}], notes, model }.
 */
export async function analyse({ mode, image = null, text = '', onStatus = () => {} }) {
  let prompt;
  if (mode === 'label') prompt = LABEL + (text ? `\nExtra info from the user: ${text}` : '');
  else if (mode === 'text') prompt = `Estimate the nutrition of what I ate: ${text}`;
  else prompt = 'Identify the foods in this photo and estimate portions and nutrition.' + (text ? ` Extra details from me: ${text}` : '');
  const build = (simple) => {
    const parts = [];
    if (image) parts.push({ inline_data: { mime_type: 'image/jpeg', data: image } });
    parts.push({ text: simple ? `${prompt}\n\n${SHAPE}` : prompt });
    const generationConfig = simple
      ? { temperature: 0.2, responseMimeType: 'application/json' }
      : { temperature: 0.2, responseMimeType: 'application/json', responseSchema: SCHEMA };
    return { systemInstruction: { parts: [{ text: SYSTEM }] }, contents: [{ role: 'user', parts }], generationConfig };
  };
  const { data, model } = await askJSON(build, onStatus);
  return { ...parseResult(data), model };
}

/**
 * Sends a JSON request, trying the chosen model, then a simpler request, then other models,
 * so one busy or failing model doesn't stop you. build(simple) returns the request body.
 */
async function askJSON(build, onStatus = () => {}) {
  let model = await modelName();
  const simpleFirst = getKV('gemini.simple', '') === model;
  const plan = [{ model, simple: simpleFirst }, { model, simple: !simpleFirst }];
  let alts = null;
  let lastErr = null;
  for (let i = 0; i < plan.length && i < 5; i++) {
    const step = plan[i];
    if (i > 0) onStatus(step.model === model ? `${model} had a problem — trying a simpler request…` : `Trying ${step.model}…`);
    let j;
    try { j = await generate(step.model, build(step.simple), i === 0 ? 45000 : 40000); }
    catch (e) {
      if (!(e instanceof AIError)) throw e;
      lastErr = e;
      if (e.status === 404 && i === 0 && ai.model) {
        // A stale saved model: forget it and start again with a freshly discovered one.
        await ai.setModel('');
        model = await modelName();
        plan.push({ model, simple: false });
        continue;
      }
      const retryable = e.timeout || e.status >= 500 || e.status === 429 || (e.status === 400 && !/api key/i.test(e.message));
      if (!retryable) throw e;
      if (alts == null && i >= 1) {
        alts = await alternatives(model);
        for (const m of alts) plan.push({ model: m, simple: true });
      }
      continue;
    }
    const cand = j && j.candidates && j.candidates[0];
    if (!cand) {
      const block = j && j.promptFeedback && j.promptFeedback.blockReason;
      if (block) throw new AIError(`Gemini refused this request (${block}).`);
      lastErr = new AIError('Gemini returned no answer.'); continue;
    }
    const raw = (cand.content && cand.content.parts || []).filter((p) => !p.thought).map((p) => p.text || '').join('');
    const data = parseJSON(raw);
    if (!data) { lastErr = new AIError(cand.finishReason === 'MAX_TOKENS' ? 'Gemini’s answer was cut off.' : "Gemini's answer couldn't be read.", { detail: `finish: ${cand.finishReason || '?'}` }); continue; }
    // Remember what worked so the next request goes straight there.
    if (step.model !== ai.model && getKV('gemini.modelPick', '') !== 'user') await ai.setModel(step.model);
    if (step.simple) setKV('gemini.simple', step.model); else if (getKV('gemini.simple', '') === step.model) deleteKV('gemini.simple');
    return { data, model: step.model };
  }
  const e = lastErr || new AIError('Gemini returned no answer.');
  const tried = [...new Set(plan.map((p) => p.model))].join(', ');
  throw new AIError(`${e.message.replace(/ Try again.*$/, '')} Tried: ${tried}. Try again in a minute.`, { status: e.status, detail: e.detail });
}

// ---------------------------------------------------------------------------------
// "Fill the gap": meal ideas that fit what's left of today's targets

const SUGGEST_ITEM = {
  type: 'OBJECT',
  properties: {
    name: { type: 'STRING' }, portion: { type: 'STRING' }, grams: NUM,
    calories: NUM, protein_g: NUM, carbs_g: NUM, fat_g: NUM, fibre_g: NUM, sugars_g: NUM, saturated_fat_g: NUM, salt_g: NUM,
  },
  required: ['name', 'portion', 'grams', 'calories', 'protein_g', 'carbs_g', 'fat_g'],
};
const SUGGEST_SCHEMA = {
  type: 'OBJECT',
  properties: {
    options: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { title: { type: 'STRING' }, why: { type: 'STRING' }, prep_minutes: NUM, items: { type: 'ARRAY', items: SUGGEST_ITEM } },
        required: ['title', 'why', 'items'],
      },
    },
  },
  required: ['options'],
};
const SUGGEST_SHAPE = `Reply with ONLY a JSON object, no markdown, in exactly this shape:
{"options": [{"title": "", "why": "", "prep_minutes": 5, "items": [{"name": "", "portion": "", "grams": 0, "calories": 0, "protein_g": 0, "carbs_g": 0, "fat_g": 0, "fibre_g": 0, "sugars_g": 0, "saturated_fat_g": 0, "salt_g": 0}]}]}`;

const SUGGEST_SYSTEM = `You are a practical sports nutrition coach for a UK food-tracking app. Suggest real, simple foods and meals available in UK supermarkets or easy to make at home, with realistic portions in grams and accurate UK nutrition values. Each option must fit the remaining targets as closely as possible: hit the protein, carbs and fat gaps while keeping total calories within about 10% of the calories left, and keep under any stated limits (sugar, saturated fat, salt). Prefer whole foods; at most one item may be a protein shake or bar. Never suggest supplements other than plain protein powder, alcohol, or energy drinks. Give 3 to 5 different options (e.g. a quick no-cook one, a proper meal, a snack combo), ordered best fit first. "why" is one short sentence on how it fills the gap. Keep names short.`;

/**
 * remaining: { kcal, protein, carbs, fat, fibre, sugarsLeft, satFatLeft, saltLeft }
 * context: { meal, dayLabel, diet, timeOfDay, likes: [food names], note }
 */
export async function suggestMeals({ remaining, context = {}, onStatus = () => {} }) {
  const r = remaining;
  const lines = [
    `Calories left today: ${Math.round(r.kcal)} kcal.`,
    `Still needed: protein ${Math.max(0, Math.round(r.protein))} g, carbs ${Math.max(0, Math.round(r.carbs))} g, fat ${Math.max(0, Math.round(r.fat))} g${r.fibre > 0 ? `, fibre ${Math.round(r.fibre)} g` : ''}.`,
    `Stay under: ${[r.sugarsLeft != null ? `sugars ${Math.max(0, Math.round(r.sugarsLeft))} g` : null, r.satFatLeft != null ? `saturated fat ${Math.max(0, Math.round(r.satFatLeft))} g` : null, r.saltLeft != null ? `salt ${Math.max(0, r.saltLeft).toFixed(1)} g` : null].filter(Boolean).join(', ') || 'no extra limits'}.`,
  ];
  if (context.meal) lines.push(`It's for: ${context.meal}${context.timeOfDay ? ` (time now ${context.timeOfDay})` : ''}.`);
  if (context.dayLabel) lines.push(`Today is: ${context.dayLabel}.`);
  if (context.diet) lines.push(`Diet style: ${context.diet}.`);
  if (context.likes && context.likes.length) lines.push(`Foods I often eat (use some if they fit): ${context.likes.slice(0, 25).join(', ')}.`);
  if (context.note) lines.push(`My request: ${context.note}`);
  if (context.split) lines.push('The gap is large, so this can be split across more than one meal: make options that cover about half of it, as one meal.');
  const prompt = lines.join('\n');
  const build = (simple) => ({
    systemInstruction: { parts: [{ text: SUGGEST_SYSTEM }] },
    contents: [{ role: 'user', parts: [{ text: simple ? `${prompt}\n\n${SUGGEST_SHAPE}` : prompt }] }],
    generationConfig: simple
      ? { temperature: 0.6, responseMimeType: 'application/json' }
      : { temperature: 0.6, responseMimeType: 'application/json', responseSchema: SUGGEST_SCHEMA },
  });
  const { data, model } = await askJSON(build, onStatus);
  const options = (Array.isArray(data && data.options) ? data.options : []).map((o) => {
    const parsed = parseResult({ items: Array.isArray(o.items) ? o.items.map((it) => ({ ...it, confidence: null })) : [] }).items;
    const totals = {};
    for (const it of parsed) for (const [k, v] of Object.entries(it.totals)) totals[k] = (totals[k] || 0) + v;
    return {
      title: String(o.title || 'Meal idea').slice(0, 60), why: String(o.why || '').slice(0, 200),
      prep: Number(o.prep_minutes) > 0 ? Math.round(Number(o.prep_minutes)) : null, items: parsed, totals,
    };
  }).filter((o) => o.items.length);
  if (!options.length) throw new AIError('Gemini didn’t come up with any ideas. Try again.');
  return { options, model };
}

export function parseResult(data) {
  const items = (Array.isArray(data && data.items) ? data.items : []).map((it) => {
    const totals = {};
    for (const [k, v] of Object.entries(MAP)) if (it[k] != null) totals[v] = Number(it[k]);
    const t = cleanNutrients(totals);
    const grams = Number(it.grams) > 0 ? Number(it.grams) : null;
    // Store per 100 g so the portion can be adjusted afterwards.
    const base = grams ? Object.fromEntries(Object.entries(t).map(([k, v]) => [k, (v * 100) / grams])) : t;
    return {
      name: String(it.name || 'Food').slice(0, 60), portion: String(it.portion || '').slice(0, 60),
      grams, confidence: Number.isFinite(Number(it.confidence)) ? Number(it.confidence) : null, base, totals: t,
    };
  }).filter((x) => x.totals.kcal != null);
  return { items, notes: data && data.notes ? String(data.notes).slice(0, 400) : '', isFood: data ? data.is_food !== false : false };
}
