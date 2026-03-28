@echo off
echo Cerrando servidores...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":5555.*LISTENING"') do taskkill /F /PID %%a >nul 2>&1
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000.*LISTENING"') do taskkill /F /PID %%a >nul 2>&1
taskkill /FI "WINDOWTITLE eq OCR-Server" >nul 2>&1
taskkill /FI "WINDOWTITLE eq Node-Server" >nul 2>&1
echo Cerrado.
timeout /t 2 /nobreak >nul
