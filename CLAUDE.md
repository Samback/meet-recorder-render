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

# Start recording
curl -X POST http://localhost:3000/api/record \
  -H "Content-Type: application/json" \
  -d '{"meetUrl": "https://meet.google.com/xxx-xxxx-xxx", "options": {"audioFormat": "mp3"}}'

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

### Chrome/Puppeteer Issues
If you see "Could not find Chrome" errors:
- Fixed in latest version with explicit Chrome path
- Chrome installed via Dockerfile at `/usr/bin/google-chrome-stable`
- Puppeteer configured to use system Chrome instead of bundled version

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