@echo off
cd /d "%~dp0"
echo Installing mongoose...
npm install mongoose --no-fund --no-audit
