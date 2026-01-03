require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");
const axios = require("axios");
const fs = require("fs");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const INCLUDE_REVIEWS = process.env.INCLUDE_REVIEWS === "true";
const MAX_PHOTOS = Number(process.env.MAX_PHOTOS || 10);

if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error("Missing SUPABASE_URL or SUPABASE_KEY");
if (!GOOGLE_API_KEY) throw new Error("Missing GOOGLE_API_KEY");
if (!OPENAI_API_KEY) console.warn("⚠️ OPENAI_API_KEY missing – translations will fallback to raw text");

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const LANGUAGES = ["de", "en", "it", "fr", "hr"];
const NO_LANG = "und";
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

async function translateWithOpenAI(text, targetLang) {
  if (!OPENAI_API_KEY) return text;

  try {
    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o",
        messages: [
          { role: "system", content: `Übersetze folgenden Text ins ${targetLang}. Gib nur den übersetzten Text zurück.` },
          { role: "user", content: text },
        ],
        temperature: 0.2,
      },
      {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        timeout: 60000,
      }
    );
    return response.data.choices[0].message.content.trim();
  } catch (err) {
    console.error(`❌ OpenAI Fehler bei Übersetzung (${targetLang}):`, err?.response?.data || err.message);
    return text;
  }
}

/**
 * Legacy Places Details (v3) – liefert photos[] mit photo_reference.
 * Wichtig: Wir nutzen bewusst kein fields=..., weil eure Attribute dynamisch sind.
 */
async function getPlaceDetails(placeId, lang = "en") {
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(
    placeId
  )}&language=${encodeURIComponent(lang)}&key=${encodeURIComponent(GOOGLE_API_KEY)}`;

  const response = await axios.get(url, { timeout: 60000 });
  if (!response.data || response.data.status !== "OK") {
    throw new Error(`Google Details failed: ${response.data?.status} - ${response.data?.error_message || "no error_message"}`);
  }
  return response.data.result;
}

function getValueFromDetails(details, keyPath) {
  const keys = keyPath.split(".");
  let value = details;
  for (const k of keys) {
    if (value && Object.prototype.hasOwnProperty.call(value, k)) {
      value = value[k];
    } else {
      return null;
    }
  }
  return value ?? null;
}

/**
 * Normalisiert photos[] auf ein sauberes Snapshot-Format.
 * Entfernt "ai:false" Artefakte, dedupliziert per photo_reference.
 */
function normalizePhotos(detailsPhotos) {
  const arr = Array.isArray(detailsPhotos) ? detailsPhotos : [];
  const out = [];
  const seen = new Set();

  for (const p of arr) {
    const ref = p?.photo_reference;
    if (!ref || seen.has(ref)) continue;
    seen.add(ref);

    out.push({
      photo_reference: ref,
      width: p?.width ?? null,
      height: p?.height ?? null,
      html_attributions: Array.isArray(p?.html_attributions) ? p.html_attributions : [],
    });

    if (out.length >= MAX_PHOTOS) break;
  }

  return out;
}

async function upsertValue(insertData) {
  const { error } = await supabase.from("location_values").upsert(insertData, {
    onConflict: "location_id,attribute_id,language_code",
  });
  if (error) throw error;
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

  for (const entry of placeEntries) {
    const placeId = entry.placeId;

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

    let baseDetails;
    try {
      baseDetails = await getPlaceDetails(placeId, "en");
    } catch (e) {
      console.error(`❌ Place Details Fehler für ${placeId}:`, e.message);
      continue;
    }

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

    // --- PATCH: Photos Snapshot einmalig vorbereiten --------------------
    const photosSnapshot = normalizePhotos(baseDetails.photos);

    for (const attr of filteredAttributes) {
      try {
        // 1) PATCH: key === "photos" -> komplettes Array als Snapshot in value_json
        if (attr.key === "photos") {
          if (photosSnapshot.length === 0) {
            // nichts zu speichern
            continue;
          }

          await upsertValue({
            location_id: location.id,
            attribute_id: attr.attribute_id,
            language_code: NO_LANG,
            updated_at: new Date().toISOString(),
            value_json: photosSnapshot,
          });

          console.log(`🖼️ photos Snapshot gespeichert (${photosSnapshot.length} Fotos)`);
          continue;
        }

        // 2) Kompatibilität: photo_1..photo_5 als einzelne Fotoobjekte
        if (attr.key && attr.key.startsWith("photo_")) {
          const index = parseInt(attr.key.split("_")[1], 10) - 1;
          const p = photosSnapshot[index];
          if (!p) continue;

          await upsertValue({
            location_id: location.id,
            attribute_id: attr.attribute_id,
            language_code: NO_LANG,
            updated_at: new Date().toISOString(),
            value_json: {
              photo_reference: p.photo_reference,
              width: p.width,
              height: p.height,
              html_attributions: p.html_attributions,
            },
          });

          console.log(`✅ ${attr.key} gespeichert (Foto #${index + 1})`);
          continue;
        }

        // 3) Alle anderen Attribute: aus baseDetails lesen
        const raw = getValueFromDetails(baseDetails, attr.key);
        if (raw === null || raw === undefined || raw === "") continue;

        const langs = attr.multilingual ? LANGUAGES : [NO_LANG];

        for (const lang of langs) {
          let valueForInsert = raw;

          // Übersetzung nur für string-basierte, mehrsprachige Felder
          if (attr.multilingual && lang !== "en" && typeof raw === "string") {
            valueForInsert = await translateWithOpenAI(raw, lang);
          }

          const insertData = {
            location_id: location.id,
            attribute_id: attr.attribute_id,
            language_code: attr.multilingual ? lang : NO_LANG,
            updated_at: new Date().toISOString(),
          };

          switch (attr.input_type) {
            case "text":
              insertData.value_text = String(valueForInsert);
              break;

            case "json": {
              // wenn raw ein Objekt ist, direkt speichern, sonst parse versuchen
              if (typeof valueForInsert === "object") {
                insertData.value_json = valueForInsert;
              } else {
                const s = String(valueForInsert);
                try {
                  insertData.value_json = JSON.parse(s);
                } catch {
                  // fallback: als Text
                  insertData.value_text = s;
                }
              }
              break;
            }

            case "number":
              insertData.value_number = Number(valueForInsert);
              if (Number.isNaN(insertData.value_number)) continue;
              break;

            case "boolean":
            case "bool":
              insertData.value_bool = valueForInsert === true || valueForInsert === "true";
              break;

            case "option":
              insertData.value_option = String(valueForInsert);
              break;

            default:
              console.warn(`⚠️ Unbekannter input_type (${attr.input_type}) für ${attr.key}`);
              continue;
          }

          await upsertValue(insertData);
          console.log(`✅ ${attr.key} [${insertData.language_code}] gespeichert.`);
        }
      } catch (err) {
        console.error(`❌ Fehler bei ${attr.key}:`, err.message || err);
      }
    }
  }

  console.log("🎉 Attribut-Erweiterung abgeschlossen.");
}

enrichLocationValues();
