@echo off
pushd "%~dp0"
cl /nologo /O2 /LD /EHsc WmiDll.cpp /link ole32.lib oleaut32.lib wbemuuid.lib /OUT:WmiDll.dll
if errorlevel 1 exit /b 1
echo Built WmiDll.dll
