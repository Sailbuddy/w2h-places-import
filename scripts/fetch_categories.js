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

// ▶️ Argument: JSON-Dateiname
const inputFile = process.argv[2] || 'data/place_ids.json';

if (!fs.existsSync(inputFile)) {
  console.error(`❌ Datei nicht gefunden: ${inputFile}`);
  process.exit(1);
}

const placeIds = JSON.parse(fs.readFileSync(inputFile, 'utf8'));

async function translateWithOpenAI(term) {
  const prompt = `Übersetze das Wort "${term}" (z. B. eine Kategorie wie "restaurant", "park" etc.) in folgende Sprachen:\n- Deutsch\n- Italienisch\n- Französisch\n- Kroatisch\n\nFormat:\n{\n  "de": "…",\n  "it": "…",\n  "fr": "…",\n  "hr": "…"\n}`;

  try {
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4',
        messages: [
          { role: 'system', content: 'Du bist ein hilfreicher Übersetzer.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.3
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${OPENAI_API_KEY}`
        }
      }
    );

    const raw = response.data.choices[0].message.content;

    // JSON aus Text extrahieren und parsen
    const match = raw.match(/\{[\s\S]*?\}/);
    if (!match) {
      console.warn(`⚠️ Kein JSON gefunden in der KI-Antwort:\n${raw}`);
      return {};
    }

    const parsed = JSON.parse(match[0]);
    return parsed;
  } catch (err) {
    console.error(`❌ Fehler bei OpenAI-Übersetzung: ${err.response?.status || ''} ${err.message}`);
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

  const base = {
    name_en: type,
    icon: type,
    active: true,
    sort_order: 9999,
    google_cat_id: type
  };

  // 🔁 OpenAI-Übersetzung holen
  const translations = await translateWithOpenAI(type);

  if (translations.de) base.name_de = translations.de;
  if (translations.it) base.name_it = translations.it;
  if (translations.fr) base.name_fr = translations.fr;
  if (translations.hr) base.name_hr = translations.hr;

  const { data, error } = await supabase
    .from('categories')
    .insert(base)
    .select()
    .single();

  if (error) {
    console.error(`❌ Fehler beim Einfügen ${type}:`, error.message);
    return false;
  } else {
    console.log(`➕ Neue Kategorie eingefügt: ${type}`);
    return true;
  }
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
      } else {
        console.log(`🔍 types: ${types.join(', ')}`);
      }

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
