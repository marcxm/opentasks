import React, { createContext, useContext, useState, useMemo, useEffect } from 'react';
import { ThemeProvider as MuiThemeProvider, createTheme } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { saveServerPreference, getServerPreferences } from './services/serverPreferences';
import { isAuthenticated } from './services/auth';

type ThemeMode = 'light' | 'dark';

interface AppContextType {
  themeMode: ThemeMode;
  toggleTheme: () => void;
}

const AppContext = createContext<AppContextType>({
  themeMode: 'light',
  toggleTheme: () => {},
});

export const useAppContext = () => useContext(AppContext);

export const AppProviders: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    return (localStorage.getItem('theme') as ThemeMode) || 'light';
  });

  // Load theme from server preferences after authentication
  useEffect(() => {
    const loadServerTheme = async () => {
      if (isAuthenticated()) {
        try {
          const prefs = await getServerPreferences();
          if (prefs.theme && (prefs.theme === 'light' || prefs.theme === 'dark')) {
            setThemeMode(prefs.theme as ThemeMode);
            localStorage.setItem('theme', prefs.theme);
          }
        } catch (err) {
          // Ignore errors, just use localStorage/default
          console.log('Could not load theme from server:', err);
        }
      }
    };
    
    loadServerTheme();
  }, []);

  const toggleTheme = () => {
    const newMode = themeMode === 'light' ? 'dark' : 'light';
    setThemeMode(newMode);
    localStorage.setItem('theme', newMode);
    // Save to server in background, don't wait
    saveServerPreference('theme', newMode).catch((err) => {
      console.error('Failed to save theme preference:', err);
    });
  };

  const theme = useMemo(
    () =>
      createTheme({
        palette: {
          mode: themeMode,
          primary: {
            main: themeMode === 'light' ? '#2196F3' : '#90caf9',
          },
          secondary: {
            main: themeMode === 'light' ? '#FF9800' : '#f48fb1',
          },
          background: {
            default: themeMode === 'light' ? '#f5f5f5' : '#121212',
            paper: themeMode === 'light' ? '#ffffff' : '#1e1e1e',
          },
        },
        typography: {
          fontFamily: 'Roboto, Arial, sans-serif',
        },
        components: {
          MuiButton: {
            styleOverrides: {
              root: {
                textTransform: 'none',
              },
            },
          },
        },
      }),
    [themeMode]
  );

  return (
    <AppContext.Provider value={{ themeMode, toggleTheme }}>
      <MuiThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </MuiThemeProvider>
    </AppContext.Provider>
  );
};
