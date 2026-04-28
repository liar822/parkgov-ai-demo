@echo off
REM ============================================================
REM AI Parking Management System - Automated Installation Script
REM For Windows 10/11
REM ============================================================

echo.
echo ========================================
echo  AI Parking System - Installation Wizard
echo ========================================
echo.
echo This script will install the complete AI Parking Management System
echo Estimated time: 15-20 minutes
echo.
pause

REM Check if running as administrator
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo.
    echo ERROR: This script must be run as Administrator!
    echo Right-click on this file and select "Run as administrator"
    echo.
    pause
    exit /b 1
)

echo.
echo [Step 1 of 10] Checking system requirements...
echo.

REM Check Node.js
where node >nul 2>&1
if %errorLevel% neq 0 (
    echo ERROR: Node.js is not installed!
    echo Please install Node.js 18+ from: https://nodejs.org/
    echo.
    pause
    exit /b 1
) else (
    echo ✓ Node.js found
    node --version
)

REM Check Python
where py >nul 2>&1
if %errorLevel% neq 0 (
    echo ERROR: Python is not installed!
    echo Please install Python 3.10 or 3.11 from: https://www.python.org/downloads/
    echo IMPORTANT: Check "Add Python to PATH" during installation
    echo.
    pause
    exit /b 1
) else (
    echo ✓ Python found
    py --version
)

REM Check Docker
where docker >nul 2>&1
if %errorLevel% neq 0 (
    echo ERROR: Docker Desktop is not installed!
    echo Please install Docker Desktop from: https://www.docker.com/products/docker-desktop/
    echo.
    pause
    exit /b 1
) else (
    echo ✓ Docker found
    docker --version
)

echo.
echo [Step 2 of 10] Installing backend dependencies...
echo.
cd /d "%~dp0backend"
call npm install
if %errorLevel% neq 0 (
    echo ERROR: Backend dependency installation failed!
    pause
    exit /b 1
)
echo ✓ Backend dependencies installed

echo.
echo [Step 3 of 10] Installing frontend dependencies...
echo.
cd /d "%~dp0frontend"
call npm install
if %errorLevel% neq 0 (
    echo ERROR: Frontend dependency installation failed!
    pause
    exit /b 1
)
echo ✓ Frontend dependencies installed

echo.
echo [Step 4 of 10] Installing Python AI dependencies...
echo.
cd /d "%~dp0ai-services"
echo Upgrading pip...
py -m pip install --upgrade pip
echo Installing ultralytics and other dependencies...
py -m pip install -r requirements.txt
if %errorLevel% neq 0 (
    echo ERROR: Python dependency installation failed!
    pause
    exit /b 1
)
echo ✓ Python AI dependencies installed

echo.
echo [Step 5 of 10] Verifying YOLO installation...
echo.
py -c "from ultralytics import YOLO; print('YOLO verified')"
if %errorLevel% neq 0 (
    echo WARNING: YOLO verification failed, attempting reinstall...
    py -m pip install ultralytics --no-cache-dir
    py -c "from ultralytics import YOLO; print('YOLO reinstalled successfully')"
)
echo ✓ YOLO AI model ready

echo.
echo [Step 6 of 10] Setting up environment variables...
echo.
if not exist "%~dp0.env" (
    echo Creating .env file...
    (
        echo NODE_ENV=development
        echo PORT=3000
        echo FRONTEND_URL=http://localhost:5173
        echo DB_HOST=localhost
        echo DB_PORT=5432
        echo DB_NAME=parking_system
        echo DB_USER=parking_admin
        echo DB_PASSWORD=parking_secure_password_2024
        echo JWT_SECRET=%RANDOM%%RANDOM%%RANDOM%%RANDOM%
        echo PYTHON_PATH=py
        echo REDIS_HOST=localhost
        echo REDIS_PORT=6379
        echo MAX_FILE_SIZE=524288000
        echo UPLOAD_DIR=./backend/uploads
        echo YOLO_MODEL=yolov8n.pt
        echo CONFIDENCE_THRESHOLD=0.5
        echo NMS_THRESHOLD=0.4
    ) > "%~dp0.env"
    echo ✓ .env file created with default values
) else (
    echo ✓ .env file already exists
)

echo.
echo [Step 7 of 10] Starting PostgreSQL database...
echo.
cd /d "%~dp0"
docker-compose -f docker-compose.dev.yml up -d
echo Waiting 15 seconds for database initialization...
timeout /t 15 /nobreak
docker ps | findstr postgres_db
if %errorLevel% neq 0 (
    echo ERROR: Database container failed to start!
    echo Check Docker Desktop is running
    pause
    exit /b 1
)
echo ✓ PostgreSQL database started

echo.
echo [Step 8 of 10] Initializing database schema...
echo.
docker exec -i postgres_db psql -U parking_admin -d parking_system < database/init.sql 2>nul
if %errorLevel% neq 0 (
    echo WARNING: Database initialization had issues (may already be initialized)
) else (
    echo ✓ Database schema initialized
)

echo.
echo [Step 9 of 10] Starting backend server...
echo.
start "AI Parking Backend" cmd /k "cd /d '%~dp0backend' && npm start"
echo Waiting 10 seconds for backend to start...
timeout /t 10 /nobreak
echo ✓ Backend server starting on port 3000

echo.
echo [Step 10 of 10] Starting frontend application...
echo.
start "AI Parking Frontend" cmd /k "cd /d '%~dp0frontend' && npm run dev"
echo Waiting 10 seconds for frontend to start...
timeout /t 10 /nobreak
echo ✓ Frontend application starting on http://localhost:5173

echo.
echo ========================================
echo  INSTALLATION COMPLETE! 🎉
echo ========================================
echo.
echo The AI Parking Management System is now running!
echo.
echo Quick Links:
echo   - Frontend: http://localhost:5173
echo   - Backend:  http://localhost:3000
echo   - Database: localhost:5432
echo.
echo Default Login Credentials:
echo   Admin: admin / admin123
echo   User:  user / user123
echo.
echo IMPORTANT: Keep both terminal windows open!
echo   - AI Parking Backend
echo   - AI Parking Frontend
echo.
echo Next Steps:
echo   1. Open http://localhost:5173 in your browser
echo   2. Login with admin credentials
echo   3. Create your first parking lot
echo   4. Upload a test video for AI analysis
echo.
echo For detailed troubleshooting, see: INSTALLATION-GUIDE.md
echo.
pause
