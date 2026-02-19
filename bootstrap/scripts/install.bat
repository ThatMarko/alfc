@echo off
net session >nul 2>&1 || (
    echo Requesting administrator privileges...
    powershell -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)

pushd "%~dp0"

echo Stopping existing service (if any)...
alfc-service.exe stop 2>nul
timeout /t 2 /nobreak >nul

echo Removing existing service (if any)...
alfc-service.exe uninstall 2>nul
timeout /t 2 /nobreak >nul

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
