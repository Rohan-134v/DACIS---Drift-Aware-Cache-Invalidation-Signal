@echo off
echo =======================================================
echo   Starting NeuroBank + DACIS Platform
echo =======================================================

echo Starting DACIS ML Backend (Docker Compose)...
start "DACIS Backend (Port 8000)" cmd /k "cd /d %~dp0DACIS_Backend\DACIS\dacis-backend && docker compose up"

echo Starting NeuroBank Express Backend (Port 4000)...
start "Express Backend (Port 4000)" cmd /k "cd /d %~dp0Bank-Interface\neurobank\backend && npm start"

echo Starting NeuroBank Next.js Frontend (Port 3000)...
start "Next.js Frontend (Port 3000)" cmd /k "cd /d %~dp0Bank-Interface\neurobank && npm run dev"

echo.
echo All services launched in separate windows!
echo - Next.js UI is at: http://localhost:3000
echo - Express API is at: http://localhost:4000
echo - DACIS FastAPI is at: http://localhost:8000
echo.
