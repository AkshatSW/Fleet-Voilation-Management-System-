@echo off
REM One-click launcher for Fleet Violation Monitoring (Windows).
REM - Bootstraps backend venv + pip install on first run
REM - Bootstraps frontend node_modules on first run
REM - Seeds the PostgreSQL database if missing
REM - Starts FastAPI (uvicorn) on :8000 and Vite on :5176 in separate windows
REM - Close those windows (or Ctrl+C inside them) to stop.

setlocal ENABLEDELAYEDEXPANSION

set "ROOT_DIR=%~dp0"
if "%ROOT_DIR:~-1%"=="\" set "ROOT_DIR=%ROOT_DIR:~0,-1%"
set "BACKEND_DIR=%ROOT_DIR%\backend"
set "FRONTEND_DIR=%ROOT_DIR%\frontend"
set "VENV_DIR=%BACKEND_DIR%\venv"

echo ==^> Project root: %ROOT_DIR%

REM --- locate python ---
where py >nul 2>nul
if %ERRORLEVEL%==0 (
    set "PYTHON=py -3"
) else (
    where python >nul 2>nul
    if %ERRORLEVEL%==0 (
        set "PYTHON=python"
    ) else (
        echo ERROR: Python not found on PATH. Install Python 3.11+ first.
        exit /b 1
    )
)

REM --- locate npm ---
where npm >nul 2>nul
if not %ERRORLEVEL%==0 (
    echo ERROR: npm not found on PATH. Install Node.js 18+ first.
    exit /b 1
)

REM --- backend bootstrap ---
pushd "%BACKEND_DIR%"

if not exist "%VENV_DIR%\Scripts\activate.bat" (
    echo ==^> Creating Python venv at backend\venv
    %PYTHON% -m venv "%VENV_DIR%"
    if errorlevel 1 (
        echo ERROR: failed to create venv.
        popd
        exit /b 1
    )
)

call "%VENV_DIR%\Scripts\activate.bat"

set "REQ_STAMP=%VENV_DIR%\.requirements.stamp"
set "INSTALL_REQ=0"
if not exist "%REQ_STAMP%" set "INSTALL_REQ=1"
if exist "%REQ_STAMP%" (
    for %%A in ("%BACKEND_DIR%\requirements.txt") do set "REQ_MTIME=%%~tA"
    for %%A in ("%REQ_STAMP%") do set "STAMP_MTIME=%%~tA"
    REM crude: if requirements.txt is newer than stamp by string compare, reinstall.
    if "!REQ_MTIME!" GTR "!STAMP_MTIME!" set "INSTALL_REQ=1"
)

if "%INSTALL_REQ%"=="1" (
    echo ==^> Installing backend dependencies
    python -m pip install --upgrade pip >nul
    pip install -r requirements.txt
    if errorlevel 1 (
        echo ERROR: pip install failed.
        popd
        exit /b 1
    )
    type nul > "%REQ_STAMP%"
) else (
    echo ==^> Backend dependencies up to date
)

if not exist "%BACKEND_DIR%\fleet_violations.db" (
    echo ==^> Seeding database (fleet_violations.db not found)
    python seed.py
) else (
    echo ==^> Database already present, skipping seed
)

popd

REM --- frontend bootstrap ---
pushd "%FRONTEND_DIR%"
if not exist "%FRONTEND_DIR%\node_modules" (
    echo ==^> Installing frontend dependencies
    call npm install
    if errorlevel 1 (
        echo ERROR: npm install failed.
        popd
        exit /b 1
    )
) else (
    echo ==^> Frontend dependencies already installed
)
popd

REM --- launch both in new windows ---
echo ==^> Starting backend  (http://localhost:8000)
start "Fleet Backend" cmd /k "cd /d "%BACKEND_DIR%" && call "%VENV_DIR%\Scripts\activate.bat" && set WATCHFILES_IGNORE_PERMISSION_DENIED=true && uvicorn app.main:app --reload --reload-dir app --reload-exclude postgres-data/* --host 0.0.0.0 --port 8000"

echo ==^> Starting frontend (http://localhost:5176)
start "Fleet Frontend" cmd /k "cd /d "%FRONTEND_DIR%" && npm run dev"

echo.
echo Backend  -^> http://localhost:8000
echo Frontend -^> http://localhost:5176
echo Close the "Fleet Backend" and "Fleet Frontend" windows to stop.

endlocal
