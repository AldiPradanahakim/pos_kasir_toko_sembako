@echo off
cd /d "%~dp0"
set "NEED_SETUP="
title POS Toko Hakim

echo [POS Toko Hakim] Memeriksa Node.js...
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js tidak ditemukan di PATH sistem!
    echo Silakan install Node.js versi 20 atau lebih baru dari https://nodejs.org
    pause
    exit /b 1
)

echo Versi Node.js yang terdeteksi:
call node -v
if %errorlevel% neq 0 (
    echo [ERROR] Gagal menjalankan Node.js!
    pause
    exit /b 1
)

if not exist "node_modules\" (
    echo [POS Toko Hakim] Folder node_modules belum ada di root.
    echo Menjalankan npm install untuk menginstal dependensi root...
    call npm install
    if %errorlevel% neq 0 (
        echo [ERROR] Gagal menjalankan npm install di root!
        pause
        exit /b %errorlevel%
    )
)

if not exist "backend\node_modules\" set "NEED_SETUP=1"
if not exist "frontend\node_modules\" set "NEED_SETUP=1"

if defined NEED_SETUP (
    echo.
    echo [POS Toko Hakim] Instalasi pertama kali — mohon tunggu, ini hanya sekali.
    call npm run setup
    if %errorlevel% neq 0 (
        echo [ERROR] Gagal menjalankan setup dependensi dan database!
        pause
        exit /b %errorlevel%
    )
)

echo.
echo [POS Toko Hakim] Menjalankan server backend dan frontend...
call npm run dev
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Proses berhenti dengan kode error %errorlevel%.
    pause
)
