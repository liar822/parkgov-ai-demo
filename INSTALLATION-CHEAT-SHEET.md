================================================================================
         AI PARKING MANAGEMENT SYSTEM - INSTALLATION CHEAT SHEET
================================================================================

FOR EXPERTS INSTALLING ON ANOTHER LAPTOP
Estimated Time: 30 minutes total (mostly automated)

================================================================================
PREREQUISITES (Install First - 10 minutes)
================================================================================

1. NODE.JS 18+ 
   Download: https://nodejs.org/en/download/
   Choose: Windows Installer (.msi) - 64-bit
   Verify: Open CMD, type "node --version" → Should show v18.x.x

2. PYTHON 3.10 or 3.11
   Download: https://www.python.org/downloads/
   ⚠️ CRITICAL: CHECK "Add Python to PATH" during installation!
   Verify: Open CMD, type "py --version" → Should show Python 3.10.x

3. DOCKER DESKTOP
   Download: https://www.docker.com/products/docker-desktop/
   Install with default settings
   May require restart
   Verify: Open CMD, type "docker --version"

================================================================================
AUTOMATED INSTALLATION (15-20 minutes)
================================================================================

STEP 1: Extract ZIP File
  - Right-click ai-parking-system-v1.0.zip
  - Select "Extract All..."
  - Extract to: C:\Users\[YourName]\Documents\ai-parking-system

STEP 2: Run Installation Script
  - Navigate to extracted folder
  - RIGHT-CLICK on INSTALL-AUTOMATED.bat
  - SELECT "Run as administrator"
  - Click "Yes" if Windows asks for permission

STEP 3: Wait (15-20 minutes)
  The script will automatically:
  ✓ Install backend dependencies (~200 packages)
  ✓ Install frontend dependencies (~400 packages)
  ✓ Install YOLO AI and Python libraries (~70 packages)
  ✓ Configure environment variables
  ✓ Start PostgreSQL database
  ✓ Initialize database tables
  ✓ Launch backend server
  ✓ Launch frontend application

STEP 4: Browser Opens Automatically
  - Opens to: http://localhost:5173
  - Login with: admin / admin123

================================================================================
QUICK VERIFICATION (2 minutes)
================================================================================

After installation, verify these work:

✓ Backend Running:
  Look for terminal window titled "AI Parking Backend"
  Should show: "Backend running on port 3000"

✓ Frontend Running:
  Look for terminal window titled "AI Parking Frontend"
  Should show: "Local: http://localhost:5173"

✓ Database Running:
  Open CMD, type: docker ps
  Should show postgres_db container as "Up"

✓ Can Login:
  Go to http://localhost:5173
  Login: admin / admin123
  Should see Admin Dashboard

✓ Can Create Parking Lot:
  Click "Parking Lots" tab → "New lot"
  Fill form, click "Create"
  Should show success message

✓ Video Upload Works:
  Go to "Video Analysis" tab
  Select lot, choose video file, upload
  Status should change: pending → processing → completed

================================================================================
FIRST-TIME SETUP WORKFLOW
================================================================================

1. LOGIN AS ADMIN
   Username: admin
   Password: admin123

2. CREATE FIRST PARKING LOT
   Admin Dashboard → Parking Lots → New lot
   Name: Main Parking
   Total Slots: 50
   Rows: 5
   Columns: 10
   Click "Create"

3. TEST VIDEO UPLOAD
   Admin Dashboard → Video Analysis
   Select "Main Parking"
   Choose parking lot video (MP4, 30-60 seconds)
   Click "Upload"
   Wait 1-2 minutes for AI processing
   Click "Show Details" to see results

4. TEST CHATBOT
   Click chatbot icon (bottom-right)
   Type: "Find available parking"
   Type: "yes"
   Type: "How much does it cost?"
   Type: "thanks"
   Should get contextual responses

================================================================================
COMMON ISSUES & QUICK FIXES
================================================================================

ISSUE: "Port 3000 already in use"
FIX: 
  CMD: netstat -ano | findstr :3000
       taskkill /PID [NUMBER] /F

ISSUE: "Cannot connect to database"
FIX:
  CMD: docker-compose -f docker-compose.dev.yml up -d
       timeout /t 10

ISSUE: "Module 'ultralytics' not found"
FIX:
  CMD: cd ai-services
       py -m pip install ultralytics

ISSUE: "Website shows white screen"
FIX:
  - Press F12 in browser
  - Check Console tab for errors
  - Clear cache (Ctrl+Shift+Delete)
  - Hard refresh (Ctrl+F5)

ISSUE: "Video stuck on pending"
FIX:
  - Check backend terminal for Python errors
  - Verify YOLO installed: py -c "from ultralytics import YOLO; print('OK')"
  - If error: py -m pip install ultralytics

ISSUE: "Login fails with invalid credentials"
FIX:
  - Make sure typing correctly (case-sensitive!)
  - Username: admin (all lowercase)
  - Password: admin123 (all lowercase)

================================================================================
DAILY STARTUP PROCEDURE
================================================================================

To start the system each day:

OPTION A - Using Docker (Recommended):
  CMD: cd C:\path\to\ai-parking-system
       docker-compose -f docker-compose.dev.yml up -d

OPTION B - Manual Start:
  Terminal 1: cd backend && npm start
  Terminal 2: cd frontend && npm run dev
  
  Then open: http://localhost:5173

================================================================================
MAINTENANCE TASKS
================================================================================

WEEKLY:
- Check disk space (dir command)
- Review error logs in backend terminal
- Monitor database size

MONTHLY:
- Update dependencies:
  CMD: cd backend && npm update
       cd ../frontend && npm update
       cd ../ai-services && py -m pip install --upgrade -r requirements.txt
- Backup database:
  CMD: docker exec postgres_db pg_dump -U parking_admin parking_system > backup.sql

AS NEEDED:
- Clean old video uploads from backend/uploads/
- Archive old analysis records
- Review user activity logs

================================================================================
CONTACT INFORMATION FOR SUPPORT
================================================================================

Primary Contact: [Your Name]
Phone: [Your Phone Number]
Email: [Your Email Address]
Hours: [Your Support Hours]

For urgent issues outside support hours:
- Check INSTALLATION-GUIDE.md troubleshooting section
- Review QUICKSTART.md common issues
- Check backend terminal logs for error messages

================================================================================
SYSTEM REQUIREMENTS
================================================================================

MINIMUM:
- Windows 10/11 (64-bit)
- 8GB RAM
- 10GB free disk space
- Internet connection (for downloads)

RECOMMENDED:
- Windows 11 (64-bit)
- 16GB RAM
- SSD storage
- NVIDIA GPU (for faster AI processing)

================================================================================
WHAT'S INCLUDED IN THE PACKAGE
================================================================================

📄 Documentation Files:
  - INSTALLATION-GUIDE.md (detailed instructions)
  - QUICKSTART.md (fast setup guide)
  - DEPLOYMENT-CHECKLIST.md (expert reference)
  - DEPLOYMENT-SUMMARY.md (complete overview)
  - This CHEAT-SHEET.md (quick reference)

🔧 Automation Scripts:
  - INSTALL-AUTOMATED.bat (one-click installer)
  - setup-database.bat (database initialization)
  - start-system.bat (launch all services)

📦 Application Code:
  - backend/ (Node.js API server)
  - frontend/ (React/Vite UI)
  - ai-services/ (Python YOLO AI)
  - database/ (PostgreSQL schema)

⚙️ Configuration:
  - .env.example (environment template)
  - docker-compose.dev.yml (Docker setup)
  - package.json files (dependency manifests)

================================================================================
SUCCESS INDICATORS
================================================================================

Installation is successful when ALL of these are true:

✅ Backend terminal shows "Database connected"
✅ Frontend terminal shows "VITE ready"  
✅ Browser loads http://localhost:5173 without errors
✅ Can login with admin/admin123
✅ Can create new parking lot successfully
✅ Video upload completes (status: completed)
✅ AI detection shows real vehicle results
✅ Chatbot responds with contextual answers
✅ Real-time updates work (no page refresh needed)
✅ No red errors in browser console (F12)

If ANY of these fail, check troubleshooting section above!

================================================================================
DEFAULT CREDENTIALS
================================================================================

ADMIN ACCOUNT:
Username: admin
Password: admin123

USER ACCOUNT:
Username: user
Password: user123

⚠️ IMPORTANT: Change passwords after first login in production!

================================================================================
QUICK REFERENCE COMMANDS
================================================================================

Check if everything is running:
  docker ps                    # Shows database container
  netstat -ano | findstr 3000  # Shows backend port
  netstat -ano | findstr 5173  # Shows frontend port

Restart everything:
  docker-compose down
  cd backend && npm start      # Terminal 1
  cd frontend && npm run dev   # Terminal 2

View logs:
  docker logs postgres_db      # Database logs
  type backend\logs\error.log  # Backend error logs

Backup database:
  docker exec postgres_db pg_dump -U parking_admin parking_system > backup.sql

Restore database:
  docker exec -i postgres_db psql -U parking_admin parking_system < backup.sql

================================================================================
VERSION INFORMATION
================================================================================

Package Version: 1.0
Release Date: March 2024
Includes:
  - Backend: Node.js 18+, Express 4.18, Socket.IO 4.6
  - Frontend: React 18.2, Vite 4.5, TailwindCSS 3.3
  - AI Services: Python 3.10, YOLO 8.4, PyTorch 2.10
  - Database: PostgreSQL 15 (Docker)

================================================================================
                           END OF CHEAT SHEET
================================================================================

For complete detailed instructions, see: INSTALLATION-GUIDE.md
For quick start guide, see: QUICKSTART.md
For expert reference, see: DEPLOYMENT-CHECKLIST.md

Good luck with your installation! 🚀🅿️

================================================================================
