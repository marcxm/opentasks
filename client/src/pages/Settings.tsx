import React, { useState, useEffect } from 'react'
import {
  Box,
  Typography,
  Card,
  CardContent,
  List,
  ListItem,
  ListItemText,
  Divider,
  Switch,
  FormControlLabel,
  Button,
  Alert,
  CircularProgress,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
} from '@mui/material'
import {
  Settings as SettingsIcon,
  Sync as SyncIcon,
  Notifications as NotificationsIcon,
  Palette as PaletteIcon,
  VisibilityOff as VisibilityOffIcon,
  Download as DownloadIcon,
  Upload as UploadIcon,
} from '@mui/icons-material'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { syncApi, taskListApi, exportApi, calendarApi } from '../services/api'
import { getServerPreferences, saveServerPreference } from '../services/serverPreferences'
import { isAuthenticated } from '../services/auth'
import { useAppContext } from '../AppProviders'

const Settings: React.FC = () => {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { themeMode, toggleTheme } = useAppContext()
  const [hideLocalLists, setHideLocalLists] = useState<boolean>(false)
  const [isExporting, setIsExporting] = useState<boolean>(false)
  const [isImporting, setIsImporting] = useState<boolean>(false)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importMessage, setImportMessage] = useState<string>('')
  const [isCalendarExporting, setIsCalendarExporting] = useState<number | null>(null)
  const [isCalendarImporting, setIsCalendarImporting] = useState<boolean>(false)
  const [calendarImportFile, setCalendarImportFile] = useState<File | null>(null)
  const [calendarImportMessage, setCalendarImportMessage] = useState<string>('')
  const [selectedImportCalendarId, setSelectedImportCalendarId] = useState<number | null>(null)

  // Fetch sync status
  const { data: syncStatus, isLoading: syncLoading } = useQuery({
    queryKey: ['syncStatus'],
    queryFn: syncApi.getSyncStatus,
    refetchInterval: 30000, // Refresh every 30 seconds
  })

  // Fetch task lists
  const { data: taskLists } = useQuery({
    queryKey: ['taskLists'],
    queryFn: taskListApi.getTaskLists,
    enabled: isAuthenticated(),
  })
  
  console.log('=== SETTINGS RENDER ===')
  console.log('taskLists:', taskLists)
  console.log('selectedImportCalendarId:', selectedImportCalendarId)

  // Fetch server preferences with error handling
  const { data: serverPreferences, isLoading: preferencesLoading } = useQuery({
    queryKey: ['serverPreferences'],
    queryFn: getServerPreferences,
    retry: false,
    // Don't throw errors, just use default values
    throwOnError: false,
  })

  // Load hide local lists setting from server preferences
  useEffect(() => {
    if (serverPreferences) {
      setHideLocalLists(serverPreferences.hideLocalLists || false)
    }
  }, [serverPreferences])

  const handleHideLocalListsChange = async (checked: boolean) => {
    setHideLocalLists(checked)
    try {
      await saveServerPreference('hideLocalLists', checked)
      // Invalidate and refetch server preferences to update the UI
      await queryClient.invalidateQueries({ queryKey: ['serverPreferences'] })
    } catch (error) {
      console.error('Failed to save hide local lists setting:', error)
      // Revert the local state if server save failed
      setHideLocalLists(serverPreferences?.hideLocalLists || false)
    }
  }

  const handleExport = async () => {
    setIsExporting(true)
    try {
      const data = await exportApi.exportData()
      
      // Create and download the file
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `opentasks-export-${new Date().toISOString().split('T')[0]}.json`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
      
      setImportMessage('Export completed successfully!')
      setTimeout(() => setImportMessage(''), 3000)
    } catch (error) {
      console.error('Export failed:', error)
      setImportMessage('Export failed. Please try again.')
      setTimeout(() => setImportMessage(''), 5000)
    } finally {
      setIsExporting(false)
    }
  }

  const handleImportFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) {
      setImportFile(file)
      setImportMessage('')
    }
  }

  const handleImport = async () => {
    if (!importFile) return
    
    setIsImporting(true)
    try {
      const text = await importFile.text()
      const data = JSON.parse(text)
      
      const result = await exportApi.importData(data)
      
      if (result.success) {
        setImportMessage(`Import completed! Created ${result.results.tasks.created} tasks, ${result.results.taskLists.created} lists.`)
        // Refresh all data
        await queryClient.invalidateQueries({ queryKey: ['tasks'] })
        await queryClient.invalidateQueries({ queryKey: ['taskLists'] })
        await queryClient.invalidateQueries({ queryKey: ['categories'] })
      } else {
        setImportMessage('Import failed. Please check the file format.')
      }
    } catch (error) {
      console.error('Import failed:', error)
      setImportMessage('Import failed. Please check the file format.')
    } finally {
      setIsImporting(false)
      setImportFile(null)
      // Reset file input
      const fileInput = document.getElementById('import-file') as HTMLInputElement
      if (fileInput) fileInput.value = ''
    }
  }

  // Calendar export/import functions
  const handleCalendarExport = async (listId: number) => {
    setIsCalendarExporting(listId)
    try {
      console.log('Starting calendar export for listId:', listId)
      console.log('Auth token:', localStorage.getItem('authToken'))
      console.log('API base URL:', import.meta.env.VITE_API_URL || 'http://localhost:5004/api')
      
      const blob = await calendarApi.exportCalendar(listId.toString())
      
      console.log('Calendar export successful, blob size:', blob.size)
      console.log('Blob type:', blob.type)
      
      // Create download link
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      
      // Get calendar name for filename
      const calendar = taskLists?.find(list => list.id === listId)
      const filename = calendar ? `${calendar.name.replace(/[^a-zA-Z0-9]/g, '_')}.ics` : `calendar_${listId}.ics`
      link.download = filename
      
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
      
    } catch (error) {
      console.error('Calendar export error:', error)
      console.error('Error details:', error.response?.data, error.response?.status)
      console.error('Error message:', error.message)
      console.error('Error stack:', error.stack)
      alert(`Calendar export failed: ${error.message}. Please try again.`)
    } finally {
      setIsCalendarExporting(null)
    }
  }

  const handleCalendarImportFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) {
      setCalendarImportFile(file)
      setCalendarImportMessage('')
    }
  }

  const handleCalendarImport = async () => {
    if (!calendarImportFile || !selectedImportCalendarId) {
      setCalendarImportMessage('Please select a calendar to import to.')
      return
    }
    
    setIsCalendarImporting(true)
    try {
      const text = await calendarImportFile.text()
      const result = await calendarApi.importCalendar(text, selectedImportCalendarId)
      
      if (result.message) {
        const summary = result.summary || { total: result.taskCount || 0 }
        let message = `Calendar imported successfully! `
        if (summary.total > 0) {
          message += `Total: ${summary.total} components imported`
          if (summary.tasks > 0) message += ` (${summary.tasks} tasks`
          if (summary.events > 0) message += `, ${summary.events} events`
          if (summary.journals > 0) message += `, ${summary.journals} journals`
          if (summary.freebusy > 0) message += `, ${summary.freebusy} freebusy`
          if (summary.tasks > 0) message += ')'
        }
        setCalendarImportMessage(message)
        // Refresh task lists and tasks
        queryClient.invalidateQueries({ queryKey: ['taskLists'] })
        queryClient.invalidateQueries({ queryKey: ['tasks'] })
      } else {
        setCalendarImportMessage('Calendar import failed. Please check the file format.')
      }
    } catch (error) {
      console.error('Calendar import error:', error)
      const errorMessage = error.response?.data?.error || error.message || 'Unknown error occurred'
      setCalendarImportMessage(`Calendar import failed: ${errorMessage}`)
    } finally {
      setIsCalendarImporting(false)
      setCalendarImportFile(null)
      setSelectedImportCalendarId(null)
      // Reset file input
      const fileInput = document.getElementById('calendar-import-file') as HTMLInputElement
      if (fileInput) fileInput.value = ''
    }
  }

  const formatLastSync = (lastSync: string | null) => {
    if (!lastSync) return 'Never'
    return new Date(lastSync).toLocaleString()
  }

  const getSyncIntervalText = (syncInterval: number | null) => {
    if (!syncInterval) return 'Not configured'
    const minutes = Math.round(syncInterval / 60000)
    if (minutes < 60) return `Every ${minutes} minutes`
    const hours = Math.round(minutes / 60)
    return `Every ${hours} hour${hours > 1 ? 's' : ''}`
  }

  return (
    <Box>
      <Typography variant="h4" gutterBottom>
        Settings
      </Typography>

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            <VisibilityOffIcon sx={{ mr: 1, verticalAlign: 'middle' }} />
            List Management
          </Typography>
          <List>
            <ListItem>
              <ListItemText
                primary="Hide Local Lists"
                secondary="Hide local task lists from the interface (only show CalDAV lists)"
              />
              <Switch
                checked={hideLocalLists}
                onChange={(e) => handleHideLocalListsChange(e.target.checked)}
                disabled={preferencesLoading}
              />
            </ListItem>
          </List>
        </CardContent>
      </Card>

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            <DownloadIcon sx={{ mr: 1, verticalAlign: 'middle' }} />
            Data Export & Import
          </Typography>
          <List>
            <ListItem>
              <ListItemText
                primary="Export Data"
                secondary="Download all your tasks, lists, and categories as a JSON file"
              />
              <Button 
                variant="outlined" 
                size="small"
                onClick={handleExport}
                disabled={isExporting}
                startIcon={isExporting ? <CircularProgress size={16} /> : <DownloadIcon />}
              >
                {isExporting ? 'Exporting...' : 'Export'}
              </Button>
            </ListItem>
            <ListItem>
              <ListItemText
                primary="Import Data"
                secondary="Upload a previously exported JSON file to restore your data"
              />
              <Box display="flex" alignItems="center" gap={1}>
                <input
                  id="import-file"
                  type="file"
                  accept=".json"
                  onChange={handleImportFileChange}
                  style={{ display: 'none' }}
                />
                <Button 
                  variant="outlined" 
                  size="small"
                  onClick={() => document.getElementById('import-file')?.click()}
                  startIcon={<UploadIcon />}
                >
                  Choose File
                </Button>
                <Button 
                  variant="contained" 
                  size="small"
                  onClick={handleImport}
                  disabled={!importFile || isImporting}
                  startIcon={isImporting ? <CircularProgress size={16} /> : <UploadIcon />}
                >
                  {isImporting ? 'Importing...' : 'Import'}
                </Button>
              </Box>
            </ListItem>
          </List>
          {importMessage && (
            <Alert 
              severity={importMessage.includes('failed') ? 'error' : 'success'} 
              sx={{ mt: 2 }}
            >
              {importMessage}
            </Alert>
          )}
        </CardContent>
      </Card>

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            <DownloadIcon sx={{ mr: 1, verticalAlign: 'middle' }} />
            Calendar Export & Import
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Export individual calendars as ICS files or import ICS files to create new calendars
          </Typography>
          
          {/* Calendar Export Section */}
          <Typography variant="subtitle1" gutterBottom sx={{ mt: 2 }}>
            Export Calendars
          </Typography>
          <List>
            {taskLists?.map((list) => (
              <ListItem key={list.id}>
                <ListItemText
                  primary={list.name}
                  secondary={`${list.account_type === 'org.dmfs.account.LOCAL' ? 'Local' : 'CalDAV'} calendar`}
                />
                <Button 
                  variant="outlined" 
                  size="small"
                  onClick={() => handleCalendarExport(list.id)}
                  disabled={isCalendarExporting === list.id}
                  startIcon={isCalendarExporting === list.id ? <CircularProgress size={16} /> : <DownloadIcon />}
                >
                  {isCalendarExporting === list.id ? 'Exporting...' : 'Export ICS'}
                </Button>
              </ListItem>
            ))}
          </List>

          {/* Calendar Import Section */}
          <Typography variant="subtitle1" gutterBottom sx={{ mt: 3 }}>
            Import Calendar
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Import ICS file tasks into an existing calendar
          </Typography>
          
          {/* Calendar Selection */}
          <FormControl fullWidth sx={{ mb: 2 }}>
            <InputLabel>Select Calendar to Import To</InputLabel>
            <Select
              value={selectedImportCalendarId || ''}
              onChange={(e) => {
                const selectedId = Number(e.target.value)
                console.log('=== DROPDOWN SELECTION ===')
                console.log('Selected value:', e.target.value)
                console.log('Selected ID:', selectedId)
                console.log('Available taskLists:', taskLists?.map(l => ({ id: l.id, name: l.name })))
                setSelectedImportCalendarId(selectedId)
              }}
              label="Select Calendar to Import To"
            >
              {taskLists?.map((list) => (
                <MenuItem key={list.id} value={list.id}>
                  {list.name} {list.account_type === 'caldav' ? '(Remote)' : '(Local)'}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          
          <Box display="flex" alignItems="center" gap={1} sx={{ mb: 2 }}>
            <input
              id="calendar-import-file"
              type="file"
              accept=".ics"
              onChange={handleCalendarImportFileChange}
              style={{ display: 'none' }}
            />
            <Button 
              variant="outlined" 
              size="small"
              onClick={() => document.getElementById('calendar-import-file')?.click()}
              startIcon={<UploadIcon />}
            >
              Choose ICS File
            </Button>
              <Button
                variant="contained"
                size="small"
                onClick={handleCalendarImport}
                disabled={!calendarImportFile || !selectedImportCalendarId || isCalendarImporting}
                startIcon={isCalendarImporting ? <CircularProgress size={16} /> : <UploadIcon />}
              >
                {isCalendarImporting ? 'Importing...' : 'Import Calendar'}
              </Button>
          </Box>
          
          {calendarImportMessage && (
            <Alert 
              severity={calendarImportMessage.includes('failed') ? 'error' : 'success'} 
              sx={{ mt: 2 }}
            >
              {calendarImportMessage}
            </Alert>
          )}
        </CardContent>
      </Card>

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            <SyncIcon sx={{ mr: 1, verticalAlign: 'middle' }} />
            Synchronization
          </Typography>
          {syncLoading ? (
            <Box display="flex" alignItems="center" gap={2}>
              <CircularProgress size={20} />
              <Typography>Loading sync status...</Typography>
            </Box>
          ) : (
            <List>
              <ListItem>
                <ListItemText
                  primary="CalDAV Sync"
                  secondary={syncStatus?.caldav?.enabled ? 
                    `Connected to ${syncStatus.caldav.serverUrl}` : 
                    "Not configured"
                  }
                />
                <Button 
                  variant="outlined" 
                  size="small"
                  onClick={() => navigate('/settings/caldav')}
                >
                  {syncStatus?.caldav?.enabled ? 'Configure' : 'Setup'}
                </Button>
              </ListItem>
              <ListItem>
                <ListItemText
                  primary="Last Sync"
                  secondary={formatLastSync(syncStatus?.caldav?.lastSync)}
                />
              </ListItem>
              <ListItem>
                <ListItemText
                  primary="Sync Interval"
                  secondary={getSyncIntervalText(syncStatus?.caldav?.syncInterval)}
                />
              </ListItem>
              <ListItem>
                <ListItemText
                  primary="Status"
                  secondary={syncStatus?.caldav?.status === 'syncing' ? 
                    'Syncing...' : 
                    syncStatus?.caldav?.enabled ? 'Active' : 'Inactive'
                  }
                />
              </ListItem>
            </List>
          )}
        </CardContent>
      </Card>

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            <NotificationsIcon sx={{ mr: 1, verticalAlign: 'middle' }} />
            Notifications
          </Typography>
          <List>
            <ListItem>
              <ListItemText
                primary="Due Date Reminders"
                secondary="Get notified when tasks are due"
              />
              <Switch defaultChecked />
            </ListItem>
            <ListItem>
              <ListItemText
                primary="Start Date Alerts"
                secondary="Get notified when tasks are starting"
              />
              <Switch defaultChecked />
            </ListItem>
            <ListItem>
              <ListItemText
                primary="Overdue Alerts"
                secondary="Get notified about overdue tasks"
              />
              <Switch defaultChecked />
            </ListItem>
          </List>
        </CardContent>
      </Card>

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            <PaletteIcon sx={{ mr: 1, verticalAlign: 'middle' }} />
            Appearance
          </Typography>
          <List>
            <ListItem>
              <ListItemText
                primary="Theme"
                secondary={themeMode === 'light' ? 'Light theme' : 'Dark theme'}
              />
              <Button variant="outlined" size="small" onClick={toggleTheme}>
                Toggle Dark Mode
              </Button>
            </ListItem>
          </List>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            <SettingsIcon sx={{ mr: 1, verticalAlign: 'middle' }} />
            About
          </Typography>
          <List>
            <ListItem>
              <ListItemText
                primary="Version"
                secondary="2.0.0"
              />
            </ListItem>
            <ListItem>
              <ListItemText
                primary="License"
                secondary="Apache License 2.0"
              />
            </ListItem>
            <ListItem>
              <ListItemText
                primary="Source"
                secondary="Ported from Android OpenTasks"
              />
            </ListItem>
          </List>
        </CardContent>
      </Card>
    </Box>
  )
}

export default Settings