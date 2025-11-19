@echo off
setlocal

:: 🔧 Konfiguration
set FILE=data\place_ids.json
set RESET=data\place_ids_reset.json
set BACKUP=data\place_ids_backup_%date:~6,4%%date:~3,2%%date:~0,2%_%time:~0,2%%time:~3,2%.json
set COMMIT_MSG=🧹 place_ids.json durch leere Vorlage ersetzt
set BRANCH=main
set REMOTE=origin

:: Git Konfiguration & Sicherheitsausnahme
git config --global --add safe.directory "%CD%"

echo 🔄 Git Pull vom Remote...
git pull --rebase || (
    echo ❌ Git Pull fehlgeschlagen. Bitte manuell prüfen!
    pause
    exit /b 1
)

:: 📦 Jetzt Datei ersetzen
echo ✅ Backup speichern: %BACKUP%
copy /Y "%FILE%" "%BACKUP%" || (
    echo ❌ Fehler beim Backup!
    pause
    exit /b 1
)

echo ✅ Ersetze %FILE% durch %RESET%
copy /Y "%RESET%" "%FILE%" || (
    echo ❌ Fehler beim Ersetzen!
    pause
    exit /b 1
)

:: Git Commit & Push
echo 📝 Git Commit vorbereiten...
git add "%FILE%"
git commit -m "%COMMIT_MSG%" || echo ⚠️ Keine Änderungen zu committen

echo 🚀 Push mit Absicherung...
git push --force-with-lease %REMOTE% %BRANCH% || (
    echo ❌ Push fehlgeschlagen. Bitte manuell prüfen!
    pause
    exit /b 1
)

echo ✅ Fertig! Neue Datei wurde ersetzt, committed und gepusht.
pause
