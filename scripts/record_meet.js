const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

async function recordMeeting(recordingId, meetUrl, options, googleAuth = {}) {
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
    
    // Navigate to meet first
    console.log(`Navigating to: ${meetUrl}`);
    await page.goto(meetUrl, { waitUntil: 'networkidle2', timeout: 60000 });
    console.log('Page loaded successfully');
    
    // Handle Google authentication if credentials provided and login is required
    if (googleAuth.email && googleAuth.password) {
      console.log(`Checking if Google authentication is needed for: ${googleAuth.email}`);
      
      // Look for login indicators
      const loginIndicators = [
        'input[type="email"]',
        '#identifierId',
        'a[href*="accounts.google.com"]',
        "text=Sign in",
        "text=Use another account"
      ];
      
      let needsLogin = false;
      for (const indicator of loginIndicators) {
        try {
          if (indicator.startsWith('text=')) {
            const text = indicator.replace('text=', '');
            const found = await page.evaluate((searchText) => {
              return document.body.textContent.includes(searchText);
            }, text);
            if (found) {
              needsLogin = true;
              console.log(`Login needed - found: "${text}"`);
              break;
            }
          } else {
            const element = await page.$(indicator);
            if (element) {
              needsLogin = true;
              console.log(`Login needed - found selector: ${indicator}`);
              break;
            }
          }
        } catch (e) {
          // Continue checking
        }
      }
      
      if (needsLogin) {
        console.log(`Authenticating with Google account: ${googleAuth.email}`);
        updateMetadata(recordingDir, { 
          status: 'authenticating',
          authenticatingWith: googleAuth.email
        });
        
        try {
          // Take screenshot before authentication
          const authScreenshot = path.join(recordingDir, 'auth_before_screenshot.png');
          await page.screenshot({ path: authScreenshot, fullPage: true });
          console.log(`Auth screenshot saved: ${authScreenshot}`);
          
          // Check if we're already on a Google login page
          const currentUrl = page.url();
          const isOnGoogleLogin = currentUrl.includes('accounts.google.com');
          
          console.log(`Current URL: ${currentUrl}`);
          console.log(`Already on Google login page: ${isOnGoogleLogin}`);
          
          let signInClicked = false;
          
          // If not on Google login page, try to navigate there
          if (!isOnGoogleLogin) {
            console.log('Not on Google login page, trying to click sign in...');
            
            const signInSelectors = [
              'a[href*="accounts.google.com"]',
              '[aria-label*="Sign in"]',
              '[data-action="signin"]',
              'button[data-action="signin"]'
            ];
            
            // First try regular CSS selectors
            for (const selector of signInSelectors) {
              try {
                const element = await page.$(selector);
                if (element) {
                  // Check if element is still attached
                  const isAttached = await element.evaluate(el => el.isConnected);
                  if (isAttached) {
                    await element.click();
                    console.log(`Clicked sign in element: ${selector}`);
                    signInClicked = true;
                    break;
                  } else {
                    console.log(`Element detached: ${selector}`);
                  }
                }
              } catch (e) {
                console.log(`Sign in selector failed: ${selector} - ${e.message}`);
              }
            }
            
            // Try text-based search as fallback using evaluate instead of $x
            if (!signInClicked) {
              try {
                const signInTexts = ['Sign in', 'Sign In', 'SIGN IN', 'Login', 'LOG IN'];
                for (const text of signInTexts) {
                  const clickableElements = await page.evaluate((searchText) => {
                    const walker = document.createTreeWalker(
                      document.body,
                      NodeFilter.SHOW_TEXT,
                      null,
                      false
                    );
                    
                    const matchingElements = [];
                    let node;
                    
                    while (node = walker.nextNode()) {
                      if (node.textContent.trim() === searchText) {
                        let element = node.parentElement;
                        while (element) {
                          if (element.tagName === 'BUTTON' || element.tagName === 'A' || 
                              element.getAttribute('role') === 'button' ||
                              element.onclick || element.getAttribute('data-action')) {
                            const rect = element.getBoundingClientRect();
                            if (rect.width > 0 && rect.height > 0) {
                              matchingElements.push({
                                tagName: element.tagName,
                                text: element.textContent.trim(),
                                className: element.className,
                                id: element.id
                              });
                              break;
                            }
                          }
                          element = element.parentElement;
                        }
                      }
                    }
                    return matchingElements;
                  }, text);
                  
                  if (clickableElements.length > 0) {
                    // Try to click the first matching element
                    const clicked = await page.evaluate((searchText) => {
                      const walker = document.createTreeWalker(
                        document.body,
                        NodeFilter.SHOW_TEXT,
                        null,
                        false
                      );
                      
                      let node;
                      while (node = walker.nextNode()) {
                        if (node.textContent.trim() === searchText) {
                          let element = node.parentElement;
                          while (element) {
                            if (element.tagName === 'BUTTON' || element.tagName === 'A' || 
                                element.getAttribute('role') === 'button' ||
                                element.onclick || element.getAttribute('data-action')) {
                              const rect = element.getBoundingClientRect();
                              if (rect.width > 0 && rect.height > 0) {
                                element.click();
                                return true;
                              }
                            }
                            element = element.parentElement;
                          }
                        }
                      }
                      return false;
                    }, text);
                    
                    if (clicked) {
                      console.log(`Clicked sign in text: "${text}"`);
                      signInClicked = true;
                      break;
                    }
                  }
                }
              } catch (e) {
                console.log(`Text-based sign in search failed: ${e.message}`);
              }
            }
            
            if (signInClicked) {
              // Wait for navigation to login page
              console.log('Waiting for navigation to Google login page...');
              try {
                await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 });
              } catch (e) {
                console.log('Navigation timeout, but continuing - may have navigated');
              }
              
              // Extra wait for page to stabilize
              await new Promise(resolve => setTimeout(resolve, 2000));
            }
          } else {
            console.log('Already on Google login page');
          }
          
          // Take screenshot after any navigation
          console.log('Taking screenshot after potential navigation...');
          await new Promise(resolve => setTimeout(resolve, 3000));
          const afterClickScreenshot = path.join(recordingDir, 'auth_after_navigation_screenshot.png');
          await page.screenshot({ path: afterClickScreenshot, fullPage: true });
          console.log(`After navigation screenshot saved: ${afterClickScreenshot}`);
          
          // Check current URL again after potential navigation
          const newUrl = page.url();
          console.log(`Current URL after navigation: ${newUrl}`);
          
          // Try multiple selectors for email field with longer timeout
          const emailSelectors = [
            'input[type="email"]',
            '#identifierId',
            'input[name="identifier"]',
            'input[autocomplete="username"]',
            'input[autocomplete="email"]',
            'input[name="Email"]',
            '#Email',
            'input[id*="email"]',
            'input[id*="identifier"]'
          ];
          
          let emailField = null;
          
          // First wait for the page to be on a Google login URL
          let waitCount = 0;
          while (!page.url().includes('accounts.google.com') && waitCount < 10) {
            console.log(`Waiting for Google login page... (attempt ${waitCount + 1})`);
            await new Promise(resolve => setTimeout(resolve, 1000));
            waitCount++;
          }
          
          console.log(`Final URL before email field search: ${page.url()}`);
          
          for (const selector of emailSelectors) {
            try {
              console.log(`Looking for email field: ${selector}`);
              emailField = await page.waitForSelector(selector, { timeout: 8000 });
              if (emailField) {
                console.log(`Found email field: ${selector}`);
                break;
              }
            } catch (e) {
              console.log(`Email selector failed: ${selector} - ${e.message}`);
            }
          }
          
          if (!emailField) {
            // Take failure screenshot
            const failScreenshot = path.join(recordingDir, 'auth_email_field_not_found.png');
            await page.screenshot({ path: failScreenshot, fullPage: true });
            console.log(`Email field not found screenshot saved: ${failScreenshot}`);
            throw new Error('Could not find email input field after clicking sign in');
          }
          
          await emailField.click();
          await emailField.type(googleAuth.email);
          
          // Click next button
          const nextButton = await page.$('#identifierNext, button[type="submit"]');
          if (nextButton) {
            await nextButton.click();
          }
          
          // Wait for password field
          await page.waitForSelector('input[type="password"]', { timeout: 15000 });
          const passwordField = await page.$('input[type="password"]');
          await passwordField.click();
          await passwordField.type(googleAuth.password);
          
          // Click password next button
          const passwordNext = await page.$('#passwordNext, button[type="submit"]');
          if (passwordNext) {
            await passwordNext.click();
          }
          
          // Wait for navigation back to Meet
          await page.waitForFunction(
            (url) => window.location.href.includes('meet.google.com'),
            { timeout: 30000 },
            meetUrl
          );
          
          console.log('Google authentication completed, back on Meet page');
          updateMetadata(recordingDir, { 
            status: 'authenticated',
            authenticatedAt: new Date().toISOString()
          });
          
        } catch (error) {
          console.error('Google authentication failed:', error.message);
          updateMetadata(recordingDir, {
            status: 'auth_failed',
            error: `Google authentication failed: ${error.message}`,
            failedAt: new Date().toISOString()
          });
          throw new Error(`Authentication failed: ${error.message}`);
        }
      } else {
        console.log('No login required - already authenticated or anonymous access');
      }
    }
    
    // Join meeting logic - try multiple selector approaches
    console.log('Waiting for meeting interface...');
    
    // Wait for page to load completely
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Check for meeting access restrictions
    const accessDeniedSelectors = [
      "text=You can't join this video call",
      "text=Your meeting is safe",
      "text=No one can join a meeting unless invited",
      "[aria-label*=\"can't join\"]"
    ];
    
    let accessDenied = false;
    for (const selector of accessDeniedSelectors) {
      try {
        if (selector.startsWith('text=')) {
          const text = selector.replace('text=', '');
          const found = await page.evaluate((searchText) => {
            return document.body.textContent.includes(searchText);
          }, text);
          if (found) {
            accessDenied = true;
            console.log(`Access denied detected: "${text}"`);
            break;
          }
        } else {
          const element = await page.$(selector);
          if (element) {
            accessDenied = true;
            console.log(`Access denied detected with selector: ${selector}`);
            break;
          }
        }
      } catch (e) {
        // Continue checking other selectors
      }
    }
    
    if (accessDenied) {
      console.log('Meeting access is restricted - host approval or invitation required');
      updateMetadata(recordingDir, {
        status: 'access_denied',
        error: 'Meeting access restricted - host approval or invitation required',
        accessDeniedAt: new Date().toISOString()
      });
      
      // Take screenshot of access denied screen
      const accessDeniedScreenshot = path.join(recordingDir, 'access_denied_screenshot.png');
      await page.screenshot({ path: accessDeniedScreenshot, fullPage: true });
      console.log(`Access denied screenshot saved: ${accessDeniedScreenshot}`);
      
      // Wait a bit to see if access gets granted
      console.log('Waiting 30 seconds to see if host grants access...');
      await new Promise(resolve => setTimeout(resolve, 30000));
      
      // Check again if we can now access the meeting
      let accessGranted = false;
      for (const selector of accessDeniedSelectors) {
        try {
          if (selector.startsWith('text=')) {
            const text = selector.replace('text=', '');
            const found = await page.evaluate((searchText) => {
              return document.body.textContent.includes(searchText);
            }, text);
            if (!found) {
              accessGranted = true;
              break;
            }
          }
        } catch (e) {
          // Continue
        }
      }
      
      if (!accessGranted) {
        console.log('Access still denied after waiting - stopping recording');
        updateMetadata(recordingDir, {
          status: 'failed',
          error: 'Meeting access denied - host did not grant access within 30 seconds'
        });
        return; // Exit the function
      } else {
        console.log('Access granted! Continuing with meeting join...');
        updateMetadata(recordingDir, { 
          status: 'access_granted',
          accessGrantedAt: new Date().toISOString()
        });
      }
    }
    
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
      
      // Take screenshot for debugging
      try {
        const screenshotPath = path.join(recordingDir, 'debug_screenshot.png');
        await page.screenshot({ path: screenshotPath, fullPage: true });
        console.log(`Debug screenshot saved: ${screenshotPath}`);
        
        // Also log page content for debugging
        const pageContent = await page.content();
        fs.writeFileSync(path.join(recordingDir, 'page_content.html'), pageContent);
        console.log('Page HTML content saved for debugging');
        
        updateMetadata(recordingDir, {
          debugInfo: {
            screenshotTaken: true,
            screenshotPath: 'debug_screenshot.png',
            htmlContentSaved: true
          }
        });
      } catch (e) {
        console.log('Failed to take debug screenshot:', e.message);
      }
      
      // Continue anyway - might already be joined or have different UI
    }
    
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    updateMetadata(recordingDir, { 
      status: 'recording',
      joinedAt: new Date().toISOString(),
      browserPid: browser.process()?.pid || 'unknown'
    });
    
    // Start audio recording
    console.log('Starting audio recording...');
    const audioFile = path.join(recordingDir, `recording.${options.audioFormat || 'mp3'}`);
    console.log(`Audio file path: ${audioFile}`);
    
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
    
    console.log('FFmpeg command:', 'ffmpeg', ffmpegArgs.join(' '));
    ffmpegProcess = spawn('ffmpeg', ffmpegArgs);
    
    ffmpegProcess.on('spawn', () => {
      console.log('FFmpeg process started successfully');
    });
    
    ffmpegProcess.on('error', (error) => {
      console.error('FFmpeg spawn error:', error);
      updateMetadata(recordingDir, {
        status: 'failed',
        error: `FFmpeg failed to start: ${error.message}`,
        failedAt: new Date().toISOString()
      });
    });
    
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
  const [recordingId, meetUrl, optionsStr, googleAuthStr] = process.argv.slice(2);
  const options = JSON.parse(optionsStr || '{}');
  const googleAuth = JSON.parse(googleAuthStr || '{}');
  
  recordMeeting(recordingId, meetUrl, options, googleAuth)
    .then(() => process.exit(0))
    .catch(error => {
      console.error('Recording failed:', error);
      process.exit(1);
    });
}

module.exports = { recordMeeting };