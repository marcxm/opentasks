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
} from '@mui/material'
import {
  Search as SearchIcon,
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  CheckCircle as CheckCircleIcon,
  RadioButtonUnchecked as RadioButtonUncheckedIcon,
  FilterList as FilterIcon,
} from '@mui/icons-material'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'

import { taskApi, taskListApi } from '../services/api'
import { Task, TaskList as TaskListType } from '../types'
import { getSelectedListId, setSelectedListId } from '../services/settings'
import { getServerPreferences, saveServerPreference } from '../services/serverPreferences'

// Simple SearchInput component for quick task creation
const SearchInput: React.FC<{
  value: string
  onChange: (value: string) => void
  onQuickCreate?: (title: string) => void
}> = ({ value, onChange, onQuickCreate }) => {
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
        padding: '12px',
        border: '2px solid #1976d2',
        borderRadius: '4px',
        fontSize: '16px',
        outline: 'none',
        boxSizing: 'border-box',
      }}
    />
  )
}

const AllTasks: React.FC = () => {
  const [searchInput, setSearchInput] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedTab, setSelectedTab] = useState(0) // Default to "All" tab
  const [filterDialogOpen, setFilterDialogOpen] = useState(false)
  const [selectedListId, setSelectedListIdState] = useState<number | null>(null)
  const [filters, setFilters] = useState({
    status: 'all', // Show all tasks including completed
    priority: 'all',
    listId: 'all',
  })
  
  const searchInputRef = useRef<HTMLInputElement>(null)
  
  const navigate = useNavigate()
  const queryClient = useQueryClient()

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

  // Fetch tasks - show ALL tasks including completed (stable query key)
  const { data: tasksData, isLoading } = useQuery({
    queryKey: ['allTasks', filters.status, filters.priority, filters.listId],
    queryFn: () => {
      const queryFilters = { ...filters, search: '' } // Don't use searchQuery here
      console.log('AllTasks query filters:', queryFilters)
      
      // Remove listId if it's 'all' to get tasks from all lists
      if (queryFilters.listId === 'all') {
        delete queryFilters.listId
      }
      
      // Only apply status filtering if it's not 'all'
      if (filters.status !== 'all') {
        queryFilters.status = filters.status
      }
      // Show ALL tasks including completed
      
      return taskApi.getTasks(queryFilters)
    },
    keepPreviousData: true,
    staleTime: 10000,
    refetchOnWindowFocus: false,
    enabled: true,
  })

  // Filter tasks on the client side instead of server side to prevent re-renders
  const filteredTasks = useMemo(() => {
    if (!tasksData?.tasks) return []
    
    let filtered = tasksData.tasks
    
    // Apply list filter if a specific list is selected
    if (selectedListId !== null) {
      filtered = filtered.filter(task => task.list_id === selectedListId)
    }
    
    // Apply search filter on client side
    if (searchInput.trim()) {
      const searchLower = searchInput.toLowerCase()
      filtered = filtered.filter(task => 
        task.title.toLowerCase().includes(searchLower) ||
        (task.description && task.description.toLowerCase().includes(searchLower))
      )
    }
    
    return filtered
  }, [tasksData?.tasks, searchInput, selectedListId])

  // Fetch task lists
  const { data: taskLists } = useQuery({
    queryKey: ['taskLists'],
    queryFn: taskListApi.getTaskLists,
  })

  // Fetch server preferences to check hideLocalLists setting
  const { data: serverPreferences } = useQuery({
    queryKey: ['serverPreferences'],
    queryFn: getServerPreferences,
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
      queryClient.invalidateQueries({ 
        queryKey: ['allTasks', filters.status, filters.priority, filters.listId],
        exact: true 
      })
      // Don't invalidate the home view tasks query to avoid filter reset
      toast.success('Task completed!')
    },
    onError: () => {
      toast.error('Failed to complete task')
    },
  })

  // Toggle task mutation
  const toggleTaskMutation = useMutation({
    mutationFn: taskApi.toggleTask,
    onSuccess: () => {
      queryClient.invalidateQueries({ 
        queryKey: ['allTasks', filters.status, filters.priority, filters.listId],
        exact: true 
      })
      // Don't invalidate the home view tasks query to avoid filter reset
      toast.success('Task status updated!')
    },
    onError: () => {
      toast.error('Failed to update task status')
    },
  })

  // Delete task mutation
  const deleteTaskMutation = useMutation({
    mutationFn: taskApi.deleteTask,
    onSuccess: () => {
      queryClient.invalidateQueries({ 
        queryKey: ['allTasks', filters.status, filters.priority, filters.listId],
        exact: true 
      })
      // Don't invalidate the home view tasks query to avoid filter reset
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
      queryClient.invalidateQueries({ 
        queryKey: ['allTasks', filters.status, filters.priority, filters.listId],
        exact: true 
      })
      // Don't invalidate the home view tasks query to avoid filter reset
      toast.success('Task created!')
      // Clear search field after successful task creation
      setSearchInput('')
    },
    onError: () => {
      toast.error('Failed to create task')
    },
  })

  const handleTabChange = (event: React.SyntheticEvent, newValue: number) => {
    setSelectedTab(newValue)
    const statusMap = ['all', '0', '1', '2'] // 0=pending, 1=in_progress, 2=completed
    setFilters({ ...filters, status: statusMap[newValue] })
  }

  const handleToggleTask = (taskId: number) => {
    toggleTaskMutation.mutate(taskId)
  }

  const handleDeleteTask = (taskId: number) => {
    if (window.confirm('Are you sure you want to delete this task?')) {
      deleteTaskMutation.mutate(taskId)
    }
  }

  const handleEditTask = (taskId: number) => {
    navigate(`/tasks/${taskId}/edit`)
  }

  const handleViewTask = (taskId: number) => {
    navigate(`/tasks/${taskId}`)
  }

  const handleQuickCreate = async (title: string) => {
    try {
      // Use the currently selected list, or fall back to first available list
      let targetListId = selectedListId
      
      // If no list is selected (showing all tasks), use the first available list
      if (targetListId === null) {
        targetListId = filteredTaskLists && filteredTaskLists.length > 0 ? filteredTaskLists[0].id : 1
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
      const fallbackListId = filteredTaskLists && filteredTaskLists.length > 0 ? filteredTaskLists[0].id : 1
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

  if (isLoading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <Typography>Loading tasks...</Typography>
      </Box>
    )
  }

  const tasks = filteredTasks

  const handleListSelect = async (listId: number | null) => {
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
      <Typography variant="h4" gutterBottom>
        All Tasks
      </Typography>

      {/* List Selector */}
      <Box mb={3}>
        <Box display="flex" gap={1} flexWrap="wrap" alignItems="center">
          <Typography variant="body2" color="text.secondary" sx={{ mr: 1 }}>
            Filter by list:
          </Typography>
          <Chip
            label="All Lists"
            onClick={() => handleListSelect(null)}
            color={selectedListId === null ? "primary" : "default"}
            variant={selectedListId === null ? "filled" : "outlined"}
            clickable
            sx={{ mb: 1 }}
          />
          {filteredTaskLists?.map((list) => (
            <Chip
              key={list.id}
              label={list.name}
              onClick={() => handleListSelect(list.id)}
              color={selectedListId === list.id ? "primary" : "default"}
              variant={selectedListId === list.id ? "filled" : "outlined"}
              clickable
              sx={{ mb: 1 }}
            />
          ))}
        </Box>
      </Box>

      {/* Search and Filter Bar */}
      <Box display="flex" gap={2} mb={3} alignItems="center">
        <SearchInput
          value={searchInput}
          onChange={(value) => {
            console.log('SearchInput onChange called with:', value)
            setSearchInput(value)
          }}
          onQuickCreate={handleQuickCreate}
        />
        <IconButton onClick={() => setFilterDialogOpen(true)}>
          <FilterIcon />
        </IconButton>
      </Box>

      {/* Tabs */}
      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
        <Tabs value={selectedTab} onChange={handleTabChange}>
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

export default AllTasks