import fs from 'fs';
import path from 'path';

const PLACE_IDS_MANUAL_FILE = 'data/place_ids.json';

function clearManualPlaceIdsFile() {
  try {
    const filePath = path.resolve(process.cwd(), PLACE_IDS_MANUAL_FILE);
    const dirPath = path.dirname(filePath);

    console.log(`Arbeitsverzeichnis: ${process.cwd()}`);
    console.log(`Versuche, Datei zu löschen: ${filePath}`);

    if (!fs.existsSync(dirPath)) {
      console.error(`Verzeichnis existiert nicht: ${dirPath}`);
      process.exit(1);
    } else {
      console.log(`Verzeichnis existiert: ${dirPath}`);
      try {
        fs.accessSync(dirPath, fs.constants.W_OK);
        console.log(`Schreibrechte auf Verzeichnis vorhanden: ${dirPath}`);
      } catch {
        console.error(`Keine Schreibrechte für Verzeichnis: ${dirPath}`);
        process.exit(1);
      }
    }

    if (fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, '[]', 'utf-8');
      console.log(`Die Datei ${PLACE_IDS_MANUAL_FILE} wurde erfolgreich geleert.`);
    } else {
      console.warn(`Die Datei ${PLACE_IDS_MANUAL_FILE} existiert nicht.`);
    }
  } catch (err) {
    console.error(`Fehler beim Leeren der Datei ${PLACE_IDS_MANUAL_FILE}: ${err.message}`);
    process.exit(1);
  }
}

clearManualPlaceIdsFile();
