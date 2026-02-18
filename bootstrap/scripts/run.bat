@echo off
net session >nul 2>&1 || (
    echo Requesting administrator privileges...
    powershell -Command "Start-Process cmd.exe -ArgumentList '/k %~f0' -Verb RunAs"
    exit /b
)

echo Starting ALFC fan control (temporary, non-service mode)...
echo Press Ctrl+C to stop.
set NODE_ENV=production
start http://localhost:5522
alfc.exe
