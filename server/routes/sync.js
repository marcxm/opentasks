const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const { getDatabase } = require('../database/init');
const syncManager = require('../services/syncManager');

const router = express.Router();

// Note: CalDAV configuration is now loaded in the main server file

// Trigger CalDAV synchronization
router.post('/caldav', authenticateToken, async (req, res) => {
  try {
    const result = await syncManager.triggerManualSync();
    res.json({ 
      message: result.message,
      status: 'success'
    });
  } catch (error) {
    console.error('Error triggering CalDAV sync:', error);
    res.status(500).json({ 
      error: 'Failed to trigger CalDAV synchronization',
      message: error.message
    });
  }
});

// Get sync status
router.get('/status', authenticateToken, (req, res) => {
  try {
    const caldavSync = syncManager.getCalDAVSync();
    const status = caldavSync.getStatus();
    
    // Get last sync from database as well
    const db = getDatabase();
    const syncState = db.prepare(`
      SELECT data FROM sync_state 
      WHERE account_name = 'caldav' AND account_type = 'caldav'
    `).get();
    
    let lastSync = status.lastSync;
    if (syncState) {
      try {
        const syncData = JSON.parse(syncState.data);
        lastSync = syncData.lastSync || status.lastSync;
      } catch (error) {
        console.error('Error parsing sync state data:', error);
      }
    }
    
    res.json({
      caldav: {
        enabled: status.enabled,
        lastSync: lastSync,
        status: status.syncInProgress ? 'syncing' : (status.enabled ? 'configured' : 'not_configured'),
        serverUrl: status.serverUrl,
        syncInterval: status.syncInterval
      },
      lastSync: lastSync,
      nextSync: lastSync ? new Date(new Date(lastSync).getTime() + status.syncInterval).toISOString() : null
    });
  } catch (error) {
    console.error('Error getting sync status:', error);
    res.status(500).json({ error: 'Failed to get sync status' });
  }
});

// Get CalDAV configuration
router.get('/caldav/config', authenticateToken, (req, res) => {
  try {
    const db = getDatabase();
    const config = db.prepare(`
      SELECT data FROM sync_state 
      WHERE account_name = 'caldav_config' AND account_type = 'caldav'
    `).get();

    if (config) {
      const configData = JSON.parse(config.data);
      // Don't return the password for security
      const { password, ...safeConfig } = configData;
      res.json({
        ...safeConfig,
        syncInterval: Math.round(configData.syncInterval / 60000), // Convert milliseconds to minutes
        hasPassword: !!password
      });
    } else {
      res.json({
        serverUrl: '',
        username: '',
        collectionPath: '/opentasks/',
        syncInterval: 15,
        hasPassword: false
      });
    }
  } catch (error) {
    console.error('Error getting CalDAV configuration:', error);
    res.status(500).json({ error: 'Failed to get CalDAV configuration' });
  }
});

// Configure CalDAV settings
router.post('/caldav/configure', authenticateToken, (req, res) => {
  try {
    const { serverUrl, username, password, collectionPath, syncInterval } = req.body;

    if (!serverUrl || !username) {
      return res.status(400).json({ 
        error: 'Missing required fields',
        message: 'serverUrl and username are required'
      });
    }

    // Get existing configuration to preserve password if not provided
    const db = getDatabase();
    let existingConfig = null;
    try {
      const existing = db.prepare(`
        SELECT data FROM sync_state 
        WHERE account_name = 'caldav_config' AND account_type = 'caldav'
      `).get();
      if (existing) {
        existingConfig = JSON.parse(existing.data);
      }
    } catch (error) {
      // No existing config, that's fine
    }

    // Use existing password if new password is not provided
    const finalPassword = password || (existingConfig ? existingConfig.password : '');
    
    if (!finalPassword) {
      return res.status(400).json({ 
        error: 'Password required',
        message: 'Password is required for CalDAV configuration'
      });
    }

    // Convert sync interval from minutes to milliseconds
    const syncIntervalMs = parseInt(syncInterval) * 60 * 1000 || 900000; // Default to 15 minutes

    // Update environment variables
    process.env.CALDAV_SERVER_URL = serverUrl;
    process.env.CALDAV_USERNAME = username;
    process.env.CALDAV_PASSWORD = finalPassword;
    process.env.CALDAV_COLLECTION_PATH = collectionPath || '/opentasks/';
    process.env.CALDAV_SYNC_INTERVAL = syncIntervalMs.toString();

    // Persist configuration to database
    const configData = {
      serverUrl,
      username,
      password: finalPassword,
      collectionPath: collectionPath || '/opentasks/',
      syncInterval: syncIntervalMs,
      configuredAt: new Date().toISOString()
    };

    db.prepare(`
      INSERT OR REPLACE INTO sync_state (account_name, account_type, data)
      VALUES (?, ?, ?)
    `).run('caldav_config', 'caldav', JSON.stringify(configData));

    // Restart CalDAV sync with new settings
    const caldavSync = syncManager.restartCalDAVSync();

    res.json({ 
      message: 'CalDAV configuration updated successfully',
      status: 'success'
    });
  } catch (error) {
    console.error('Error configuring CalDAV:', error);
    res.status(500).json({ error: 'Failed to configure CalDAV' });
  }
});

// Test CalDAV connection
router.post('/caldav/test', authenticateToken, async (req, res) => {
  try {
    const { serverUrl, username, password } = req.body;

    if (!serverUrl || !username || !password) {
      return res.status(400).json({ 
        error: 'Missing required fields',
        message: 'serverUrl, username, and password are required'
      });
    }

    // Test connection by trying to discover collections
    const axios = require('axios');
    const response = await axios.request({
      method: 'PROPFIND',
      url: serverUrl,
      auth: { username, password },
      headers: {
        'Depth': '1',
        'Content-Type': 'application/xml'
      },
      data: `<?xml version="1.0" encoding="utf-8" ?>
        <D:propfind xmlns:D="DAV:">
          <D:prop>
            <D:resourcetype/>
            <D:displayname/>
          </D:prop>
        </D:propfind>`
    });

    res.json({ 
      message: 'CalDAV connection successful',
      status: 'success',
      serverInfo: {
        serverUrl,
        responseStatus: response.status
      }
    });
  } catch (error) {
    console.error('Error testing CalDAV connection:', error);
    res.status(500).json({ 
      error: 'CalDAV connection failed',
      message: error.message
    });
  }
});

module.exports = router;