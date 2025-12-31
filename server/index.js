const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs').promises;

// File-based routes
const taskRoutes = require('./routes/fileTasks');
const taskListRoutes = require('./routes/fileTaskLists');
const syncRoutes = require('./routes/fileSync');
const authRoutes = require('./routes/auth');
const preferencesRoutes = require('./routes/filePreferences');
const exportRoutes = require('./routes/fileExport');

const { setupWebSocket } = require('./websocket/server');
const { startNotificationScheduler } = require('./services/notifications');
const fileCalDAVSync = require('./services/fileCalDAVSync');
const fileManager = require('./services/fileManager');

const app = express();
const PORT = process.env.PORT || 5000;
const DATA_DIR = process.env.DATA_DIR || './data';

// Ensure data directory exists
async function ensureDataDirectory() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.mkdir(path.join(DATA_DIR, 'collections'), { recursive: true });
    await fs.mkdir(path.join(DATA_DIR, 'uploads'), { recursive: true });
    console.log(`Data directory ensured: ${DATA_DIR}`);
  } catch (error) {
    console.error('Error creating data directory:', error);
    process.exit(1);
  }
}

// Initialize file-based services
async function initializeServices() {
  try {
    console.log('Initializing file-based services...');
    
    // Initialize file manager
    await fileManager.ensureDataDirectories();
    console.log('File manager initialized');
    
    // Initialize CalDAV sync
    await fileCalDAVSync.initialize();
    console.log('FileCalDAV sync initialized');
    
    // Start notification scheduler
    startNotificationScheduler();
    console.log('Notification scheduler started');
    
    console.log('All services initialized successfully');
  } catch (error) {
    console.error('Error initializing services:', error);
    process.exit(1);
  }
}

// Middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "ws:", "wss:"],
    },
  },
}));

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true
}));

app.use(compression());
app.use(morgan('combined'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // limit each IP to 1000 requests per windowMs
  message: 'Too many requests from this IP, please try again later.'
});
app.use('/api/', limiter);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    version: '2.0-filebased'
  });
});

// API routes
app.use('/api/tasks', taskRoutes);
app.use('/api/tasklists', taskListRoutes);
app.use('/api/sync', syncRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/preferences', preferencesRoutes);
app.use('/api/export', exportRoutes);

// Serve static files
app.use('/uploads', express.static(path.join(DATA_DIR, 'uploads')));

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Start server
async function startServer() {
  try {
    await ensureDataDirectory();
    await initializeServices();
    
    const server = app.listen(PORT, '0.0.0.0', () => {
      console.log(`File-based OpenTasks server running on port ${PORT}`);
      console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`Data directory: ${DATA_DIR}`);
    });

    // Setup WebSocket
    setupWebSocket(server);
    console.log('WebSocket server initialized');

    // Graceful shutdown
    process.on('SIGTERM', () => {
      console.log('SIGTERM received, shutting down gracefully');
      server.close(() => {
        console.log('Server closed');
        process.exit(0);
      });
    });

    process.on('SIGINT', () => {
      console.log('SIGINT received, shutting down gracefully');
      server.close(() => {
        console.log('Server closed');
        process.exit(0);
      });
    });

  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();