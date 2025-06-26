import fetch from 'node-fetch';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// 🔁 Eingabedatei aus Argument oder Standardwert
const filepath = process.argv[2] || 'data/place_ids_archive.json';

// 🔎 Google Place Details abrufen
async function fetchGooglePlaceData(placeId, language) {
  const apiKey = process.env.GOOGLE_API_KEY;
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(placeId)}&fields=name,formatted_address,website,url,types,opening_hours,formatted_phone_number,rating,price_level&language=${language}&key=${apiKey}`;

  try {
    const response = await fetch(url);
    const data = await response.json();

    if (data.status !== 'OK') {
      console.warn(`⚠️ Fehler beim Abruf für ${placeId} (${language}): ${data.status}`);
      return null;
    }

    return data.result;
  } catch (err) {
    console.error(`❌ Netzwerkfehler bei ${placeId} (${language}): ${err.message}`);
    return null;
  }
}

// 📥 Kategorie-ID aus erster Google-Type ermitteln
async function resolveCategoryId(googleTypes) {
  if (!googleTypes || googleTypes.length === 0) return 1;
  const firstType = googleTypes[0];

  const { data, error } = await supabase
    .from('categories')
    .select('id')
    .eq('google_cat_id', firstType)
    .maybeSingle();

  if (error || !data) {
    console.warn(`⚠️ Keine Kategorie-ID gefunden für Typ: ${firstType}, fallback zu ID 1`);
    return 1;
  }

  return data.id;
}

// 📥 Location einfügen oder aktualisieren
async function insertOrUpdateLocation(placeEntry, placeDetails) {
  const displayName = placeEntry.preferredName || placeDetails?.name || '(ohne Namen)';
  const categoryId = await resolveCategoryId(placeDetails?.types);
  const now = new Date().toISOString();

  // Prüfen ob der Datensatz bereits existiert (wegen created_at)
  const { data: existing, error: fetchError } = await supabase
    .from('locations')
    .select('id, created_at')
    .eq('google_place_id', placeEntry.placeId)
    .maybeSingle();

  if (fetchError) {
    throw new Error(`❌ Fehler beim Lesen bestehender Location: ${fetchError.message}`);
  }

  const { data, error } = await supabase.from('locations').upsert([{
    google_place_id: placeEntry.placeId,
    display_name: displayName,
    address: placeDetails?.formatted_address || null,
    website: placeDetails?.website || null,
    maps_url: placeDetails?.url || null,
    category_id: categoryId,
    phone: placeDetails?.formatted_phone_number || null,
    rating: placeDetails?.rating || null,
    price_level: placeDetails?.price_level || null,
    created_at: existing?.created_at || now,
    updated_at: now,
  }], { onConflict: 'google_place_id' }).select().single();

  if (error) {
    throw new Error(`❌ Fehler beim Upsert der Location: ${error.message}`);
  }

  console.log(`✅ Location gespeichert: ${displayName} (${placeEntry.placeId})`);
  return data;
}

// 🧩 Attribut-Mapping laden
async function loadAttributeMapping() {
  const { data, error } = await supabase
    .from('attribute_definitions')
    .select('id, key')
    .eq('is_active', true);

  if (error) throw new Error(`Fehler beim Laden des Attribut-Mappings: ${error.message}`);

  const mapping = {};
  data.forEach(attr => {
    mapping[attr.key] = attr.id;
  });
  return mapping;
}

// 🌍 Location-Werte in mehreren Sprachen einfügen
async function insertLocationValues(locationId, placeDetails, attributeMapping) {
  const languages = ['de', 'en', 'it', 'hr', 'fr'];
  const inserts = [];
  const now = new Date().toISOString();

  for (const lang of languages) {
    const nameKey = `name_${lang}`;
    const descKey = `description_${lang}`;

    if (placeDetails[nameKey] && attributeMapping.name) {
      inserts.push({
        location_id: locationId,
        attribute_id: attributeMapping.name,
        value_text: placeDetails[nameKey],
        language_code: lang,
        updated_at: now,
      });
    }

    if (placeDetails[descKey] && attributeMapping.description) {
      inserts.push({
        location_id: locationId,
        attribute_id: attributeMapping.description,
        value_text: placeDetails[descKey],
        language_code: lang,
        updated_at: now,
      });
    }
  }

  if (inserts.length > 0) {
    const { error } = await supabase.from('location_values').upsert(inserts);
    if (error) throw new Error(`Fehler beim Speichern der Sprachwerte: ${error.message}`);
    console.log(`🌍 Sprachvarianten gespeichert für Location ID ${locationId}`);
  }
}

// 📂 Datei mit Place IDs laden
function loadPlaceIdsFromFile(filepath) {
  try {
    const raw = fs.readFileSync(filepath, 'utf-8');
    const rawData = JSON.parse(raw);

    return rawData.map(entry => {
      if (typeof entry === 'string') return { placeId: entry, preferredName: null };
      return { placeId: entry.placeId, preferredName: entry.preferredName || null };
    });
  } catch (err) {
    console.error(`❌ Fehler beim Lesen von ${filepath}: ${err.message}`);
    return [];
  }
}

// ▶️ Hauptlauf
async function processPlaces() {
  console.log(`📦 Starte Import von Datei: ${filepath}`);
  const placeEntries = loadPlaceIdsFromFile(filepath);

  if (placeEntries.length === 0) {
    console.warn('⚠️ Keine gültigen Einträge gefunden – Abbruch');
    return;
  }

  const attributeMapping = await loadAttributeMapping();

  for (const placeEntry of placeEntries) {
    try {
      const detailsDe = await fetchGooglePlaceData(placeEntry.placeId, 'de');
      const detailsEn = await fetchGooglePlaceData(placeEntry.placeId, 'en');
      const detailsIt = await fetchGooglePlaceData(placeEntry.placeId, 'it');
      const detailsHr = await fetchGooglePlaceData(placeEntry.placeId, 'hr');
      const detailsFr = await fetchGooglePlaceData(placeEntry.placeId, 'fr');

      const location = await insertOrUpdateLocation(placeEntry, detailsDe);

      const all = {
        name_de: detailsDe?.name,
        description_de: detailsDe?.formatted_address,
        name_en: detailsEn?.name,
        description_en: detailsEn?.formatted_address,
        name_it: detailsIt?.name,
        description_it: detailsIt?.formatted_address,
        name_hr: detailsHr?.name,
        description_hr: detailsHr?.formatted_address,
        name_fr: detailsFr?.name,
        description_fr: detailsFr?.formatted_address,
      };

      await insertLocationValues(location.id, all, attributeMapping);
    } catch (err) {
      console.error(`❌ Fehler bei Place ID ${placeEntry.placeId}: ${err.message}`);
    }
  }

  console.log('✅ Importlauf abgeschlossen');
}

processPlaces();
