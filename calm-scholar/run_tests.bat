@echo off
cd /d "%~dp0"
if not exist .venv\Scripts\python.exe (
  echo Run setup.bat first.
  pause
  exit /b 1
)
.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.venv\Scripts\python.exe -m pytest -q
.venv\Scripts\python.exe manage.py check
pause
