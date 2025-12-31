const fs = require('fs').promises;
const path = require('path');

const PREFERENCES_FILE = '/app/data/preferences.json';

// Default preferences
const defaultPreferences = {
  selectedListId: null,
  theme: 'light',
  language: 'en',
  notificationsEnabled: true,
  hideLocalLists: false
};

// Ensure preferences file exists
async function ensurePreferencesFile() {
  try {
    await fs.access(PREFERENCES_FILE);
  } catch (error) {
    // File doesn't exist, create it with default values
    await fs.writeFile(PREFERENCES_FILE, JSON.stringify(defaultPreferences, null, 2));
  }
}

// Get all preferences
async function getPreferences() {
  try {
    await ensurePreferencesFile();
    const data = await fs.readFile(PREFERENCES_FILE, 'utf8');
    return { ...defaultPreferences, ...JSON.parse(data) };
  } catch (error) {
    console.error('Error reading preferences:', error);
    return defaultPreferences;
  }
}

// Save all preferences
async function savePreferences(preferences) {
  try {
    await ensurePreferencesFile();
    const currentPreferences = await getPreferences();
    const updatedPreferences = { ...currentPreferences, ...preferences };
    await fs.writeFile(PREFERENCES_FILE, JSON.stringify(updatedPreferences, null, 2));
    return updatedPreferences;
  } catch (error) {
    console.error('Error saving preferences:', error);
    throw error;
  }
}

// Save a single preference
async function savePreference(key, value) {
  try {
    const currentPreferences = await getPreferences();
    currentPreferences[key] = value;
    await savePreferences(currentPreferences);
    return currentPreferences;
  } catch (error) {
    console.error(`Error saving preference ${key}:`, error);
    throw error;
  }
}

module.exports = {
  getPreferences,
  savePreferences,
  savePreference
};