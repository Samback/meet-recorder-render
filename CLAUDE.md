# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Google Meet recording service designed for deployment on Render.com. The service provides automated browser-based recording of Google Meet sessions with audio processing capabilities in multiple formats (MP3, WAV, FLAC).

## Architecture

The application uses a split architecture pattern:

- **Express.js API Server** (`server.js`): Handles HTTP endpoints, process management, and file serving
- **Puppeteer Recording Script** (`scripts/record_meet.js`): Manages browser automation, meeting joining, and audio capture
- **Docker Container**: Provides isolated environment with Chrome, FFmpeg, and Node.js
- **Render.com Deployment**: Cloud hosting with automatic scaling and SSL

### Key Components

- **Recording Management**: In-memory tracking of active recordings with metadata persistence
- **Browser Automation**: Puppeteer-based Google Meet joining with permission handling
- **Audio Processing**: FFmpeg integration for real-time recording and format conversion
- **File Storage**: Temporary `/tmp/recordings` with automatic cleanup after 7 days
- **Status Monitoring**: Real-time status updates through metadata JSON files

## Common Development Commands

### Local Development
```bash
# Install dependencies
npm install

# Start development server (with nodemon)
npm run dev

# Start production server
npm start
```

### Docker Operations
```bash
# Build container
docker build -t meet-recorder .

# Run container locally
docker run -p 3000:3000 meet-recorder

# Health check
curl http://localhost:3000/health
```

### Testing API Endpoints
```bash
# Test endpoint (for debugging)
curl -X POST http://localhost:3000/api/test \
  -H "Content-Type: application/json" \
  -d '{"test": "data"}'

# Start recording (anonymous)
curl -X POST http://localhost:3000/api/record \
  -H "Content-Type: application/json" \
  -d '{"meetUrl": "https://meet.google.com/xxx-xxxx-xxx", "options": {"audioFormat": "mp3"}}'

# Start recording (with Google account) - NEW SIMPLIFIED FORMAT
curl -X POST http://localhost:3000/api/record \
  -H "Content-Type: application/json" \
  -d '{
    "meetUrl": "https://meet.google.com/xxx-xxxx-xxx",
    "email": "your-email@gmail.com",
    "password": "your-password",
    "options": {"audioFormat": "mp3"}
  }'

# Check status
curl http://localhost:3000/api/status/RECORDING_ID

# Download recording
curl http://localhost:3000/api/download/RECORDING_ID/mp3
```

### Common 400 Bad Request Issues
- **Missing meetUrl**: Ensure request body includes `"meetUrl"` field
- **Invalid meetUrl**: Must contain `"meet.google.com"`
- **Missing Content-Type**: Must include `"Content-Type: application/json"` header
- **Malformed JSON**: Check request body JSON syntax

### Google Account Authentication

**Why use Google authentication?**
- **Bypass anonymous restrictions** - Many meetings don't allow guest users
- **Enable invitations** - Host can invite the specific Google account
- **Appear as real participant** - Shows account name instead of "Guest"
- **Access corporate meetings** - Required for many business/educational meetings

**Request format with Google auth (SIMPLIFIED):**
```json
{
  "meetUrl": "https://meet.google.com/xxx-xxxx-xxx",
  "email": "recorder@example.com", 
  "password": "your-password"
}
```

**Legacy format (still supported):**
```json
{
  "meetUrl": "https://meet.google.com/xxx-xxxx-xxx",
  "googleAuth": {
    "email": "recorder@example.com", 
    "password": "your-password"
  }
}
```

**Authentication flow:**
1. Logs into Google account before joining meeting
2. Navigates to Google Meet as authenticated user
3. Joins meeting with account identity
4. Starts audio recording
5. Returns success response only after recording is active

**API Response Behavior:**
- **OLD**: Returned immediately when request received
- **NEW**: Waits until recording actually starts before responding
- **Timeout**: 90 seconds for full initialization
- **Success**: Returns when FFmpeg audio recording is confirmed active
- **Failure**: Returns error if authentication, join, or recording fails

**Security notes:**
- Credentials are not logged or stored permanently
- Use a dedicated Google account for recording
- Consider app-specific passwords for enhanced security

### Chrome/Puppeteer Issues
If you see "Could not find Chrome" errors:
- Fixed in latest version with explicit Chrome path
- Chrome installed via Dockerfile at `/usr/bin/google-chrome-stable`
- Puppeteer configured to use system Chrome instead of bundled version

## Debug Dashboard

Access the comprehensive debug dashboard at:
```
https://your-app.onrender.com/debug
```

**Features:**
- **Session Overview**: List all recording sessions with metadata
- **Screenshots**: View UI screenshots when join button not found
- **Logs**: Access process logs, error logs, and FFmpeg logs
- **HTML Content**: View saved page content for UI analysis
- **Status Tracking**: See recording status and error details

**Individual File Access:**
```
https://your-app.onrender.com/api/debug/RECORDING_ID/FILENAME
```

**Common Debug Files:**
- `debug_screenshot.png` - UI screenshot
- `page_content.html` - HTML page content
- `process.log` - Main process output
- `error.log` - Error messages
- `ffmpeg.log` - Audio recording logs
- `metadata.json` - Recording metadata

## Key File Locations

- **Main Server**: `server.js`
- **Recording Logic**: `scripts/record_meet.js`
- **Dependencies**: `package.json`
- **Container Config**: `Dockerfile`
- **Deployment Config**: `render.yaml`
- **Documentation**: `README.md`

## Recording Workflow States

```
initializing → launching_browser → joining_meeting → recording_active → processing → completed
```

## Important Implementation Details

### Audio Recording Process
- Uses FFmpeg with PulseAudio backend for system audio capture
- Supports multiple output formats with configurable quality settings
- Includes real-time monitoring and graceful shutdown handling

### Browser Automation
- Headless Chrome with media stream permissions
- Automatic camera disable and microphone management  
- Meeting detection through DOM element monitoring
- Configurable timeouts and error handling

### Storage Management
- Recordings stored in `/tmp/recordings/{recordingId}/`
- Metadata tracking in JSON format for each recording
- Automatic cleanup via cron job (daily at 2 AM)
- Multiple format outputs with size tracking

### Error Handling
- Process-level error logging to recording directories
- Graceful cleanup of browser and FFmpeg processes
- Status persistence for debugging and monitoring
- Comprehensive error reporting through API

## Security Considerations

- Non-root user execution in Docker container
- Sandboxed Chrome browser execution
- No persistent storage of sensitive meeting data
- Automatic file cleanup prevents storage accumulation

## Deployment Troubleshooting

### Missing package-lock.json Error
If you encounter "npm ci" errors during Docker build:

```bash
# Generate package-lock.json locally
npm install

# Commit the generated package-lock.json
git add package-lock.json
git commit -m "Add package-lock.json for Docker builds"
```

### Docker Build Commands
```bash
# Test Docker build locally before deployment
docker build -t meet-recorder .
docker run -p 3000:3000 meet-recorder
```

### Common Build Issues
- **Missing package-lock.json**: Run `npm install` locally and commit the lock file
- **Node version mismatch**: Dockerfile uses Node 18, ensure compatibility
- **FFmpeg/Chrome dependencies**: Already included in Dockerfile system packages

### 502 Bad Gateway Error
If you see 502 errors on Render.com:

1. **Check deployment logs** in Render dashboard for specific errors
2. **Directory permissions**: Fixed in latest version with proper Docker user setup
3. **Health check failure**: Service must respond to `/health` endpoint within 60 seconds
4. **Startup timeout**: Container must start within Render's timeout limits

**Quick fixes:**
```bash
# Test locally first
docker build -t meet-recorder .
docker run -p 3000:3000 meet-recorder
curl http://localhost:3000/health

# If working locally, redeploy on Render
git push origin main
```