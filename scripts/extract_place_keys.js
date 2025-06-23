// scripts/extract_place_keys.js

import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Optional: Google-Type → category_id Mapping
const TYPE_TO_CATEGORY = {
  restaurant: 1,
  cafe: 2,
  lodging: 3,
  marina: 4,
  museum: 5,
  atm: 6,
};

const PLACE_FILE = './data/place_details.json';
const DEBUG_LOG = './logs/attributes_added.json'; // optional

function flattenObject(obj, prefix = '', result = {}) {
  for (const key in obj) {
    if (!obj.hasOwnProperty(key)) continue;

    const value = obj[key];
    const prefixedKey = prefix ? `${prefix}.${key}` : key;

    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      flattenObject(value, prefixedKey, result);
    } else if (Array.isArray(value)) {
      value.forEach((item, index) => {
        const arrayKey = `${prefixedKey}[${index}]`;
        if (typeof item === 'object') {
          flattenObject(item, arrayKey, result);
        } else {
          result[arrayKey] = item;
        }
      });
    } else {
      result[prefixedKey] = value;
    }
  }
  return result;
}

async function fetchExistingKeys() {
  const { data, error } = await supabase
    .from('attribute_definitions')
    .select('key');

  if (error) throw error;
  return data.map(d => d.key);
}

function guessInputType(value) {
  if (typeof value === 'boolean') return 'checkbox';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'string' && value.length < 100) return 'text';
  if (typeof value === 'string') return 'textarea';
  return 'text';
}

function extractCategoryIdFromTypes(types) {
  if (!Array.isArray(types)) return null;
  for (const t of types) {
    if (TYPE_TO_CATEGORY[t]) return TYPE_TO_CATEGORY[t];
  }
  return 9; // fallback category_id
}

async function main() {
  const raw = JSON.parse(fs.readFileSync(PLACE_FILE, 'utf8'));
  const place = raw.result;

  const flat = flattenObject(place);
  const types = place.types || [];

  const existingKeys = await fetchExistingKeys();
  const newKeys = Object.entries(flat).filter(([key]) => !existingKeys.includes(key));

  const addedAttributes = [];

  for (const [key, value] of newKeys) {
    const attribute = {
      key,
      name_en: key.replace(/\./g, ' ').replace(/\[.*?\]/g, '').replace(/_/g, ' '),
      name_de: key.replace(/\./g, ' ').replace(/\[.*?\]/g, '').replace(/_/g, ' '), // später übersetzen
      input_type: guessInputType(value),
      is_active: false,
      sort_order: 100,
      category_id: extractCategoryIdFromTypes(types),
    };

    const { data, error } = await supabase
      .from('attribute_definitions')
      .insert(attribute)
      .select();

    if (error) {
      console.error(`❌ Fehler bei ${key}:`, error.message);
    } else {
      console.log(`✅ Neues Attribut: ${key}`);
      addedAttributes.push(attribute);
    }
  }

  if (addedAttributes.length > 0) {
    fs.mkdirSync(path.dirname(DEBUG_LOG), { recursive: true });
    fs.writeFileSync(DEBUG_LOG, JSON.stringify(addedAttributes, null, 2));
    console.log(`📝 Log gespeichert unter ${DEBUG_LOG}`);
  } else {
    console.log('📭 Keine neuen Attribute erkannt.');
  }
}

main().catch(console.error);
