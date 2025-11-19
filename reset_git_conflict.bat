@echo off
setlocal

:: 🧭 Verzeichnis setzen (falls nötig)
cd /d C:\Users\gmaye\repos\w2h-places-import

echo 🧹 Überprüfe Git-Status auf Konflikte ...
git status

:: Prüfen, ob Rebase aktiv ist
git rebase --abort >nul 2>&1
if %ERRORLEVEL%==0 (
    echo 🔄 Git Rebase abgebrochen.
)

:: Wiederherstellen der problematischen Datei (force reset)
echo 🧨 Stelle place_ids.json auf Remote-Stand zurück ...
git restore --source=origin/main --staged --worktree data/place_ids.json

:: 🧼 Alles sauber? Dann Pull starten
echo 🔄 Führe jetzt git pull aus ...
git pull

:: 🟢 Erfolgsmeldung
echo ✅ Git-Konflikt wurde bereinigt und aktueller Stand geladen.
pause