@echo off
net session >nul 2>&1 || (
    echo Requesting administrator privileges...
    powershell -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)

echo Stopping ALFC service...
alfc-service.exe stop 2>nul

echo Uninstalling ALFC service...
alfc-service.exe uninstall || (
    echo Failed to uninstall service.
    pause
    exit /b 1
)

echo Done. You can delete the alfc folder now.
pause
