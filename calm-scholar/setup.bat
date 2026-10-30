@echo off
cd /d "%~dp0"
python -m venv .venv
if errorlevel 1 goto fail
.venv\Scripts\python.exe -m pip install -r requirements.txt
if errorlevel 1 goto fail
if not exist .env copy .env.example .env >nul
.venv\Scripts\python.exe manage.py migrate
if errorlevel 1 goto fail
echo Setup complete. Run start.bat, then open http://127.0.0.1:8000
pause
exit /b 0
:fail
echo Setup failed. Check the message above. Python 3.11 or newer and internet access are required.
pause
exit /b 1
