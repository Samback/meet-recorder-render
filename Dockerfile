FROM node:18-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    wget gnupg ca-certificates procps curl \
    ffmpeg pulseaudio alsa-utils \
    && wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | apt-key add - \
    && echo "deb [arch=amd64] https://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list \
    && apt-get update \
    && apt-get install -y google-chrome-stable \
    && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy app source
COPY . .

# Create directories
RUN mkdir -p /tmp/recordings

# Create non-root user
RUN groupadd -r recorder && useradd -r -g recorder -G audio recorder \
    && chown -R recorder:recorder /app /tmp/recordings

# Switch to non-root user
USER recorder

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:${PORT:-3000}/health || exit 1

# Expose port
EXPOSE 3000

# Start application
CMD ["npm", "start"]