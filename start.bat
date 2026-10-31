@echo off
cd /d "%~dp0"
if not exist .venv\Scripts\python.exe (
  echo Run setup.bat first.
  pause
  exit /b 1
)
echo Open http://127.0.0.1:8000 in your browser. Keep this window open.
.venv\Scripts\python.exe manage.py runserver 127.0.0.1:8000
pause
