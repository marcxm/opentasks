// Settings service for managing user preferences
export interface UserSettings {
  defaultTaskListId: string | null
  selectedListId: string | null
}

const SETTINGS_KEY = 'opentasks_user_settings'

export const defaultSettings: UserSettings = {
  defaultTaskListId: null,
  selectedListId: null
}

// Event emitter for settings changes
class SettingsEventEmitter {
  private listeners: (() => void)[] = []

  addListener(callback: () => void) {
    this.listeners.push(callback)
  }

  removeListener(callback: () => void) {
    this.listeners = this.listeners.filter(l => l !== callback)
  }

  emit() {
    this.listeners.forEach(callback => callback())
  }
}

export const settingsEventEmitter = new SettingsEventEmitter()

export const getSettings = (): UserSettings => {
  try {
    const stored = localStorage.getItem(SETTINGS_KEY)
    if (stored) {
      return { ...defaultSettings, ...JSON.parse(stored) }
    }
  } catch (error) {
    console.error('Error loading settings:', error)
  }
  return defaultSettings
}

export const saveSettings = (settings: Partial<UserSettings>): void => {
  try {
    const currentSettings = getSettings()
    const newSettings = { ...currentSettings, ...settings }
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(newSettings))
    // Emit change event
    settingsEventEmitter.emit()
  } catch (error) {
    console.error('Error saving settings:', error)
  }
}

export const getDefaultTaskListId = (): string | null => {
  return getSettings().defaultTaskListId
}

export const setDefaultTaskListId = (listId: string | null): void => {
  saveSettings({ defaultTaskListId: listId })
}

export const getSelectedListId = (): string | null => {
  return getSettings().selectedListId
}

export const setSelectedListId = (listId: string | null): void => {
  saveSettings({ selectedListId: listId })
}