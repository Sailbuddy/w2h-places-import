import fs from 'fs';
import path from 'path';
import axios from 'axios';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;

const PLACE_IDS_FILE = './data/place_ids.json';
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// --- OPTIONALES MAPPING ---
const TYPE_TO_CATEGORY = {
  restaurant: 1,
  cafe: 2,
  lodging: 3,
  marina: 4,
  museum: 5
};

// --- API FELDER ---
const FIELDS = [
  'name',
  'formatted_address',
  'geometry',
  'place_id',
  'type',
  'opening_hours',
  'website',
  'url',
  'rating',
  'user_ratings_total',
  'price_level',
  'plus_code',
  'editorial_summary',
  'photo',
  'formatted_phone_number',
  'international_phone_number',
  'delivery',
  'dine_in',
  'reservable',
  'serves_beer',
  'serves_vegetarian_food',
  'takeout'
].join(',');

// --- TOOL FUNKTIONEN ---
function flatten(obj, prefix = '', result = {}) {
  for (const key in obj) {
    const value = obj[key];
    const pathKey = prefix ? `${prefix}.${key}` : key;

    if (value && typeof value === 'object' && !Array.isArray(value)) {
      flatten(value, pathKey, result);
    } else if (Array.isArray(value)) {
      value.forEach((v, i) => {
        if (typeof v === 'object') {
          flatten(v, `${pathKey}[${i}]`, result);
        } else {
          result[`${pathKey}[${i}]`] = v;
        }
      });
    } else {
      result[pathKey] = value;
    }
  }
  return result;
}

function guessInputType(value) {
  if (typeof value === 'boolean') return 'checkbox';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'string' && value.length > 100) return 'textarea';
  return 'text';
}

function extractCategoryId(types) {
  if (!Array.isArray(types)) return 9;
  for (const t of types) {
    if (TYPE_TO_CATEGORY[t]) return TYPE_TO_CATEGORY[t];
  }
  return 9; // fallback
}

async function getPlaceId() {
  const raw = fs.readFileSync(PLACE_IDS_FILE, 'utf8');
  const list = JSON.parse(raw);
  if (!list[0]?.placeId) throw new Error('Keine gültige placeId in place_ids.json');
  return list[0].placeId;
}

async function fetchPlaceDetails(placeId) {
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=${FIELDS}&language=de&key=${GOOGLE_API_KEY}`;
  const { data } = await axios.get(url);
  if (data.status !== 'OK') throw new Error(`Google API Fehler: ${data.status}`);
  return data.result;
}

async function getExistingKeys() {
  const { data, error } = await supabase.from('attribute_definitions').select('key');
  if (error) throw new Error(error.message);
  return data.map(d => d.key);
}

async function insertAttribute(attr) {
  const { error } = await supabase.from('attribute_definitions').insert(attr);
  if (error) {
    console.error(`❌ Fehler bei "${attr.key}": ${error.message}`);
  } else {
    console.log(`✅ Neues Attribut: ${attr.key}`);
  }
}

// --- HAUPTFUNKTION ---
async function main() {
  const placeId = await getPlaceId();
  const result = await fetchPlaceDetails(placeId);
  const types = result.types || [];
  const flat = flatten(result);
  const existingKeys = await getExistingKeys();

  const newEntries = Object.entries(flat).filter(([k]) => !existingKeys.includes(k));

  if (newEntries.length === 0) {
    console.log('📭 Keine neuen Attribute erkannt.');
    return;
  }

  const categoryId = extractCategoryId(types);

  for (const [key, value] of newEntries) {
    const inputType = guessInputType(value);
    const label = key.replace(/\./g, ' ').replace(/\[.*?\]/g, '').replace(/_/g, ' ');

    const attr = {
      key,
      name_en: label,
      name_de: label,
      input_type: inputType,
      is_active: false,
      sort_order: 100,
      category_id: categoryId
    };

    await insertAttribute(attr);
  }

  console.log(`🎯 ${newEntries.length} neue Attribute eingefügt.`);
}

main().catch(err => console.error('❌ Abbruch:', err.message));
