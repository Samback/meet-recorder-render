# 🔑 Google App Password Setup Guide

## Why Use App Passwords?

**App passwords are now the DEFAULT and RECOMMENDED method** for Google Meet recording because they:

✅ **Bypass 2FA completely** - No phone confirmations or device verification  
✅ **Most reliable** - Work consistently in automated/Docker environments  
✅ **Production ready** - No user interaction required during authentication  
✅ **Simple setup** - One-time configuration  
✅ **Secure** - App-specific passwords that can be revoked individually  

## Setup Steps (5 minutes)

### 1. Enable 2-Step Verification
- Go to https://myaccount.google.com/security
- Click "2-Step Verification" 
- Follow the setup process (required for app passwords)

### 2. Generate App Password
- Visit https://myaccount.google.com/apppasswords
- Select "Mail" as the app
- Click "Generate"
- **Copy the 16-digit password** (e.g., "abcd efgh ijkl mnop")

### 3. Test Your App Password
```bash
# Start the server
npm run dev

# Test with your app password
curl -X POST http://localhost:3000/api/record \
  -H "Content-Type: application/json" \
  -d '{
    "meetUrl": "https://meet.google.com/your-meeting-id",
    "email": "your-email@gmail.com",
    "password": "abcd efgh ijkl mnop"
  }'
```

## What You Should See

✅ **Success logs:**
```
🔐 Starting Google authentication for: your-email@gmail.com
🔑 Using Google App Password (bypasses 2FA)
🔑 Starting app password authentication - most reliable method
✅ App password authentication completed successfully!
```

❌ **Failure indicators:**
- "App password authentication failed"
- "Please verify your Google App Password is correct"

## Troubleshooting

### App Password Not Working?
1. **Check the password** - Must be exactly 16 characters from Google
2. **Verify 2FA is enabled** - Required for app passwords  
3. **Try regenerating** - Old app passwords may expire
4. **Check account type** - Some corporate accounts restrict app passwords

### Still Having Issues?
1. **View debug dashboard** - http://localhost:3000/debug
2. **Check authentication screenshots** - Look for detailed step-by-step images
3. **Try alternative method** - Set `"method": "direct_meet"` as fallback

## Key Features

- **Smart Detection**: System automatically detects 16-character app password format
- **Automatic Fallback**: If app password fails, tries regular authentication  
- **Enhanced Debugging**: Detailed screenshots at every authentication step
- **Production Ready**: Works reliably in Docker/cloud environments

## Production Usage

For production deployments, **always use app passwords**:

```json
{
  "meetUrl": "https://meet.google.com/xxx-xxxx-xxx",
  "email": "recorder@yourdomain.com", 
  "password": "your-16-digit-app-password",
  "options": {
    "audioFormat": "mp3",
    "maxDuration": 7200
  }
}
```

This ensures reliable, automated recording without any user interaction required.