// 📦 extract_place_keys.js
// Mini-Modul zum rekursiven Extrahieren und Abgleichen von Attributen aus Google Place JSON
// Voraussetzung: Supabase JS Client ist eingerichtet und verfügbar

import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// 🧠 Mapping Google types → category_id
const TYPE_TO_CATEGORY = {
  restaurant: 1,
  cafe: 2,
  lodging: 3,
  marina: 4,
  museum: 5,
  atm: 6
};

// 🔁 JSON flach extrahieren
function flatten(obj, prefix = '', result = {}) {
  for (const key in obj) {
    const value = obj[key];
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      flatten(value, fullKey, result);
    } else if (Array.isArray(value)) {
      value.forEach((v, i) => {
        if (typeof v === 'object') {
          flatten(v, `${fullKey}[${i}]`, result);
        } else {
          result[`${fullKey}[${i}]`] = v;
        }
      });
    } else {
      result[fullKey] = value;
    }
  }
  return result;
}

// 🧩 Vorschlagslogik für input_type
function suggestInputType(value) {
  if (typeof value === 'boolean') return 'checkbox';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'string' && value.length < 50) return 'text';
  if (typeof value === 'string') return 'textarea';
  return 'text';
}

// 🚀 Hauptfunktion
export async function extractAndInsertAttributes(placeData) {
  const types = placeData.types || [];
  const category_id = TYPE_TO_CATEGORY[types[0]] || 9; // Fallback-Kategorie: 9 = "Sonstige"

  const flat = flatten(placeData);
  for (const key in flat) {
    // Prüfen ob bereits vorhanden
    const { data: existing, error } = await supabase
      .from('attribute_definitions')
      .select('id')
      .eq('key', key)
      .maybeSingle();

    if (existing) continue; // bereits vorhanden

    // Attributvorschlag erzeugen
    const input_type = suggestInputType(flat[key]);

    const insert = await supabase.from('attribute_definitions').insert([
      {
        key,
        category_id,
        name_en: key.replaceAll('.', ' ').replaceAll('_', ' ').replace(/\[\d+\]/g, '').trim(),
        name_de: key.replaceAll('.', ' ').replaceAll('_', ' ').replace(/\[\d+\]/g, '').trim(),
        input_type,
        is_active: false,
        sort_order: 99
      }
    ]);

    if (insert.error) {
      console.warn(`Fehler beim Einfügen von Attribut ${key}:`, insert.error);
    } else {
      console.log(`✅ Neues Attribut erfasst: ${key}`);
    }
  }
}

// 🔧 Beispielnutzung (Testdatei einlesen)
if (process.argv[2]) {
  const filePath = path.resolve(process.argv[2]);
  const raw = fs.readFileSync(filePath, 'utf-8');
  const json = JSON.parse(raw);
  extractAndInsertAttributes(json.result || json);
}
