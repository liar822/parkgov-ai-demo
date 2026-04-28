# AI Parking Management System - Complete Installation Guide

## 🎯 PRE-INSTALLATION CHECKLIST

### System Requirements
- **Operating System**: Windows 10/11 (64-bit) OR macOS 10.15+ OR Linux Ubuntu 20.04+
- **RAM**: Minimum 8GB (Recommended: 16GB for YOLO AI processing)
- **Storage**: Minimum 10GB free space
- **Internet**: Required for downloading dependencies (~500MB total download)
- **GPU**: Optional (NVIDIA GPU with CUDA accelerates YOLO detection)

### Required Software (Install First)

#### 1. Node.js 18+ (JavaScript Runtime)
**Windows:**
```cmd
# Download from: https://nodejs.org/en/download/
# Choose "Windows Installer (.msi)" - 64-bit
# Run installer, accept defaults
# Verify installation:
node --version
npm --version
```

**Expected Output:**
```
v18.x.x or higher
9.x.x or higher
```

#### 2. Python 3.10 or 3.11 (AI Services)
**Windows:**
```cmd
# Download from: https://www.python.org/downloads/
# Choose Python 3.10.x or 3.11.x (NOT 3.12+ due to compatibility)
# IMPORTANT: During installation, CHECK "Add Python to PATH"
# Verify installation:
py --version
pip --version
```

**Expected Output:**
```
Python 3.10.x or 3.11.x
pip 23.x or higher
```

#### 3. Docker Desktop (PostgreSQL Database)
**Windows:**
```cmd
# Download from: https://www.docker.com/products/docker-desktop/
# Install Docker Desktop for Windows
# Enable WSL 2 backend during installation
# Restart computer if prompted
# Verify installation:
docker --version
docker-compose --version
```

**Expected Output:**
```
Docker version 24.x.x
Docker Compose version v2.x.x
```

---

## 📥 STEP-BY-STEP INSTALLATION PROCESS

### Step 1: Copy Project Files

**Option A: Using Git (Recommended)**
```cmd
# Open Command Prompt or PowerShell
cd C:\Users\YourUsername\Documents
git clone <your-repository-url> ai-parking-system
cd ai-parking-system
```

**Option B: Manual Copy**
```cmd
# Copy entire project folder to new location
# Example destination:
C:\Users\YourUsername\Documents\ai-parking-system
```

**Folder Structure Should Look Like:**
```
ai-parking-system/
├── backend/
│   ├── package.json
│   ├── server.js
│   └── ...
├── frontend/
│   ├── package.json
│   ├── vite.config.js
│   └── ...
├── ai-services/
│   ├── requirements.txt
│   ├── video_processor.py
│   └── ...
├── docker-compose.dev.yml
├── .env
└── README.md
```

---

### Step 2: Install Backend Dependencies

```cmd
# Navigate to backend directory
cd C:\Users\YourUsername\Documents\ai-parking-system\backend

# Install ALL Node.js packages
npm install

# This installs:
# - express (web server)
# - pg (PostgreSQL client)
# - socket.io (real-time WebSocket)
# - bcryptjs (password hashing)
# - jsonwebtoken (JWT authentication)
# - joi (validation)
# - multer (file upload)
# - python-shell (Python integration)
# - cors (cross-origin requests)
# - dotenv (environment variables)
# ...and all their dependencies

# Expected Time: 2-5 minutes
# Expected Output: ~150-200 packages installed
```

**Verify Backend Installation:**
```cmd
# Check node_modules exists
dir node_modules | findstr "express pg socket.io"
```

---

### Step 3: Install Frontend Dependencies

```cmd
# Navigate to frontend directory
cd C:\Users\YourUsername\Documents\ai-parking-system\frontend

# Install ALL React/Vite packages
npm install

# This installs:
# - react (UI library)
# - react-dom (React DOM renderer)
# - vite (build tool)
# - tailwindcss (styling)
# - framer-motion (animations)
# - react-hot-toast (notifications)
# - @heroicons/react (icons)
# - axios (HTTP client)
# - socket.io-client (WebSocket client)
# ...and all dependencies

# Expected Time: 2-5 minutes
# Expected Output: ~300-400 packages installed
```

**Verify Frontend Installation:**
```cmd
# Check node_modules exists
dir node_modules | findstr "react vite tailwindcss"
```

---

### Step 4: Install Python AI Dependencies

```cmd
# Navigate to ai-services directory
cd C:\Users\YourUsername\Documents\ai-parking-system\ai-services

# Upgrade pip first
py -m pip install --upgrade pip

# Install ALL Python packages including YOLO
py -m pip install -r requirements.txt

# This installs:
# - ultralytics (YOLOv8n AI model)
# - opencv-python (computer vision)
# - numpy (numerical operations)
# - pillow (image processing)
# - torch (PyTorch deep learning)
# - torchvision (vision models)
# - scipy (scientific computing)
# - matplotlib (plotting)
# - psutil (system monitoring)
# - polars (data processing)
# ...and all dependencies

# Expected Time: 10-15 minutes (torch is large ~100MB)
# Expected Output: ~50-70 packages installed
```

**Critical Verification - YOLO Installation:**
```cmd
# Test that ultralytics works
py -c "from ultralytics import YOLO; print('✅ YOLO installed successfully')"

# Expected Output:
# ✅ YOLO installed successfully
```

**If YOLO Import Fails:**
```cmd
# Reinstall ultralytics explicitly
py -m pip install ultralytics --no-cache-dir --force-reinstall

# Test again
py -c "from ultralytics import YOLO; print('✅ YOLO working')"
```

---

### Step 5: Configure Environment Variables

```cmd
# Navigate to project root
cd C:\Users\YourUsername\Documents\ai-parking-system

# Copy .env.example to .env (if exists)
copy .env.example .env

# OR create new .env file manually
notepad .env
```

**Paste This Content into `.env`:**
```env
# Backend Configuration
NODE_ENV=development
PORT=3000
FRONTEND_URL=http://localhost:5173

# Database Configuration (Docker PostgreSQL)
DB_HOST=localhost
DB_PORT=5432
DB_NAME=parking_system
DB_USER=parking_admin
DB_PASSWORD=parking_secure_password_2024

# JWT Secret (Change this to a random string!)
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production-abc123xyz

# Python Path (Auto-detected, but can override)
PYTHON_PATH=py

# Redis Configuration (Optional, for caching)
REDIS_HOST=localhost
REDIS_PORT=6379

# File Upload Limits
MAX_FILE_SIZE=524288000
UPLOAD_DIR=./backend/uploads

# AI Model Configuration
YOLO_MODEL=yolov8n.pt
CONFIDENCE_THRESHOLD=0.5
NMS_THRESHOLD=0.4
```

**Save and Close Notepad**

---

### Step 6: Start PostgreSQL Database (Docker)

```cmd
# Navigate to project root
cd C:\Users\YourUsername\Documents\ai-parking-system

# Start PostgreSQL container using Docker Compose
docker-compose -f docker-compose.dev.yml up -d

# Expected Output:
# [+] Running 1/1
#  ✔ Container postgres_db started

# Wait 10 seconds for database to initialize
timeout /t 10

# Verify database is running
docker ps

# Expected Output shows:
# CONTAINER ID   IMAGE          STATUS
# xxxxxxxxxxxx   postgres:15    Up X seconds
```

**Test Database Connection:**
```cmd
# Connect to PostgreSQL container
docker exec -it postgres_db psql -U parking_admin -d parking_system

# You should see:
# parking_system=>

# Type \q to exit
\q
```

---

### Step 7: Initialize Database Schema

**Option A: Automatic Initialization (Recommended)**
```cmd
# The backend will auto-initialize on first run
# Just start the backend (next step)
```

**Option B: Manual Initialization**
```cmd
# Navigate to project root
cd C:\Users\YourUsername\Documents\ai-parking-system

# Run database initialization script
docker exec -i postgres_db psql -U parking_admin -d parking_system < database/init.sql
```

**Verify Database Tables:**
```cmd
# Connect to database
docker exec -it postgres_db psql -U parking_admin -d parking_system

# List all tables
\dt

# Expected Output:
# ┌─────────────────────┬─────────────────────┬────────────┐
# │ Schema              │ Name                │ Type       │
# ├─────────────────────┼─────────────────────┼────────────┤
# │ public              │ users               │ table      │
# │ public              │ parking_lots        │ table      │
# │ public              │ parking_slots       │ table      │
# │ public              │ video_analysis      │ table      │
# │ public              │ bookings            │ table      │
# │ public              │ chatbot_conversations│ table     │
# └─────────────────────┴─────────────────────┴────────────┘

# Exit
\q
```

---

### Step 8: Start Backend Server

```cmd
# Open NEW Command Prompt window
# Navigate to backend directory
cd C:\Users\YourUsername\Documents\ai-parking-system\backend

# Start the backend server
npm start

# Expected Output:
# 🔄 Attempting database connection (attempt 1/5)...
# ✅ Database initialized successfully!
# 🚗 AI Parking System Backend running on port 3000
# 📊 Environment: development
# 🔗 Frontend URL: http://localhost:5173
# 🗄️  Connected to PostgreSQL database

# KEEP THIS WINDOW OPEN - Backend must stay running!
```

**Verify Backend is Running:**
```cmd
# Open browser or use curl:
curl http://localhost:3000/api/health

# Expected Response:
# {"success":true,"message":"Backend is running"}
```

---

### Step 9: Start Frontend Application

```cmd
# Open ANOTHER NEW Command Prompt window
# Navigate to frontend directory
cd C:\Users\YourUsername\Documents\ai-parking-system\frontend

# Start Vite development server
npm run dev

# Expected Output:
# VITE v4.5.14  ready in 1554 ms
#
# ➜  Local:   http://localhost:5173/
# ➜  Network: http://192.168.x.x:5173/
#
# KEEP THIS WINDOW OPEN - Frontend must stay running!
```

**Open in Browser:**
```
http://localhost:5173
```

---

### Step 10: Login and Verify System

**Default Credentials:**

**Admin Account:**
```
Username: admin
Password: admin123
```

**User Account:**
```
Username: user
Password: user123
```

**Verification Checklist:**

After logging in as admin, verify these features:

1. ✅ **Dashboard Loads** - Analytics and statistics visible
2. ✅ **Parking Lots Tab** - Shows existing parking lots
3. ✅ **Users Tab** - Can view/create users
4. ✅ **Video Analysis Tab** - Upload interface appears
5. ✅ **Chatbot Icon** - Bottom-right corner clickable

---

## 🧪 TESTING THE INSTALLATION

### Test 1: Create a New Parking Lot

**Navigate to:** Admin Dashboard → Parking Lots tab

**Click:** "New lot" button

**Fill Form:**
```
Name: Test Parking Lot
Total Slots: 20
Rows: 4
Columns: 5
Slot Width: 2.5
Slot Height: 5.0
Video URL: (leave empty)
Active: Yes
```

**Click:** "Create" button

**Expected Result:**
```
✅ Toast notification: "Lot created"
✅ Lot appears in dropdown list
✅ 20 parking slots created automatically
```

---

### Test 2: Upload Video for AI Analysis

**Prerequisites:**
- Have a short parking lot video ready (30-60 seconds, MP4 format)
- Parking lot must exist in system

**Steps:**

1. **Navigate to:** Admin Dashboard → Video Analysis tab
2. **Select:** Parking lot from dropdown
3. **Click:** File input, choose video file
4. **Click:** "Upload" button

**Watch Console (F12):**
```javascript
← "Uploading video: test-video.mp4 to lot: 1"
← "Upload response: {success: true, data: {...}}"
```

**Monitor Status Changes:**
```
Table shows:
┌────┬─────┬──────────────────────┬─────────────┬──────────────┐
│ ID │ Lot │ File                 │ Status      │ Actions      │
├────┼─────┼──────────────────────┼─────────────┼──────────────┤
│ 1  │ 1   │ parking-video-xxx.mp4│ 🟡 pending  │ [Cancel]     │
│    │    │                      │ ↓ (after 5s)│              │
│    │    │                      │ 🔵processing│ [...]        │
│    │    │                      │ ↓ (after 60s)│             │
│    │    │                      │ 🟢 completed│ [Show Details]│
└────┴─────┴──────────────────────┴─────────────┴──────────────┘
```

**Click:** "Show Details" on completed analysis

**Expected Results Display:**
```
Detection Results:
┌──────────────────┬──────────────────┬──────────────────┬──────────────────┐
│ Total Detections │ Vehicles Count   │ Occupancy Rate   │ Confidence       │
│       13         │        8         │      61.5%       │      87.3%       │
└──────────────────┴──────────────────┴──────────────────┴──────────────────┘

Slot-by-Slot Detection:
┌─────────┬─────────┬─────────┬─────────┐
│ Slot 1  │ Slot 2  │ Slot 3  │ Slot 4  │
│ 🚗Occ   │ ✅Avail │ 🚗Occ   │ ✅Avail │
│ 92%     │ 85%     │ 88%     │ 79%     │
└─────────┴─────────┴─────────┴─────────┘
```

**Verify Real-Time Updates:**
- Go to User Dashboard
- Slot statuses update automatically without refresh
- Occupancy percentage changes in real-time

---

### Test 3: AI Chatbot Conversations

**Click:** Chatbot icon (bottom-right corner)

**Try This Conversation:**
```
You: "Find available parking"
Bot: "I can help you find available parking! Based on current data..."

You: "yes"
Bot: "Great! Currently we have: 🅿️ Main Parking Lot: 18 out of 50 spots available..."

You: "How much does it cost?"
Bot: "Here are our complete pricing details: 💰 Hourly Rates: First hour: $2..."

You: "thanks"
Bot: "You're welcome! I'm here to help anytime. Have a great day! 😊"
```

**Expected Behavior:**
- ✅ Contextual responses (understands "yes", "thanks")
- ✅ Different responses for different questions
- ✅ No repetitive generic messages

---

## ⚠️ TROUBLESHOOTING COMMON ISSUES

### Issue 1: "Port 3000 Already in Use"

**Symptoms:**
```
Error: listen EADDRINUSE: address already in use :::3000
```

**Solution:**
```cmd
# Find process using port 3000
netstat -ano | findstr :3000

# Kill the process (replace PID with actual number)
taskkill /PID 12345 /F

# Or change backend port in .env
PORT=3001
```

---

### Issue 2: "Cannot Connect to Database"

**Symptoms:**
```
🔄 Attempting database connection (attempt 1/5)...
❌ Database connection failed
```

**Solution:**
```cmd
# Check if Docker container is running
docker ps

# If not running, start it:
docker-compose -f docker-compose.dev.yml up -d

# Restart container:
docker-compose -f docker-compose.dev.yml restart

# Wait 10 seconds, then restart backend
```

---

### Issue 3: "Module 'ultralytics' Not Found"

**Symptoms:**
```
ModuleNotFoundError: No module named 'ultralytics'
```

**Solution:**
```cmd
# Navigate to ai-services
cd C:\Users\YourUsername\Documents\ai-parking-system\ai-services

# Reinstall ultralytics
py -m pip install ultralytics --no-cache-dir

# Verify installation
py -c "from ultralytics import YOLO; print('✅ YOLO OK')"
```

---

### Issue 4: Frontend Won't Load (White Screen)

**Symptoms:**
- Browser shows blank white page
- Console shows errors like "Failed to fetch" or "Cannot GET /"

**Solution:**
```cmd
# Check if frontend server is running
# Look for: "VITE ready" message

# If not running, restart:
cd C:\Users\YourUsername\Documents\ai-parking-system\frontend
npm run dev

# Clear browser cache (Ctrl+Shift+Delete)
# Hard refresh: Ctrl+F5
```

---

### Issue 5: Video Upload Fails Silently

**Symptoms:**
- Upload starts but never completes
- No error message shown

**Check:**
```cmd
# Backend terminal logs
# Look for Python execution errors

# Browser console (F12)
# Look for network errors

# Verify .env has correct PYTHON_PATH
PYTHON_PATH=py
```

**Fix:**
```cmd
# Test Python path
py -c "print('Python works')"

# If fails, update .env with full path:
PYTHON_PATH=C:\Python310\python.exe
```

---

## 📊 PERFORMANCE OPTIMIZATION

### For Systems with NVIDIA GPU

**Enable CUDA Acceleration:**
```cmd
# Uninstall CPU-only torch
py -m pip uninstall torch torchvision

# Install CUDA-enabled versions
py -m pip install torch torchvision --index-url https://download.pytorch.org/whl/cu118

# Verify CUDA is available
py -c "import torch; print(f'CUDA available: {torch.cuda.is_available()}')"
```

**Expected Speed Improvement:**
- CPU only: ~15-30 FPS
- NVIDIA GPU: ~60-120 FPS (2-4x faster)

---

### For Faster Processing

**Reduce Video Resolution:**
- Process 720p videos instead of 4K
- Faster frame extraction
- Lower memory usage

**Adjust Frame Sampling:**
Edit `ai-services/video_processor.py`:
```python
# Change line ~123
frame_interval = 30  # Process every 30th frame (increase for speed, decrease for accuracy)
```

---

## 🔒 SECURITY HARDENING (Production Only)

### Change Default Passwords

**Update Admin Password:**
```sql
-- Connect to database
docker exec -it postgres_db psql -U parking_admin -d parking_system

-- Generate new bcrypt hash (use online tool or Node.js)
-- Update password_hash
UPDATE users SET password_hash = '$2a$10$NEW_HASH_HERE' WHERE username = 'admin';
```

### Update JWT Secret

**In `.env` file:**
```env
# Generate random 32-character string
JWT_SECRET=<random-string-generated-by-crypto-randombytes>
```

**Node.js generation:**
```javascript
const crypto = require('crypto');
console.log(crypto.randomBytes(32).toString('hex'));
```

---

## 📦 BACKUP AND RESTORE

### Backup Database

```cmd
# Export database to SQL file
docker exec postgres_db pg_dump -U parking_admin parking_system > backup-$(date +%Y%m%d).sql

# Save to safe location
copy backup-*.sql D:\Backups\
```

### Restore Database

```cmd
# Import from SQL file
docker exec -i postgres_db psql -U parking_admin parking_system < backup-20240304.sql
```

---

## 🎯 POST-INSTALLATION CHECKLIST

After completing installation, verify:

- [ ] **Backend runs** on http://localhost:3000
- [ ] **Frontend loads** on http://localhost:5173
- [ ] **Database connected** (check backend logs)
- [ ] **Admin login works** (admin/admin123)
- [ ] **User login works** (user/user123)
- [ ] **Can create parking lots** (with slot configuration)
- [ ] **Can upload videos** (MP4 format accepted)
- [ ] **YOLO detection works** (real AI, not mock data)
- [ ] **Results display in UI** (slot-by-slot breakdown)
- [ ] **Chatbot responds** (contextual conversations)
- [ ] **Real-time updates work** (Socket.IO active)
- [ ] **No console errors** (browser F12 clean)

---

## 📞 SUPPORT AND MAINTENANCE

### Log Files Location

**Backend Logs:**
```
backend/logs/error.log
backend/logs/access.log
```

**Frontend Logs:**
```
Browser Console (F12)
```

**Docker Logs:**
```cmd
docker logs postgres_db
```

### Regular Maintenance Tasks

**Weekly:**
- Check disk space (`dir` command)
- Review error logs
- Monitor database size

**Monthly:**
- Update dependencies:
  ```cmd
  cd backend && npm update
  cd ../frontend && npm update
  cd ../ai-services && py -m pip install --upgrade -r requirements.txt
  ```
- Backup database
- Clean old video uploads

---

## 🎉 INSTALLATION COMPLETE!

Your AI Parking Management System is now fully installed and operational!

**Next Steps:**
1. Upload your first parking lot video
2. Configure parking lots to match your facility
3. Train staff on using the admin dashboard
4. Set up user accounts for operators
5. Customize pricing in database if needed

**Enjoy real-time AI-powered parking management!** 🚗🅿️✨
