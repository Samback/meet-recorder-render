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
    const { meetUrl, options = {} } = req.body;
    
    // Debug logging
    console.log('Received request body:', JSON.stringify(req.body));
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
      recordingDir
    };
    
    fs.writeFileSync(`${recordingDir}/metadata.json`, JSON.stringify(metadata, null, 2));
    
    // Start recording process
    const recordingProcess = startRecording(recordingId, meetUrl, options);
    activeRecordings.set(recordingId, recordingProcess);
    
    // Return immediate response
    res.json({
      success: true,
      recordingId,
      status: 'initializing',
      message: 'Recording process started',
      statusUrl: `/api/status/${recordingId}`,
      downloadUrl: `/api/download/${recordingId}`
    });
    
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

// Start recording function
function startRecording(recordingId, meetUrl, options) {
  const recordingDir = `/tmp/recordings/${recordingId}`;
  
  // Spawn recording process
  const process = spawn('node', ['scripts/record_meet.js', recordingId, meetUrl, JSON.stringify(options)], {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  
  // Log output
  process.stdout.on('data', (data) => {
    console.log(`[${recordingId}] ${data}`);
    fs.appendFileSync(`${recordingDir}/process.log`, data);
  });
  
  process.stderr.on('data', (data) => {
    console.error(`[${recordingId}] ${data}`);
    fs.appendFileSync(`${recordingDir}/error.log`, data);
  });
  
  process.on('close', (code) => {
    console.log(`Recording ${recordingId} finished with code ${code}`);
    activeRecordings.delete(recordingId);
  });
  
  return process;
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
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🎥 Google Meet Recording Service running on port ${PORT}`);
  
  // Ensure recordings directory exists
  if (!fs.existsSync(RECORDINGS_DIR)) {
    fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
    console.log(`Created recordings directory: ${RECORDINGS_DIR}`);
  }
});