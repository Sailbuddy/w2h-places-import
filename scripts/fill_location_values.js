import fs from 'fs';
import fetch from 'node-fetch';
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;

const filePath = process.argv[2] || 'data/place_ids.json';
const placeEntries = JSON.parse(fs.readFileSync(filePath, 'utf8'));

const language = 'de';
const now = new Date().toISOString();

const fetchPlaceDetails = async (placeId) => {
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&language=${language}&key=${GOOGLE_API_KEY}`;
  const res = await fetch(url);
  const data = await res.json();
  return data.result || null;
};

const main = async () => {
  const { data: attributes, error: attrErr } = await supabase
    .from('attribute_definitions')
    .select('id, key, type');

  if (attrErr) {
    console.error('Fehler beim Laden der attribute_definitions:', attrErr.message);
    return;
  }

  for (const entry of placeEntries) {
    const placeId = entry.placeId;
    if (!placeId) continue;

    const details = await fetchPlaceDetails(placeId);
    if (!details) {
      console.warn(`⚠️ Keine Details gefunden für Place ID: ${placeId}`);
      continue;
    }

    const { data: loc, error: locErr } = await supabase
      .from('locations')
      .select('id')
      .eq('place_id', placeId)
      .maybeSingle();

    if (locErr || !loc) {
      console.warn(`⚠️ Keine Location gefunden für Place ID: ${placeId}`);
      continue;
    }

    const location_id = loc.id;

    for (const attr of attributes) {
      const rawValue = details[attr.key];
      if (rawValue === undefined || rawValue === null) continue;

      const entryData = {
        location_id,
        attribute_id: attr.id,
        language_code: language,
        updated_at: now,
      };

      switch (attr.type) {
        case 'text':
          entryData.value_text = String(rawValue);
          break;
        case 'bool':
          entryData.value_bool = Boolean(rawValue);
          break;
        case 'number':
          entryData.value_number = Number(rawValue);
          break;
        case 'option':
          entryData.value_option = String(rawValue);
          break;
        default:
          continue;
      }

      const { error: insertErr } = await supabase
        .from('location_values')
        .upsert(entryData, { ignoreDuplicates: false });

      if (insertErr) {
        console.error(`Fehler beim Einfügen von Attribut ${attr.key}:`, insertErr.message);
      }
    }

    console.log(`✅ Werte für ${details.name || placeId} gespeichert.`);
  }
};

main();
