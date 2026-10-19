@echo off
setlocal DisableDelayedExpansion
powershell -NoProfile -NonInteractive -Command "$principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent()); if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { exit 0 } else { exit 1 }"
if not errorlevel 1 goto administrator_ready

echo Requesting administrator privileges...
set "ALFC_SCRIPT_PATH=%~f0"
powershell -NoProfile -Command "try { $child = Start-Process -FilePath $env:ALFC_SCRIPT_PATH -Verb RunAs -Wait -PassThru; exit $child.ExitCode } catch { Write-Error $_; exit 1 }"
set "ALFC_ELEVATION_STATUS=%errorlevel%"
exit /b %ALFC_ELEVATION_STATUS%

:administrator_ready
pushd "%~dp0" || exit /b 1

for %%F in (alfc.exe alfc-service.exe alfc-service.xml WmiDll.dll frontend\index.html) do if not exist "%%F" (
    echo Missing required release file: %%F
    exit /b 1
)
for %%F in (alfc.exe alfc-service.exe alfc-service.xml WmiDll.dll frontend\index.html) do if exist "%%F\" (
    echo Required release file is a directory: %%F
    exit /b 1
)

sc.exe query alfc >nul 2>&1
set "ALFC_QUERY_STATUS=%errorlevel%"
if not "%ALFC_QUERY_STATUS%"=="0" if not "%ALFC_QUERY_STATUS%"=="1060" (
    echo Unable to query the ALFC service. No service was changed.
    exit /b %ALFC_QUERY_STATUS%
)
set "ALFC_WRAPPER_PATH=%~dp0alfc-service.exe"
powershell -NoProfile -NonInteractive -Command "try { [xml]$config = Get-Content -LiteralPath ([IO.Path]::ChangeExtension($env:ALFC_WRAPPER_PATH, '.xml')) -Raw -ErrorAction Stop; if ($config.service.id -cne 'alfc') { throw 'The WinSW configuration must use service ID alfc.' }; if ($env:ALFC_QUERY_STATUS -eq '0') { $imagePath = (Get-ItemProperty -LiteralPath 'HKLM:\SYSTEM\CurrentControlSet\Services\alfc' -Name ImagePath -ErrorAction Stop).ImagePath; $expected = [string][char]34 + [IO.Path]::GetFullPath($env:ALFC_WRAPPER_PATH) + [char]34; if (![String]::Equals($imagePath.Trim(), $expected, [StringComparison]::OrdinalIgnoreCase)) { throw 'The existing alfc service belongs to another executable. Use its own uninstaller before changing installation directories.' } }; exit 0 } catch { Write-Error $_; exit 1 }"
if errorlevel 1 exit /b 1
if "%ALFC_QUERY_STATUS%"=="1060" goto install_service

echo Stopping existing service...
alfc-service.exe stopwait || exit /b 1
echo Removing existing service...
alfc-service.exe uninstall || exit /b 1

:install_service
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
