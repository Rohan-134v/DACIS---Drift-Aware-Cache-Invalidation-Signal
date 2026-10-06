@echo off
echo ======================================================
echo   DACIS Fraud Detection - Demo Runner
echo ======================================================
echo.

echo [1] Resetting all accounts to clean state...
cd /d "%~dp0Bank-Interface\neurobank\backend"
node reset-demo.js

echo.
echo [2] Running fraud detection demo...
node demo-transactions.js

echo.
echo ======================================================
echo   Demo complete! Open http://localhost:3000
echo   Login: admin@neurobank.io / NeuroAdmin@2025
echo ======================================================
pause
