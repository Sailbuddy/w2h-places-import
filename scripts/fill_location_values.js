import { createClient } from '@supabase/supabase-js';
import fs from 'fs/promises';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const INPUT_FILE = process.argv[2] || 'data/place_ids.json';
const DEFAULT_LANGUAGE = 'de';

// Diese Attribute wollen wir einfügen
const predefinedAttributes = [
  {
    key: 'google_name',
    translations: {
      de: 'Google Name',
      en: 'Google Name',
      it: 'Nome Google',
      hr: 'Google ime',
      fr: 'Nom Google'
    }
  }
];

async function main() {
  try {
    const raw = await fs.readFile(INPUT_FILE, 'utf8');
    const places = JSON.parse(raw);

    const { data: existingAttributes, error: attrErr } = await supabase
      .from('attribute_definitions')
      .select('*');

    if (attrErr) throw new Error('Fehler beim Laden der Attribute: ' + attrErr.message);

    // Attribute automatisch hinzufügen, falls sie nicht existieren
    for (const attr of predefinedAttributes) {
      const alreadyExists = existingAttributes.some((a) => a.key === attr.key);
      if (!alreadyExists) {
        const { error: insertErr } = await supabase.from('attribute_definitions').insert([
          {
            key: attr.key,
            name_de: attr.translations.de,
            name_en: attr.translations.en,
            name_it: attr.translations.it,
            name_hr: attr.translations.hr,
            name_fr: attr.translations.fr,
            is_active: true
          }
        ]);
        if (insertErr) console.error('❌ Fehler beim Anlegen des Attributs:', insertErr.message);
      }
    }

    // Nach dem Einfügen erneut abrufen, um IDs zu erhalten
    const { data: attributes } = await supabase.from('attribute_definitions').select('*');

    const attrMap = new Map(attributes.map((a) => [a.key, a]));

    for (const place of places) {
      const location_id = place.locationId;
      const name = place.preferredName;

      if (!location_id || !name) {
        console.warn('⚠️  Ungültiger Eintrag (fehlende ID oder Name):', place);
        continue;
      }

      const attr = attrMap.get('google_name');
      if (!attr) {
        console.warn(`⚠️  Attribut "google_name" nicht gefunden – übersprungen`);
        continue;
      }

      const { error: insertValErr } = await supabase.from('location_values').insert([
        {
          location_id,
          attribute_id: attr.id,
          language_code: DEFAULT_LANGUAGE,
          value_text: name
        }
      ]);

      if (insertValErr) {
        console.error(
          `❌ Fehler beim Einfügen der Attribute für ${location_id}:`,
          insertValErr
        );
      } else {
        console.log(`✅ Attribut für ${location_id} eingefügt`);
      }
    }

    console.log('🎉 Fertig!');
  } catch (err) {
    console.error('Fataler Fehler:', err);
  }
}

main();
