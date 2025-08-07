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
RUN npm ci --omit=dev

# Copy app source
COPY . .

# Create non-root user with home directory
RUN groupadd -r recorder && useradd -r -g recorder -G audio -m recorder

# Create directories with proper ownership
RUN mkdir -p /app/recordings /tmp/recordings /home/recorder/.local/share/applications \
    && chown -R recorder:recorder /app /tmp/recordings /home/recorder \
    && chmod -R 755 /tmp/recordings /home/recorder

# Switch to non-root user
USER recorder

# Health check with longer startup period
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD curl -f http://localhost:${PORT:-3000}/health || exit 1

# Expose port
EXPOSE 3000

# Start application
CMD ["npm", "start"]