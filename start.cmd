@echo off
rem ASCII-only on purpose: cmd.exe mangles UTF-8 text inside .cmd files.
rem All user-facing messages live in scripts\launch.mjs (UTF-8 safe).
setlocal
chcp 65001 >nul
cd /d "%~dp0"

set "NODE_EXE="
for /f "delims=" %%i in ('where node 2^>nul') do if not defined NODE_EXE set "NODE_EXE=%%~fi"
if not defined NODE_EXE if exist "%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe" set "NODE_EXE=%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
if not defined NODE_EXE (
  echo [ERROR] Node.js not found. Install Node.js 20.19+ from https://nodejs.org/
  echo         ^(Node.js 20.19 or newer is required^)
  pause
  exit /b 1
)

"%NODE_EXE%" "scripts\launch.mjs" %*
pause
