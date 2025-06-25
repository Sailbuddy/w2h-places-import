import fs from 'fs';
import axios from 'axios';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const inputFile = process.argv[2] || 'data/place_ids.json';

if (!fs.existsSync(inputFile)) {
  console.error(`❌ Datei nicht gefunden: ${inputFile}`);
  process.exit(1);
}

const placeIds = JSON.parse(fs.readFileSync(inputFile, 'utf8'));

// 🔁 KI-gestützte Übersetzungsfunktion
async function translateWithOpenAI(term) {
  const prompt = `Übersetze den englischen Begriff "${term}" für eine Kartendarstellung in die Sprachen Deutsch (de), Italienisch (it), Französisch (fr) und Kroatisch (hr). Gib nur ein kompaktes JSON-Objekt zurück, z. B.:
{"de":"Restaurant","it":"Ristorante","fr":"Restaurant","hr":"Restoran"}`;

  try {
    const res = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.4
      },
      {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const raw = res.data.choices[0].message.content.trim();
    console.log(`🗣️ OpenAI-Antwort für "${term}":\n${raw}`);

    let parsed;
    try {
      parsed = JSON.parse(raw);
      console.log(`📦 Geparst:`, parsed);
    } catch (e) {
      console.error(`❌ Fehler beim JSON-Parsing für "${term}":`, e.message);
      return {};
    }

    return parsed;
  } catch (err) {
    console.error(`❌ Fehler bei OpenAI-Anfrage für "${term}":`, err.message);
    return {};
  }
}

async function ensureCategory(type) {
  const { data: existing } = await supabase
    .from('categories')
    .select('id')
    .eq('google_cat_id', type)
    .maybeSingle();

  if (existing) {
    console.log(`✅ Bereits vorhanden: ${type}`);
    return false;
  }

  console.log(`➕ Neue Kategorie eingefügt: ${type}`);

  const translations = await translateWithOpenAI(type);

  if (!translations || Object.keys(translations).length === 0) {
    console.warn(`⚠️ Keine Übersetzung erhalten für "${type}"`);
  }

  const newCat = {
    name_en: type,
    name_de: translations.de || null,
    name_it: translations.it || null,
    name_fr: translations.fr || null,
    name_hr: translations.hr || null,
    icon: type,
    active: true,
    sort_order: 9999,
    google_cat_id: type
  };

  const { data, error } = await supabase
    .from('categories')
    .insert(newCat)
    .select()
    .single();

  if (error) {
    console.error(`❌ Fehler beim Einfügen ${type}:`, error.message);
    return false;
  }

  console.log(`📥 Eingefügt mit Übersetzungen: ${type}`);
  return true;
}

async function run() {
  console.log(`📂 Kategorienprüfung für Datei: ${inputFile}`);

  for (const entry of placeIds) {
    const placeId =
      typeof entry === 'string'
        ? entry
        : entry.place_id || entry.placeId || entry.id || entry.place || undefined;

    if (!placeId) {
      console.warn(`⚠️ Ungültiger Eintrag in place_ids.json: ${JSON.stringify(entry)}`);
      continue;
    }

    console.log(`📌 Verarbeite Place ID: ${placeId}`);

    try {
      const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&key=${GOOGLE_API_KEY}`;
      const res = await axios.get(url);
      const result = res.data.result;

      if (!result) {
        console.warn(`⚠️ Kein result für Place ID: ${placeId}`);
        continue;
      }

      const types = result.types || [];
      if (types.length === 0) {
        console.log(`🔍 types ist leer ([])`);
        continue;
      }

      console.log(`🔍 types: ${types.join(', ')}`);

      for (const type of types) {
        const added = await ensureCategory(type);
        if (!added) {
          console.log(`⚠️ Ignoriert: ${type} (bereits vorhanden oder Fehler)`);
        }
      }
    } catch (err) {
      console.error(`❌ Fehler bei Place ${placeId}:`, err.message);
    }
  }

  console.log(`✅ Kategorie-Sync abgeschlossen für ${placeIds.length} Einträge.`);
}

run();
