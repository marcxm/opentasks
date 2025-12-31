import React, { useState } from 'react'
import {
  Box,
  Typography,
  Card,
  CardContent,
  TextField,
  Button,
  Alert,
  CircularProgress,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Switch,
  FormControlLabel,
  Divider,
  Chip,
} from '@mui/material'
import {
  Sync as SyncIcon,
  CheckCircle as CheckCircleIcon,
  Error as ErrorIcon,
  Settings as SettingsIcon,
} from '@mui/icons-material'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm, Controller } from 'react-hook-form'
import toast from 'react-hot-toast'

import { syncApi } from '../services/api'

interface CalDAVConfig {
  serverUrl: string
  username: string
  password: string
  collectionPath: string
  syncInterval: number
  autoSync: boolean
}

const CalDAVSettings: React.FC = () => {
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null)
  const queryClient = useQueryClient()

  const { control, handleSubmit, watch, setValue, reset } = useForm<CalDAVConfig>({
    defaultValues: {
      serverUrl: '',
      username: '',
      password: '',
      collectionPath: '/calendars',
      syncInterval: 15,
      autoSync: true,
    },
  })

  // Fetch sync status
  const { data: syncStatus, isLoading: statusLoading } = useQuery({
    queryKey: ['syncStatus'],
    queryFn: syncApi.getSyncStatus,
    refetchInterval: 30000, // Refresh every 30 seconds
  })

  // Fetch CalDAV configuration
  const { data: caldavConfig, isLoading: configLoading } = useQuery({
    queryKey: ['caldavConfig'],
    queryFn: syncApi.getCalDAVConfig,
  })

  // Update form when configuration loads
  React.useEffect(() => {
    if (caldavConfig) {
      reset({
        serverUrl: caldavConfig.serverUrl || '',
        username: caldavConfig.username || '',
        password: '', // Don't populate password for security
        collectionPath: caldavConfig.collectionPath || '/calendars',
        syncInterval: caldavConfig.syncInterval || 15,
        autoSync: true,
      })
    }
  }, [caldavConfig, reset])

  // Test connection mutation
  const testConnectionMutation = useMutation({
    mutationFn: ({ serverUrl, username, password }: { serverUrl: string; username: string; password: string }) =>
      syncApi.testCalDAVConnection(serverUrl, username, password),
    onSuccess: (data) => {
      setTestResult({ success: true, message: data.message })
      toast.success('CalDAV connection successful!')
    },
    onError: (error: any) => {
      setTestResult({ success: false, message: error.response?.data?.message || 'Connection failed' })
      toast.error('CalDAV connection failed')
    },
  })

  // Configure CalDAV mutation
  const configureMutation = useMutation({
    mutationFn: (config: CalDAVConfig) => syncApi.configureCalDAV(config),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['syncStatus'] })
      queryClient.invalidateQueries({ queryKey: ['caldavConfig'] })
      toast.success('CalDAV configuration saved!')
    },
    onError: () => {
      toast.error('Failed to save CalDAV configuration')
    },
  })

  // Trigger sync mutation
  const syncMutation = useMutation({
    mutationFn: syncApi.triggerCalDAVSync,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['syncStatus'] })
      toast.success('Sync triggered successfully!')
    },
    onError: () => {
      toast.error('Failed to trigger sync')
    },
  })

  const onSubmit = (data: CalDAVConfig) => {
    configureMutation.mutate(data)
  }

  const handleTestConnection = () => {
    const formData = watch()
    if (!formData.serverUrl || !formData.username || !formData.password) {
      toast.error('Please fill in all required fields')
      return
    }
    testConnectionMutation.mutate({
      serverUrl: formData.serverUrl,
      username: formData.username,
      password: formData.password,
    })
  }

  const handleTriggerSync = () => {
    syncMutation.mutate()
  }

  const formatLastSync = (lastSync: string | null) => {
    if (!lastSync) return 'Never'
    return new Date(lastSync).toLocaleString()
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'syncing':
        return 'warning'
      case 'configured':
        return 'success'
      case 'not_configured':
        return 'error'
      default:
        return 'default'
    }
  }

  return (
    <Box>
      <Typography variant="h4" gutterBottom>
        <SettingsIcon sx={{ mr: 1, verticalAlign: 'middle' }} />
        CalDAV Synchronization
      </Typography>

      {/* Current Status */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Current Status
          </Typography>
          {statusLoading ? (
            <Box display="flex" alignItems="center" gap={2}>
              <CircularProgress size={20} />
              <Typography>Loading status...</Typography>
            </Box>
          ) : (
            <Box>
              <Box display="flex" alignItems="center" gap={2} mb={2}>
                <Chip
                  label={syncStatus?.caldav?.status || 'Unknown'}
                  color={getStatusColor(syncStatus?.caldav?.status || 'unknown')}
                  icon={syncStatus?.caldav?.status === 'configured' ? <CheckCircleIcon /> : <ErrorIcon />}
                />
                {syncStatus?.caldav?.enabled && (
                  <Chip label="Enabled" color="success" variant="outlined" />
                )}
              </Box>
              
              <Box display="grid" gridTemplateColumns="repeat(auto-fit, minmax(200px, 1fr))" gap={2}>
                <Box>
                  <Typography variant="subtitle2" color="text.secondary">
                    Last Sync
                  </Typography>
                  <Typography variant="body1">
                    {formatLastSync(syncStatus?.caldav?.lastSync)}
                  </Typography>
                </Box>
                
                <Box>
                  <Typography variant="subtitle2" color="text.secondary">
                    Server URL
                  </Typography>
                  <Typography variant="body1" noWrap>
                    {syncStatus?.caldav?.serverUrl || 'Not configured'}
                  </Typography>
                </Box>
                
                <Box>
                  <Typography variant="subtitle2" color="text.secondary">
                    Sync Interval
                  </Typography>
                  <Typography variant="body1">
                    {syncStatus?.caldav?.syncInterval ? `${syncStatus.caldav.syncInterval / 1000 / 60} minutes` : 'Not set'}
                  </Typography>
                </Box>
              </Box>

              <Box mt={2}>
                <Button
                  variant="contained"
                  startIcon={<SyncIcon />}
                  onClick={handleTriggerSync}
                  disabled={!syncStatus?.caldav?.enabled || syncMutation.isPending}
                >
                  {syncMutation.isPending ? 'Syncing...' : 'Sync Now'}
                </Button>
              </Box>
            </Box>
          )}
        </CardContent>
      </Card>

      {/* Configuration */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            CalDAV Configuration
          </Typography>
          
          {configLoading ? (
            <Box display="flex" justifyContent="center" alignItems="center" minHeight="200px">
              <CircularProgress />
            </Box>
          ) : (
            <form onSubmit={handleSubmit(onSubmit)}>
              <Box display="grid" gridTemplateColumns="repeat(auto-fit, minmax(300px, 1fr))" gap={3}>
              <Controller
                name="serverUrl"
                control={control}
                rules={{ required: 'Server URL is required' }}
                render={({ field, fieldState }) => (
                  <TextField
                    {...field}
                    label="Server URL"
                    placeholder="https://your-radicale-server.com"
                    fullWidth
                    error={!!fieldState.error}
                    helperText={fieldState.error?.message}
                    required
                  />
                )}
              />

              <Controller
                name="username"
                control={control}
                rules={{ required: 'Username is required' }}
                render={({ field, fieldState }) => (
                  <TextField
                    {...field}
                    label="Username"
                    fullWidth
                    error={!!fieldState.error}
                    helperText={fieldState.error?.message}
                    required
                  />
                )}
              />

              <Controller
                name="password"
                control={control}
                rules={{ 
                  required: !caldavConfig?.hasPassword ? 'Password is required' : false 
                }}
                render={({ field, fieldState }) => (
                  <TextField
                    {...field}
                    label="Password"
                    type="password"
                    fullWidth
                    error={!!fieldState.error}
                    helperText={
                      fieldState.error?.message || 
                      (caldavConfig?.hasPassword ? 'Password is already saved. Leave blank to keep current password.' : '')
                    }
                    placeholder={caldavConfig?.hasPassword ? 'Leave blank to keep current password' : ''}
                    required={!caldavConfig?.hasPassword}
                  />
                )}
              />

              <Controller
                name="collectionPath"
                control={control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    label="Collection Path"
                    placeholder="/calendars"
                    fullWidth
                    helperText="Path prefix for collections (e.g., /calendars for Baikal, /opentasks for Radicale)"
                  />
                )}
              />

              <Controller
                name="syncInterval"
                control={control}
                render={({ field }) => (
                  <FormControl fullWidth>
                    <InputLabel id="sync-interval-label">Sync Interval</InputLabel>
                    <Select 
                      {...field}
                      labelId="sync-interval-label"
                      label="Sync Interval"
                    >
                      <MenuItem value={5}>5 minutes</MenuItem>
                      <MenuItem value={15}>15 minutes</MenuItem>
                      <MenuItem value={30}>30 minutes</MenuItem>
                      <MenuItem value={60}>1 hour</MenuItem>
                      <MenuItem value={240}>4 hours</MenuItem>
                      <MenuItem value={1440}>24 hours</MenuItem>
                    </Select>
                  </FormControl>
                )}
              />

              <Controller
                name="autoSync"
                control={control}
                render={({ field }) => (
                  <FormControlLabel
                    control={<Switch {...field} checked={field.value} />}
                    label="Enable automatic synchronization"
                  />
                )}
              />
            </Box>

            <Divider sx={{ my: 3 }} />

            <Box display="flex" gap={2} justifyContent="space-between">
              <Button
                variant="outlined"
                onClick={handleTestConnection}
                disabled={testConnectionMutation.isPending}
              >
                {testConnectionMutation.isPending ? 'Testing...' : 'Test Connection'}
              </Button>

              <Button
                type="submit"
                variant="contained"
                disabled={configureMutation.isPending}
              >
                {configureMutation.isPending ? 'Saving...' : 'Save Configuration'}
              </Button>
              </Box>
            </form>
          )}

          {testResult && (
            <Alert
              severity={testResult.success ? 'success' : 'error'}
              sx={{ mt: 2 }}
              icon={testResult.success ? <CheckCircleIcon /> : <ErrorIcon />}
            >
              {testResult.message}
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Help */}
      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Configuration Help
          </Typography>
          <Typography variant="body2" paragraph>
            To configure CalDAV synchronization:
          </Typography>
          <Box component="ol" sx={{ pl: 2 }}>
            <li>Enter your CalDAV server URL (e.g., https://baikal.example.com/dav.php)</li>
            <li>Provide your username and password</li>
            <li>Set the collection path prefix:<br/>
              - Baikal: /calendars<br/>
              - Radicale: /opentasks or /calendars<br/>
              - Other servers: check your server documentation</li>
            <li>Choose how often to synchronize (recommended: 15 minutes)</li>
            <li>Test the connection to verify your settings</li>
            <li>Save the configuration to enable synchronization</li>
          </Box>
          <Typography variant="body2" color="text.secondary">
            Note: The full path will be: serverUrl + collectionPath + /username/collection-name/
          </Typography>
        </CardContent>
      </Card>
    </Box>
  )
}

export default CalDAVSettings