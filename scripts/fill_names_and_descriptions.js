// scripts/fill_names_and_descriptions.js

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import axios from "axios";
import fs from "fs";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const googleApiKey = process.env.GOOGLE_API_KEY;

// ✅ Neu: Schutzschalter
// Wenn false: niemals bestehende Felder überschreiben (write-if-empty)
const FORCE_NAMES_DESC = process.env.FORCE_NAMES_DESC === "true";

// ✅ Neu: wenn true: it/fr/hr nur setzen, wenn Text nicht identisch zu EN
const SKIP_IF_SAME_AS_EN = process.env.SKIP_IF_SAME_AS_EN !== "false"; // default true

if (!supabaseUrl || !supabaseKey || !googleApiKey) {
  throw new Error("❌ SUPABASE_URL, SUPABASE_KEY und GOOGLE_API_KEY sind erforderlich.");
}

const supabase = createClient(supabaseUrl, supabaseKey);
const languages = ["de", "en", "fr", "it", "hr"];

async function fetchGoogleData(placeId, language) {
  const url =
    `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(placeId)}` +
    `&language=${encodeURIComponent(language)}` +
    `&fields=name,editorial_summary` +
    `&key=${encodeURIComponent(googleApiKey)}`;

  try {
    const response = await axios.get(url, { timeout: 60000 });
    if (response.data.status !== "OK") {
      console.warn(`⚠️ Google API-Fehler bei ${placeId} (${language}): ${response.data.status}`);
      return null;
    }
    return response.data.result;
  } catch (err) {
    console.warn(`❌ Netzwerkfehler bei ${placeId} (${language}): ${err.message}`);
    return null;
  }
}

async function getExistingLocation(placeId) {
  const { data, error } = await supabase
    .from("locations")
    .select(
      "id, " +
        "name_de,name_en,name_fr,name_it,name_hr, " +
        "description_de,description_en,description_fr,description_it,description_hr"
    )
    .eq("google_place_id", placeId)
    .maybeSingle();

  if (error) {
    console.error(`❌ Fehler beim Lesen existing location (${placeId}): ${error.message}`);
    return null;
  }
  return data || null;
}

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

function normalizeText(v) {
  return String(v || "")
    .replace(/\s+/g, " ")
    .trim();
}

async function updateLocation(placeId, updates) {
  const { error } = await supabase.from("locations").update(updates).eq("google_place_id", placeId);

  if (error) {
    console.error(`❌ Fehler beim Aktualisieren von ${placeId}: ${error.message}`);
  }
}

async function main() {
  const jsonPath = process.argv[2] || "data/place_ids_archive.json";

  let rawData;
  try {
    const fileContent = fs.readFileSync(jsonPath, "utf-8");
    rawData = JSON.parse(fileContent);
  } catch (err) {
    console.error(`❌ Fehler beim Einlesen von ${jsonPath}: ${err.message}`);
    return;
  }

  const placeIds = rawData.map((entry) => (typeof entry === "string" ? entry : entry.placeId));

  for (const placeId of placeIds) {
    const existing = await getExistingLocation(placeId);
    if (!existing) {
      console.warn(`⚠️ Location nicht gefunden in DB (skip): ${placeId}`);
      continue;
    }

    // EN zuerst holen (für "same-as-en" Vergleich)
    const enResult = await fetchGoogleData(placeId, "en");
    const enName = enResult?.name || null;
    const enDesc = enResult?.editorial_summary?.overview || null;

    const updates = {};

    for (const lang of languages) {
      const result = lang === "en" ? enResult : await fetchGoogleData(placeId, lang);
      if (!result) continue;

      const newName = result.name || null;
      const newDesc = result.editorial_summary?.overview || null;

      const nameField = `name_${lang}`;
      const descField = `description_${lang}`;

      // --- NAME: write-if-empty (außer Force) ---
      if (newName) {
        const already = existing[nameField];
        if (FORCE_NAMES_DESC || !isNonEmptyString(already)) {
          updates[nameField] = newName;
        }
      }

      // --- DESCRIPTION: write-if-empty (außer Force) ---
      if (newDesc) {
        const already = existing[descField];

        // ✅ Neu: it/fr/hr nicht mit EN überschreiben, wenn Google eh nur EN liefert
        if (
          SKIP_IF_SAME_AS_EN &&
          lang !== "en" &&
          isNonEmptyString(enDesc) &&
          normalizeText(newDesc) === normalizeText(enDesc)
        ) {
          // Wenn bereits etwas existiert: sowieso nicht überschreiben.
          // Wenn leer: lieber leer lassen als Englisch reinschreiben.
          continue;
        }

        if (FORCE_NAMES_DESC || !isNonEmptyString(already)) {
          updates[descField] = newDesc;
        }
      }
    }

    if (Object.keys(updates).length > 0) {
      await updateLocation(placeId, updates);
      console.log(`✅ Aktualisiert (write-if-empty): ${placeId}`);
    } else {
      console.log(`➖ Keine Änderungen (alles geschützt/leer oder same-as-en): ${placeId}`);
    }
  }

  console.log("🎉 Name + Beschreibung Import abgeschlossen.");
}

main().catch((err) => console.error("❌ Hauptfehler:", err));
