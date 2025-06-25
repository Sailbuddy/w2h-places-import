import fs from 'fs';
import axios from 'axios';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ▶️ Eingabeparameter (Dateiname)
const inputFile = process.argv[2];
if (!inputFile || !fs.existsSync(inputFile)) {
  console.error(`❌ Datei nicht gefunden oder nicht angegeben: ${inputFile}`);
  process.exit(1);
}

const placeIds = JSON.parse(fs.readFileSync(inputFile, 'utf8'));

async function translateType(type) {
  const prompt = `
Gib mir den Begriff "${type}" auf folgenden Sprachen als einfache Wörter oder Kategorienbezeichnungen zurück:

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
    const res = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
      }
    );

    const content = res.data.choices[0].message.content;
    const lines = content.split('\n');
    const result = {};
    for (const line of lines) {
      const [lang, value] = line.split(':').map(s => s.trim());
      if (lang && value) result[lang] = value;
    }

    return {
      name_de: result.de || null,
      name_it: result.it || null,
      name_fr: result.fr || null,
      name_hr: result.hr || null,
    };
  } catch (err) {
    console.error(`❌ Übersetzungsfehler für "${type}":`, err.message);
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

  const translations = await translateType(type);

  const { error } = await supabase.from('categories').insert({
    name_en: type,
    name_de: translations.name_de,
    name_it: translations.name_it,
    name_fr: translations.name_fr,
    name_hr: translations.name_hr,
    icon: type,
    active: true,
    sort_order: 9999,
    google_cat_id: type,
  });

  if (error) {
    console.error(`❌ Fehler beim Einfügen ${type}:`, error.message);
    return false;
  }

  console.log(`➕ Neue Kategorie eingefügt: ${type}`);
  return true;
}

async function run() {
  console.log(`📂 Kategorie-Sync gestartet für: ${inputFile}`);

  for (const entry of placeIds) {
    const placeId =
      typeof entry === 'string'
        ? entry
        : entry.place_id || entry.placeId || entry.id || entry.place || undefined;

    if (!placeId) {
      console.warn(`⚠️ Ungültiger Eintrag in Datei: ${JSON.stringify(entry)}`);
      continue;
    }

    try {
      const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&key=${GOOGLE_API_KEY}`;
      const res = await axios.get(url);
      const result = res.data.result;

      if (!result?.types || !Array.isArray(result.types)) {
        console.warn(`⚠️ Keine gültigen types für ${placeId}`);
        continue;
      }

      for (const type of result.types) {
        await ensureCategory(type);
      }
    } catch (err) {
      console.error(`❌ Fehler bei ${placeId}:`, err.message);
    }
  }

  console.log(`✅ Kategorie-Sync abgeschlossen für Datei: ${inputFile}`);
}

run();
