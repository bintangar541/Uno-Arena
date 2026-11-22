
@echo off
setlocal
title UNO Arena Launcher

cd /d C:\Uno-Arena

echo ======================================
echo       UNO ARENA - SERVER LAUNCHER
echo ======================================
echo.

if not exist "server\src\server.js" (
    echo [ERROR] File backend tidak ditemukan!
    pause
    exit /b 1
)

if not exist "C:\Program Files (x86)\cloudflared\cloudflared.exe" (
    echo [ERROR] Cloudflared tidak ditemukan!
    pause
    exit /b 1
)

echo [1/2] Starting UNO Arena Backend...
start "UNO Arena Backend" cmd /k "cd /d C:\Uno-Arena && npm run dev:server"

echo.
echo Menunggu backend siap...

:WAIT_BACKEND
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri 'http://localhost:3000/api/health' -TimeoutSec 2; if ($r.StatusCode -eq 200) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>&1

if errorlevel 1 (
    timeout /t 2 /nobreak >nul
    goto WAIT_BACKEND
)

echo [OK] Backend berhasil aktif!
echo.

echo [2/2] Starting Cloudflare Tunnel...
start "UNO Arena Tunnel" cmd /k ""C:\Program Files (x86)\cloudflared\cloudflared.exe" tunnel --url http://localhost:3000"

echo.
echo ======================================
echo       UNO ARENA SERVER ACTIVE
echo ======================================
echo.
echo Backend: http://localhost:3000
echo Tunnel : Lihat jendela UNO Arena Tunnel
echo.
echo Jangan tutup kedua jendela CMD.
echo.
pause
