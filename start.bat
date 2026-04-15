@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo =========================================
echo   로또 예측기 기동
echo =========================================

echo.
echo [1/2] 데이터 업데이트...
call node fetch-data.js
if errorlevel 1 (
  echo [오류] 데이터 수집 실패
  pause
  exit /b 1
)

echo.
echo [2/2] 서버 시작...
node server.js
pause
