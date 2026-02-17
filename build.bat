@echo off

@REM Build NativeAOT DLLs (requires .NET 8 SDK + C++ build tools)
echo Building NativeAOT DLLs...
call bun run --cwd server build:wmiapi || exit /b
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

@REM NativeAOT DLLs
copy server\native\windows\WmiAPI.dll dist\alfc\ || exit /b
copy server\native\windows\CPUOC.dll dist\alfc\ || exit /b
copy server\native\windows\IntelOverclockingSDK.dll dist\alfc\ || exit /b

@REM Frontend
xcopy /I /E frontend\build dist\alfc\frontend || exit /b

@REM WinSW service wrapper
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