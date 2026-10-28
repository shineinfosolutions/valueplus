@echo off
echo ============================================
echo  VALUEPLUS ERP - Setup Script
echo ============================================
echo.

cd /d "%~dp0"
echo [1/3] Installing dependencies...
call npm install

if %errorlevel% neq 0 (
    echo ERROR: npm install failed. Please check your Node.js installation.
    pause
    exit /b 1
)

echo.
echo [2/3] Dependencies installed successfully!
echo.
echo [3/3] Starting development server...
echo  Open http://localhost:3000 in your browser
echo  Login: admin / 123456
echo.
call npm run dev
