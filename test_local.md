# Testing Google Meet Recorder Locally - App Password Focus

## Prerequisites

1. **Docker Desktop** (for Chrome/FFmpeg dependencies) 
2. **Node.js** installed locally
3. **Google account with 2FA enabled** 
4. **Google App Password** (REQUIRED for best results)
5. **Test Google Meet URL** (create a test meeting)

## 🔑 **Step 1: Setup Google App Password (ESSENTIAL)**

**Why App Passwords?**
- ✅ Bypasses all 2FA complexity
- ✅ No phone confirmations needed  
- ✅ Most reliable for automated recording
- ✅ Works consistently in Docker environments

**Setup Steps:**
1. **Enable 2FA**: Go to https://myaccount.google.com/security
2. **Generate App Password**: Visit https://myaccount.google.com/apppasswords
3. **Select "Mail"** as the app type
4. **Copy the 16-digit password** (spaces don't matter)

## Method 1: Local Development Server (Recommended)

### Start the server:
```bash
npm install
npm run dev
```

### 🔑 **Primary Test - App Password Authentication (RECOMMENDED)**:
```bash
curl -X POST http://localhost:3000/api/record \
  -H "Content-Type: application/json" \
  -d '{
    "meetUrl": "https://meet.google.com/your-test-meeting-id",
    "email": "your-email@gmail.com",
    "password": "abcd efgh ijkl mnop",
    "options": {"audioFormat": "mp3", "maxDuration": 120}
  }'
```

### ⚡ **Simplified Test (Uses App Password by Default)**:
```bash
curl -X POST http://localhost:3000/api/record \
  -H "Content-Type: application/json" \
  -d '{
    "meetUrl": "https://meet.google.com/your-test-meeting-id", 
    "email": "your-email@gmail.com",
    "password": "your-16-digit-app-password"
  }'
```

3. **Test Persistent Session**:
```bash
curl -X POST http://localhost:3000/api/record \
  -H "Content-Type: application/json" \
  -d '{
    "meetUrl": "https://meet.google.com/your-test-meeting-id",
    "email": "your-email@gmail.com",
    "password": "your-password",
    "method": "persistent_session",
    "options": {"audioFormat": "mp3", "maxDuration": 60}
  }'
```

4. **Test Legacy Method (Fallback)**:
```bash
curl -X POST http://localhost:3000/api/record \
  -H "Content-Type: application/json" \
  -d '{
    "meetUrl": "https://meet.google.com/your-test-meeting-id",
    "email": "your-email@gmail.com",
    "password": "your-password",
    "method": "legacy",
    "options": {"audioFormat": "mp3", "maxDuration": 60}
  }'
```

### Monitor the results:

1. **Check debug dashboard**: http://localhost:3000/debug
2. **View detailed screenshots**: Each recording will have 15+ debug screenshots
3. **Check logs**: Server console will show detailed authentication flow

## Method 2: Docker Testing

### Build and run in Docker:
```bash
docker build -t meet-recorder .
docker run -p 3000:3000 meet-recorder
```

### Test with curl (same commands as above but to localhost:3000)

## Method 3: Direct Script Testing

### Test authentication components directly:
```bash
# Test the new MeetAuthenticator class
node -e "
const { MeetAuthenticator } = require('./scripts/auth_improvements.js');
const auth = new MeetAuthenticator('/tmp/test');
console.log('✅ MeetAuthenticator loads successfully');
console.log('Available methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(auth)).filter(name => name !== 'constructor'));
"
```

### Test record_meet.js syntax:
```bash
node -c scripts/record_meet.js && echo "✅ Syntax OK"
```

## Method 4: Using the Test Script

```bash
# Edit the test script with your credentials
nano test_new_auth.sh

# Make it executable and run
chmod +x test_new_auth.sh
./test_new_auth.sh
```

## What to Look For

### ✅ **Success Indicators**:
- Server logs show: `✅ Authentication successful using method: direct_meet`
- Debug dashboard shows progression through authentication steps
- Screenshots show successful login to Google account
- Recording starts without "already authenticated" false positive

### ❌ **Failure Indicators**:
- Logs show: `Already logged in - on authenticated page` for sign-in URLs
- Early exit with code 0 before actual authentication
- Missing authentication debug screenshots
- Process stops at Gmail landing page

### 🔍 **Debug Information**:
- Check `/tmp/recordings/RECORDING_ID/` for debug files
- Look at `debug_XX_stepname_info.json` files for detailed page state
- Screenshots show each step of authentication process
- Authentication state analysis in JSON files

## Troubleshooting

### If authentication fails:
1. **Check credentials** - Use app-specific password for 2FA accounts
2. **Try different methods** - Start with `direct_meet`, fallback to `legacy`
3. **Check debug screenshots** - See exactly where authentication failed
4. **Review logs** - Server console shows detailed authentication flow

### If Docker issues:
```bash
# Check Docker logs
docker logs CONTAINER_ID

# Test Chrome availability
docker run meet-recorder /usr/bin/google-chrome-stable --version
```

### Common fixes:
- **2FA issues**: Use `app_password` method with Google App Password
- **Device confirmation**: System now handles this automatically
- **Meeting access**: Make sure the Google account can access the meeting

## Creating Test Meetings

1. Go to https://meet.google.com/
2. Click "New meeting" → "Start an instant meeting"
3. Copy the meeting URL for testing
4. You can join from another browser/device to test recording