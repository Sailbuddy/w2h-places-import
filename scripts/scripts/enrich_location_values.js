// scripts/enrich_location_values.js

require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");
const axios = require("axios");

// 🔐 ENV
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// 🌍 Zielsprachen
const LANGUAGES = ["de", "en", "it", "fr"];

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// 🧠 OpenAI-Übersetzer
async function translateWithOpenAI(text, targetLang) {
  try {
    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: `Übersetze ins ${targetLang}. Nur den übersetzten Text, keine Kommentare.`
          },
          {
            role: "user",
            content: text
          }
        ]
      },
      {
        headers: {
          "Authorization": `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    return response.data.choices[0].message.content.trim();
  } catch (err) {
    console.error("Übersetzungsfehler:", err.message);
    return text; // Fallback: gib Original zurück
  }
}

// 🔍 Google Place Details holen
async function getPlaceDetails(placeId, lang = "en") {
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&language=${lang}&key=${GOOGLE_API_KEY}`;
  const response = await axios.get(url);
  return response.data.result;
}

// 🚀 Hauptfunktion
async function enrichLocationValues() {
  const { data: locations } = await supabase.from("locations").select("*");

  const { data: attributes } = await supabase.from("attribute_definitions").select("*");

  for (const location of locations) {
    const placeId = location.google_place_id;
    if (!placeId) continue;

    console.log(`📍 Bearbeite: ${location.display_name}`);

    // Nur EN einmal abrufen, um alle Originalwerte zu holen
    const baseDetails = await getPlaceDetails(placeId, "en");

    for (const attr of attributes) {
      const rawValue = getValueFromDetails(baseDetails, attr.key);
      if (!rawValue) continue;

      // Sprachen je nach Multilingual-Flag
      const langs = attr.multilingual ? LANGUAGES : ["de"];

      for (const lang of langs) {
        let translatedValue = rawValue;

        if (attr.multilingual && lang !== "en") {
          translatedValue = await translateWithOpenAI(rawValue, lang);
        }

        // 🔁 UPSERT location_value
        const { error } = await supabase.from("location_values").upsert({
          location_id: location.id,
          attribute_id: attr.attribute_id,
          language_code: lang,
          value: translatedValue,
          updated_at: new Date().toISOString()
        }, {
          onConflict: "location_id,attribute_id,language_code"
        });

        if (error) {
          console.error(`❌ Fehler bei ${attr.key} [${lang}]:`, error.message);
        } else {
          console.log(`✅ ${attr.key} [${lang}] aktualisiert.`);
        }
      }
    }
  }
}

// 🔎 Hilfsfunktion zur Attribut-Zuordnung
function getValueFromDetails(details, keyPath) {
  const keys = keyPath.split(".");
  let value = details;
  for (const k of keys) {
    if (value && k in value) {
      value = value[k];
    } else {
      return null;
    }
  }
  if (typeof value === "object") return JSON.stringify(value);
  return value?.toString() ?? null;
}

// ▶️ Starte das Skript
enrichLocationValues();
