const express = require('express');
const filePreferences = require('../services/filePreferences');

const router = express.Router();

// Get user preferences
router.get('/', async (req, res) => {
  try {
    const preferences = await filePreferences.getPreferences();
    res.json(preferences);
  } catch (error) {
    console.error('Error fetching user preferences:', error);
    res.status(500).json({ error: 'Failed to fetch preferences' });
  }
});

// Update user preferences
router.put('/', async (req, res) => {
  try {
    const { selectedListId, theme, language, notificationsEnabled, hideLocalLists } = req.body;
    
    const preferences = await filePreferences.savePreferences({
      selectedListId,
      theme,
      language,
      notificationsEnabled,
      hideLocalLists
    });
    
    res.json({ message: 'Preferences updated successfully', preferences });
  } catch (error) {
    console.error('Error updating user preferences:', error);
    res.status(500).json({ error: 'Failed to update preferences' });
  }
});

// Update specific preference
router.patch('/:key', async (req, res) => {
  try {
    const { key } = req.params;
    const { value } = req.body;
    
    // Validate key
    const validKeys = ['selectedListId', 'theme', 'language', 'notificationsEnabled', 'hideLocalLists'];
    if (!validKeys.includes(key)) {
      return res.status(400).json({ error: 'Invalid preference key' });
    }
    
    const preferences = await filePreferences.savePreference(key, value);
    
    res.json({ message: 'Preference updated successfully', preferences });
  } catch (error) {
    console.error('Error updating preference:', error);
    res.status(500).json({ error: 'Failed to update preference' });
  }
});

module.exports = router;