const express = require('express');
const cors = require('cors');
const { spawn, exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

// Determine recordings directory (fallback for different environments)
const RECORDINGS_DIR = process.env.RECORDINGS_DIR || '/tmp/recordings';

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Storage for active recordings
const activeRecordings = new Map();

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    activeRecordings: activeRecordings.size,
    uptime: process.uptime()
  });
});

// Test endpoint to debug requests
app.post('/api/test', (req, res) => {
  res.json({
    message: 'Test endpoint working',
    receivedBody: req.body,
    headers: req.headers,
    timestamp: new Date().toISOString()
  });
});

// Start recording endpoint
app.post('/api/record', async (req, res) => {
  try {
    const { meetUrl, options = {}, googleAuth = {}, email, password } = req.body;
    
    // Support both new flat structure and old nested structure
    const authConfig = email && password ? { email, password } : googleAuth;
    
    // Debug logging (excluding sensitive data)
    console.log('Received request body:', JSON.stringify({
      meetUrl,
      email: authConfig.email || 'not provided',
      hasPassword: !!authConfig.password,
      options
    }));
    console.log('meetUrl:', meetUrl);
    
    // Validate input
    if (!meetUrl) {
      return res.status(400).json({ 
        error: 'meetUrl is required',
        received: req.body 
      });
    }
    
    if (!meetUrl.includes('meet.google.com')) {
      return res.status(400).json({ 
        error: 'Valid Google Meet URL required (must contain meet.google.com)',
        received: meetUrl 
      });
    }
    
    const recordingId = `rec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const recordingDir = `${RECORDINGS_DIR}/${recordingId}`;
    
    // Create recording directory
    if (!fs.existsSync(recordingDir)) {
      fs.mkdirSync(recordingDir, { recursive: true });
    }
    
    // Create initial metadata
    const metadata = {
      recordingId,
      meetUrl,
      startTime: new Date().toISOString(),
      status: 'initializing',
      options: {
        audioFormat: options.audioFormat || 'mp3',
        quality: options.quality || '320k',
        maxDuration: options.maxDuration || 14400
      },
      authentication: authConfig.email ? {
        method: authConfig.method || 'improved_direct', // Support new auth methods
        email: authConfig.email,
        hasCredentials: !!authConfig.password,
        authType: 'google'
      } : { method: 'anonymous' },
      recordingDir
    };
    
    fs.writeFileSync(`${recordingDir}/metadata.json`, JSON.stringify(metadata, null, 2));
    
    // Start recording process and wait for actual start
    res.setTimeout(120000); // 2 minute timeout for initialization
    
    try {
      const result = await startRecordingAndWait(recordingId, meetUrl, options, authConfig);
      
      res.json({
        success: true,
        recordingId,
        status: result.status,
        message: result.message,
        statusUrl: `/api/status/${recordingId}`,
        downloadUrl: `/api/download/${recordingId}`,
        startedAt: result.startedAt,
        authentication: result.authentication
      });
      
    } catch (error) {
      console.error(`Recording initialization failed for ${recordingId}:`, error.message);
      res.status(400).json({
        success: false,
        recordingId,
        error: error.message,
        statusUrl: `/api/status/${recordingId}`
      });
    }
    
  } catch (error) {
    console.error('Start recording error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get recording status
app.get('/api/status/:recordingId', (req, res) => {
  try {
    const { recordingId } = req.params;
    const metadataPath = `/tmp/recordings/${recordingId}/metadata.json`;
    
    if (!fs.existsSync(metadataPath)) {
      return res.status(404).json({ error: 'Recording not found' });
    }
    
    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    const isActive = activeRecordings.has(recordingId);
    
    res.json({
      ...metadata,
      isActive,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Debug dashboard - list all recording sessions
app.get('/debug', (req, res) => {
  try {
    if (!fs.existsSync(RECORDINGS_DIR)) {
      return res.send('<h1>No recordings directory found</h1>');
    }
    
    const recordings = fs.readdirSync(RECORDINGS_DIR)
      .map(recordingId => {
        const recordingDir = path.join(RECORDINGS_DIR, recordingId);
        const files = fs.readdirSync(recordingDir).filter(file => 
          file.endsWith('.png') || file.endsWith('.html') || file.endsWith('.log') || file.endsWith('.json')
        );
        
        const metadata = fs.existsSync(path.join(recordingDir, 'metadata.json')) 
          ? JSON.parse(fs.readFileSync(path.join(recordingDir, 'metadata.json'), 'utf8'))
          : {};
        
        return {
          recordingId,
          files,
          metadata,
          createdTime: fs.statSync(recordingDir).mtime
        };
      })
      .sort((a, b) => b.createdTime - a.createdTime);
    
    const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Recording Debug Dashboard</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 20px; background: #f5f5f5; }
        .container { max-width: 1200px; margin: 0 auto; }
        .recording { background: white; margin: 20px 0; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .recording h3 { margin-top: 0; color: #333; }
        .metadata { background: #f8f9fa; padding: 10px; border-radius: 4px; margin: 10px 0; }
        .files { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 15px; }
        .file-link { padding: 8px 15px; background: #007bff; color: white; text-decoration: none; border-radius: 4px; font-size: 12px; }
        .file-link:hover { background: #0056b3; }
        .file-link.screenshot { background: #28a745; }
        .file-link.log { background: #fd7e14; }
        .file-link.html { background: #6f42c1; }
        .file-link.json { background: #17a2b8; }
        .status { padding: 4px 8px; border-radius: 3px; font-size: 12px; font-weight: bold; }
        .status.completed { background: #d4edda; color: #155724; }
        .status.failed { background: #f8d7da; color: #721c24; }
        .status.recording { background: #d1ecf1; color: #0c5460; }
        .status.access_denied { background: #fff3cd; color: #856404; }
        .status.access_granted { background: #d4edda; color: #155724; }
        .status.authenticating { background: #e2e3e5; color: #495057; }
        .status.authenticated { background: #d4edda; color: #155724; }
        .status.auth_failed { background: #f8d7da; color: #721c24; }
        h1 { color: #333; text-align: center; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>🎥 Recording Debug Dashboard</h1>
        <p><strong>Total Sessions:</strong> ${recordings.length}</p>
        
        ${recordings.map(recording => `
          <div class="recording">
            <h3>📁 ${recording.recordingId}</h3>
            <div class="metadata">
              <p><strong>Status:</strong> <span class="status ${recording.metadata.status || 'unknown'}">${recording.metadata.status || 'Unknown'}</span></p>
              <p><strong>Started:</strong> ${recording.metadata.startTime || 'Unknown'}</p>
              <p><strong>Meet URL:</strong> ${recording.metadata.meetUrl || 'Unknown'}</p>
              <p><strong>Auth Method:</strong> ${recording.metadata.authentication?.method || 'Unknown'} ${recording.metadata.authentication?.email ? `(${recording.metadata.authentication.email})` : ''}</p>
              ${recording.metadata.error ? `<p><strong>Error:</strong> <code>${recording.metadata.error}</code></p>` : ''}
            </div>
            
            <div class="files">
              ${recording.files.map(file => {
                const fileType = file.endsWith('.png') ? 'screenshot' : 
                                file.endsWith('.log') ? 'log' : 
                                file.endsWith('.html') ? 'html' : 'json';
                return `<a href="/api/debug/${recording.recordingId}/${file}" class="file-link ${fileType}" target="_blank">${file}</a>`;
              }).join('')}
            </div>
          </div>
        `).join('')}
        
        ${recordings.length === 0 ? '<p style="text-align: center; color: #666;">No recording sessions found.</p>' : ''}
      </div>
    </body>
    </html>`;
    
    res.send(html);
  } catch (error) {
    res.status(500).send(`<h1>Error loading debug dashboard</h1><p>${error.message}</p>`);
  }
});

// Debug endpoint - get screenshot or HTML content
app.get('/api/debug/:recordingId/:file?', (req, res) => {
  try {
    const { recordingId, file = 'debug_screenshot.png' } = req.params;
    const recordingDir = `${RECORDINGS_DIR}/${recordingId}`;
    
    if (!fs.existsSync(recordingDir)) {
      return res.status(404).json({ error: 'Recording not found' });
    }
    
    const filePath = path.join(recordingDir, file);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Debug file not found' });
    }
    
    // Set appropriate content type
    if (file.endsWith('.png')) {
      res.setHeader('Content-Type', 'image/png');
    } else if (file.endsWith('.html')) {
      res.setHeader('Content-Type', 'text/html');
    }
    
    res.sendFile(path.resolve(filePath));
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Download recording
app.get('/api/download/:recordingId/:format?', (req, res) => {
  try {
    const { recordingId, format = 'mp3' } = req.params;
    const recordingDir = `${RECORDINGS_DIR}/${recordingId}`;
    
    if (!fs.existsSync(recordingDir)) {
      return res.status(404).json({ error: 'Recording not found' });
    }
    
    const metadata = JSON.parse(fs.readFileSync(`${recordingDir}/metadata.json`, 'utf8'));
    
    if (metadata.status !== 'completed') {
      return res.status(202).json({ 
        message: 'Recording not yet completed',
        status: metadata.status 
      });
    }
    
    // Find the requested file
    const fileName = metadata.files?.[format];
    if (!fileName) {
      return res.status(404).json({ error: `Format ${format} not available` });
    }
    
    const filePath = path.join(recordingDir, fileName);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    // Send file
    res.download(filePath, fileName);
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Stop recording
app.post('/api/stop/:recordingId', (req, res) => {
  try {
    const { recordingId } = req.params;
    
    if (activeRecordings.has(recordingId)) {
      const process = activeRecordings.get(recordingId);
      process.kill('SIGTERM');
      activeRecordings.delete(recordingId);
      
      res.json({ 
        success: true, 
        message: 'Recording stopped',
        recordingId 
      });
    } else {
      res.status(404).json({ error: 'Recording not found or already stopped' });
    }
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Start recording and wait for actual start
async function startRecordingAndWait(recordingId, meetUrl, options, googleAuth = {}) {
  return new Promise((resolve, reject) => {
    const recordingDir = `${RECORDINGS_DIR}/${recordingId}`;
    const timeoutMs = 90000; // 1.5 minute timeout
    
    // Spawn recording process
    const process = spawn('node', ['scripts/record_meet.js', recordingId, meetUrl, JSON.stringify(options), JSON.stringify(googleAuth)], {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    
    activeRecordings.set(recordingId, process);
    
    let resolved = false;
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        reject(new Error('Recording initialization timeout - process took too long to start'));
      }
    }, timeoutMs);
    
    // Log output and monitor for success states
    process.stdout.on('data', (data) => {
      const output = data.toString();
      console.log(`[${recordingId}] ${output}`);
      fs.appendFileSync(`${recordingDir}/process.log`, output);
      
      // Check for successful recording start
      if (output.includes('FFmpeg process started successfully') && !resolved) {
        resolved = true;
        clearTimeout(timeout);
        
        // Read current metadata for response
        const metadata = JSON.parse(fs.readFileSync(`${recordingDir}/metadata.json`, 'utf8'));
        
        resolve({
          status: 'recording_active',
          message: '🎥 Recording started successfully! Audio capture is active.',
          startedAt: new Date().toISOString(),
          authentication: metadata.authentication
        });
      }
      
      // Check for authentication completion
      if (output.includes('Google authentication completed') && !resolved) {
        console.log(`[${recordingId}] Authentication successful, continuing...`);
      }
    });
    
    process.stderr.on('data', (data) => {
      const error = data.toString();
      console.error(`[${recordingId}] ${error}`);
      fs.appendFileSync(`${recordingDir}/error.log`, error);
      
      // Check for critical errors that should fail the request
      if ((error.includes('Authentication failed') || 
           error.includes('Meeting access denied') ||
           error.includes('FFmpeg failed to start')) && !resolved) {
        resolved = true;
        clearTimeout(timeout);
        reject(new Error(error.trim()));
      }
    });
    
    process.on('close', (code) => {
      console.log(`Recording ${recordingId} finished with code ${code}`);
      activeRecordings.delete(recordingId);
      
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        reject(new Error(`Recording process exited with code ${code} before starting`));
      }
    });
    
    process.on('error', (error) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        reject(new Error(`Failed to spawn recording process: ${error.message}`));
      }
    });
  });
}

// Cleanup old recordings (daily)
const cron = require('node-cron');
cron.schedule('0 2 * * *', () => {
  console.log('Running daily cleanup...');
  cleanupOldRecordings();
});

function cleanupOldRecordings() {
  if (!fs.existsSync(RECORDINGS_DIR)) return;
  
  const cutoffTime = Date.now() - (7 * 24 * 60 * 60 * 1000); // 7 days
  
  fs.readdirSync(RECORDINGS_DIR).forEach(dir => {
    const dirPath = path.join(RECORDINGS_DIR, dir);
    const stat = fs.statSync(dirPath);
    
    if (stat.mtime.getTime() < cutoffTime) {
      fs.rmSync(dirPath, { recursive: true, force: true });
      console.log(`Cleaned up old recording: ${dir}`);
    }
  });
}

// Start server
console.log('🚀 Starting Google Meet Recording Service...');
console.log(`📂 Recordings directory: ${RECORDINGS_DIR}`);
console.log(`🌐 Binding to port: ${PORT}`);

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`🎥 Google Meet Recording Service running on port ${PORT}`);
  console.log(`✅ Server ready at http://0.0.0.0:${PORT}`);
  console.log(`📊 Health check: http://0.0.0.0:${PORT}/health`);
  
  // Ensure recordings directory exists
  if (!fs.existsSync(RECORDINGS_DIR)) {
    fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
    console.log(`📁 Created recordings directory: ${RECORDINGS_DIR}`);
  } else {
    console.log(`📁 Using existing recordings directory: ${RECORDINGS_DIR}`);
  }
  
  console.log('🎬 Service fully initialized and ready for recordings');
});

server.on('error', (error) => {
  console.error('❌ Server startup error:', error);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('📋 Received SIGTERM, shutting down gracefully...');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('📋 Received SIGINT, shutting down gracefully...');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});