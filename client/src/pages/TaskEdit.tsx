import React, { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  Box,
  Typography,
  Card,
  CardContent,
  TextField,
  Button,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Grid,
  Switch,
  FormControlLabel,
  CircularProgress,
} from '@mui/material'
import { DateTimePicker } from '@mui/x-date-pickers/DateTimePicker'
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'

dayjs.extend(utc)
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm, Controller } from 'react-hook-form'
import toast from 'react-hot-toast'

import { taskApi, taskListApi } from '../services/api'
import { getServerPreferences } from '../services/serverPreferences'
import { Task } from '../types'

interface TaskFormData {
  title: string
  description: string
  list_id: string
  priority: number
  status: number
  due: dayjs.Dayjs | null
  dtstart: dayjs.Dayjs | null
  is_allday: boolean
  location: string
  organizer: string
  percent_complete: number
}

const TaskEdit: React.FC = () => {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const isEdit = !!id

  const { control, handleSubmit, reset, watch } = useForm<TaskFormData>({
    defaultValues: {
      title: '',
      description: '',
      list_id: 'todo',
      priority: 0,
      status: 0,
      due: null,
      dtstart: null,
      is_allday: false,
      location: '',
      organizer: '',
      percent_complete: 0,
    },
  })

  // Fetch task data for editing
  const { data: task, isLoading: taskLoading } = useQuery({
    queryKey: ['task', id],
    queryFn: () => taskApi.getTask(id!),
    enabled: isEdit,
  })

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

  // Create/Update mutations
  const createMutation = useMutation({
    mutationFn: taskApi.createTask,
    onSuccess: (newTask) => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] })
      toast.success('Task created successfully!')
      navigate(`/tasks/${newTask.id}`)
    },
    onError: (error: any) => {
      console.error('Task creation error:', error)
      toast.error(`Failed to create task: ${error.response?.data?.error || error.message}`)
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Task> }) =>
      taskApi.updateTask(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] })
      queryClient.invalidateQueries({ queryKey: ['task', id] })
      toast.success('Task updated successfully!')
      navigate(`/tasks/${id}`)
    },
    onError: (error: any) => {
      console.error('Task update error:', error)
      const errorMessage = error.response?.data?.error || error.message || 'Failed to update task'
      toast.error(`Failed to update task: ${errorMessage}`)
    },
  })

  // Reset form when task data loads
  useEffect(() => {
    if (task) {
      reset({
        title: task.title,
        description: task.description || '',
        list_id: task.list_id,
        priority: task.priority,
        status: task.status,
        due: task.due ? dayjs.utc(task.due) : null,
        dtstart: task.dtstart ? dayjs.utc(task.dtstart) : null,
        is_allday: task.is_allday === 1,
        location: task.location || '',
        organizer: task.organizer || '',
        percent_complete: task.percent_complete || 0,
      })
    }
  }, [task, reset])

  const onSubmit = (data: TaskFormData) => {
    const taskData = {
      ...data,
      due: data.due?.toISOString() || null,
      dtstart: data.dtstart?.toISOString() || null,
      is_allday: data.is_allday ? 1 : 0,
    }

    if (isEdit) {
      updateMutation.mutate({ id: id!, data: taskData })
    } else {
      createMutation.mutate(taskData)
    }
  }

  const handleCancel = () => {
    navigate(-1)
  }

  if (taskLoading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    )
  }

  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <Box>
        <Typography variant="h4" gutterBottom>
          {isEdit ? 'Edit Task' : 'Create New Task'}
        </Typography>

        <Card>
          <CardContent>
            <form onSubmit={handleSubmit(onSubmit)}>
              <Grid container spacing={3}>
                <Grid item xs={12}>
                  <Controller
                    name="title"
                    control={control}
                    rules={{ required: 'Title is required' }}
                    render={({ field, fieldState }) => (
                      <TextField
                        {...field}
                        label="Title"
                        fullWidth
                        error={!!fieldState.error}
                        helperText={fieldState.error?.message}
                        required
                      />
                    )}
                  />
                </Grid>

                <Grid item xs={12}>
                  <Controller
                    name="description"
                    control={control}
                    render={({ field }) => (
                      <TextField
                        {...field}
                        label="Description"
                        fullWidth
                        multiline
                        rows={4}
                      />
                    )}
                  />
                </Grid>

                <Grid item xs={12} sm={6}>
                  <Controller
                    name="list_id"
                    control={control}
                    render={({ field }) => (
                      <FormControl fullWidth>
                        <InputLabel id="task-list-label">Task List</InputLabel>
                        <Select 
                          {...field}
                          labelId="task-list-label"
                          label="Task List"
                        >
                          {filteredTaskLists?.map((list) => (
                            <MenuItem key={list.id} value={list.id}>
                              {list.name}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    )}
                  />
                </Grid>

                <Grid item xs={12} sm={6}>
                  <Controller
                    name="priority"
                    control={control}
                    render={({ field }) => (
                      <FormControl fullWidth>
                        <InputLabel id="priority-label">Priority</InputLabel>
                        <Select 
                          {...field}
                          labelId="priority-label"
                          label="Priority"
                        >
                          <MenuItem value={0}>None</MenuItem>
                          <MenuItem value={1}>High</MenuItem>
                          <MenuItem value={2}>Medium-High</MenuItem>
                          <MenuItem value={3}>Medium</MenuItem>
                          <MenuItem value={4}>Low-Medium</MenuItem>
                          <MenuItem value={5}>Low</MenuItem>
                        </Select>
                      </FormControl>
                    )}
                  />
                </Grid>

                <Grid item xs={12} sm={6}>
                  <Controller
                    name="status"
                    control={control}
                    render={({ field }) => (
                      <FormControl fullWidth>
                        <InputLabel id="status-label">Status</InputLabel>
                        <Select 
                          {...field}
                          labelId="status-label"
                          label="Status"
                        >
                          <MenuItem value={0}>Pending</MenuItem>
                          <MenuItem value={1}>In Progress</MenuItem>
                          <MenuItem value={2}>Completed</MenuItem>
                          <MenuItem value={3}>Cancelled</MenuItem>
                        </Select>
                      </FormControl>
                    )}
                  />
                </Grid>

                <Grid item xs={12} sm={6}>
                  <Controller
                    name="percent_complete"
                    control={control}
                    render={({ field }) => (
                      <TextField
                        {...field}
                        label="Progress (%)"
                        type="number"
                        fullWidth
                        inputProps={{ min: 0, max: 100 }}
                      />
                    )}
                  />
                </Grid>

                <Grid item xs={12} sm={6}>
                  <Controller
                    name="dtstart"
                    control={control}
                    render={({ field }) => (
                      <DateTimePicker
                        {...field}
                        label="Start Date"
                        value={field.value}
                        onChange={(newValue) => {
                          // Treat user input as floating time (no timezone conversion)
                          // Create a new dayjs object in UTC with the same date/time values
                          if (newValue) {
                            const utcValue = dayjs.utc(newValue.format('YYYY-MM-DD HH:mm:ss'))
                            field.onChange(utcValue)
                          } else {
                            field.onChange(null)
                          }
                        }}
                        slotProps={{
                          textField: {
                            fullWidth: true,
                          },
                        }}
                      />
                    )}
                  />
                </Grid>

                <Grid item xs={12} sm={6}>
                  <Controller
                    name="due"
                    control={control}
                    render={({ field }) => (
                      <DateTimePicker
                        {...field}
                        label="Due Date"
                        value={field.value}
                        onChange={(newValue) => {
                          // Treat user input as floating time (no timezone conversion)
                          // Create a new dayjs object in UTC with the same date/time values
                          if (newValue) {
                            const utcValue = dayjs.utc(newValue.format('YYYY-MM-DD HH:mm:ss'))
                            field.onChange(utcValue)
                          } else {
                            field.onChange(null)
                          }
                        }}
                        slotProps={{
                          textField: {
                            fullWidth: true,
                          },
                        }}
                      />
                    )}
                  />
                </Grid>

                <Grid item xs={12} sm={6}>
                  <Controller
                    name="location"
                    control={control}
                    render={({ field }) => (
                      <TextField
                        {...field}
                        label="Location"
                        fullWidth
                      />
                    )}
                  />
                </Grid>

                <Grid item xs={12} sm={6}>
                  <Controller
                    name="organizer"
                    control={control}
                    render={({ field }) => (
                      <TextField
                        {...field}
                        label="Organizer Email"
                        type="email"
                        fullWidth
                      />
                    )}
                  />
                </Grid>

                <Grid item xs={12}>
                  <Controller
                    name="is_allday"
                    control={control}
                    render={({ field }) => (
                      <FormControlLabel
                        control={<Switch {...field} checked={field.value} />}
                        label="All Day Event"
                      />
                    )}
                  />
                </Grid>
              </Grid>

              <Box display="flex" gap={2} mt={4} justifyContent="flex-end">
                <Button variant="outlined" onClick={handleCancel}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="contained"
                  disabled={createMutation.isPending || updateMutation.isPending}
                >
                  {isEdit ? 'Update Task' : 'Create Task'}
                </Button>
              </Box>
            </form>
          </CardContent>
        </Card>
      </Box>
    </LocalizationProvider>
  )
}

export default TaskEdit