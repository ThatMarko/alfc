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

echo Stopping ALFC service...
alfc-service.exe stopwait || exit /b 1

echo Uninstalling ALFC service...
alfc-service.exe uninstall || (
    echo Failed to uninstall service.
    pause
    exit /b 1
)

echo Done. You can delete the alfc folder now.
pause
