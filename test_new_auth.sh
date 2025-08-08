#!/bin/bash

# Test the Google Meet Recorder with focus on App Password method
# Replace with your actual meeting URL and credentials

MEET_URL="https://meet.google.com/your-meeting-id"
EMAIL="your-email@gmail.com" 
APP_PASSWORD="your-app-password"  # 16-digit Google App Password
REGULAR_PASSWORD="your-regular-password"

echo "🔑 Testing Google Meet Recorder - App Password Focus"
echo "=================================================="
echo "📝 IMPORTANT: For best results, use Google App Passwords!"
echo "   Generate at: https://myaccount.google.com/apppasswords"
echo ""

# Test 1: App Password Authentication (RECOMMENDED - DEFAULT METHOD)
echo "🔑 Test 1: App Password Authentication (RECOMMENDED)"
echo "   ✅ Bypasses 2FA completely"
echo "   ✅ Most reliable for production use"
curl -X POST http://localhost:3000/api/record \
  -H "Content-Type: application/json" \
  -d "{
    \"meetUrl\": \"$MEET_URL\",
    \"email\": \"$EMAIL\",
    \"password\": \"$APP_PASSWORD\",
    \"method\": \"app_password\",
    \"options\": {\"audioFormat\": \"mp3\", \"maxDuration\": 120}
  }"

echo -e "\n\n"

# Test 2: Default Method (Now defaults to app_password)
echo "⚡ Test 2: Default Method (Uses App Password by Default)"
echo "   🔍 Automatically detects app password format"
curl -X POST http://localhost:3000/api/record \
  -H "Content-Type: application/json" \
  -d "{
    \"meetUrl\": \"$MEET_URL\",
    \"email\": \"$EMAIL\",
    \"password\": \"$APP_PASSWORD\",
    \"options\": {\"audioFormat\": \"mp3\", \"maxDuration\": 120}
  }"

echo -e "\n\n"

# Test 3: Regular Password with Smart Fallback
echo "🔐 Test 3: Regular Password (with App Password Fallback)"
echo "   🔄 Will try app password if regular authentication fails"
curl -X POST http://localhost:3000/api/record \
  -H "Content-Type: application/json" \
  -d "{
    \"meetUrl\": \"$MEET_URL\",
    \"email\": \"$EMAIL\",
    \"password\": \"$REGULAR_PASSWORD\",
    \"options\": {\"audioFormat\": \"mp3\", \"maxDuration\": 120}
  }"

echo -e "\n\n"

# Test 4: Direct Meet Authentication (Alternative)
echo "🎯 Test 4: Direct Meet Authentication (Alternative Method)"
echo "   ⚠️  May require 2FA confirmation"
curl -X POST http://localhost:3000/api/record \
  -H "Content-Type: application/json" \
  -d "{
    \"meetUrl\": \"$MEET_URL\",
    \"email\": \"$EMAIL\",
    \"password\": \"$REGULAR_PASSWORD\",
    \"method\": \"direct_meet\",
    \"options\": {\"audioFormat\": \"mp3\", \"maxDuration\": 120}
  }"

echo -e "\n\n"
echo "✅ Test script completed!"
echo ""
echo "📊 Check Results:"
echo "   • Debug Dashboard: http://localhost:3000/debug"  
echo "   • Look for detailed authentication screenshots"
echo "   • App password method should show: '🔑 Using Google App Password (bypasses 2FA)'"
echo ""
echo "💡 Tips:"
echo "   • App passwords are 16 characters (spaces optional)"
echo "   • Enable 2FA first at https://myaccount.google.com/security"  
echo "   • Generate app password at https://myaccount.google.com/apppasswords"