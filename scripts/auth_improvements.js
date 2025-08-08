// Enhanced Google Meet Authentication Methods
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

class MeetAuthenticator {
  constructor(recordingDir) {
    this.recordingDir = recordingDir;
    this.screenshotCounter = 0;
  }

  // Helper function to check if user is truly authenticated (not just on a sign-in page)
  isAuthenticated(url) {
    // First exclude sign-in pages (these take priority)
    const isSignInPage = url.includes('signin/identifier') || 
                        url.includes('signin/v2/identifier') ||
                        url.includes('signin/v3/identifier') ||
                        url.includes('ServiceLogin') ||
                        url.includes('accounts.google.com/AccountChooser');
    
    if (isSignInPage) {
      console.log(`🔍 Sign-in page detected, not authenticated: ${url}`);
      return false;
    }
    
    // Then check for truly authenticated pages
    const authenticatedPages = url.includes('mail.google.com') ||
                              url.includes('myaccount.google.com') || 
                              url.includes('accounts.google.com/signin/continue') ||
                              url.includes('accounts.google.com/b/0/ManageAccount');
    
    if (authenticatedPages) {
      console.log(`✅ Authenticated page detected: ${url}`);
      return true;
    }
    
    console.log(`❓ Unknown authentication state for URL: ${url}`);
    return false;
  }

  async takeDebugScreenshot(page, stepName, description = '') {
    try {
      this.screenshotCounter++;
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `auth_${this.screenshotCounter.toString().padStart(2, '0')}_${stepName}_${timestamp}.png`;
      const screenshotPath = path.join(this.recordingDir, filename);
      
      await page.screenshot({ path: screenshotPath, fullPage: true });
      console.log(`📸 Auth screenshot ${this.screenshotCounter}: ${stepName} - ${filename}`);
      
      const pageInfo = {
        url: page.url(),
        title: await page.title().catch(() => 'Unknown'),
        timestamp: new Date().toISOString(),
        step: stepName,
        description: description
      };
      
      const infoPath = path.join(this.recordingDir, `auth_${this.screenshotCounter.toString().padStart(2, '0')}_${stepName}_info.json`);
      fs.writeFileSync(infoPath, JSON.stringify(pageInfo, null, 2));
      
      return filename;
    } catch (error) {
      console.log(`Failed to take auth screenshot for ${stepName}:`, error.message);
      return null;
    }
  }

  /**
   * METHOD 1: Cookie-based Authentication
   * Pre-authenticate in a separate session and save cookies
   */
  async authenticateWithCookies(page, email, password) {
    console.log('🍪 Starting cookie-based authentication...');
    
    try {
      // Go directly to Google accounts sign-in
      await page.goto('https://accounts.google.com/signin/v2/identifier?service=mail&passive=true&rm=false&continue=https%3A//mail.google.com/mail/', { 
        waitUntil: 'networkidle2', 
        timeout: 60000 
      });
      
      await this.takeDebugScreenshot(page, 'cookie_auth_start', 'Starting cookie-based authentication');
      
      // Enter email
      await page.waitForSelector('input[type="email"]', { timeout: 10000 });
      await page.type('input[type="email"]', email);
      await this.takeDebugScreenshot(page, 'cookie_email_entered', 'Email entered for cookie auth');
      
      // Click Next
      await page.click('#identifierNext');
      await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 });
      await this.takeDebugScreenshot(page, 'cookie_after_email', 'After email Next click');
      
      // Enter password
      await page.waitForSelector('input[type="password"]', { timeout: 10000 });
      await page.type('input[type="password"]', password);
      await this.takeDebugScreenshot(page, 'cookie_password_entered', 'Password entered');
      
      // Click Next
      await page.click('#passwordNext');
      await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });
      
      // Wait for authentication success
      await page.waitForFunction(() => {
        return window.location.href.includes('mail.google.com') || 
               document.querySelector('[data-ogsr-up]');
      }, { timeout: 60000 });
      
      await this.takeDebugScreenshot(page, 'cookie_auth_success', 'Cookie authentication successful');
      
      // Save cookies for future use
      const cookies = await page.cookies();
      const cookiePath = path.join(this.recordingDir, 'google_cookies.json');
      fs.writeFileSync(cookiePath, JSON.stringify(cookies, null, 2));
      console.log('✅ Cookies saved for future use');
      
      return { success: true, method: 'cookies', cookies };
      
    } catch (error) {
      await this.takeDebugScreenshot(page, 'cookie_auth_failed', `Cookie auth failed: ${error.message}`);
      throw new Error(`Cookie authentication failed: ${error.message}`);
    }
  }

  /**
   * METHOD 2: Direct Meet URL Authentication
   * Skip Gmail, go directly to Meet with auth challenge
   */
  async authenticateDirectToMeet(page, meetUrl, email, password) {
    console.log('🎯 Starting direct Meet authentication...');
    
    try {
      // Go directly to the Meet URL
      await page.goto(meetUrl, { waitUntil: 'networkidle2', timeout: 60000 });
      await this.takeDebugScreenshot(page, 'direct_meet_initial', 'Initial Meet URL load');
      
      // Check if authentication is required
      const needsAuth = await page.evaluate(() => {
        return document.body.textContent.includes('Sign in') || 
               document.querySelector('input[type="email"]') ||
               window.location.href.includes('accounts.google.com');
      });
      
      if (!needsAuth) {
        await this.takeDebugScreenshot(page, 'direct_already_authed', 'Already authenticated to Meet');
        return { success: true, method: 'direct_already_authenticated' };
      }
      
      // Handle sign-in if redirected
      if (page.url().includes('accounts.google.com')) {
        await this.takeDebugScreenshot(page, 'direct_auth_redirect', 'Redirected to accounts.google.com');
        
        // Follow the authentication flow
        return await this.performDirectAuth(page, email, password, meetUrl);
      }
      
      // Look for sign-in button on Meet page
      const signInSelectors = [
        'button:has-text("Sign in")',
        '[aria-label*="Sign in"]',
        'a[href*="accounts.google.com"]'
      ];
      
      let signInFound = false;
      for (const selector of signInSelectors) {
        try {
          const element = await page.$(selector);
          if (element) {
            await element.click();
            await this.takeDebugScreenshot(page, 'direct_signin_clicked', 'Clicked sign in on Meet page');
            signInFound = true;
            break;
          }
        } catch (e) {
          continue;
        }
      }
      
      if (signInFound) {
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 });
        return await this.performDirectAuth(page, email, password, meetUrl);
      }
      
      throw new Error('Could not find sign-in option on Meet page');
      
    } catch (error) {
      await this.takeDebugScreenshot(page, 'direct_auth_failed', `Direct auth failed: ${error.message}`);
      throw new Error(`Direct Meet authentication failed: ${error.message}`);
    }
  }

  async performDirectAuth(page, email, password, originalMeetUrl) {
    // Enter email
    await page.waitForSelector('input[type="email"]', { timeout: 10000 });
    await page.type('input[type="email"]', email);
    await this.takeDebugScreenshot(page, 'direct_email_entered', 'Email entered in direct auth');
    
    // Enhanced Next button clicking
    await this.clickNextButton(page, 'email');
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 });
    
    // Enter password
    await page.waitForSelector('input[type="password"]', { timeout: 10000 });
    await page.type('input[type="password"]', password);
    await this.takeDebugScreenshot(page, 'direct_password_entered', 'Password entered in direct auth');
    
    // Click Next for password
    await this.clickNextButton(page, 'password');
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });
    
    // Wait for successful authentication and potential redirect back to Meet
    await page.waitForFunction((meetUrl) => {
      const url = window.location.href;
      return url.includes('meet.google.com') || 
             url.includes('mail.google.com') ||
             document.querySelector('[data-ogsr-up]');
    }, { timeout: 60000 }, originalMeetUrl);
    
    await this.takeDebugScreenshot(page, 'direct_auth_complete', 'Direct authentication completed');
    
    // If not on Meet page, navigate back
    if (!page.url().includes('meet.google.com')) {
      await page.goto(originalMeetUrl, { waitUntil: 'networkidle2', timeout: 60000 });
      await this.takeDebugScreenshot(page, 'direct_back_to_meet', 'Navigated back to Meet after auth');
    }
    
    return { success: true, method: 'direct_to_meet' };
  }

  /**
   * METHOD 3: Session Persistence with User Data Directory
   * Use persistent browser profile to maintain login state
   */
  async authenticateWithPersistentSession(email, password, meetUrl) {
    console.log('💾 Starting persistent session authentication...');
    
    const userDataDir = path.join(this.recordingDir, '..', 'browser_profiles', email.replace(/[^a-zA-Z0-9]/g, '_'));
    
    // Ensure directory exists
    if (!fs.existsSync(userDataDir)) {
      fs.mkdirSync(userDataDir, { recursive: true });
    }
    
    const browser = await puppeteer.launch({
      headless: 'new',
      executablePath: '/usr/bin/google-chrome-stable',
      userDataDir: userDataDir, // Persistent profile
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-web-security',
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        '--allow-running-insecure-content',
        '--autoplay-policy=no-user-gesture-required',
      ],
      defaultViewport: { width: 1920, height: 1080 }
    });
    
    const page = await browser.newPage();
    
    try {
      // First, try to go directly to Meet to check if already authenticated
      await page.goto(meetUrl, { waitUntil: 'networkidle2', timeout: 60000 });
      await this.takeDebugScreenshot(page, 'persistent_meet_check', 'Checking Meet with persistent session');
      
      // Check if we're already authenticated
      const isAuthenticated = await page.evaluate(() => {
        return !document.body.textContent.includes('Sign in to join this meeting') &&
               !window.location.href.includes('accounts.google.com') &&
               (document.querySelector('[data-ogsr-up]') || 
                document.querySelector('[aria-label*="Join"]') ||
                document.querySelector('[jsname="Qx7uuf"]'));
      });
      
      if (isAuthenticated) {
        await this.takeDebugScreenshot(page, 'persistent_already_auth', 'Already authenticated with persistent session');
        return { success: true, method: 'persistent_already_authenticated', browser, page };
      }
      
      // If not authenticated, perform authentication
      console.log('Not authenticated, performing login with persistent session...');
      
      // Go to Gmail to authenticate (will be saved to persistent profile)
      await page.goto('https://accounts.google.com/signin/v2/identifier?service=mail&continue=https://mail.google.com', { 
        waitUntil: 'networkidle2', 
        timeout: 60000 
      });
      
      await this.performBasicAuth(page, email, password);
      
      // After authentication, go back to Meet
      await page.goto(meetUrl, { waitUntil: 'networkidle2', timeout: 60000 });
      await this.takeDebugScreenshot(page, 'persistent_auth_complete', 'Authentication complete, back on Meet');
      
      return { success: true, method: 'persistent_session_new', browser, page };
      
    } catch (error) {
      await this.takeDebugScreenshot(page, 'persistent_auth_failed', `Persistent auth failed: ${error.message}`);
      await browser.close();
      throw new Error(`Persistent session authentication failed: ${error.message}`);
    }
  }

  /**
   * METHOD 4: App Passwords (RECOMMENDED for production)
   * Use Google App Passwords to bypass 2FA completely
   */
  async authenticateWithAppPassword(page, email, appPassword) {
    console.log('🔑 Starting app password authentication (bypasses 2FA)...');
    
    try {
      // App passwords work through direct Google accounts authentication
      console.log('🎯 Navigating to Google accounts sign-in for app password auth...');
      
      await page.goto('https://accounts.google.com/signin/v2/identifier?service=mail&passive=true&rm=false&continue=https%3A//mail.google.com/mail/', { 
        waitUntil: 'networkidle2', 
        timeout: 60000 
      });
      
      await this.takeDebugScreenshot(page, 'app_password_start', 'Starting app password authentication');
      
      // Enter email
      console.log('📧 Entering email for app password authentication...');
      await page.waitForSelector('input[type="email"]', { timeout: 10000 });
      await page.type('input[type="email"]', email);
      await this.takeDebugScreenshot(page, 'app_password_email', 'Email entered for app password');
      
      // Click Next for email
      await this.clickNextButton(page, 'email');
      await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 });
      await this.takeDebugScreenshot(page, 'app_password_after_email', 'After email Next click');
      
      // Enter app password (this bypasses 2FA completely)
      console.log('🔑 Entering Google App Password (bypassing 2FA)...');
      await page.waitForSelector('input[type="password"]', { timeout: 10000 });
      await page.type('input[type="password"]', appPassword);
      await this.takeDebugScreenshot(page, 'app_password_entered', 'App password entered');
      
      // Click Next for password
      await this.clickNextButton(page, 'password');
      
      // App passwords should authenticate directly without 2FA prompts
      console.log('⏳ Waiting for app password authentication (should bypass 2FA)...');
      
      // Wait for successful authentication - app passwords skip 2FA
      await page.waitForFunction(() => {
        const url = window.location.href;
        // Check for sign-in pages (should NOT be considered authenticated)
        const isSignInPage = url.includes('signin/identifier') || 
                            url.includes('signin/v2/identifier') ||
                            url.includes('signin/v3/identifier') ||
                            url.includes('ServiceLogin') ||
                            url.includes('accounts.google.com/AccountChooser');
        
        if (isSignInPage) {
          return false; // Still on sign-in page, not authenticated
        }
        
        // Check for authenticated pages or account avatar
        return url.includes('mail.google.com') ||
               url.includes('myaccount.google.com') || 
               url.includes('accounts.google.com/signin/continue') ||
               url.includes('accounts.google.com/b/0/ManageAccount') ||
               document.querySelector('[data-ogsr-up]'); // Account avatar present
      }, { timeout: 45000 }); // Longer timeout for app password auth
      
      await this.takeDebugScreenshot(page, 'app_password_success', 'App password authentication successful');
      
      console.log('✅ App password authentication completed successfully!');
      return { success: true, method: 'app_password' };
      
    } catch (error) {
      console.error('❌ App password authentication failed:', error.message);
      await this.takeDebugScreenshot(page, 'app_password_failed', `App password auth failed: ${error.message}`);
      
      // Provide helpful error messages for app password issues
      if (error.message.includes('timeout')) {
        throw new Error(`App password authentication timed out. Please verify: 1) Your app password is correct, 2) Account has app passwords enabled, 3) No additional security prompts are blocking authentication.`);
      } else {
        throw new Error(`App password authentication failed: ${error.message}. Please verify your Google App Password is correct and hasn't expired.`);
      }
    }
  }

  async performBasicAuth(page, email, password) {
    // Enter email
    await page.waitForSelector('input[type="email"]', { timeout: 10000 });
    await page.type('input[type="email"]', email);
    await this.clickNextButton(page, 'email');
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 });
    
    // Enter password
    await page.waitForSelector('input[type="password"]', { timeout: 10000 });
    await page.type('input[type="password"]', password);
    await this.clickNextButton(page, 'password');
    
    // Wait for authentication success
    await page.waitForFunction(() => {
      return window.location.href.includes('mail.google.com') || 
             document.querySelector('[data-ogsr-up]');
    }, { timeout: 60000 });
  }

  async clickNextButton(page, context) {
    const nextSelectors = [
      '#identifierNext',
      '#passwordNext', 
      'button[type="submit"]',
      '[jsname="LgbsSe"]',
      'button:has-text("Next")',
      '[aria-label*="Next"]'
    ];
    
    let clicked = false;
    for (const selector of nextSelectors) {
      try {
        const button = await page.$(selector);
        if (button) {
          await button.click();
          console.log(`Clicked ${context} next button: ${selector}`);
          clicked = true;
          break;
        }
      } catch (e) {
        continue;
      }
    }
    
    if (!clicked) {
      // Text-based fallback
      const textClicked = await page.evaluate(() => {
        const elements = document.querySelectorAll('button, div[role="button"]');
        for (const el of elements) {
          const text = el.textContent?.toLowerCase() || '';
          if (text.includes('next') || text.includes('weiter') || text.includes('continue')) {
            el.click();
            return text;
          }
        }
        return false;
      });
      
      if (textClicked) {
        console.log(`Clicked ${context} next via text search: ${textClicked}`);
      } else {
        // Final fallback - press Enter
        const inputSelector = context === 'email' ? 'input[type="email"]' : 'input[type="password"]';
        await page.focus(inputSelector);
        await page.keyboard.press('Enter');
        console.log(`Pressed Enter on ${context} field as fallback`);
      }
    }
  }
}

module.exports = { MeetAuthenticator };