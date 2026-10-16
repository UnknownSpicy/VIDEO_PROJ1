@echo off
setlocal
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
    py -3.12 -m venv .venv
    if errorlevel 1 exit /b 1
)
".venv\Scripts\python.exe" -m pip install -r requirements.txt
if errorlevel 1 exit /b 1
echo CreatorIQ: oppna http://127.0.0.1:8000 i din webblasare.
".venv\Scripts\python.exe" -m creatoriq
