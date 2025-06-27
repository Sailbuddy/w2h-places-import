// scripts/enrich_location_values.js

require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");
const axios = require("axios");
const fs = require("fs");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const LANGUAGES = ["de", "en", "it", "fr", "hr"];
const filepath = process.argv[2] || "data/place_ids.json";

function loadPlaceIdsFromFile(path) {
  try {
    const raw = fs.readFileSync(path, "utf-8");
    const json = JSON.parse(raw);
    return json.map((entry) =>
      typeof entry === "string"
        ? { placeId: entry, preferredName: null }
        : { placeId: entry.placeId, preferredName: entry.preferredName || null }
    );
  } catch (err) {
    console.error(`❌ Fehler beim Lesen der Datei ${path}:`, err.message);
    return [];
  }
}

function getTodayGroup() {
  const days = ["sonntag", "montag", "dienstag", "mittwoch", "donnerstag", "freitag", "samstag"];
  const today = new Date().getDay();
  return days[today];
}

async function translateWithOpenAI(text, targetLang) {
  try {
    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: `Übersetze folgenden Text ins ${targetLang}. Gib nur den übersetzten Text zurück.`,
          },
          {
            role: "user",
            content: text,
          },
        ],
      },
      {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );
    return response.data.choices[0].message.content.trim();
  } catch (err) {
    console.error(`❌ OpenAI Fehler bei Übersetzung (${targetLang}):`, err.message);
    return text;
  }
}

async function getPlaceDetails(placeId, lang = "en") {
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&language=${lang}&key=${GOOGLE_API_KEY}`;
  const response = await axios.get(url);
  return response.data.result;
}

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

async function enrichLocationValues() {
  const placeEntries = loadPlaceIdsFromFile(filepath);
  if (placeEntries.length === 0) {
    console.warn("⚠️ Keine gültigen Place IDs gefunden.");
    return;
  }

  const { data: allAttributes, error: attrError } = await supabase
    .from("attribute_definitions")
    .select("*");
  if (attrError) {
    console.error("❌ Fehler beim Laden der Attribute:", attrError.message);
    return;
  }

  const groupForToday = getTodayGroup();

  for (const entry of placeEntries) {
    const placeId = entry.placeId;

    const { data: location, error: locError } = await supabase
      .from("locations")
      .select("id, display_name, category_id")
      .eq("google_place_id", placeId)
      .maybeSingle();

    if (locError || !location) {
      console.warn(`⚠️ Keine Location gefunden für ${placeId}`);
      continue;
    }

    console.log(`📍 Bearbeite: ${location.display_name}`);
    const baseDetails = await getPlaceDetails(placeId, "en");

    const attributes = allAttributes.filter(attr =>
      (!attr.category_id || attr.category_id === location.category_id) &&
      (attr.update_frequency === "täglich" || attr.update_frequency === groupForToday)
    );

    for (const attr of attributes) {
      let rawValue = null;

      if (attr.key.startsWith("photo_")) {
        const index = parseInt(attr.key.split("_")[1], 10) - 1;
        const photo = baseDetails.photos?.[index];
        if (!photo) continue;

        rawValue = {
          photo_reference: photo.photo_reference,
          width: photo.width,
          height: photo.height,
        };
      } else {
        rawValue = getValueFromDetails(baseDetails, attr.key);
        if (!rawValue) continue;
      }

      const langs = attr.multilingual ? LANGUAGES : ["de"];

      for (const lang of langs) {
        let translatedValue = rawValue;

        if (attr.multilingual && lang !== "en" && typeof rawValue === "string") {
          translatedValue = await translateWithOpenAI(rawValue, lang);
        }

        const insertData = {
          location_id: location.id,
          attribute_id: attr.attribute_id,
          language_code: lang,
          updated_at: new Date().toISOString(),
        };

        if (attr.key.startsWith("photo_")) {
          insertData.value_json = rawValue;
        } else {
          switch (attr.input_type) {
            case "text":
            case "json":
              insertData.value_text = translatedValue;
              break;
            case "number":
              insertData.value_number = parseFloat(translatedValue);
              break;
            case "boolean":
            case "bool":
              insertData.value_bool = translatedValue === "true" || translatedValue === true;
              break;
            case "option":
              insertData.value_option = translatedValue;
              break;
            default:
              console.warn(`⚠️ Unbekannter input_type (${attr.input_type}) für ${attr.key}`);
              continue;
          }
        }

        const { error } = await supabase.from("location_values").upsert(insertData, {
          onConflict: "location_id,attribute_id,language_code",
        });

        if (error) {
          console.error(`❌ Fehler bei ${attr.key} [${lang}]:`, error.message);
        } else {
          console.log(`✅ ${attr.key} [${lang}] gespeichert.`);
        }
      }
    }
  }

  console.log("🎉 Attribut-Erweiterung abgeschlossen.");
}

enrichLocationValues();
