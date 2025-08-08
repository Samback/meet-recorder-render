#!/bin/bash

# Test the new enhanced authentication methods
# Replace with your actual meeting URL and credentials

MEET_URL="https://meet.google.com/your-meeting-id"
EMAIL="your-email@gmail.com" 
PASSWORD="your-password"

echo "🧪 Testing Enhanced Authentication Methods for Google Meet Recorder"
echo "=================================================="

# Test 1: Direct Meet Authentication (Recommended)
echo "🎯 Test 1: Direct Meet Authentication"
curl -X POST http://localhost:3000/api/record \
  -H "Content-Type: application/json" \
  -d "{
    \"meetUrl\": \"$MEET_URL\",
    \"email\": \"$EMAIL\",
    \"password\": \"$PASSWORD\",
    \"method\": \"direct_meet\",
    \"options\": {\"audioFormat\": \"mp3\"}
  }"

echo -e "\n\n"

# Test 2: Persistent Session (Best for repeated recordings)
echo "💾 Test 2: Persistent Session Authentication"
curl -X POST http://localhost:3000/api/record \
  -H "Content-Type: application/json" \
  -d "{
    \"meetUrl\": \"$MEET_URL\",
    \"email\": \"$EMAIL\",
    \"password\": \"$PASSWORD\",
    \"method\": \"persistent_session\",
    \"options\": {\"audioFormat\": \"mp3\"}
  }"

echo -e "\n\n"

# Test 3: App Password (Best for 2FA accounts)
echo "🔑 Test 3: App Password Authentication"
echo "Note: Replace password with your Google App Password"
curl -X POST http://localhost:3000/api/record \
  -H "Content-Type: application/json" \
  -d "{
    \"meetUrl\": \"$MEET_URL\",
    \"email\": \"$EMAIL\",
    \"password\": \"your-app-specific-password\",
    \"method\": \"app_password\",
    \"options\": {\"audioFormat\": \"mp3\"}
  }"

echo -e "\n\n"

# Test 4: Default method (uses improved_direct)
echo "⚡ Test 4: Default Method (Simplified)"
curl -X POST http://localhost:3000/api/record \
  -H "Content-Type: application/json" \
  -d "{
    \"meetUrl\": \"$MEET_URL\",
    \"email\": \"$EMAIL\",
    \"password\": \"$PASSWORD\",
    \"options\": {\"audioFormat\": \"mp3\"}
  }"

echo -e "\n\n"
echo "✅ Test script completed!"
echo "Check the debug dashboard at http://localhost:3000/debug for detailed screenshots and logs"