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

async function translateCategoryName(name_en) {
  const prompt = `Übersetze den Begriff "${name_en}" als Kategoriebeschreibung für eine Google Maps Karte jeweils mit einem einzelnen Wort in die folgenden Sprachen: Deutsch (de), Italienisch (it), Französisch (fr), Kroatisch (hr). Gib das Ergebnis als JSON-Objekt zurück mit den Schlüsseln name_de, name_it, name_fr, name_hr.`;

  try {
    const response = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: 'gpt-4',
      messages: [
        { role: 'system', content: 'Du bist ein hilfreicher Übersetzer für Begriffe aus der Kartenkategorisierung.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.3
    }, {
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    const message = response.data.choices[0].message.content;
    const translations = JSON.parse(message);
    return translations;

  } catch (err) {
    console.error(`❌ Fehler bei der Übersetzung von "${name_en}":`, err.message);
    return {
      name_de: null,
      name_it: null,
      name_fr: null,
      name_hr: null
    };
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

  console.log(`🌍 Übersetze Kategorie "${type}" ...`);
  const translations = await translateCategoryName(type);

  const newCat = {
    name_en: type,
    name_de: translations.name_de,
    name_it: translations.name_it,
    name_fr: translations.name_fr,
    name_hr: translations.name_hr,
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

      if ('types' in result && Array.isArray(result.types)) {
        if (result.types.length === 0) {
          console.log(`🔍 types ist leer ([])`);
        } else {
          console.log(`🔍 types: ${result.types.join(', ')}`);
        }
      } else {
        console.warn(`⚠️ types-Feld fehlt oder ist kein Array!`);
      }

      const types = result.types || [];
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
