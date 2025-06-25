const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function run(inputFile) {
  const inputPath = path.resolve(inputFile);
  const places = JSON.parse(fs.readFileSync(inputPath, 'utf-8'));

  // Hole alle Attribute aus Supabase (verwende "key" statt "google_key")
  const attributeDefinitionsRes = await supabase
    .from('attribute_definitions')
    .select('id, key, input_type, default_value');

  if (attributeDefinitionsRes.error) {
    console.error('Fehler beim Laden der attribute_definitions:', attributeDefinitionsRes.error.message);
    return;
  }

  const attributeDefinitions = attributeDefinitionsRes.data;

  for (const place of places) {
    const { placeId, preferredName } = place;

    // Hole Location aus Supabase
    const locationRes = await supabase
      .from('locations')
      .select('id')
      .eq('google_place_id', placeId)
      .maybeSingle();

    if (locationRes.error || !locationRes.data) {
      console.warn(`⚠️ Keine Location gefunden für Place ID: ${placeId}`);
      continue;
    }

    const locationId = locationRes.data.id;

    for (const attr of attributeDefinitions) {
      const googleKey = attr.key;
      const inputType = attr.input_type;
      const defaultValue = attr.default_value || null;
      const value =
        googleKey === 'name' ? preferredName : defaultValue;

      const insertRes = await supabase.from('location_values').insert({
        location_id: locationId,
        attribute_definition_id: attr.id,
        value: value,
        type: inputType,
      });

      if (insertRes.error) {
        console.error(`Fehler beim Einfügen für ${placeId} (${googleKey}):`, insertRes.error.message);
      }
    }
  }

  console.log('✅ Alle Werte wurden verarbeitet.');
}

const inputFile = process.argv[2];
if (!inputFile) {
  console.error('❌ Bitte gib eine JSON-Datei als Argument an.');
  process.exit(1);
}

run(inputFile);
