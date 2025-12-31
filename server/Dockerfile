# Use Node.js 18 Alpine image
FROM node:20.19.6-alpine3.23

# Set working directory
WORKDIR /app

# Install system dependencies (no longer need sqlite)
RUN apk add --no-cache \
    python3 \
    make \
    g++

# Copy package files
COPY server/package*.json ./

# Install dependencies (use npm install since we don't have package-lock.json)
RUN npm install --only=production --frozen-lockfile=false

# Copy source code
COPY server/ ./

# Create data directory structure
RUN mkdir -p /app/data/collections /app/uploads

# Create non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S opentasks -u 1001

# Change ownership of the app directory
RUN chown -R opentasks:nodejs /app
USER opentasks

# Expose port
EXPOSE 5000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node healthcheck.js

# Start the application
CMD ["node", "index.js"]
