import fetch from 'node-fetch';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const filepath = process.argv[2] || 'data/place_ids_archive.json';

function getActiveUpdateLevels() {
  // 🔁 FULL_IMPORT: alle Ebenen 1,2,3 immer aktiv
  if (process.env.FULL_IMPORT === 'true') {
    console.log('🟢 FULL_IMPORT aktiv – verwende alle Update-Level (1,2,3).');
    return [1, 2, 3];
  }

  const today = new Date();
  const weekday = today.getDay(); // 0 = Sonntag
  const dayOfMonth = today.getDate(); // 1–31
  const levels = [1]; // täglich immer
  if (weekday === 0) levels.push(2); // wöchentlich (Sonntag)
  if (dayOfMonth === 1) levels.push(3); // monatlich (1. des Monats)
  return levels;
}

/**
 * Mappe interne Attribute-Keys -> gültige Google Places "fields".
 * Wird aktuell nur zu Debug-Zwecken verwendet.
 */
function toGoogleFields(keys) {
  const map = {
    // Fotos
    photos: 'photos',
    photo_1: 'photos',
    photo_2: 'photos',
    photo_3: 'photos',
    photo_4: 'photos',
    photo_5: 'photos',

    // Öffnungszeiten
    opening_hours: 'opening_hours',
    'opening_hours.open_now': 'opening_hours',
    'opening_hours.periods': 'opening_hours',
    'opening_hours.periods[0].open.day': 'opening_hours',
    'opening_hours.periods[0].open.time': 'opening_hours',
    'opening_hours.weekday_text': 'opening_hours',

    // Name / Adresse / Basics
    name: 'name',
    address: 'formatted_address',
    formatted_address: 'formatted_address',
    phone: 'formatted_phone_number',
    formatted_phone_number: 'formatted_phone_number',
    website: 'website',
    url: 'url',
    maps_url: 'url',
    rating: 'rating',
    price_level: 'price_level',
    plus_code: 'plus_code',
    types: 'types',
    category: 'types',
    geometry: 'geometry',
    lat: 'geometry',
    lng: 'geometry',
    permanently_closed: 'business_status', // alt -> business_status

    // 🔁 Erweiterte Felder für FULL_IMPORT (1:1 Durchreichung)
    business_status: 'business_status',
    current_opening_hours: 'current_opening_hours',
    international_phone_number: 'international_phone_number',
    user_ratings_total: 'user_ratings_total',
    editorial_summary: 'editorial_summary',
    serves_breakfast: 'serves_breakfast',
    serves_lunch: 'serves_lunch',
    serves_dinner: 'serves_dinner',
    serves_beer: 'serves_beer',
    serves_wine: 'serves_wine',
    serves_coffee: 'serves_coffee',
    reservable: 'reservable',
    wheelchair_accessible_entrance: 'wheelchair_accessible_entrance'
  };

  const whitelist = new Set(Object.values(map)); // was wir prinzipiell akzeptieren

  // Minimales, sinnvolles Basis-Set:
  const base = [
    'name',
    'formatted_address',
    'geometry',
    'url',
    'website',
    'formatted_phone_number',
    'rating',
    'price_level',
    'plus_code',
    'types'
  ];

  const out = new Set(base);

  // Aus den aktiven Attribut-Keys ableiten
  for (const k of keys || []) {
    const g = map[k];
    if (g && whitelist.has(g)) out.add(g);
  }

  // 🔁 Zusatzfelder, die bei FULL_IMPORT IMMER angefragt werden sollen
  if (process.env.FULL_IMPORT === 'true') {
    const fullExtra = [
      'business_status',
      'opening_hours',
      'current_opening_hours',
      'international_phone_number',
      'user_ratings_total',
      'editorial_summary',
      'photos',
      'serves_breakfast',
      'serves_lunch',
      'serves_dinner',
      'serves_beer',
      'serves_wine',
      'serves_coffee',
      'reservable',
      'wheelchair_accessible_entrance'
    ];
    for (const g of fullExtra) {
      if (whitelist.has(g)) out.add(g);
    }
  }

  return Array.from(out);
}

/**
 * Holt Place-Details von Google.
 * Nutzt bewusst eine kleine, stabile Feldliste.
 * Gibt nur das `result`-Objekt zurück – oder `null`, wenn status != OK.
 */
async function fetchGooglePlaceData(placeId, language) {
  const apiKey = process.env.GOOGLE_API_KEY;

  // Bewusst konservative Feldliste – hier hatten wir früher sicher funktionierende Aufrufe
  const fields = [
    'name',
    'formatted_address',
    'geometry',
    'url',
    'website',
    'formatted_phone_number',
    'rating',
    'price_level',
    'plus_code',
    'types'
  ].join(',');

  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(
    placeId
  )}&fields=${fields}&language=${language}&key=${apiKey}`;

  try {
    const response = await fetch(url);
    const data = await response.json();

    if (data.status !== 'OK') {
      console.warn(
        `⚠️ Fehler beim Abruf für ${placeId} (${language}): ${data.status} – ${
          data.error_message || 'keine error_message'
        }`
      );
      return null;
    }
    return data.result;
  } catch (err) {
    console.error(`❌ Netzwerkfehler bei ${placeId} (${language}): ${err.message}`);
    return null;
  }
}

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

async function insertOrUpdateLocation(placeEntry, placeDetails) {
  const displayName = placeEntry.preferredName || placeDetails?.name || '(ohne Namen)';
  const categoryId = await resolveCategoryId(placeDetails?.types);
  const now = new Date().toISOString();

  const { data: existing } = await supabase
    .from('locations')
    .select('id')
    .eq('google_place_id', placeEntry.placeId)
    .maybeSingle();

  const { data, error } = await supabase
    .from('locations')
    .upsert(
      [
        {
          google_place_id: placeEntry.placeId,
          display_name: displayName,
          address: placeDetails?.formatted_address || null,
          website: placeDetails?.website || null,
          maps_url: placeDetails?.url || null,
          category_id: categoryId,
          phone: placeDetails?.formatted_phone_number || null,
          rating: placeDetails?.rating || null,
          price_level: placeDetails?.price_level || null,
          lat: placeDetails?.geometry?.location?.lat ?? null,
          lng: placeDetails?.geometry?.location?.lng ?? null,
          plus_code: placeDetails?.plus_code?.global_code || null,
          updated_at: now,
          created_at: existing ? undefined : now
        }
      ],
      { onConflict: 'google_place_id' }
    )
    .select()
    .single();

  if (error) {
    throw new Error(`❌ Fehler beim Upsert der Location: ${error.message}`);
  }

  console.log(`✅ Location gespeichert: ${displayName} (${placeEntry.placeId})`);
  return data;
}

async function loadAttributeMapping() {
  const { data, error } = await supabase
    .from('attribute_definitions')
    .select('attribute_id, key')
    .eq('is_active', true);

  if (error) throw new Error(`Fehler beim Laden des Attribut-Mappings: ${error.message}`);

  const mapping = {};
  data.forEach((attr) => {
    mapping[attr.key] = attr.attribute_id;
  });
  return mapping;
}

async function insertLocationValues(locationId, placeDetails, attributeMapping) {
  const languages = ['de', 'en', 'it', 'hr', 'fr'];
  const inserts = [];

  for (const lang of languages) {
    const nameKey = `name_${lang}`;
    const descKey = `description_${lang}`;

    if (placeDetails[nameKey] && attributeMapping.name) {
      inserts.push({
        location_id: locationId,
        attribute_id: attributeMapping.name,
        value_text: placeDetails[nameKey],
        language_code: lang,
        updated_at: new Date().toISOString()
      });
    }

    if (placeDetails[descKey] && attributeMapping.description) {
      inserts.push({
        location_id: locationId,
        attribute_id: attributeMapping.description,
        value_text: placeDetails[descKey],
        language_code: lang,
        updated_at: new Date().toISOString()
      });
    }
  }

  if (inserts.length > 0) {
    const { error } = await supabase.from('location_values').upsert(inserts);
    if (error) throw new Error(`Fehler beim Speichern der Sprachwerte: ${error.message}`);
    console.log(`🌍 Sprachvarianten gespeichert für Location ID ${locationId}`);
  }
}

function loadPlaceIdsFromFile(filepath) {
  try {
    const raw = fs.readFileSync(filepath, 'utf-8');
    const rawData = JSON.parse(raw);

    return rawData.map((entry) => {
      if (typeof entry === 'string') return { placeId: entry, preferredName: null };
      return { placeId: entry.placeId, preferredName: entry.preferredName || null };
    });
  } catch (err) {
    console.error(`❌ Fehler beim Lesen von ${filepath}: ${err.message}`);
    return [];
  }
}

async function processPlaces() {
  console.log(`📦 Starte Import von Datei: ${filepath}`);
  const placeEntries = loadPlaceIdsFromFile(filepath);
  if (placeEntries.length === 0) {
    console.warn('⚠️ Keine gültigen Einträge gefunden – Abbruch');
    return;
  }

  const activeLevels = getActiveUpdateLevels();

  const { data: activeAttributes, error: attrError } = await supabase
    .from('attribute_definitions')
    .select('key, update_frequency')
    .eq('is_active', true);

  if (attrError) throw new Error(`❌ Fehler beim Laden der Attributdefinitionen: ${attrError.message}`);

  const allowedKeys = (activeAttributes || [])
    .filter((attr) => activeLevels.includes(attr.update_frequency))
    .map((attr) => attr.key);

  // Debug-Ausgabe: interne Keys + (theoretische) Google-Felder
  console.log(`🔎 Erlaube interne Keys heute (${new Date().toISOString()}):`);
  console.log(allowedKeys.join(', '));
  const googleFields = toGoogleFields(allowedKeys);
  console.log('🔎 Google fields (nur Debug, nicht an API gesendet):');
  console.log(googleFields.join(', '));

  const attributeMapping = await loadAttributeMapping();

  for (const placeEntry of placeEntries) {
    try {
      // 🟢 Deutsch = Primärquelle – ohne gültige DE-Daten kein Update
      const detailsDe = await fetchGooglePlaceData(placeEntry.placeId, 'de');
      if (!detailsDe) {
        console.warn(
          `⏭️ Überspringe ${placeEntry.placeId}, weil keine gültigen DE-Details vorliegen. Bestehende DB-Daten bleiben unverändert.`
        );
        continue;
      }

      // Weitere Sprachen sind optional
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
        description_fr: detailsFr?.formatted_address
      };

      await insertLocationValues(location.id, all, attributeMapping);
    } catch (err) {
      console.error(`❌ Fehler bei Place ID ${placeEntry.placeId}: ${err.message}`);
    }
  }

  console.log('✅ Importlauf abgeschlossen');
}

processPlaces();
