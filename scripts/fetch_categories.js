import fs from 'fs';
import axios from 'axios';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

// 🔑 API Keys
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY; // WICHTIG: konsistent mit yml
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// 📁 Dateiname über Argument oder Default
const inputFile = process.argv[2] || 'data/place_ids.json';

if (!fs.existsSync(inputFile)) {
  console.error(`❌ Datei nicht gefunden: ${inputFile}`);
  process.exit(1);
}

const placeIds = JSON.parse(fs.readFileSync(inputFile, 'utf8'));

// 🧠 KI-Übersetzer
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
      if (lang && value) translations[lang] = value;
    }

    return {
      name_de: translations.de || null,
      name_it: translations.it || null,
      name_fr: translations.fr || null,
      name_hr: translations.hr || null,
    };
  } catch (error) {
    console.error(`❌ OpenAI-Fehler bei "${termEn}":`, error.response?.data || error.message);
    return { name_de: null, name_it: null, name_fr: null, name_hr: null };
  }
}

// 🧩 Kategorie eintragen
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

  const translations = await translateWithOpenAI(type);

  const newCat = {
    google_cat_id: type,
    name_en: type,
    name_de: translations.name_de,
    name_it: translations.name_it,
    name_fr: translations.name_fr,
    name_hr: translations.name_hr,
    icon: type,
    active: true,
    sort_order: 9999,
  };

  const { error } = await supabase.from('categories').insert(newCat);
  if (error) {
    console.error(`❌ Fehler beim Einfügen von ${type}:`, error.message);
    return false;
  }

  console.log(`➕ Neue Kategorie eingefügt: ${type}`);
  return true;
}

// ▶️ Hauptfunktion
async function run() {
  console.log(`📂 Kategorienprüfung für Datei: ${inputFile}`);

  for (const entry of placeIds) {
    const placeId = typeof entry === 'string'
      ? entry
      : entry.place_id || entry.placeId || entry.id || entry.place || undefined;

    if (!placeId) {
      console.warn(`⚠️ Ungültiger Eintrag: ${JSON.stringify(entry)}`);
      continue;
    }

    console.log(`📌 Prüfe Place ID: ${placeId}`);

    try {
      const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&key=${GOOGLE_API_KEY}`;
      const res = await axios.get(url);
      const result = res.data.result;

      if (!result || !result.types || !Array.isArray(result.types)) {
        console.warn(`⚠️ Keine gültigen types bei Place ID ${placeId}`);
        continue;
      }

      for (const type of result.types) {
        const added = await ensureCategory(type);
        if (!added) {
          console.log(`⚠️ Ignoriert: ${type}`);
        }
      }
    } catch (err) {
      console.error(`❌ Fehler bei Place ${placeId}:`, err.message);
    }
  }

  console.log(`✅ Kategorie-Sync abgeschlossen für ${placeIds.length} Einträge.`);
}

run();
