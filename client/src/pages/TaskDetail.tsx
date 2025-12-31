import React from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  Box,
  Typography,
  Card,
  CardContent,
  Button,
  Chip,
  Divider,
  IconButton,
  CircularProgress,
} from '@mui/material'
import {
  Edit as EditIcon,
  Delete as DeleteIcon,
  ArrowBack as ArrowBackIcon,
  CheckCircle as CheckCircleIcon,
} from '@mui/icons-material'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'

import { taskApi } from '../services/api'

const TaskDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const { data: task, isLoading, error } = useQuery({
    queryKey: ['task', id],
    queryFn: () => taskApi.getTask(Number(id)),
    enabled: !!id,
  })

  const completeTaskMutation = useMutation({
    mutationFn: taskApi.completeTask,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['task', id] })
      queryClient.invalidateQueries({ queryKey: ['tasks'] })
      toast.success('Task completed!')
    },
    onError: () => {
      toast.error('Failed to complete task')
    },
  })

  const deleteTaskMutation = useMutation({
    mutationFn: taskApi.deleteTask,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] })
      toast.success('Task deleted!')
      navigate('/')
    },
    onError: () => {
      toast.error('Failed to delete task')
    },
  })

  const handleEdit = () => {
    navigate(`/tasks/${id}/edit`)
  }

  const handleDelete = () => {
    if (window.confirm('Are you sure you want to delete this task?')) {
      deleteTaskMutation.mutate(Number(id))
    }
  }

  const handleComplete = () => {
    completeTaskMutation.mutate(Number(id))
  }

  const handleBack = () => {
    navigate(-1)
  }

  if (isLoading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    )
  }

  if (error || !task) {
    return (
      <Box textAlign="center" py={4}>
        <Typography variant="h6" color="error">
          Task not found
        </Typography>
        <Button onClick={handleBack} sx={{ mt: 2 }}>
          Go Back
        </Button>
      </Box>
    )
  }

  const formatDate = (dateString: string | null) => {
    if (!dateString) return null
    return new Date(dateString).toLocaleString()
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

  const getStatusLabel = (status: number) => {
    switch (status) {
      case 0:
        return 'Pending'
      case 1:
        return 'In Progress'
      case 2:
        return 'Completed'
      case 3:
        return 'Cancelled'
      default:
        return 'Unknown'
    }
  }

  return (
    <Box>
      <Box display="flex" alignItems="center" mb={3}>
        <IconButton onClick={handleBack} sx={{ mr: 2 }}>
          <ArrowBackIcon />
        </IconButton>
        <Typography variant="h4" component="h1">
          {task.title}
        </Typography>
      </Box>

      <Card>
        <CardContent>
          <Box display="flex" justifyContent="space-between" alignItems="flex-start" mb={2}>
            <Box display="flex" gap={1} flexWrap="wrap">
              <Chip label={getStatusLabel(task.status)} color="primary" />
              {task.priority > 0 && (
                <Chip label={getPriorityLabel(task.priority)} color="secondary" />
              )}
              {task.list_name && (
                <Chip label={task.list_name} variant="outlined" />
              )}
            </Box>
            <Box display="flex" gap={1}>
              {task.status !== 2 && (
                <Button
                  variant="contained"
                  startIcon={<CheckCircleIcon />}
                  onClick={handleComplete}
                  disabled={completeTaskMutation.isPending}
                >
                  Complete
                </Button>
              )}
              <Button
                variant="outlined"
                startIcon={<EditIcon />}
                onClick={handleEdit}
              >
                Edit
              </Button>
              <Button
                variant="outlined"
                color="error"
                startIcon={<DeleteIcon />}
                onClick={handleDelete}
                disabled={deleteTaskMutation.isPending}
              >
                Delete
              </Button>
            </Box>
          </Box>

          {task.description && (
            <>
              <Divider sx={{ my: 2 }} />
              <Typography variant="h6" gutterBottom>
                Description
              </Typography>
              <Typography variant="body1" paragraph>
                {task.description}
              </Typography>
            </>
          )}

          <Divider sx={{ my: 2 }} />

          <Box display="grid" gridTemplateColumns="repeat(auto-fit, minmax(200px, 1fr))" gap={2}>
            {task.due && (
              <Box>
                <Typography variant="subtitle2" color="text.secondary">
                  Due Date
                </Typography>
                <Typography variant="body1">
                  {formatDate(task.due)}
                </Typography>
              </Box>
            )}

            {task.dtstart && (
              <Box>
                <Typography variant="subtitle2" color="text.secondary">
                  Start Date
                </Typography>
                <Typography variant="body1">
                  {formatDate(task.dtstart)}
                </Typography>
              </Box>
            )}

            {task.location && (
              <Box>
                <Typography variant="subtitle2" color="text.secondary">
                  Location
                </Typography>
                <Typography variant="body1">
                  {task.location}
                </Typography>
              </Box>
            )}

            {task.organizer && (
              <Box>
                <Typography variant="subtitle2" color="text.secondary">
                  Organizer
                </Typography>
                <Typography variant="body1">
                  {task.organizer}
                </Typography>
              </Box>
            )}

            {task.percent_complete !== null && (
              <Box>
                <Typography variant="subtitle2" color="text.secondary">
                  Progress
                </Typography>
                <Typography variant="body1">
                  {task.percent_complete}%
                </Typography>
              </Box>
            )}

            <Box>
              <Typography variant="subtitle2" color="text.secondary">
                Created
              </Typography>
              <Typography variant="body1">
                {formatDate(task.created)}
              </Typography>
            </Box>

            <Box>
              <Typography variant="subtitle2" color="text.secondary">
                Last Modified
              </Typography>
              <Typography variant="body1">
                {formatDate(task.last_modified)}
              </Typography>
            </Box>
          </Box>

          {task.children && task.children.length > 0 && (
            <>
              <Divider sx={{ my: 2 }} />
              <Typography variant="h6" gutterBottom>
                Subtasks
              </Typography>
              {task.children.map((child) => (
                <Box key={child.id} display="flex" alignItems="center" gap={1} mb={1}>
                  <Chip
                    label={getStatusLabel(child.status)}
                    size="small"
                    color={child.status === 2 ? 'success' : 'default'}
                  />
                  <Typography variant="body2">
                    {child.title}
                  </Typography>
                </Box>
              ))}
            </>
          )}
        </CardContent>
      </Card>
    </Box>
  )
}

export default TaskDetail