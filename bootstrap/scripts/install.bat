@echo off
net session >nul 2>&1 || (
    echo Requesting administrator privileges...
    powershell -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)

echo Installing ALFC service...
alfc-service.exe install || (
    echo Failed to install service.
    pause
    exit /b 1
)

echo Starting ALFC service...
alfc-service.exe start || (
    echo Failed to start service.
    pause
    exit /b 1
)

echo Done. UI available @ http://localhost:5522
start http://localhost:5522
