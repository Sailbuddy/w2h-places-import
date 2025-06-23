import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

async function clearPlaceIdsFile() {
  const filePath = path.resolve('./data/place_ids.json');

  try {
    console.log(`Versuche, Datei zu löschen: ${filePath}`);

    // Datei leeren
    fs.writeFileSync(filePath, '[]', 'utf-8');
    console.log(`Die Datei ${filePath} wurde erfolgreich geleert.`);

    // Git Commit und Push vorbereiten
    const repoPath = path.resolve('./');

    // Git Config setzen (Name und Email)
    execSync('git config user.name "github-actions"', { cwd: repoPath });
    execSync('git config user.email "actions@github.com"', { cwd: repoPath });

    // Datei zum Commit hinzufügen
    execSync('git add data/place_ids.json', { cwd: repoPath });

    // Commit erstellen (mit Fehlerbehandlung, falls keine Änderung)
    try {
      execSync('git commit -m "Automatisches Leeren der place_ids.json nach Import"', { cwd: repoPath });
      console.log('✅ Git Commit erfolgreich erstellt.');
    } catch (commitError) {
      console.log('ℹ️ Kein neuer Commit: vermutlich keine Änderung in der Datei.');
    }

    // Änderungen pushen
    execSync('git push', { cwd: repoPath });
    console.log('✅ Änderungen erfolgreich gepusht.');
  } catch (err) {
    console.error('❌ Fehler beim Leeren und Git-Commit/Push:', err);
  }
}

clearPlaceIdsFile();
