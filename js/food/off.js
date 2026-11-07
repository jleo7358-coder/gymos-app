// Open Food Facts: free, open product database (no key). Used for barcode lookups and
// online food search. Results are cached on the phone so repeat scans work offline.

import { NUTRIENTS, cleanNutrients } from './nutrients.js';
import { uuid } from '../util.js';

const BASE = 'https://world.openfoodfacts.org';
const FIELDS = 'code,product_name,product_name_en,generic_name,brands,quantity,serving_size,serving_quantity,nutriments,nutrition_data_per,image_front_small_url';

export class OFFError extends Error {}

async function getJSON(url, timeoutMs = 12000) {
  if (!navigator.onLine) throw new OFFError('You are offline. Connect to the internet to look up products.');
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    if (res.status === 404) return null;
    if (res.status === 429) throw new OFFError('Open Food Facts is busy (too many requests). Try again in a minute.');
    if (!res.ok) throw new OFFError(`Open Food Facts error (${res.status}). Try again later.`);
    return await res.json();
  } catch (e) {
    if (e instanceof OFFError) throw e;
    if (e && e.name === 'AbortError') throw new OFFError('Open Food Facts took too long to answer. Try again.');
    throw new OFFError("Couldn't reach Open Food Facts. Check your connection.");
  } finally { clearTimeout(t); }
}

/** Valid EAN-8 / UPC-A / EAN-13 / GTIN-14 check digit. */
export function validBarcode(code) {
  if (!/^\d{8}$|^\d{12,14}$/.test(code)) return false;
  const d = code.split('').map(Number);
  const check = d.pop();
  let s = 0;
  d.reverse().forEach((x, i) => { s += x * (i % 2 === 0 ? 3 : 1); });
  return (10 - (s % 10)) % 10 === check;
}

/** UPC-E (8 digits starting 0/1) → UPC-A, so it matches the database. */
export function expandUPCE(code) {
  if (!/^[01]\d{7}$/.test(code)) return null;
  const ns = code[0], m = code.slice(1, 7), c = code[7];
  const last = m[5];
  let body;
  if ('012'.includes(last)) body = m.slice(0, 2) + last + '0000' + m.slice(2, 5);
  else if (last === '3') body = m.slice(0, 3) + '00000' + m.slice(3, 5);
  else if (last === '4') body = m.slice(0, 4) + '00000' + m[4];
  else body = m.slice(0, 5) + '0000' + last;
  const a = ns + body + c;
  return validBarcode(a) ? a : null;
}

function num(v) {
  const x = typeof v === 'string' ? parseFloat(v.replace(',', '.')) : v;
  return Number.isFinite(x) ? x : null;
}

/** OFF product → food record (per 100 g/ml), or null when it has no usable nutrition. */
export function productToFood(p, barcode) {
  if (!p) return null;
  const nm = p.nutriments || {};
  const n = {};
  for (const def of NUTRIENTS) {
    let v = num(nm[`${def.off}_100g`]);
    if (def.key === 'kcal' && v == null) {
      const kj = num(nm['energy-kj_100g']) ?? (nm.energy_unit === 'kJ' || !nm.energy_unit ? num(nm.energy_100g) : null);
      if (kj != null) v = kj / 4.184;
    }
    if (def.key === 'salt' && v == null) { const na = num(nm.sodium_100g); if (na != null) v = na * 2.5; }
    if (def.key === 'folate' && v == null) v = num(nm.folates_100g);
    if (v != null) n[def.key] = v * def.mult;
  }
  const base = cleanNutrients(n);
  if (base.kcal == null && base.protein == null && base.carbs == null && base.fat == null) return null;
  const name = (p.product_name_en || p.product_name || p.generic_name || '').trim();
  const isLiquid = /\bml\b|\bl\b|cl\b/i.test(p.quantity || '') && !/\bg\b/i.test(p.quantity || '');
  const servings = [];
  const sq = num(p.serving_quantity);
  if (sq && sq > 0 && sq < 5000) servings.push({ label: (p.serving_size || `${sq} ${isLiquid ? 'ml' : 'g'}`).trim().slice(0, 40), g: sq });
  const packG = num((p.quantity || '').match(/([\d.,]+)\s*(g|ml)\b/i)?.[1]);
  if (packG && packG > 0 && packG < 5000 && (!sq || Math.abs(packG - sq) > 1)) servings.push({ label: `whole pack (${p.quantity.trim()})`.slice(0, 40), g: packG });
  return {
    id: uuid(), name: name || `Product ${barcode || p.code}`, brand: (p.brands || '').split(',')[0].trim() || null,
    barcode: barcode || p.code || null, source: 'off', basis: '100', unit: isLiquid ? 'ml' : 'g', base,
    servings, image: p.image_front_small_url || null, createdAt: Date.now(),
    perServingOnly: p.nutrition_data_per === 'serving',
  };
}

export async function lookupBarcode(code) {
  const tries = [code];
  if (code.length === 12) tries.push('0' + code);
  if (code.length === 13 && code.startsWith('0')) tries.push(code.slice(1));
  const upca = code.length === 8 ? expandUPCE(code) : null;
  if (upca) tries.push(upca);
  for (const c of tries) {
    const j = await getJSON(`${BASE}/api/v2/product/${encodeURIComponent(c)}.json?fields=${FIELDS}`);
    if (j && j.status === 1 && j.product) {
      const food = productToFood(j.product, code);
      return { found: true, food, name: j.product.product_name || '' };
    }
  }
  return { found: false };
}

export async function search(query, page = 1) {
  const q = encodeURIComponent(query.trim());
  const url = `${BASE}/cgi/search.pl?search_terms=${q}&search_simple=1&action=process&json=1&page_size=24&page=${page}&sort_by=unique_scans_n&fields=${FIELDS}`;
  const j = await getJSON(url, 15000);
  const products = (j && j.products) || [];
  return products.map((p) => productToFood(p, p.code)).filter((f) => f && f.base.kcal != null);
}
