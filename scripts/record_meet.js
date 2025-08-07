const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

async function recordMeeting(recordingId, meetUrl, options) {
  const RECORDINGS_DIR = process.env.RECORDINGS_DIR || '/tmp/recordings';
  const recordingDir = `${RECORDINGS_DIR}/${recordingId}`;
  let browser, ffmpegProcess;
  
  try {
    console.log(`Starting recording ${recordingId} for ${meetUrl}`);
    
    // Update status
    updateMetadata(recordingDir, { status: 'launching_browser' });
    
    // Launch browser
    browser = await puppeteer.launch({
      headless: 'new', // Use new headless mode for Docker
      executablePath: '/usr/bin/google-chrome-stable', // Explicit Chrome path for Docker
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-web-security',
        '--disable-features=VizDisplayCompositor',
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        '--allow-running-insecure-content',
        '--autoplay-policy=no-user-gesture-required',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-crash-reporter',
        '--disable-extensions',
        '--disable-logging',
        '--disable-breakpad',
        '--user-data-dir=/tmp/chrome-user-data',
        '--data-path=/tmp/chrome-data',
        '--homedir=/tmp'
      ],
      defaultViewport: { width: 1920, height: 1080 }
    });
    
    const page = await browser.newPage();
    
    // Grant permissions
    const context = browser.defaultBrowserContext();
    await context.overridePermissions(meetUrl, ['microphone', 'camera']);
    
    updateMetadata(recordingDir, { 
      status: 'joining_meeting',
      browserLaunched: true,
      targetUrl: meetUrl
    });
    
    // Navigate to meet
    console.log(`Navigating to: ${meetUrl}`);
    await page.goto(meetUrl, { waitUntil: 'networkidle2', timeout: 60000 });
    console.log('Page loaded successfully');
    
    // Join meeting logic - try multiple selector approaches
    console.log('Waiting for meeting interface...');
    
    // Wait for page to load completely
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Try to find and disable camera
    const cameraSelectors = [
      '[data-is-muted="false"]', // Camera toggle
      '[aria-label*="camera"]',   // Camera button by aria-label
      'button[jsname="BOHaEe"]',  // Original selector
      '[data-tooltip*="camera"]'  // Tooltip-based selector
    ];
    
    for (const selector of cameraSelectors) {
      try {
        const cameraButton = await page.$(selector);
        if (cameraButton) {
          await cameraButton.click();
          console.log(`Camera disabled using selector: ${selector}`);
          break;
        }
      } catch (e) {
        console.log(`Camera selector ${selector} failed:`, e.message);
      }
    }
    
    // Try to find and click join button
    const joinSelectors = [
      'button[jsname="Qx7uuf"]',           // Original selector
      '[aria-label*="Join"]',              // Join by aria-label  
      '[data-tooltip*="Join"]',            // Tooltip-based
      'button[data-promo-anchor-id="join"]', // Data attribute
      'div[role="button"][aria-label*="Join"]' // Alternative join button
    ];
    
    console.log('Looking for join button...');
    let joinSuccessful = false;
    
    for (const selector of joinSelectors) {
      try {
        const joinButton = await page.$(selector);
        if (joinButton) {
          await joinButton.click();
          console.log(`Join button clicked using selector: ${selector}`);
          joinSuccessful = true;
          break;
        }
      } catch (e) {
        console.log(`Join selector ${selector} failed:`, e.message);
      }
    }
    
    // Try text-based approach as fallback
    if (!joinSuccessful) {
      try {
        const buttons = await page.$$('button, div[role="button"]');
        for (const button of buttons) {
          const text = await button.evaluate(el => el.textContent?.toLowerCase() || '');
          const ariaLabel = await button.evaluate(el => el.getAttribute('aria-label')?.toLowerCase() || '');
          
          if (text.includes('join') || ariaLabel.includes('join')) {
            await button.click();
            console.log(`Join button clicked via text search: "${text}" / "${ariaLabel}"`);
            joinSuccessful = true;
            break;
          }
        }
      } catch (e) {
        console.log('Text-based join search failed:', e.message);
      }
    }
    
    if (!joinSuccessful) {
      console.log('No join button found, may already be in meeting or different UI');
      // Continue anyway - might already be joined or have different UI
    }
    
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    updateMetadata(recordingDir, { 
      status: 'recording',
      joinedAt: new Date().toISOString(),
      browserPid: browser.process()?.pid || 'unknown'
    });
    
    // Start audio recording
    const audioFile = path.join(recordingDir, `recording.${options.audioFormat || 'mp3'}`);
    
    const ffmpegArgs = [
      '-f', 'pulse',
      '-i', 'default',
      '-acodec', options.audioFormat === 'wav' ? 'pcm_s16le' : 'libmp3lame',
      ...(options.audioFormat === 'mp3' ? ['-ab', options.quality || '320k'] : []),
      '-ar', '44100',
      '-ac', '2',
      '-y',
      audioFile
    ];
    
    ffmpegProcess = spawn('ffmpeg', ffmpegArgs);
    
    ffmpegProcess.stderr.on('data', (data) => {
      fs.appendFileSync(`${recordingDir}/ffmpeg.log`, data);
    });
    
    updateMetadata(recordingDir, {
      status: 'recording_active',
      ffmpegPid: ffmpegProcess.pid,
      recordingStartTime: new Date().toISOString()
    });
    
    // Monitor for completion
    const maxDuration = options.maxDuration || 14400; // 4 hours default
    const startTime = Date.now();
    
    const monitorInterval = setInterval(async () => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      
      // Check max duration
      if (elapsed >= maxDuration) {
        console.log('Max duration reached, stopping...');
        clearInterval(monitorInterval);
        await stopRecording();
        return;
      }
      
      // Check if meeting is still active using multiple approaches
      try {
        const meetingIndicators = [
          '[jsname="CQylAd"]',           // Original selector
          '[data-meeting-title]',        // Meeting title
          '[aria-label*="participants"]', // Participants indicator
          '.google-meet-video-container', // Video container
          '[data-allocation-index]'       // Video tiles
        ];
        
        let meetingActive = false;
        for (const selector of meetingIndicators) {
          const elements = await page.$$(selector);
          if (elements.length > 0) {
            meetingActive = true;
            break;
          }
        }
        
        if (!meetingActive) {
          console.log('Meeting ended, stopping...');
          clearInterval(monitorInterval);
          await stopRecording();
          return;
        } else {
          console.log(`Recording active, elapsed: ${elapsed}s`);
        }
      } catch (e) {
        console.log('Error checking meeting status:', e.message);
        // Don't stop on single check error, continue monitoring
      }
    }, 30000); // Check every 30 seconds
    
    async function stopRecording() {
      const endTime = new Date().toISOString();
      const duration = Math.floor((Date.now() - startTime) / 1000);
      
      // Stop FFmpeg
      if (ffmpegProcess && !ffmpegProcess.killed) {
        ffmpegProcess.kill('SIGINT');
        
        // Wait for FFmpeg to finish
        await new Promise(resolve => {
          ffmpegProcess.on('close', resolve);
          setTimeout(resolve, 10000); // Force after 10 seconds
        });
      }
      
      // Close browser
      if (browser) {
        await browser.close();
      }
      
      updateMetadata(recordingDir, {
        status: 'processing',
        endTime,
        duration
      });
      
      // Process files
      await processRecordingFiles(recordingDir, options);
      
      updateMetadata(recordingDir, {
        status: 'completed',
        processedAt: new Date().toISOString()
      });
      
      console.log(`Recording ${recordingId} completed successfully`);
    }
    
  } catch (error) {
    console.error('Recording error:', error);
    
    // Cleanup on error
    if (ffmpegProcess && !ffmpegProcess.killed) {
      ffmpegProcess.kill('SIGKILL');
    }
    if (browser) {
      await browser.close();
    }
    
    updateMetadata(recordingDir, {
      status: 'failed',
      error: error.message,
      failedAt: new Date().toISOString()
    });
  }
}

function updateMetadata(recordingDir, updates) {
  const metadataPath = path.join(recordingDir, 'metadata.json');
  let metadata = {};
  
  if (fs.existsSync(metadataPath)) {
    metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
  }
  
  Object.assign(metadata, updates);
  fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
}

async function processRecordingFiles(recordingDir, options) {
  const { spawn } = require('child_process');
  
  // Find the main recording file
  const files = fs.readdirSync(recordingDir);
  const recordingFile = files.find(f => f.startsWith('recording.'));
  
  if (!recordingFile) {
    throw new Error('No recording file found');
  }
  
  const inputPath = path.join(recordingDir, recordingFile);
  const baseName = 'processed_recording';
  
  // Create multiple formats
  const formats = {
    mp3: `${baseName}.mp3`,
    wav: `${baseName}.wav`,
    flac: `${baseName}.flac`
  };
  
  const processPromises = Object.entries(formats).map(([format, fileName]) => {
    return new Promise((resolve, reject) => {
      const outputPath = path.join(recordingDir, fileName);
      
      let ffmpegArgs;
      if (format === 'mp3') {
        ffmpegArgs = ['-i', inputPath, '-acodec', 'libmp3lame', '-ab', '320k', '-y', outputPath];
      } else if (format === 'wav') {
        ffmpegArgs = ['-i', inputPath, '-acodec', 'pcm_s16le', '-y', outputPath];
      } else if (format === 'flac') {
        ffmpegArgs = ['-i', inputPath, '-acodec', 'flac', '-y', outputPath];
      }
      
      const process = spawn('ffmpeg', ffmpegArgs);
      
      process.on('close', (code) => {
        if (code === 0) {
          resolve(fileName);
        } else {
          reject(new Error(`FFmpeg failed for ${format}`));
        }
      });
      
      process.on('error', reject);
    });
  });
  
  try {
    await Promise.all(processPromises);
    
    // Get file sizes
    const fileSizes = {};
    Object.entries(formats).forEach(([format, fileName]) => {
      const filePath = path.join(recordingDir, fileName);
      if (fs.existsSync(filePath)) {
        fileSizes[format] = fs.statSync(filePath).size;
      }
    });
    
    updateMetadata(recordingDir, {
      files: formats,
      fileSizes
    });
    
  } catch (error) {
    console.error('File processing error:', error);
    throw error;
  }
}

// Run if called directly
if (require.main === module) {
  const [recordingId, meetUrl, optionsStr] = process.argv.slice(2);
  const options = JSON.parse(optionsStr || '{}');
  
  recordMeeting(recordingId, meetUrl, options)
    .then(() => process.exit(0))
    .catch(error => {
      console.error('Recording failed:', error);
      process.exit(1);
    });
}

module.exports = { recordMeeting };