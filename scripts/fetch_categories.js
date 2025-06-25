import fs from 'fs';
import axios from 'axios';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const inputFile = process.argv[2] || 'data/place_ids.json';

if (!fs.existsSync(inputFile)) {
  console.error(`❌ Datei nicht gefunden: ${inputFile}`);
  process.exit(1);
}

const placeIds = JSON.parse(fs.readFileSync(inputFile, 'utf8'));

async function translateWithOpenAI(termEn) {
  const prompt = `
Gib mir den Begriff "${termEn}" auf folgenden Sprachen als einfache Wörter oder Kategorienbezeichnungen zurück:

Deutsch (de):
Italienisch (it):
Französisch (fr):
Kroatisch (hr):

Nur die Begriffe, keine Erklärung, keine Einleitung. Format:
de: ...
it: ...
fr: ...
hr: ...
  `;

  try {
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${OPENAI_API_KEY}`,
        },
      }
    );

    const content = response.data.choices[0].message.content;

    const translations = {};
    for (const line of content.split('\n')) {
      const [lang, value] = line.split(':').map(s => s.trim());
      if (lang && value) {
        translations[lang] = value;
      }
    }

    return {
      name_de: translations.de || null,
      name_it: translations.it || null,
      name_fr: translations.fr || null,
      name_hr: translations.hr || null,
    };
  } catch (error) {
    console.error(`❌ Fehler bei der Übersetzung von "${termEn}":`, error?.response?.status, error?.response?.data);
    return {
      name_de: null,
      name_it: null,
      name_fr: null,
      name_hr: null,
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

  console.log(`🧠 Neue Kategorie erkannt: ${type} → sende an KI zur Übersetzung...`);
  const translations = await translateWithOpenAI(type);

  const newCat = {
    name_en: type,
    name_de: translations.name_de,
    name_it: translations.name_it,
    name_fr: translations.name_fr,
    name_hr: translations.name_hr,
    icon: type,
    active: true,
    sort_order: 9999,
    google_cat_id: type,
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
