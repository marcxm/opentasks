const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const { getDatabase } = require('../database/init');

const router = express.Router();

// Get user preferences
router.get('/', authenticateToken, (req, res) => {
  try {
    const db = getDatabase();
    const userId = req.user.userId;
    
    // Get user preferences from database
    const preferences = db.prepare(`
      SELECT selected_list_id, theme, language, notifications_enabled, hide_local_lists
      FROM user_preferences 
      WHERE user_id = ?
    `).get(userId);
    
    if (preferences) {
      res.json({
        selectedListId: preferences.selected_list_id,
        theme: preferences.theme || 'light',
        language: preferences.language || 'en',
        notificationsEnabled: Boolean(preferences.notifications_enabled),
        hideLocalLists: Boolean(preferences.hide_local_lists)
      });
    } else {
      // Return default preferences if none exist
      res.json({
        selectedListId: null,
        theme: 'light',
        language: 'en',
        notificationsEnabled: true,
        hideLocalLists: false
      });
    }
  } catch (error) {
    console.error('Error fetching user preferences:', error);
    res.status(500).json({ error: 'Failed to fetch preferences' });
  }
});

// Update user preferences
router.put('/', authenticateToken, (req, res) => {
  try {
    const db = getDatabase();
    const userId = req.user.userId;
    const { selectedListId, theme, language, notificationsEnabled, hideLocalLists } = req.body;
    
    // Check if preferences exist for this user
    const existing = db.prepare(`
      SELECT id FROM user_preferences WHERE user_id = ?
    `).get(userId);
    
    if (existing) {
      // Update existing preferences
      db.prepare(`
        UPDATE user_preferences 
        SET selected_list_id = ?, theme = ?, language = ?, notifications_enabled = ?, hide_local_lists = ?
        WHERE user_id = ?
      `).run(selectedListId, theme, language, notificationsEnabled ? 1 : 0, hideLocalLists ? 1 : 0, userId);
    } else {
      // Insert new preferences
      db.prepare(`
        INSERT INTO user_preferences (user_id, selected_list_id, theme, language, notifications_enabled, hide_local_lists)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(userId, selectedListId, theme, language, notificationsEnabled ? 1 : 0, hideLocalLists ? 1 : 0);
    }
    
    res.json({ message: 'Preferences updated successfully' });
  } catch (error) {
    console.error('Error updating user preferences:', error);
    res.status(500).json({ error: 'Failed to update preferences' });
  }
});

// Update specific preference
router.patch('/:key', authenticateToken, (req, res) => {
  try {
    const db = getDatabase();
    const userId = req.user.userId;
    const { key } = req.params;
    const { value } = req.body;
    
    // Map frontend keys to database columns
    const keyMap = {
      'selectedListId': 'selected_list_id',
      'theme': 'theme',
      'language': 'language',
      'notificationsEnabled': 'notifications_enabled',
      'hideLocalLists': 'hide_local_lists'
    };
    
    const dbKey = keyMap[key];
    if (!dbKey) {
      return res.status(400).json({ error: 'Invalid preference key' });
    }
    
    // Convert boolean values to integers for database storage
    let dbValue = value;
    if (typeof value === 'boolean') {
      dbValue = value ? 1 : 0;
    }
    
    // Check if preferences exist for this user
    const existing = db.prepare(`
      SELECT id FROM user_preferences WHERE user_id = ?
    `).get(userId);
    
    if (existing) {
      // Update existing preferences
      db.prepare(`
        UPDATE user_preferences 
        SET ${dbKey} = ?
        WHERE user_id = ?
      `).run(dbValue, userId);
    } else {
      // Insert new preferences with default values
      const defaults = {
        selected_list_id: null,
        theme: 'light',
        language: 'en',
        notifications_enabled: 1,
        hide_local_lists: 0
      };
      defaults[dbKey] = dbValue;
      
      db.prepare(`
        INSERT INTO user_preferences (user_id, selected_list_id, theme, language, notifications_enabled, hide_local_lists)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(userId, defaults.selected_list_id, defaults.theme, defaults.language, defaults.notifications_enabled, defaults.hide_local_lists);
    }
    
    res.json({ message: 'Preference updated successfully' });
  } catch (error) {
    console.error('Error updating preference:', error);
    res.status(500).json({ error: 'Failed to update preference' });
  }
});

module.exports = router;