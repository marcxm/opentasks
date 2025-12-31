const express = require('express');
const fileCalDAVSync = require('../services/fileCalDAVSync');

const router = express.Router();

// Trigger CalDAV sync
router.post('/caldav', async (req, res) => {
  try {
    console.log('Manual CalDAV sync triggered');
    console.log('fileCalDAVSync object:', fileCalDAVSync);
    console.log('fileCalDAVSync.sync method:', typeof fileCalDAVSync.sync);
    
    if (!fileCalDAVSync || typeof fileCalDAVSync.sync !== 'function') {
      throw new Error('fileCalDAVSync is not properly initialized');
    }
    
    await fileCalDAVSync.sync();
    res.json({ message: 'CalDAV sync completed successfully' });
  } catch (error) {
    console.error('Error during CalDAV sync:', error);
    res.status(500).json({ error: 'CalDAV sync failed', details: error.message });
  }
});

// Get sync status
router.get('/status', (req, res) => {
  try {
    res.json({
      caldav: {
        enabled: fileCalDAVSync.isEnabled,
        inProgress: fileCalDAVSync.syncInProgress,
        lastSync: fileCalDAVSync.lastSync,
        status: fileCalDAVSync.isEnabled ? 'configured' : 'not_configured',
        serverUrl: fileCalDAVSync.serverUrl || null,
        syncInterval: 15 * 60 * 1000 // 15 minutes in milliseconds
      }
    });
  } catch (error) {
    console.error('Error getting sync status:', error);
    res.status(500).json({ error: 'Failed to get sync status' });
  }
});

// Get CalDAV configuration
router.get('/caldav/config', (req, res) => {
  try {
    res.json({
      serverUrl: fileCalDAVSync.serverUrl || '',
      username: fileCalDAVSync.username || '',
      collectionPath: fileCalDAVSync.collectionPath || '/calendars',
      syncInterval: 15,
      hasPassword: !!fileCalDAVSync.password
    });
  } catch (error) {
    console.error('Error getting CalDAV config:', error);
    res.status(500).json({ error: 'Failed to get CalDAV configuration' });
  }
});

// Configure CalDAV
router.post('/caldav/configure', async (req, res) => {
  try {
    const { serverUrl, username, password, collectionPath } = req.body;
    
    if (!serverUrl || !username || !password) {
      return res.status(400).json({ 
        error: 'Server URL, username, and password are required' 
      });
    }

    await fileCalDAVSync.configure(serverUrl, username, password, collectionPath || '/calendars');
    
    res.json({ 
      message: 'CalDAV configuration saved successfully',
      enabled: fileCalDAVSync.isEnabled
    });
  } catch (error) {
    console.error('Error configuring CalDAV:', error);
    res.status(500).json({ error: 'Failed to configure CalDAV', details: error.message });
  }
});

// Test CalDAV connection
router.post('/caldav/test', async (req, res) => {
  try {
    const { serverUrl, username, password, collectionPath } = req.body;
    
    if (!serverUrl || !username || !password) {
      return res.status(400).json({ 
        error: 'Server URL, username, and password are required' 
      });
    }

    // Create temporary sync instance for testing
    const testSync = require('../services/fileCalDAVSync');
    await testSync.configure(serverUrl, username, password, collectionPath || '/calendars');
    
    const result = await testSync.testConnection();
    
    res.json(result);
  } catch (error) {
    console.error('Error testing CalDAV connection:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Connection test failed', 
      details: error.message 
    });
  }
});

module.exports = router;