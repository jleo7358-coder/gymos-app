// AI food recognition with Google Gemini (your own free API key, stored only on this phone).
// Photos/descriptions go straight from the phone to Google; nothing else is sent.

import { getKV, setKV, deleteKV } from './store.js';
import { cleanNutrients } from './nutrients.js';

const API = 'https://generativelanguage.googleapis.com/v1beta';
// Bump when the automatic model choice changes, so older automatic picks are redone.
const PICK_VERSION = 'auto2';
export class AIError extends Error {
  constructor(message, { status = 0, timeout = false } = {}) { super(message); this.status = status; this.timeout = timeout; }
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
    const err = (text) => new AIError(text, { status: res.status });
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

/** A faster model to fall back to after a timeout (a "lite" one if possible). */
async function fallbackModel(current) {
  try {
    const list = await discoverModels();
    return list.find((m) => m !== current && /flash-lite/.test(m) && !/preview|latest/.test(m))
      || list.find((m) => m !== current && /flash/.test(m)) || null;
  } catch { return null; }
}

/**
 * mode: 'photo' | 'label' | 'text'. onStatus(text) reports progress.
 * Returns { items: [{name, portion, grams, confidence, base(per 100 g), totals}], notes, model }.
 */
export async function analyse({ mode, image = null, text = '', onStatus = () => {} }) {
  let model = await modelName();
  const parts = [];
  if (image) parts.push({ inline_data: { mime_type: 'image/jpeg', data: image } });
  let prompt;
  if (mode === 'label') prompt = LABEL + (text ? `\nExtra info from the user: ${text}` : '');
  else if (mode === 'text') prompt = `Estimate the nutrition of what I ate: ${text}`;
  else prompt = 'Identify the foods in this photo and estimate portions and nutrition.' + (text ? ` Extra details from me: ${text}` : '');
  parts.push({ text: prompt });
  const body = {
    systemInstruction: { parts: [{ text: SYSTEM }] },
    contents: [{ role: 'user', parts }],
    generationConfig: { temperature: 0.2, responseMimeType: 'application/json', responseSchema: SCHEMA },
  };
  let j;
  try { j = await generate(model, body, 45000); }
  catch (e) {
    if (!(e instanceof AIError)) throw e;
    if (/unavailable/.test(e.message) && ai.model) {
      // A stale saved model: forget it and retry once with a freshly discovered one.
      await ai.setModel('');
      model = await modelName();
      onStatus(`Switching to ${model}…`);
      j = await generate(model, body, 60000);
    } else if (e.timeout || e.status === 503 || e.status === 500) {
      const alt = await fallbackModel(model);
      if (!alt) throw e;
      onStatus(`${model} is slow right now — trying ${alt}…`);
      model = alt;
      j = await generate(model, body, 60000);
    } else throw e;
  }
  const cand = j && j.candidates && j.candidates[0];
  if (!cand) {
    const block = j && j.promptFeedback && j.promptFeedback.blockReason;
    throw new AIError(block ? `Gemini refused this request (${block}).` : 'Gemini returned no answer. Try again.');
  }
  const raw = (cand.content && cand.content.parts || []).filter((p) => !p.thought).map((p) => p.text || '').join('');
  let data;
  try { data = JSON.parse(raw); }
  catch {
    if (cand.finishReason === 'MAX_TOKENS') throw new AIError('Gemini’s answer was cut off. Try again, or log fewer foods at once.');
    throw new AIError("Gemini's answer couldn't be read. Try again.");
  }
  return { ...parseResult(data), model };
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
