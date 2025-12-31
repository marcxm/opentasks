// Server-side preferences service
import api from './api';

export interface UserPreferences {
  selectedListId: string | null;
  theme: string;
  language: string;
  notificationsEnabled: boolean;
  hideLocalLists: boolean;
}

// Get user preferences from server
export const getServerPreferences = async (): Promise<UserPreferences> => {
  try {
    const response = await api.get('/preferences');
    return response.data;
  } catch (error) {
    console.error('Failed to fetch server preferences:', error);
    return {
      selectedListId: null,
      theme: 'light',
      language: 'en',
      notificationsEnabled: true,
      hideLocalLists: false
    };
  }
};

// Save user preferences to server
export const saveServerPreferences = async (preferences: Partial<UserPreferences>): Promise<void> => {
  try {
    await api.put('/preferences', preferences);
  } catch (error) {
    console.error('Failed to save server preferences:', error);
    throw error;
  }
};

// Save a single preference
export const saveServerPreference = async (key: keyof UserPreferences, value: any): Promise<void> => {
  try {
    await api.patch(`/preferences/${key}`, { value });
  } catch (error) {
    console.error(`Failed to save server preference ${key}:`, error);
    throw error;
  }
};
