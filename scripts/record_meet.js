const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

async function recordMeeting(recordingId, meetUrl, options, googleAuth = {}) {
  const RECORDINGS_DIR = process.env.RECORDINGS_DIR || '/tmp/recordings';
  const recordingDir = `${RECORDINGS_DIR}/${recordingId}`;
  let browser, ffmpegProcess;
  let screenshotCounter = 0;
  
  // Helper function to take debug screenshots
  async function takeDebugScreenshot(page, stepName, description = '') {
    try {
      screenshotCounter++;
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `debug_${screenshotCounter.toString().padStart(2, '0')}_${stepName}_${timestamp}.png`;
      const screenshotPath = path.join(recordingDir, filename);
      
      await page.screenshot({ path: screenshotPath, fullPage: true });
      console.log(`📸 Debug screenshot ${screenshotCounter}: ${stepName} - ${filename}`);
      
      // Also save page URL and title for context
      const pageInfo = {
        url: page.url(),
        title: await page.title().catch(() => 'Unknown'),
        timestamp: new Date().toISOString(),
        step: stepName,
        description: description
      };
      
      const infoPath = path.join(recordingDir, `debug_${screenshotCounter.toString().padStart(2, '0')}_${stepName}_info.json`);
      fs.writeFileSync(infoPath, JSON.stringify(pageInfo, null, 2));
      
      return filename;
    } catch (error) {
      console.log(`Failed to take debug screenshot for ${stepName}:`, error.message);
      return null;
    }
  }
  
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
    
    // Handle Google authentication if credentials provided - visit accounts.google.com first
    let authenticationMode = 'anonymous'; // Default to anonymous
    let skipMeetNavigation = false;
    
    if (googleAuth.email && googleAuth.password) {
      console.log(`Starting Google authentication for: ${googleAuth.email}`);
      
      // First, visit Gmail to trigger authentication flow and handle redirects
      console.log('Starting authentication flow at gmail.com...');
      await page.goto('https://gmail.com/', { waitUntil: 'networkidle2', timeout: 60000 });
      
      // Wait for page to stabilize
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Take screenshot of Gmail landing page
      await takeDebugScreenshot(page, 'gmail_landing', 'Initial Gmail page load');
      
      // Check if we're already logged in by looking for account indicators
      const accountIndicators = [
        '[data-ogsr-up]',  // Google account avatar/profile
        '[aria-label*="Account"]',
        '[aria-label*="Profile"]',
        '.gb_Ab',  // Google bar account info
        '[jsname="jqHDEe"]'  // Account switcher
      ];
      
      let alreadyLoggedIn = false;
      for (const indicator of accountIndicators) {
        try {
          const element = await page.$(indicator);
          if (element) {
            alreadyLoggedIn = true;
            console.log(`Already logged in to Google - found indicator: ${indicator}`);
            break;
          }
        } catch (e) {
          // Continue checking
        }
      }
      
      // Also check if we're on Gmail or account management pages
      const currentUrl = page.url();
      if (currentUrl.includes('mail.google.com') ||
          currentUrl.includes('myaccount.google.com') || 
          currentUrl.includes('accounts.google.com/signin/continue') ||
          currentUrl.includes('accounts.google.com/b/0/ManageAccount')) {
        alreadyLoggedIn = true;
        console.log(`Already logged in - on authenticated page: ${currentUrl}`);
      }
      
      if (!alreadyLoggedIn) {
        // Need to login - look for sign in option
        const signInSelectors = [
          'a[href*="signin"]',
          '[aria-label*="Sign in"]',
          'button:has-text("Sign in")',
          '.gb_Sd'  // Sign in button in Google bar
        ];
        
        let signInFound = false;
        for (const selector of signInSelectors) {
          try {
            const element = await page.$(selector);
            if (element) {
              await element.click();
              console.log(`Clicked sign in element: ${selector}`);
              signInFound = true;
              break;
            }
          } catch (e) {
            console.log(`Sign in selector failed: ${selector} - ${e.message}`);
          }
        }
        
        // If no sign in button found, try text-based approach
        if (!signInFound) {
          try {
            const signInClicked = await page.evaluate(() => {
              const elements = document.querySelectorAll('a, button');
              for (const el of elements) {
                const text = el.textContent?.toLowerCase() || '';
                const ariaLabel = el.getAttribute('aria-label')?.toLowerCase() || '';
                if (text.includes('sign in') || ariaLabel.includes('sign in')) {
                  el.click();
                  return true;
                }
              }
              return false;
            });
            
            if (signInClicked) {
              console.log('Sign in clicked via text search');
              signInFound = true;
            }
          } catch (e) {
            console.log('Text-based sign in search failed:', e.message);
          }
        }
        
        if (signInFound) {
          // Wait for navigation to sign in page
          try {
            await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 });
          } catch (e) {
            console.log('Navigation timeout after sign in click, continuing...');
          }
          
          await new Promise(resolve => setTimeout(resolve, 2000));
          
          // Take screenshot after clicking sign in
          await takeDebugScreenshot(page, 'after_signin_click', 'Page after clicking sign in');
        }
        
        // Perform authentication
        updateMetadata(recordingDir, { 
          status: 'authenticating',
          authenticatingWith: googleAuth.email
        });
        
        try {
          // Take screenshot before looking for email field
          await takeDebugScreenshot(page, 'before_email_search', 'Page before searching for email field');
          
          // Look for email field
          const emailSelectors = [
            'input[type="email"]',
            '#identifierId',
            'input[name="identifier"]',
            'input[autocomplete="username"]',
            'input[autocomplete="email"]'
          ];
          
          let emailField = null;
          for (const selector of emailSelectors) {
            try {
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
            const failScreenshot = path.join(recordingDir, 'auth_email_field_not_found.png');
            await page.screenshot({ path: failScreenshot, fullPage: true });
            throw new Error('Could not find email input field on Google accounts page');
          }
          
          await emailField.click();
          await emailField.type(googleAuth.email);
          
          // Take screenshot after entering email
          await takeDebugScreenshot(page, 'email_entered', 'After entering email address');
          
          // Click next button - fix selector names
          const nextSelectors = [
            '#identifierNext', 
            'button[type="submit"]', 
            '[jsname="LgbsSe"]',
            'button:has-text("Next")',
            '[aria-label*="Next"]',
            '[data-tooltip*="Next"]'
          ];
          let nextClicked = false;
          for (const selector of nextSelectors) {
            try {
              const nextButton = await page.$(selector);
              if (nextButton) {
                await nextButton.click();
                nextClicked = true;
                console.log(`Clicked next button: ${selector}`);
                break;
              }
            } catch (e) {
              console.log(`Next button selector failed: ${selector}`);
            }
          }
          
          if (!nextClicked) {
            // Try text-based search for Next button
            try {
              const clicked = await page.evaluate(() => {
                const elements = document.querySelectorAll('button, div[role="button"], a');
                for (const el of elements) {
                  const text = el.textContent?.toLowerCase() || '';
                  const ariaLabel = el.getAttribute('aria-label')?.toLowerCase() || '';
                  if (text.includes('next') || ariaLabel.includes('next') || 
                      text.includes('weiter') || text.includes('continue')) { // Support German/other languages
                    el.click();
                    return text || ariaLabel;
                  }
                }
                return false;
              });
              
              if (clicked) {
                console.log(`Next button clicked via text search: "${clicked}"`);
                nextClicked = true;
              }
            } catch (e) {
              console.log('Text-based next search failed:', e.message);
            }
          }
          
          if (!nextClicked) {
            // Try Enter key as fallback
            await emailField.press('Enter');
            console.log('Pressed Enter on email field');
          }
          
          // Check for different possible next steps after email entry
          console.log('Waiting for next step after email entry...');
          await new Promise(resolve => setTimeout(resolve, 3000));
          
          // Take screenshot after clicking next
          await takeDebugScreenshot(page, 'after_email_next', 'Page after clicking Next on email step');
          
          // Check if we're on an account verification page instead of password
          const currentPageUrl = page.url();
          console.log(`Current URL after email: ${currentPageUrl}`);
          
          // Check for account verification indicators
          const verificationIndicators = [
            'text=Wie heißen Sie?', // German: "What is your name?"
            'text=What\'s your name?', // English equivalent
            'text=Create your Google Account',
            'text=Verify your account',
            'text=Additional verification required',
            'input[name="firstName"]',
            'input[name="lastName"]',
            '[aria-label*="First name"]',
            '[aria-label*="Last name"]'
          ];
          
          let isVerificationPage = false;
          for (const indicator of verificationIndicators) {
            try {
              if (indicator.startsWith('text=')) {
                const text = indicator.replace('text=', '');
                const found = await page.evaluate((searchText) => {
                  return document.body.textContent.includes(searchText);
                }, text);
                if (found) {
                  isVerificationPage = true;
                  console.log(`Account verification required - found: "${text}"`);
                  break;
                }
              } else {
                const element = await page.$(indicator);
                if (element) {
                  isVerificationPage = true;
                  console.log(`Account verification required - found selector: ${indicator}`);
                  break;
                }
              }
            } catch (e) {
              // Continue checking
            }
          }
          
          if (isVerificationPage) {
            console.log('Account verification/creation page detected - will proceed with anonymous access');
            const verificationScreenshot = path.join(recordingDir, 'account_verification_required.png');
            await page.screenshot({ path: verificationScreenshot, fullPage: true });
            
            updateMetadata(recordingDir, {
              status: 'verification_required_proceeding_anonymous',
              warning: 'Account verification required - Google is requesting additional account information. Proceeding with anonymous access to Meet.',
              verificationScreenshot: 'account_verification_required.png',
              proceedingAnonymous: true,
              verificationDetectedAt: new Date().toISOString()
            });
            
            console.log('⚠️  Account verification required - proceeding with anonymous access to Meet');
            // Set flag to skip further authentication steps
            const skipAuth = true;
            
            // Set flags to proceed with anonymous access
            authenticationMode = 'anonymous';
            skipMeetNavigation = true;
            
            // Navigate directly to Meet URL
            console.log(`Navigating to Meet with anonymous access: ${meetUrl}`);
            await page.goto(meetUrl, { waitUntil: 'networkidle2', timeout: 60000 });
            console.log('Meet page loaded successfully (anonymous access)');
            
            updateMetadata(recordingDir, { 
              status: 'ready_to_join_anonymous',
              meetPageLoadedAt: new Date().toISOString(),
              authenticationMode: 'anonymous'
            });
          }
          
          // Look for password field with multiple selectors and longer timeout
          await takeDebugScreenshot(page, 'before_password_search', 'Page before searching for password field');
          
          const passwordSelectors = [
            'input[type="password"]',
            '#password',
            'input[name="password"]',
            'input[autocomplete="current-password"]',
            '[aria-label*="password"]',
            '[aria-label*="Password"]'
          ];
          
          let passwordField = null;
          for (const selector of passwordSelectors) {
            try {
              console.log(`Looking for password field: ${selector}`);
              passwordField = await page.waitForSelector(selector, { timeout: 8000 });
              if (passwordField) {
                console.log(`Found password field: ${selector}`);
                break;
              }
            } catch (e) {
              console.log(`Password selector failed: ${selector} - ${e.message}`);
            }
          }
          
          if (!passwordField) {
            // Take a screenshot to see what page we're on
            const passwordFailScreenshot = path.join(recordingDir, 'password_field_not_found.png');
            await page.screenshot({ path: passwordFailScreenshot, fullPage: true });
            console.log(`Password field not found screenshot saved: ${passwordFailScreenshot}`);
            
            // Check for other possible pages we might be on
            const pageTitle = await page.title();
            const pageContent = await page.evaluate(() => document.body.textContent.slice(0, 500));
            
            updateMetadata(recordingDir, {
              status: 'password_field_not_found',
              error: `Could not find password field. Page title: "${pageTitle}". Content preview: "${pageContent.substring(0, 200)}..."`,
              passwordFailScreenshot: 'password_field_not_found.png',
              currentUrl: currentPageUrl,
              failedAt: new Date().toISOString()
            });
            
            throw new Error(`Could not find password field. This might be due to 2FA, account verification, or other security measures. Check the screenshot for details.`);
          }
          
          await passwordField.click();
          await passwordField.type(googleAuth.password);
          
          // Take screenshot after entering password
          await takeDebugScreenshot(page, 'password_entered', 'After entering password');
          
          // Click password next button
          const passwordNextSelectors = [
            '#passwordNext', 
            'button[type="submit"]', 
            '[jsname="LgbsSe"]',
            'button:has-text("Next")',
            '[aria-label*="Next"]',
            '[data-tooltip*="Next"]'
          ];
          let passwordNextClicked = false;
          for (const selector of passwordNextSelectors) {
            try {
              const passwordNext = await page.$(selector);
              if (passwordNext) {
                await passwordNext.click();
                passwordNextClicked = true;
                console.log(`Clicked password next: ${selector}`);
                break;
              }
            } catch (e) {
              console.log(`Password next selector failed: ${selector}`);
            }
          }
          
          if (!passwordNextClicked) {
            // Try text-based search for Next button
            try {
              const clicked = await page.evaluate(() => {
                const elements = document.querySelectorAll('button, div[role="button"], a');
                for (const el of elements) {
                  const text = el.textContent?.toLowerCase() || '';
                  const ariaLabel = el.getAttribute('aria-label')?.toLowerCase() || '';
                  if (text.includes('next') || ariaLabel.includes('next') || 
                      text.includes('weiter') || text.includes('continue')) { // Support German/other languages
                    el.click();
                    return text || ariaLabel;
                  }
                }
                return false;
              });
              
              if (clicked) {
                console.log(`Password Next button clicked via text search: "${clicked}"`);
                passwordNextClicked = true;
              }
            } catch (e) {
              console.log('Text-based password next search failed:', e.message);
            }
          }
          
          if (!passwordNextClicked) {
            // Try Enter key as fallback
            await passwordField.press('Enter');
            console.log('Pressed Enter on password field');
          }
          
          // Wait for authentication response - could be success, 2FA, or device confirmation
          console.log('Waiting for authentication response...');
          await new Promise(resolve => setTimeout(resolve, 5000));
          
          // Take screenshot after password submission
          await takeDebugScreenshot(page, 'after_password_submit', 'Page after submitting password');
          
          const authUrl = page.url();
          console.log(`Authentication response URL: ${authUrl}`);
          
          // Check for device confirmation prompts
          const deviceConfirmationIndicators = [
            'text=Confirm it\'s you',
            'text=2-Step Verification',
            'text=Choose how to confirm',
            'text=Get a notification',
            'text=Confirm on a familiar device',
            'text=Use your phone',
            '[aria-label*="confirm"]',
            '[data-action="selectChallenge"]',
            'button:has-text("Confirm")',
            'button:has-text("Get notification")'
          ];
          
          let needsDeviceConfirmation = false;
          let confirmationMethod = 'unknown';
          
          for (const indicator of deviceConfirmationIndicators) {
            try {
              if (indicator.startsWith('text=')) {
                const text = indicator.replace('text=', '');
                const found = await page.evaluate((searchText) => {
                  return document.body.textContent.includes(searchText);
                }, text);
                if (found) {
                  needsDeviceConfirmation = true;
                  confirmationMethod = text;
                  console.log(`Device confirmation required - found: "${text}"`);
                  break;
                }
              } else {
                const element = await page.$(indicator);
                if (element) {
                  needsDeviceConfirmation = true;
                  confirmationMethod = indicator;
                  console.log(`Device confirmation required - found selector: ${indicator}`);
                  break;
                }
              }
            } catch (e) {
              // Continue checking
            }
          }
          
          if (needsDeviceConfirmation) {
            console.log(`📱 Device confirmation required using: ${confirmationMethod}`);
            
            // Take dedicated screenshot for device confirmation
            await takeDebugScreenshot(page, 'device_confirmation', 'Device confirmation required page');
            
            const confirmationScreenshot = path.join(recordingDir, 'device_confirmation_required.png');
            await page.screenshot({ path: confirmationScreenshot, fullPage: true });
            
            updateMetadata(recordingDir, {
              status: 'device_confirmation_required',
              confirmationMethod: confirmationMethod,
              confirmationScreenshot: 'device_confirmation_required.png',
              waitingForConfirmation: true,
              confirmationStartedAt: new Date().toISOString()
            });
            
            // Look for and click "Get notification" or similar confirmation method
            const confirmationSelectors = [
              'button:has-text("Get notification")',
              'button:has-text("Confirm")',
              '[data-action="selectChallenge"]',
              'div[role="button"]:has-text("notification")',
              '[aria-label*="notification"]'
            ];
            
            let confirmationClicked = false;
            for (const selector of confirmationSelectors) {
              try {
                const element = await page.$(selector);
                if (element) {
                  await element.click();
                  console.log(`Clicked confirmation method: ${selector}`);
                  confirmationClicked = true;
                  break;
                }
              } catch (e) {
                console.log(`Confirmation selector failed: ${selector} - ${e.message}`);
              }
            }
            
            // If no specific button found, try text-based search
            if (!confirmationClicked) {
              try {
                const clicked = await page.evaluate(() => {
                  const elements = document.querySelectorAll('button, div[role="button"], a');
                  for (const el of elements) {
                    const text = el.textContent?.toLowerCase() || '';
                    if (text.includes('notification') || text.includes('confirm') || text.includes('familiar device')) {
                      el.click();
                      return text;
                    }
                  }
                  return false;
                });
                
                if (clicked) {
                  console.log(`Clicked confirmation via text search: "${clicked}"`);
                  confirmationClicked = true;
                }
              } catch (e) {
                console.log('Text-based confirmation search failed:', e.message);
              }
            }
            
            if (confirmationClicked) {
              console.log('⏳ Waiting for device confirmation... Please check your phone/device');
              updateMetadata(recordingDir, {
                status: 'waiting_for_device_confirmation',
                message: 'Please confirm the login on your phone or trusted device',
                waitingStartedAt: new Date().toISOString()
              });
              
              // Wait for confirmation completion (up to 5 minutes)
              let confirmationComplete = false;
              const maxWaitTime = 5 * 60 * 1000; // 5 minutes
              const startWait = Date.now();
              
              while (Date.now() - startWait < maxWaitTime && !confirmationComplete) {
                console.log(`⏳ Still waiting for device confirmation... ${Math.floor((Date.now() - startWait) / 1000)}s elapsed`);
                await new Promise(resolve => setTimeout(resolve, 10000)); // Check every 10 seconds
                
                // Check if we've been redirected to Gmail or authenticated page
                const currentUrl = page.url();
                if (currentUrl.includes('mail.google.com') ||
                    currentUrl.includes('myaccount.google.com') ||
                    currentUrl.includes('accounts.google.com/signin/continue')) {
                  confirmationComplete = true;
                  console.log('✅ Device confirmation completed successfully!');
                  break;
                }
                
                // Also check for account avatar presence
                try {
                  const avatar = await page.$('[data-ogsr-up]');
                  if (avatar) {
                    confirmationComplete = true;
                    console.log('✅ Device confirmation completed - account avatar detected!');
                    break;
                  }
                } catch (e) {
                  // Continue waiting
                }
              }
              
              if (!confirmationComplete) {
                const timeoutScreenshot = path.join(recordingDir, 'device_confirmation_timeout.png');
                await page.screenshot({ path: timeoutScreenshot, fullPage: true });
                
                updateMetadata(recordingDir, {
                  status: 'device_confirmation_timeout',
                  error: 'Device confirmation timed out after 5 minutes',
                  timeoutScreenshot: 'device_confirmation_timeout.png',
                  timedOutAt: new Date().toISOString()
                });
                
                throw new Error('Device confirmation timed out after 5 minutes. Please try again and confirm quickly on your device.');
              }
            } else {
              console.log('⚠️  Could not find confirmation button, proceeding anyway...');
            }
          }
          
          // Final check for successful authentication
          await page.waitForFunction(
            () => {
              const url = window.location.href;
              return url.includes('mail.google.com') ||
                     url.includes('myaccount.google.com') || 
                     url.includes('accounts.google.com/signin/continue') ||
                     url.includes('accounts.google.com/b/0/ManageAccount') ||
                     document.querySelector('[data-ogsr-up]'); // Account avatar present
            },
            { timeout: 30000 }
          );
          
          // Take screenshot of successful authentication
          await takeDebugScreenshot(page, 'auth_success', 'Successfully authenticated to Google');
          
          console.log('✅ Google authentication completed successfully!');
          authenticationMode = 'authenticated';
          updateMetadata(recordingDir, { 
            status: 'authenticated',
            authenticatedAt: new Date().toISOString(),
            finalAuthUrl: page.url()
          });
          
        } catch (error) {
          console.error('Google authentication failed:', error.message);
          const authFailScreenshot = path.join(recordingDir, 'auth_failed_screenshot.png');
          await page.screenshot({ path: authFailScreenshot, fullPage: true });
          updateMetadata(recordingDir, {
            status: 'auth_failed',
            error: `Google authentication failed: ${error.message}`,
            failedAt: new Date().toISOString()
          });
          throw new Error(`Authentication failed: ${error.message}`);
        }
      } else {
        console.log('Already authenticated with Google account, proceeding to Meet...');
        authenticationMode = 'already_authenticated';
        updateMetadata(recordingDir, { 
          status: 'already_authenticated',
          authenticatedAt: new Date().toISOString()
        });
      }
    }
    
    // Navigate to Meet URL if we haven't already (due to verification fallback)
    if (!skipMeetNavigation) {
      console.log(`Navigating to Meet with ${authenticationMode} session: ${meetUrl}`);
      await page.goto(meetUrl, { waitUntil: 'networkidle2', timeout: 60000 });
      console.log('Meet page loaded successfully');
      
      // Take screenshot of Meet page after loading
      await takeDebugScreenshot(page, 'meet_loaded', 'Google Meet page loaded');
      
      updateMetadata(recordingDir, { 
        status: 'ready_to_join',
        meetPageLoadedAt: new Date().toISOString(),
        authenticationMode: authenticationMode
      });
    }
    
    // Join meeting logic - try multiple selector approaches
    console.log('Waiting for meeting interface...');
    
    // Wait for page to load completely
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Take screenshot before checking for access restrictions
    await takeDebugScreenshot(page, 'before_access_check', 'Before checking meeting access restrictions');
    
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
    
    // Take screenshot before camera/join interactions
    await takeDebugScreenshot(page, 'before_camera_join', 'Before camera disable and join button search');
    
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
          // Take screenshot after camera disable
          await takeDebugScreenshot(page, 'camera_disabled', 'After disabling camera');
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
          // Take screenshot after successful join click
          await takeDebugScreenshot(page, 'join_clicked', 'After clicking join button');
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
            // Take screenshot after text-based join click
            await takeDebugScreenshot(page, 'join_text_clicked', 'After clicking join via text search');
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
    
    // Take final screenshot before starting recording
    await takeDebugScreenshot(page, 'ready_to_record', 'Meeting joined, ready to start recording');
    
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