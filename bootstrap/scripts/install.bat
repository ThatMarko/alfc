@echo off
setlocal DisableDelayedExpansion
powershell -NoProfile -NonInteractive -Command "$principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent()); if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { exit 0 } else { exit 1 }"
if errorlevel 1 (
    echo Requesting administrator privileges...
    set "ALFC_SCRIPT_PATH=%~f0"
    powershell -NoProfile -Command "try { $child = Start-Process -FilePath $env:ALFC_SCRIPT_PATH -Verb RunAs -Wait -PassThru; exit $child.ExitCode } catch { Write-Error $_; exit 1 }"
    exit /b
)

pushd "%~dp0" || exit /b 1

for %%F in (alfc.exe alfc-service.exe alfc-service.xml) do if not exist "%%F" (
    echo Missing required release file: %%F
    exit /b 1
)

sc.exe query alfc >nul 2>&1
if not errorlevel 1 (
    echo Stopping existing service...
    alfc-service.exe stopwait || exit /b 1
    echo Removing existing service...
    alfc-service.exe uninstall || exit /b 1
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

echo Service started. ALFC may still be initializing.
echo Open http://localhost:5522 once startup finishes.
echo Check alfc-service.out.log if the UI is not available yet.
