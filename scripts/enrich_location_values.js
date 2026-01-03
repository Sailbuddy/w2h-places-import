/**
 * scripts/enrich_location_values.js  (PATCH-Version)
 *
 * Ziele dieser Patch-Version:
 * 1) Photos zuverlässig holen (fields=photos) – statt "random" Full-Details ohne fields
 * 2) photos als echtes JSON (Array) in value_json schreiben (kein stringified JSON)
 * 3) photos pro Location als Snapshot ersetzen (nicht "anwachsen" lassen)
 * 4) bestehende Logik für andere Attribute beibehalten
 *
 * Hinweis:
 * - Dieses Script nutzt weiterhin den Legacy Place Details Endpoint (JSON), aber mit fields=...
 * - Für andere Attribute kannst du bei Bedarf später weitere fields ergänzen.
 */

require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");
const axios = require("axios");
const fs = require("fs");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const INCLUDE_REVIEWS = process.env.INCLUDE_REVIEWS === "true";

if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error("Missing SUPABASE_URL or SUPABASE_KEY");
if (!GOOGLE_API_KEY) throw new Error("Missing GOOGLE_API_KEY");
if (!OPENAI_API_KEY) console.warn("⚠️ OPENAI_API_KEY missing – Übersetzungen fallen auf raw text zurück.");

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const LANGUAGES = ["de", "en", "it", "fr", "hr"];
const NO_LANG = "und"; // neutral für nicht-mehrsprachige Werte
const filepath = process.argv[2] || "data/place_ids.json";

/** -----------------------------
 * Helpers: File -> Place IDs
 * ------------------------------*/
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

/** -----------------------------
 * OpenAI Translate (unchanged)
 * ------------------------------*/
async function translateWithOpenAI(text, targetLang) {
  if (!OPENAI_API_KEY) return text;

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
          { role: "user", content: text },
        ],
      },
      {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        timeout: 60_000,
      }
    );

    return response.data.choices?.[0]?.message?.content?.trim() ?? text;
  } catch (err) {
    console.error(`❌ OpenAI Fehler bei Übersetzung (${targetLang}):`, err.message);
    return text;
  }
}

/** -----------------------------
 * Google Place Details (PATCH)
 * - immer fields setzen
 * - wir holen in baseDetails MIN. photos
 * - optional könnt ihr später weitere fields ergänzen
 * ------------------------------*/
async function getPlaceDetails(placeId, lang = "en", fields = []) {
  const safeFields = Array.isArray(fields) && fields.length ? fields : ["photos"];
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(
    placeId
  )}&language=${encodeURIComponent(lang)}&fields=${encodeURIComponent(safeFields.join(","))}&key=${encodeURIComponent(
    GOOGLE_API_KEY
  )}`;

  const response = await axios.get(url, { timeout: 60_000 });

  if (response.data?.status !== "OK") {
    const msg = response.data?.error_message || response.data?.status || "UNKNOWN";
    throw new Error(`Google Details not OK: ${msg}`);
  }

  return response.data.result;
}

/** -----------------------------
 * Value extractor (unchanged-ish)
 * - liefert primitive oder object
 * - object bleibt object (wird später je nach input_type in jsonb geschrieben)
 * ------------------------------*/
function getValueFromDetails(details, keyPath) {
  const keys = keyPath.split(".");
  let value = details;

  for (const k of keys) {
    if (value && typeof value === "object" && k in value) {
      value = value[k];
    } else {
      return null;
    }
  }

  // Wichtig: object NICHT sofort stringify'en
  return value ?? null;
}

/** -----------------------------
 * DB helper: upsert with conflict key
 * ------------------------------*/
async function upsertLocationValue(insertData) {
  const { error } = await supabase
    .from("location_values")
    .upsert(insertData, { onConflict: "location_id,attribute_id,language_code" });

  if (error) throw new Error(error.message);
}

/** -----------------------------
 * PATCH: Photos Snapshot speichern
 * - schreibt EINEN Datensatz: attribute_id=photos (attr.attribute_id)
 * - language_code = 'und'
 * - value_json = Array of photo objects
 * - ersetzt damit automatisch (upsert)
 * ------------------------------*/
async function savePhotosSnapshot({ locationId, attributeId, photos }) {
  if (!Array.isArray(photos) || photos.length === 0) return;

  const normalized = photos.map((p) => ({
    photo_reference: p.photo_reference ?? null,
    width: p.width ?? null,
    height: p.height ?? null,
    html_attributions: p.html_attributions ?? null,
  }));

  const insertData = {
    location_id: locationId,
    attribute_id: attributeId,
    language_code: NO_LANG,
    updated_at: new Date().toISOString(),
    value_json: normalized, // ✅ echtes JSONB Array
  };

  await upsertLocationValue(insertData);
}

/** -----------------------------
 * Main
 * ------------------------------*/
async function enrichLocationValues() {
  const placeEntries = loadPlaceIdsFromFile(filepath);
  if (placeEntries.length === 0) {
    console.warn("⚠️ Keine gültigen Place IDs gefunden.");
    return;
  }

  // Alle Attribute laden
  const { data: allAttributes, error: attrError } = await supabase
    .from("attribute_definitions")
    .select("*");

  if (attrError) {
    console.error("❌ Fehler beim Laden der Attribute:", attrError.message);
    return;
  }

  for (const entry of placeEntries) {
    const placeId = entry.placeId;

    // Location in DB finden
    const { data: location, error: locError } = await supabase
      .from("locations")
      .select("id, display_name")
      .eq("google_place_id", placeId)
      .maybeSingle();

    if (locError || !location) {
      console.warn(`⚠️ Keine Location gefunden für ${placeId}`);
      continue;
    }

    console.log(`📍 Bearbeite: ${location.display_name} (${placeId})`);

    // Attribute-Links je Place
    const { data: attributeLinks, error: linkError } = await supabase
      .from("attributes_meet_categories")
      .select("attribute_id")
      .eq("place_id", placeId);

    if (linkError) {
      console.error(`❌ Fehler beim Laden der Attribute-Links für ${placeId}:`, linkError.message);
      continue;
    }

    const validAttributeIds = new Set((attributeLinks || []).map((a) => a.attribute_id));

    const filteredAttributes = allAttributes
      .filter((a) => validAttributeIds.has(a.attribute_id))
      .filter((a) => INCLUDE_REVIEWS || a.key !== "reviews");

    // PATCH: Wir holen baseDetails einmal – aber jetzt sicher mit fields!
    // Für dieses Script brauchen wir:
    // - photos (für photos und photo_1..photo_n, falls noch verwendet)
    // - Optional kannst du hier später mehr ergänzen, wenn weitere Attribute direkt aus Details kommen sollen.
    let baseDetails;
    try {
      baseDetails = await getPlaceDetails(placeId, "en", ["photos"]);
    } catch (e) {
      console.error(`❌ Google Details Fehler für ${placeId}:`, e.message);
      continue;
    }

    // 1) PATCH: Wenn "photos" als Attribut existiert -> Snapshot schreiben
    // Wir suchen das Attribute-Definition-Objekt dazu.
    const photosAttr = filteredAttributes.find((a) => a.key === "photos" && a.input_type === "json");

    if (photosAttr) {
      try {
        await savePhotosSnapshot({
          locationId: location.id,
          attributeId: photosAttr.attribute_id,
          photos: baseDetails.photos || [],
        });
        console.log(`🖼️ photos Snapshot gespeichert (${(baseDetails.photos || []).length} Fotos)`);
      } catch (e) {
        console.error(`❌ Fehler beim Speichern photos Snapshot:`, e.message);
      }
    }

    // 2) Restliche Attribute normal verarbeiten
    for (const attr of filteredAttributes) {
      // photos behandeln wir oben als Snapshot (und skippen es hier)
      if (attr.key === "photos") continue;

      // photo_1..photo_5: optional weiter unterstützen, aber auch als JSONB speichern
      if (attr.key.startsWith("photo_")) {
        const idx = parseInt(attr.key.split("_")[1], 10) - 1;
        const photo = baseDetails.photos?.[idx];
        if (!photo) continue;

        const rawValue = {
          photo_reference: photo.photo_reference,
          width: photo.width,
          height: photo.height,
          html_attributions: photo.html_attributions ?? null,
        };

        try {
          await upsertLocationValue({
            location_id: location.id,
            attribute_id: attr.attribute_id,
            language_code: NO_LANG,
            updated_at: new Date().toISOString(),
            value_json: rawValue, // ✅ echtes JSONB
          });
          console.log(`✅ ${attr.key} [${NO_LANG}] gespeichert.`);
        } catch (e) {
          console.error(`❌ Fehler bei ${attr.key}:`, e.message);
        }
        continue;
      }

      // Alle anderen: aus Details via key-path ziehen
      const rawValue = getValueFromDetails(baseDetails, attr.key);
      if (rawValue === null || rawValue === undefined || rawValue === "") continue;

      // nicht-mehrsprachige Attribute mit 'und'
      const langs = attr.multilingual ? LANGUAGES : [NO_LANG];

      for (const lang of langs) {
        let translatedValue = rawValue;

        // Übersetzung nur bei multilingual + string
        if (attr.multilingual && lang !== "en" && typeof rawValue === "string") {
          translatedValue = await translateWithOpenAI(rawValue, lang);
        }

        const insertData = {
          location_id: location.id,
          attribute_id: attr.attribute_id,
          language_code: attr.multilingual ? lang : NO_LANG,
          updated_at: new Date().toISOString(),
        };

        try {
          // input_type routing
          switch (attr.input_type) {
            case "text": {
              // Wenn rawValue object ist (unerwartet) -> stringify fallback
              insertData.value_text =
                typeof translatedValue === "string" ? translatedValue : JSON.stringify(translatedValue);
              break;
            }

            case "json": {
              // ✅ JSONB sauber speichern
              // Wenn translatedValue string ist und aussieht wie JSON -> parse versuchen
              let jsonVal = translatedValue;

              if (typeof jsonVal === "string") {
                const t = jsonVal.trim();
                if ((t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"))) {
                  try {
                    jsonVal = JSON.parse(t);
                  } catch {
                    // bleibt string -> dann lieber in value_text speichern
                    jsonVal = null;
                    insertData.value_text = jsonVal;
                  }
                } else {
                  // kein JSON -> besser als text ablegen
                  jsonVal = null;
                  insertData.value_text = translatedValue;
                }
              }

              if (jsonVal !== null) {
                insertData.value_json = jsonVal;
              } else if (!insertData.value_text) {
                // Fallback, falls oben nichts gesetzt wurde
                insertData.value_text =
                  typeof translatedValue === "string" ? translatedValue : JSON.stringify(translatedValue);
              }
              break;
            }

            case "number": {
              const num = typeof translatedValue === "number" ? translatedValue : parseFloat(translatedValue);
              if (Number.isNaN(num)) continue;
              insertData.value_number = num;
              break;
            }

            case "boolean":
            case "bool": {
              if (typeof translatedValue === "boolean") insertData.value_bool = translatedValue;
              else insertData.value_bool = translatedValue === "true";
              break;
            }

            case "option": {
              insertData.value_option =
                typeof translatedValue === "string" ? translatedValue : JSON.stringify(translatedValue);
              break;
            }

            default:
              console.warn(`⚠️ Unbekannter input_type (${attr.input_type}) für ${attr.key}`);
              continue;
          }

          await upsertLocationValue(insertData);
          console.log(`✅ ${attr.key} [${insertData.language_code}] gespeichert.`);
        } catch (e) {
          console.error(`❌ Fehler bei ${attr.key} [${lang}]:`, e.message);
        }
      }
    }
  }

  console.log("🎉 Attribut-Erweiterung abgeschlossen.");
}

enrichLocationValues().catch((e) => {
  console.error("❌ Fatal:", e);
  process.exit(1);
});
