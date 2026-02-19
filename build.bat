@echo off

@REM Build native helpers (WmiDll requires MSVC/cl.exe, CPUOC requires .NET 8 SDK)
echo Building native helpers...
call bun run --cwd server build:wmidll || exit /b
call bun run --cwd server build:cpuoc || exit /b

@REM Build frontend + server
echo Building frontend and server...
if exist dist rmdir /s /q dist
call bun run build || exit /b

@REM Assemble release directory
echo Assembling release...
mkdir dist\alfc || exit /b

@REM Server binary
copy server\dist\alfc.exe dist\alfc\ || exit /b

@REM WMI DLL (C++ COM wrapper loaded via bun:ffi)
copy server\native\windows\wmidll\WmiDll.dll dist\alfc\ || exit /b
copy server\native\windows\CPUOC.dll dist\alfc\ || exit /b
copy server\native\windows\IntelOverclockingSDK.dll dist\alfc\ || exit /b

@REM Frontend
xcopy /I /E frontend\build dist\alfc\frontend || exit /b

@REM WinSW service wrapper (alfc-service.exe must be downloaded separately for local builds,
@REM CI downloads it automatically from https://github.com/winsw/winsw/releases)
copy bootstrap\scripts\alfc-service.exe dist\alfc\ || exit /b
copy bootstrap\scripts\alfc-service.xml dist\alfc\ || exit /b

@REM Scripts and config
copy bootstrap\scripts\install.bat dist\alfc\ || exit /b
copy bootstrap\scripts\uninstall.bat dist\alfc\ || exit /b
copy bootstrap\scripts\run.bat dist\alfc\ || exit /b
copy alfc.config.json dist\alfc\ || exit /b

@REM Create release archive
echo Creating release archive...
cd dist || exit /b
powershell Compress-Archive alfc alfc.zip || exit /b
cd .. || exit /b

echo Build complete: dist\alfc.zip