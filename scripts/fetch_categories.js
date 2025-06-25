// scripts/fetch_categories.js

import dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';
import axios from 'axios';
import fs from 'fs';

// 🔐 Secrets laden
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// 🔐 Sicherheitsprüfung
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Supabase-Konfiguration fehlt. Bitte prüfe SUPABASE_URL und SUPABASE_SERVICE_ROLE_KEY in den GitHub Secrets.');
  process.exit(1);
}

if (!OPENAI_API_KEY) {
  console.error('❌ OpenAI API Key fehlt. Bitte prüfe OPENAI_API_KEY in den GitHub Secrets.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// 📂 Konfiguration
const filePath = 'data/place_ids.json';
const openaiEndpoint = 'https://api.openai.com/v1/chat/completions';
const openaiModel = 'gpt-3.5-turbo';

// 🔤 KI-gestützte Übersetzung
async function translateWithOpenAI(termEn) {
  const prompt = `Gib mir den Begriff "${termEn}" als einfache Kategoriebezeichnung in vier Sprachen zurück:

de:
it:
fr:
hr:

Nur die Wörter, keine Einleitung, keine Sätze.`;

  try {
    const response = await axios.post(
      openaiEndpoint,
      {
        model: openaiModel,
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
    console.error(`❌ Fehler bei der Übersetzung von "${termEn}":`, error.response?.status || '', error.response?.data || error.message);
    return {
      name_de: null,
      name_it: null,
      name_fr: null,
      name_hr: null,
    };
  }
}

// 🚀 Hauptfunktion: Kategorien prüfen & ergänzen
async function syncCategories() {
  const rawData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const allTypes = new Set();

  for (const entry of rawData) {
    if (entry.types && Array.isArray(entry.types)) {
      entry.types.forEach(type => allTypes.add(type));
    }
  }

  console.log(`📦 ${allTypes.size} unterschiedliche Kategorien-Typen gefunden.`);

  for (const type of allTypes) {
    const { data: existing, error: readError } = await supabase
      .from('categories')
      .select('id')
      .eq('google_cat_id', type)
      .maybeSingle();

    if (existing) {
      console.log(`✅ Ignoriert: ${type} (bereits vorhanden)`);
      continue;
    }

    console.log(`➕ Neue Kategorie erkannt: ${type}`);

    const translations = await translateWithOpenAI(type);

    const { error: insertError } = await supabase.from('categories').insert({
      google_cat_id: type,
      name_en: type,
      name_de: translations.name_de,
      name_it: translations.name_it,
      name_fr: translations.name_fr,
      name_hr: translations.name_hr,
      icon: type,
      active: true,
      sort_order: 9999,
    });

    if (insertError) {
      console.error(`❌ Fehler beim Einfügen von ${type}:`, insertError.message);
    } else {
      console.log(`✅ Eingefügt: ${type} mit Übersetzungen.`);
    }
  }

  console.log('🎉 Kategorie-Sync abgeschlossen.');
}

// ▶️ Ausführen
syncCategories();
