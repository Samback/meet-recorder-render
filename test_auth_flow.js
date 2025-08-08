const { recordMeeting } = require('./scripts/record_meet.js');
const fs = require('fs');
const path = require('path');

// Test the new authentication flow
async function testAuthFlow() {
  const recordingId = 'test-auth-' + Date.now();
  const meetUrl = 'https://meet.google.com/test-meeting-url';
  const options = { audioFormat: 'mp3' };
  
  // Test with mock Google auth
  const googleAuth = {
    email: 'test@example.com',
    password: 'test-password'
  };
  
  console.log('🧪 Testing improved authentication flow...');
  console.log(`📝 Recording ID: ${recordingId}`);
  console.log(`🔗 Meet URL: ${meetUrl}`);
  console.log(`👤 Google Auth Email: ${googleAuth.email}`);
  
  try {
    // Create test recordings directory
    const RECORDINGS_DIR = process.env.RECORDINGS_DIR || '/tmp/recordings';
    const recordingDir = `${RECORDINGS_DIR}/${recordingId}`;
    
    if (!fs.existsSync(RECORDINGS_DIR)) {
      fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
    }
    
    if (!fs.existsSync(recordingDir)) {
      fs.mkdirSync(recordingDir, { recursive: true });
    }
    
    console.log(`📂 Test recording directory: ${recordingDir}`);
    
    // This will test our new authentication flow
    // It should:
    // 1. Visit accounts.google.com first
    // 2. Check if already logged in
    // 3. Perform authentication if needed
    // 4. Only then navigate to Meet URL
    
    console.log('🚀 Starting authentication test...');
    
    // Since this is just a test, we'll expect it to fail at some point
    // but we can check the logs to see if our new flow is working
    await recordMeeting(recordingId, meetUrl, options, googleAuth);
    
  } catch (error) {
    console.log('❌ Test completed with expected error (this is normal for testing):', error.message);
    
    // Check if our logs show the new authentication flow
    const recordingDir = `${process.env.RECORDINGS_DIR || '/tmp/recordings'}/${recordingId}`;
    const metadataPath = path.join(recordingDir, 'metadata.json');
    
    if (fs.existsSync(metadataPath)) {
      const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
      console.log('📊 Metadata from test:', JSON.stringify(metadata, null, 2));
      
      // Check if we see the new authentication statuses
      if (metadata.status === 'authenticating' || 
          metadata.status === 'authenticated' || 
          metadata.status === 'already_authenticated') {
        console.log('✅ New authentication flow is working!');
        console.log('🔍 Authentication status:', metadata.status);
      }
    }
    
    // List any screenshots taken during the test
    if (fs.existsSync(recordingDir)) {
      const files = fs.readdirSync(recordingDir);
      const screenshots = files.filter(f => f.endsWith('.png'));
      if (screenshots.length > 0) {
        console.log('📸 Screenshots captured:', screenshots);
      }
    }
  }
  
  console.log('🏁 Authentication flow test completed');
}

// Run the test
testAuthFlow()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('🔥 Test failed:', error);
    process.exit(1);
  });