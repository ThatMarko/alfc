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

echo Starting ALFC fan control (temporary, non-service mode)...
echo Press Ctrl+C to stop.
set "NODE_ENV=production"
echo Open http://localhost:5522 after the server reports startup finished.
alfc.exe
