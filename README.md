# 🎥 Google Meet Recording Service

A powerful, automated Google Meet recording service designed for deployment on Render.com. This service provides real browser automation for recording Google Meet sessions with high-quality audio output in multiple formats.

## 🌟 Features

- ✅ **Automated Google Meet Recording** - Full browser automation using Puppeteer
- ✅ **Multiple Audio Formats** - Export in MP3, WAV, and FLAC formats
- ✅ **RESTful API** - Simple HTTP endpoints for integration
- ✅ **Real-time Status Tracking** - Monitor recording progress and status
- ✅ **Automatic Cleanup** - Configurable retention and cleanup policies
- ✅ **Docker Ready** - Containerized for easy deployment
- ✅ **Render.com Optimized** - Pre-configured for Render.com deployment

## 🏗️ Architecture

This service is designed to work with n8n or other automation tools:

```
User Request → n8n Workflow → Render Service → Google Meet Recording
```

### Why Split Architecture?

| Component | n8n | Render Service |
|-----------|-----|----------------|
| **Complexity** | Simple HTTP calls | Heavy processing |
| **Resources** | Minimal | Full system access |
| **Maintenance** | Easy updates | Independent deployment |
| **Cost** | Your existing server | Free tier available |

## 🚀 Quick Start

### 1. Deploy to Render.com

1. **Fork this repository** to your GitHub account
2. **Sign up for [Render.com](https://render.com)** (free tier available)
3. **Connect your GitHub account** to Render
4. **Create a new Web Service** and select this repository
5. **Render will automatically deploy** using the included `render.yaml`

Your service will be available at: `https://your-app-name.onrender.com`

### 2. Test the Service

```bash
# Health check
curl https://your-app-name.onrender.com/health

# Start a recording
curl -X POST https://your-app-name.onrender.com/api/record \
  -H "Content-Type: application/json" \
  -d '{
    "meetUrl": "https://meet.google.com/your-meeting-code",
    "options": {
      "audioFormat": "mp3",
      "quality": "320k",
      "maxDuration": 3600
    }
  }'
```

## 📡 API Reference

### Start Recording
```http
POST /api/record
Content-Type: application/json

{
  "meetUrl": "https://meet.google.com/xxx-xxxx-xxx",
  "options": {
    "audioFormat": "mp3",     // mp3, wav, flac
    "quality": "320k",        // audio bitrate for mp3
    "maxDuration": 14400      // max seconds (4 hours default)
  }
}
```

**Response:**
```json
{
  "success": true,
  "recordingId": "rec_1634567890_xyz123",
  "status": "initializing",
  "message": "Recording process started",
  "statusUrl": "/api/status/rec_1634567890_xyz123",
  "downloadUrl": "/api/download/rec_1634567890_xyz123"
}
```

### Check Status
```http
GET /api/status/{recordingId}
```

**Response:**
```json
{
  "recordingId": "rec_1634567890_xyz123",
  "status": "recording_active",
  "startTime": "2023-10-18T14:30:00.000Z",
  "duration": 1200,
  "isActive": true
}
```

### Download Recording
```http
GET /api/download/{recordingId}/{format}
```

Available formats: `mp3`, `wav`, `flac`

### Stop Recording
```http
POST /api/stop/{recordingId}
```

### Health Check
```http
GET /health
```

## 🔧 Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `NODE_ENV` | `development` | Environment mode |

### Recording Options

| Option | Default | Description |
|--------|---------|-------------|
| `audioFormat` | `mp3` | Output format (mp3, wav, flac) |
| `quality` | `320k` | Audio bitrate for MP3 |
| `maxDuration` | `14400` | Maximum recording duration (seconds) |

## 🔗 Integration with n8n

Here's a sample n8n workflow to integrate with this service:

```json
{
  "name": "Google Meet Recorder - Render Integration",
  "nodes": [
    {
      "parameters": {
        "method": "POST",
        "url": "https://your-render-app.onrender.com/api/record",
        "sendHeaders": true,
        "headerParameters": {
          "parameters": [
            {
              "name": "Content-Type",
              "value": "application/json"
            }
          ]
        },
        "sendBody": true,
        "contentType": "json",
        "jsonBody": "{\n  \"meetUrl\": \"{{ $json.meetUrl }}\",\n  \"options\": {\n    \"audioFormat\": \"mp3\",\n    \"quality\": \"320k\"\n  }\n}"
      },
      "name": "Start Recording",
      "type": "n8n-nodes-base.httpRequest"
    }
  ]
}
```

## 🖥️ Local Development

### Prerequisites

- Node.js 18+
- FFmpeg
- Google Chrome/Chromium

### Setup

```bash
# Clone the repository
git clone https://github.com/yourusername/meet-recorder-render.git
cd meet-recorder-render

# Install dependencies
npm install

# Start development server
npm run dev
```

### Testing Locally

```bash
# Start the service
npm start

# In another terminal, test recording
curl -X POST http://localhost:3000/api/record \
  -H "Content-Type: application/json" \
  -d '{
    "meetUrl": "https://meet.google.com/your-test-meeting",
    "options": {"audioFormat": "mp3"}
  }'
```

## 📁 Project Structure

```
meet-recorder-render/
├── package.json              # Dependencies and scripts
├── server.js                 # Main Express application
├── Dockerfile               # Container configuration
├── render.yaml              # Render.com deployment config
├── scripts/
│   └── record_meet.js       # Puppeteer recording logic
└── README.md                # This file
```

## 🔒 Security Considerations

- The service runs in a sandboxed Docker container
- Uses non-root user for enhanced security
- Automatic cleanup of old recordings
- No persistent storage of sensitive data

## 📊 Resource Usage

### Render.com Free Tier Limits
- ✅ **750 hours/month** free runtime
- ✅ **1GB storage** for recordings
- ✅ **512MB RAM** per service
- ✅ **0.1 CPU** allocation

### Typical Recording Usage
- **RAM**: ~200-300MB per active recording
- **Storage**: ~50-100MB per hour of audio
- **CPU**: Moderate during recording, high during processing

## 🔄 Workflow States

```
initializing → launching_browser → joining_meeting → recording_active → processing → completed
```

## 🛠️ Troubleshooting

### Common Issues

1. **Recording fails to start**
   - Check if the Google Meet URL is valid and accessible
   - Ensure the meeting hasn't started yet or allows late joins

2. **Audio quality issues**
   - Adjust the `quality` setting in recording options
   - Try different audio formats (wav for highest quality)

3. **Service timeouts**
   - Render.com free tier has request timeouts
   - For long recordings, use the status endpoint to monitor progress

### Logs

Check recording logs at:
- `/tmp/recordings/{recordingId}/process.log` - Process output
- `/tmp/recordings/{recordingId}/error.log` - Error logs
- `/tmp/recordings/{recordingId}/ffmpeg.log` - Audio processing logs

## 📈 Monitoring

The service provides several monitoring endpoints:

- `/health` - Service health and status
- `/api/status/{recordingId}` - Individual recording status
- Process logs for debugging

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test locally
5. Submit a pull request

## 📄 License

MIT License - see LICENSE file for details

## 🆘 Support

For issues and questions:
1. Check the troubleshooting section above
2. Review the API documentation
3. Open an issue on GitHub

---

**Built with ❤️ for automated Google Meet recording**