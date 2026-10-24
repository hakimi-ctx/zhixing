@echo off
setlocal
set "ZHIXING_USE_DEV=1"
set "ZHIXING_HOME=D:\ZhixingBuild"
cd /d "%~dp0"
title Zhixing

if not exist "%~dp0scripts\launcher.mjs" (
  echo.
  echo [Zhixing] Please extract the whole ZIP to a folder first,
  echo then double-click Start-Zhixing.bat inside that folder.
  echo.
  pause
  exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo [Zhixing] Node.js was not found on this computer.
  echo Please install Node.js 20 LTS or newer from https://nodejs.org/ and then double-click this file again.
  echo.
  pause
  exit /b 1
)

set "NODE_MAJOR="
for /f "tokens=1 delims=." %%v in ('node -v') do set "NODE_MAJOR=%%v"
if not defined NODE_MAJOR set "NODE_MAJOR=v0"
set "NODE_MAJOR=%NODE_MAJOR:v=%"
if %NODE_MAJOR% LSS 20 (
  echo.
  echo [Zhixing] Node.js %NODE_MAJOR% is too old.
  echo Please install Node.js 20 LTS or newer from https://nodejs.org/ and then double-click this file again.
  echo.
  pause
  exit /b 1
)

node "%~dp0scripts\launcher.mjs" %*
if errorlevel 1 (
  echo.
  pause
)
endlocal

