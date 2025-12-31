import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import {
  Box,
  Card,
  CardContent,
  Typography,
  Chip,
  IconButton,
  TextField,
  InputAdornment,
  Tabs,
  Tab,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  Checkbox,
  Fab,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  useTheme,
} from '@mui/material'
import {
  Search as SearchIcon,
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  CheckCircle as CheckCircleIcon,
  RadioButtonUnchecked as RadioButtonUncheckedIcon,
  FilterList as FilterIcon,
  Sync as SyncIcon,
} from '@mui/icons-material'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'

import { taskApi, taskListApi, syncApi } from '../services/api'
import { Task, TaskList as TaskListType } from '../types'
import { getSelectedListId, setSelectedListId, settingsEventEmitter } from '../services/settings'
import { getServerPreferences, saveServerPreference } from '../services/serverPreferences'
import { isAuthenticated } from '../services/auth'

// Simple SearchInput component for quick task creation
const SearchInput: React.FC<{
  value: string
  onChange: (value: string) => void
  onQuickCreate?: (title: string) => void
}> = ({ value, onChange, onQuickCreate }) => {
  const theme = useTheme()
  
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(e.target.value)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && value.trim() && onQuickCreate) {
      e.preventDefault()
      e.stopPropagation()
      onQuickCreate(value.trim())
    }
  }
  
  return (
    <input
      type="text"
      placeholder="Search tasks... (Press Enter to create new task)"
      value={value}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      style={{
        width: '100%',
        minWidth: 0,
        padding: '12px',
        border: `2px solid ${theme.palette.primary.main}`,
        borderRadius: '4px',
        fontSize: '16px',
        outline: 'none',
        boxSizing: 'border-box',
        maxWidth: '100%',
        backgroundColor: theme.palette.background.paper,
        color: theme.palette.text.primary,
      }}
    />
  )
}

const TaskList: React.FC = () => {
  const [searchInput, setSearchInput] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedTab, setSelectedTab] = useState(0) // Default to "All" tab
  const [filterDialogOpen, setFilterDialogOpen] = useState(false)
  const [selectedListId, setSelectedListIdState] = useState<string | null>(null)
  const [filters, setFilters] = useState({
    status: 'all', // Default to "all" but we'll filter out completed tasks
    priority: 'all',
    listId: 'all',
  })
  
  const searchInputRef = useRef<HTMLInputElement>(null)
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const isSearchingRef = useRef(false)
  
  console.log('TaskList render, searchInput:', searchInput, 'isSearching:', isSearchingRef.current) // Debug re-renders

  const navigate = useNavigate()
  const queryClient = useQueryClient()

  // Handle search input changes with debouncing but without causing re-renders
  const handleSearchChange = (value: string) => {
    setSearchInput(value)
    
    // Update searching state immediately for proper query filtering
    const isSearching = value.trim().length > 0
    isSearchingRef.current = isSearching
    
    // Clear existing timeout
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current)
    }
    
    // Set new timeout for search query update
    searchTimeoutRef.current = setTimeout(() => {
      setSearchQuery(value)
      // Invalidate main query to include completed tasks when searching
      if (value.trim()) {
        queryClient.invalidateQueries({ 
          queryKey: ['tasks', filters.status, filters.priority, filters.listId],
          exact: true 
        })
      }
    }, 300)
  }

  // Load selected list from server preferences on component mount
  useEffect(() => {
    const loadPreferences = async () => {
      try {
        const preferences = await getServerPreferences()
        setSelectedListIdState(preferences.selectedListId)
      } catch (error) {
        console.error('Failed to load server preferences, falling back to local:', error)
        // Fallback to local storage
        const savedSelectedListId = getSelectedListId()
        setSelectedListIdState(savedSelectedListId)
      }
    }
    loadPreferences()
  }, [])

  // Ensure tasks are fetched when component mounts after login
  useEffect(() => {
    // Small delay to ensure component is fully mounted and authentication is ready
    const timer = setTimeout(() => {
      // Trigger a refetch when component mounts to ensure fresh data after login
      queryClient.invalidateQueries({ 
        queryKey: ['tasks', filters.status, filters.priority, filters.listId],
        exact: true 
      })
      // Also invalidate task lists and server preferences to ensure they're fresh
      queryClient.invalidateQueries({ queryKey: ['taskLists'] })
      queryClient.invalidateQueries({ queryKey: ['serverPreferences'] })
    }, 100) // Small delay to ensure everything is ready

    return () => clearTimeout(timer)
  }, []) // Empty dependency array means this runs once on mount

  // Listen for settings changes and invalidate tasks query
  useEffect(() => {
    const handleSettingsChange = () => {
      // Invalidate only the specific query to avoid resetting filters
      queryClient.invalidateQueries({ 
        queryKey: ['tasks', filters.status, filters.priority, filters.listId],
        exact: true 
      })
      // Also reload the selected list from settings
      const savedSelectedListId = getSelectedListId()
      setSelectedListIdState(savedSelectedListId)
    }

    settingsEventEmitter.addListener(handleSettingsChange)
    return () => {
      settingsEventEmitter.removeListener(handleSettingsChange)
    }
  }, [queryClient, filters.status, filters.priority, filters.listId])

  // Fetch tasks with stable query key to prevent re-renders during search
  const { data: tasksData, isLoading } = useQuery({
    queryKey: ['tasks', filters.status, filters.priority, filters.listId],
    queryFn: async () => {
      console.log('Query triggered with filters:', filters, 'isSearching:', isSearchingRef.current)
      
      // For regular queries, use the normal task API
      const queryFilters = { ...filters, search: '' }
      
      // Remove listId if it's 'all' to get tasks from all lists
      if (queryFilters.listId === 'all') {
        delete queryFilters.listId
      }
      
      // For Home view, exclude completed tasks unless there's a search input
      if (filters.status === 'all' && !isSearchingRef.current) {
        // Exclude completed tasks in Home view when no search
        queryFilters.excludeStatus = '2'
        console.log('Home view: Excluding completed tasks, final filters:', queryFilters)
      } else if (filters.status !== 'all') {
        // Apply specific status filter
        queryFilters.status = filters.status
        // Increase limit for completed tasks to show all of them
        if (filters.status === '2') {
          queryFilters.limit = 1000
        }
        console.log('Home view: Using specific status filter:', filters.status, 'final filters:', queryFilters)
      } else if (filters.status === 'all' && isSearchingRef.current) {
        // When searching, show ALL tasks including completed ones
        console.log('Home view: Search active, showing all tasks including completed, final filters:', queryFilters)
      }
      
      console.log('About to call taskApi.getTasks with filters:', queryFilters)
      
      const result = await taskApi.getTasks(queryFilters)
      console.log('taskApi.getTasks result:', result)
      return result
    },
    keepPreviousData: true, // Keep previous data while loading new data
    staleTime: 10000, // Consider data fresh for 10 seconds
    refetchOnWindowFocus: false, // Don't refetch on window focus
    enabled: isAuthenticated(), // Only fetch when authenticated
  })


  // Filter tasks on the client side for real-time search feedback
  const filteredTasks = useMemo(() => {
    // Always use regular task data for the base set
    if (!tasksData?.tasks) return []
    
    console.log('filteredTasks: tasksData.tasks count:', tasksData.tasks.length)
    console.log('filteredTasks: current filters.status:', filters.status)
    console.log('filteredTasks: tasks with status 2:', tasksData.tasks.filter(t => t.status === 2).length)
    
    let filtered = tasksData.tasks
    
    // Apply list filter if a specific list is selected
    if (selectedListId !== null) {
      filtered = filtered.filter(task => task.list_id === selectedListId)
    }
    
    // Apply search filtering
    if (searchInput.trim()) {
      const searchLower = searchInput.toLowerCase()
      filtered = filtered.filter(task => 
        task.title.toLowerCase().includes(searchLower) ||
        (task.description && task.description.toLowerCase().includes(searchLower))
      )
    }
    
    console.log('filteredTasks: final filtered count:', filtered.length)
    return filtered
  }, [tasksData?.tasks, searchInput, selectedListId, filters.status])

  // Use the main query loading state
  const isTaskLoading = isLoading

  // Fetch task lists
  const { data: taskLists } = useQuery({
    queryKey: ['taskLists'],
    queryFn: taskListApi.getTaskLists,
    enabled: isAuthenticated(),
  })

  // Fetch server preferences to check hideLocalLists setting
  const { data: serverPreferences } = useQuery({
    queryKey: ['serverPreferences'],
    queryFn: getServerPreferences,
    enabled: isAuthenticated(),
  })

  // Filter task lists based on hideLocalLists setting
  const filteredTaskLists = React.useMemo(() => {
    if (!taskLists) return []
    if (!serverPreferences?.hideLocalLists) return taskLists
    return taskLists.filter(list => list.account_type !== 'org.dmfs.account.LOCAL')
  }, [taskLists, serverPreferences?.hideLocalLists])

  // Complete task mutation
  const completeTaskMutation = useMutation({
    mutationFn: taskApi.completeTask,
    onSuccess: () => {
      // Invalidate all task queries to ensure completed tasks appear in all tabs
      queryClient.invalidateQueries({ 
        queryKey: ['tasks'],
        exact: false 
      })
      queryClient.invalidateQueries({ queryKey: ['allTasks'] })
      toast.success('Task completed!')
    },
    onError: () => {
      toast.error('Failed to complete task')
    },
  })

  // Toggle task mutation
  const toggleTaskMutation = useMutation({
    mutationFn: taskApi.toggleTask,
    onMutate: async (taskId) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['tasks'] })
      
      // Snapshot the previous value
      const previousTasks = queryClient.getQueryData(['tasks', filters.status, filters.priority, filters.listId])
      
      // Optimistically update to remove/update the task
      queryClient.setQueryData(['tasks', filters.status, filters.priority, filters.listId], (old: any) => {
        if (!old?.tasks) return old
        return {
          ...old,
          tasks: old.tasks.map((task: any) =>
            task.id === taskId
              ? { ...task, status: task.status === 2 ? 0 : 2 }
              : task
          )
        }
      })
      
      return { previousTasks }
    },
    onSuccess: () => {
      // Invalidate all task queries to ensure completed tasks appear in all tabs
      queryClient.invalidateQueries({ 
        queryKey: ['tasks'],
        exact: false 
      })
      queryClient.invalidateQueries({ queryKey: ['allTasks'] })
      toast.success('Task status updated!')
    },
    onError: (err, taskId, context: any) => {
      // Rollback on error
      if (context?.previousTasks) {
        queryClient.setQueryData(['tasks', filters.status, filters.priority, filters.listId], context.previousTasks)
      }
      toast.error('Failed to update task status')
    },
  })

  // Delete task mutation
  const deleteTaskMutation = useMutation({
    mutationFn: taskApi.deleteTask,
    onSuccess: () => {
      // Invalidate all task queries to ensure deleted tasks disappear from all tabs
      queryClient.invalidateQueries({ 
        queryKey: ['tasks'],
        exact: false 
      })
      queryClient.invalidateQueries({ queryKey: ['allTasks'] })
      toast.success('Task deleted!')
    },
    onError: () => {
      toast.error('Failed to delete task')
    },
  })

  // Create task mutation for quick creation
  const createTaskMutation = useMutation({
    mutationFn: taskApi.createTask,
    onSuccess: () => {
      console.log('Task created successfully, current filters:', filters)
      console.log('Invalidating query with key:', ['tasks', filters.status, filters.priority, filters.listId])
      
      // Clear search field and reset search states
      setSearchInput('')
      setSearchQuery('')
      isSearchingRef.current = false
      
      // Clear any pending search timeout
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current)
        searchTimeoutRef.current = null
      }
      
      // Use setTimeout to ensure state update happens before query invalidation
      setTimeout(() => {
        // Invalidate only the specific query to avoid resetting filters
        queryClient.invalidateQueries({ 
          queryKey: ['tasks', filters.status, filters.priority, filters.listId],
          exact: true 
        })
        queryClient.invalidateQueries({ queryKey: ['allTasks'] })
      }, 0)
      
      toast.success('Task created!')
    },
    onError: () => {
      toast.error('Failed to create task')
    },
  })

  // Sync mutation
  const syncMutation = useMutation({
    mutationFn: async () => {
      console.log('Starting sync mutation...');
      const result = await syncApi.triggerSync();
      console.log('Sync mutation result:', result);
      return result;
    },
    onSuccess: (data) => {
      console.log('Sync mutation success:', data);
      toast.success(data.message || 'Sync completed successfully!')
      // Invalidate all task queries to refresh data
      queryClient.invalidateQueries({ queryKey: ['tasks'] })
      queryClient.invalidateQueries({ queryKey: ['allTasks'] })
      queryClient.invalidateQueries({ queryKey: ['taskLists'] })
    },
    onError: (error: any) => {
      console.error('Sync mutation error:', error);
      toast.error(error.response?.data?.message || 'Sync failed')
    },
  })

  const handleTabChange = (event: React.SyntheticEvent, newValue: number) => {
    console.log('Tab changed to:', newValue)
    setSelectedTab(newValue)
    const statusMap = ['all', '0', '1', '2'] // 0=pending, 1=in_progress, 2=completed
    const newStatus = statusMap[newValue]
    console.log('Setting status to:', newStatus)
    setFilters({ ...filters, status: newStatus })
    
    // Force query invalidation to ensure fresh data
    setTimeout(() => {
      queryClient.invalidateQueries({ 
        queryKey: ['tasks', newStatus, filters.priority, filters.listId],
        exact: true 
      })
    }, 0)
  }

  const handleToggleTask = (taskId: string) => {
    toggleTaskMutation.mutate(taskId)
  }

  const handleDeleteTask = (taskId: string) => {
    if (window.confirm('Are you sure you want to delete this task?')) {
      deleteTaskMutation.mutate(taskId)
    }
  }

  const handleEditTask = (taskId: string) => {
    navigate(`/tasks/${taskId}/edit`)
  }

  const handleViewTask = (taskId: string) => {
    navigate(`/tasks/${taskId}`)
  }

  const handleQuickCreate = async (title: string) => {
    try {
      // Use the currently selected list, or fall back to first available list
      let targetListId = selectedListId
      
      // If no list is selected (showing all tasks), use the first available list
      if (targetListId === null) {
        targetListId = filteredTaskLists && filteredTaskLists.length > 0 ? filteredTaskLists[0].id : 'todo'
      }
      
      createTaskMutation.mutate({
        title,
        description: '',
        status: 0, // Pending
        priority: 0, // No priority
        due: null,
        list_id: targetListId,
      })
    } catch (error) {
      console.error('Failed to create task, using fallback:', error)
      // Fallback to first available list if anything fails
      const fallbackListId = filteredTaskLists && filteredTaskLists.length > 0 ? filteredTaskLists[0].id : 'todo'
      createTaskMutation.mutate({
        title,
        description: '',
        status: 0, // Pending
        priority: 0, // No priority
        due: null,
        list_id: fallbackListId,
      })
    }
  }

  const getPriorityColor = (priority: number) => {
    switch (priority) {
      case 1:
        return 'error'
      case 2:
      case 3:
        return 'warning'
      case 4:
      case 5:
        return 'info'
      default:
        return 'default'
    }
  }

  const getPriorityLabel = (priority: number) => {
    switch (priority) {
      case 1:
        return 'High'
      case 2:
      case 3:
        return 'Medium'
      case 4:
      case 5:
        return 'Low'
      default:
        return 'None'
    }
  }

  const formatDate = (dateString: string | null) => {
    if (!dateString) return null
    return new Date(dateString).toLocaleDateString()
  }

  const isOverdue = (dueDate: string | null) => {
    if (!dueDate) return false
    return new Date(dueDate) < new Date()
  }

  if (isTaskLoading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <Typography>Loading tasks...</Typography>
      </Box>
    )
  }

  const tasks = filteredTasks

  const handleListSelect = async (listId: string | null) => {
    setSelectedListIdState(listId)
    try {
      await saveServerPreference('selectedListId', listId)
    } catch (error) {
      console.error('Failed to save server preference, falling back to local:', error)
      // Fallback to local storage
      setSelectedListId(listId)
    }
  }

  return (
    <Box>
      {/* List Selector */}
      <Box mb={3}>
        <Box 
          display="flex" 
          gap={1} 
          flexWrap="wrap" 
          alignItems="center"
          sx={{ overflow: 'hidden' }}
        >
          <Typography 
            variant="body2" 
            color="text.secondary" 
            sx={{ 
              mr: 1,
              flexShrink: 0,
              display: { xs: 'none', sm: 'block' } // Hide on mobile to save space
            }}
          >
            Filter by list:
          </Typography>
          <Chip
            label="All Lists"
            onClick={() => handleListSelect(null)}
            color={selectedListId === null ? "primary" : "default"}
            variant={selectedListId === null ? "filled" : "outlined"}
            clickable
            size="small"
            sx={{ mb: 1, flexShrink: 0 }}
          />
          {filteredTaskLists?.map((list) => (
            <Chip
              key={list.id}
              label={list.name}
              onClick={() => handleListSelect(list.id)}
              color={selectedListId === list.id ? "primary" : "default"}
              variant={selectedListId === list.id ? "filled" : "outlined"}
              clickable
              size="small"
              sx={{ 
                mb: 1,
                flexShrink: 0,
                maxWidth: { xs: '120px', sm: 'none' } // Limit width on mobile
              }}
            />
          ))}
        </Box>
      </Box>

      {/* Search and Filter Bar */}
      <Box 
        display="flex" 
        gap={{ xs: 1, sm: 2 }} 
        mb={3} 
        alignItems="center"
        sx={{ 
          flexWrap: { xs: 'nowrap', sm: 'nowrap' },
          overflow: 'hidden'
        }}
      >
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <SearchInput
            value={searchInput}
            onChange={handleSearchChange}
            onQuickCreate={handleQuickCreate}
          />
        </Box>
        <Box sx={{ display: 'flex', gap: 1, flexShrink: 0 }}>
          <IconButton 
            onClick={() => setFilterDialogOpen(true)}
            title="Filter tasks"
            size="small"
          >
            <FilterIcon />
          </IconButton>
          <IconButton 
            onClick={() => {
              console.log('Sync button clicked!');
              syncMutation.mutate();
            }}
            disabled={syncMutation.isPending}
            title="Sync with CalDAV server"
            color="primary"
            size="small"
          >
            <SyncIcon />
          </IconButton>
        </Box>
      </Box>

      {/* Tabs */}
      <Box sx={{ 
        borderBottom: 1, 
        borderColor: 'divider', 
        mb: 2,
        overflow: 'hidden'
      }}>
        <Tabs 
          value={selectedTab} 
          onChange={handleTabChange}
          variant="scrollable"
          scrollButtons="auto"
          allowScrollButtonsMobile
        >
          <Tab label="All" />
          <Tab label="Pending" />
          <Tab label="In Progress" />
          <Tab label="Completed" />
        </Tabs>
      </Box>

      {/* Task List */}
      <List>
        {tasks.map((task) => (
          <Card key={task.id} sx={{ mb: 2 }}>
            <ListItem
              button
              onClick={() => handleViewTask(task.id)}
              sx={{
                '&:hover': {
                  backgroundColor: 'action.hover',
                },
              }}
            >
              <Checkbox
                checked={task.status === 2}
                onChange={() => handleToggleTask(task.id)}
                onClick={(e) => e.stopPropagation()}
                icon={<RadioButtonUncheckedIcon />}
                checkedIcon={<CheckCircleIcon />}
              />
              <ListItemText
                primary={
                  <Box display="flex" alignItems="center" gap={1}>
                    <Typography
                      variant="h6"
                      sx={{
                        textDecoration: task.status === 2 ? 'line-through' : 'none',
                        opacity: task.status === 2 ? 0.7 : 1,
                      }}
                    >
                      {task.title}
                    </Typography>
                    {task.priority > 0 && (
                      <Chip
                        label={getPriorityLabel(task.priority)}
                        color={getPriorityColor(task.priority)}
                        size="small"
                      />
                    )}
                    {isOverdue(task.due) && task.status !== 2 && (
                      <Chip label="Overdue" color="error" size="small" />
                    )}
                  </Box>
                }
                secondary={
                  <Box>
                    {task.description && (
                      <Typography variant="body2" color="text.secondary" noWrap>
                        {task.description}
                      </Typography>
                    )}
                    <Box display="flex" gap={2} mt={1}>
                      {task.due && (
                        <Typography variant="caption" color="text.secondary">
                          Due: {formatDate(task.due)}
                        </Typography>
                      )}
                      {task.list_name && (
                        <Typography variant="caption" color="text.secondary">
                          List: {task.list_name}
                        </Typography>
                      )}
                    </Box>
                  </Box>
                }
              />
              <ListItemSecondaryAction>
                <IconButton
                  edge="end"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleEditTask(task.id)
                  }}
                >
                  <EditIcon />
                </IconButton>
                <IconButton
                  edge="end"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleDeleteTask(task.id)
                  }}
                >
                  <DeleteIcon />
                </IconButton>
              </ListItemSecondaryAction>
            </ListItem>
          </Card>
        ))}
      </List>

      {tasks.length === 0 && (
        <Box textAlign="center" py={4}>
          <Typography variant="h6" color="text.secondary">
            No tasks found
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Create your first task to get started
          </Typography>
        </Box>
      )}

      {/* Filter Dialog */}
      <Dialog open={filterDialogOpen} onClose={() => setFilterDialogOpen(false)}>
        <DialogTitle>Filter Tasks</DialogTitle>
        <DialogContent>
          <FormControl fullWidth margin="normal">
            <InputLabel id="filter-status-label">Status</InputLabel>
            <Select
              labelId="filter-status-label"
              label="Status"
              value={filters.status}
              onChange={(e) => setFilters({ ...filters, status: e.target.value })}
            >
              <MenuItem value="all">All</MenuItem>
              <MenuItem value="0">Pending</MenuItem>
              <MenuItem value="1">In Progress</MenuItem>
              <MenuItem value="2">Completed</MenuItem>
              <MenuItem value="3">Cancelled</MenuItem>
            </Select>
          </FormControl>
          <FormControl fullWidth margin="normal">
            <InputLabel id="filter-priority-label">Priority</InputLabel>
            <Select
              labelId="filter-priority-label"
              label="Priority"
              value={filters.priority}
              onChange={(e) => setFilters({ ...filters, priority: e.target.value })}
            >
              <MenuItem value="all">All</MenuItem>
              <MenuItem value="1">High</MenuItem>
              <MenuItem value="2">Medium-High</MenuItem>
              <MenuItem value="3">Medium</MenuItem>
              <MenuItem value="4">Low-Medium</MenuItem>
              <MenuItem value="5">Low</MenuItem>
            </Select>
          </FormControl>
          <FormControl fullWidth margin="normal">
            <InputLabel id="filter-list-label">Task List</InputLabel>
            <Select
              labelId="filter-list-label"
              label="Task List"
              value={filters.listId}
              onChange={(e) => setFilters({ ...filters, listId: e.target.value })}
            >
              <MenuItem value="all">All Lists</MenuItem>
              {filteredTaskLists?.map((list) => (
                <MenuItem key={list.id} value={list.id}>
                  {list.name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setFilterDialogOpen(false)}>Cancel</Button>
          <Button onClick={() => setFilterDialogOpen(false)} variant="contained">
            Apply Filters
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}

export default TaskList