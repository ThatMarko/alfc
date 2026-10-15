@echo off
setlocal DisableDelayedExpansion
pushd "%~dp0" || exit /b 1
call :build "%~1"
set "ALFC_BUILD_STATUS=%errorlevel%"
popd
exit /b %ALFC_BUILD_STATUS%

:build
set "ALFC_INCLUDE_CPUOC=0"
if "%~1"=="--experimental-cpuoc" set "ALFC_INCLUDE_CPUOC=1"
if not "%~1"=="" if not "%~1"=="--experimental-cpuoc" (
    echo Usage: build.bat [--experimental-cpuoc]
    exit /b 1
)

echo Building WMI helper...
call bun run --cwd server build:wmidll || exit /b 1
if "%ALFC_INCLUDE_CPUOC%"=="1" (
    echo Building experimental CPU tuning helper for local use...
    call bun run --cwd server build:cpuoc -p:AllowExperimentalCpuocPublish=true || exit /b 1
)

echo Building frontend and server...
if exist dist rmdir /s /q dist
call bun run build || exit /b 1
mkdir dist\alfc || exit /b 1
copy server\dist\alfc.exe dist\alfc\ || exit /b 1
copy server\native\windows\wmidll\WmiDll.dll dist\alfc\ || exit /b 1
if "%ALFC_INCLUDE_CPUOC%"=="1" (
    copy server\native\windows\CPUOC.dll dist\alfc\ || exit /b 1
    copy server\native\windows\IntelOverclockingSDK.dll dist\alfc\ || exit /b 1
)
xcopy /I /E frontend\build dist\alfc\frontend || exit /b 1

@REM Obtain the pinned WinSW v2.12.0 x64 wrapper separately for local builds.
copy bootstrap\scripts\alfc-service.exe dist\alfc\ || exit /b 1
copy bootstrap\scripts\alfc-service.xml dist\alfc\ || exit /b 1
copy bootstrap\scripts\install.bat dist\alfc\ || exit /b 1
copy bootstrap\scripts\uninstall.bat dist\alfc\ || exit /b 1
copy bootstrap\scripts\run.bat dist\alfc\ || exit /b 1
copy alfc.config.json dist\alfc\ || exit /b 1
copy LICENSE dist\alfc\ || exit /b 1
copy *.md dist\alfc\ || exit /b 1
mkdir dist\alfc\common dist\alfc\plasmoid dist\alfc\aur dist\alfc\assets || exit /b 1
copy common\*.md dist\alfc\common\ || exit /b 1
copy plasmoid\*.md dist\alfc\plasmoid\ || exit /b 1
copy aur\README.md dist\alfc\aur\ || exit /b 1
copy assets\screenshot.png dist\alfc\assets\ || exit /b 1

powershell -NoProfile -NonInteractive -Command "Compress-Archive -Path 'dist\alfc' -DestinationPath 'dist\alfc.zip'" || exit /b 1
echo Build complete: dist\alfc.zip
exit /b 0
