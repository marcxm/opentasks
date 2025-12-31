import axios from 'axios'
import { Task, TaskList, Category, TaskFilters, TasksResponse } from '../types'

// Use relative API URL - nginx will proxy /api to the backend
const getApiBaseUrl = () => {
  return '/api';
}

const api = axios.create({
  baseURL: getApiBaseUrl(),
  headers: {
    'Content-Type': 'application/json',
  },
})

// Request interceptor to add auth token
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('authToken')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// Response interceptor for error handling
api.interceptors.response.use(
  (response) => response,
  (error) => {
    console.error('API Error:', error)
    if (error.response?.status === 401) {
      localStorage.removeItem('authToken')
      window.location.href = '/login'
    }
    return Promise.reject(error)
  }
)

export const taskApi = {
  // Get all tasks
  getTasks: async (filters: TaskFilters = {}): Promise<TasksResponse> => {
    const response = await api.get('/tasks', { params: filters })
    return response.data
  },

  // Get a specific task
  getTask: async (id: string): Promise<Task> => {
    const response = await api.get(`/tasks/${id}`)
    return response.data
  },

  // Create a new task
  createTask: async (task: Partial<Task>): Promise<Task> => {
    const response = await api.post('/tasks', task)
    return response.data
  },

  // Update a task
  updateTask: async (id: string, task: Partial<Task>): Promise<Task> => {
    const response = await api.put(`/tasks/${id}`, task)
    return response.data
  },

  // Delete a task
  deleteTask: async (id: string): Promise<void> => {
    await api.delete(`/tasks/${id}`)
  },

  // Complete a task
  completeTask: async (id: string): Promise<Task> => {
    const response = await api.patch(`/tasks/${id}/complete`)
    return response.data
  },

  // Toggle task status (between completed and pending)
  toggleTask: async (id: string): Promise<Task> => {
    const response = await api.patch(`/tasks/${id}/toggle`)
    return response.data
  },

  // Search tasks
  searchTasks: async (query: string): Promise<{ tasks: Task[]; query: string }> => {
    const response = await api.get(`/tasks/search/${encodeURIComponent(query)}`)
    return response.data
  },
}

export const taskListApi = {
  // Get all task lists
  getTaskLists: async (): Promise<TaskList[]> => {
    const response = await api.get('/tasklists')
    return response.data
  },

  // Get a specific task list
  getTaskList: async (id: string): Promise<TaskList> => {
    const response = await api.get(`/tasklists/${id}`)
    return response.data
  },

  // Create a new task list
  createTaskList: async (taskList: Partial<TaskList>): Promise<TaskList> => {
    const response = await api.post('/tasklists', taskList)
    return response.data
  },

  // Update a task list
  updateTaskList: async (id: string, taskList: Partial<TaskList>): Promise<TaskList> => {
    const response = await api.put(`/tasklists/${id}`, taskList)
    return response.data
  },

  // Delete a task list
  deleteTaskList: async (id: string): Promise<void> => {
    await api.delete(`/tasklists/${id}`)
  },

  // Get tasks in a specific list
  getTasksInList: async (id: string, filters: TaskFilters = {}): Promise<TasksResponse> => {
    const response = await api.get(`/tasklists/${id}/tasks`, { params: filters })
    return response.data
  },
}

export const categoryApi = {
  // Get all categories
  getCategories: async (): Promise<Category[]> => {
    const response = await api.get('/categories')
    return response.data
  },

  // Create a new category
  createCategory: async (category: Partial<Category>): Promise<Category> => {
    const response = await api.post('/categories', category)
    return response.data
  },

  // Update a category
  updateCategory: async (id: number, category: Partial<Category>): Promise<Category> => {
    const response = await api.put(`/categories/${id}`, category)
    return response.data
  },

  // Delete a category
  deleteCategory: async (id: number): Promise<void> => {
    await api.delete(`/categories/${id}`)
  },
}

export const authApi = {
  // Login
  login: async (username: string, password: string): Promise<{ token: string; user: any }> => {
    const response = await api.post('/auth/login', { username, password })
    return response.data
  },

  // Register
  register: async (username: string, password: string, email?: string): Promise<{ token: string; user: any }> => {
    const response = await api.post('/auth/register', { username, password, email })
    return response.data
  },

  // Get current user
  getCurrentUser: async (): Promise<any> => {
    const response = await api.get('/auth/me')
    return response.data
  },
}

export const syncApi = {
  // Trigger CalDAV sync
  triggerCalDAVSync: async (): Promise<{ message: string; status: string }> => {
    const response = await api.post('/sync/caldav')
    return response.data
  },

  // Trigger manual sync (alias for triggerCalDAVSync)
  triggerSync: async (): Promise<{ message: string; status: string }> => {
    const response = await api.post('/sync/caldav')
    return response.data
  },

  // Get sync status
  getSyncStatus: async (): Promise<any> => {
    const response = await api.get('/sync/status')
    return response.data
  },

  // Get CalDAV configuration
  getCalDAVConfig: async (): Promise<{
    serverUrl: string
    username: string
    collectionPath: string
    syncInterval: number
    hasPassword: boolean
  }> => {
    const response = await api.get('/sync/caldav/config')
    return response.data
  },

  // Configure CalDAV
  configureCalDAV: async (config: {
    serverUrl: string
    username: string
    password: string
    collectionPath?: string
    syncInterval?: number
  }): Promise<{ message: string; status: string }> => {
    const response = await api.post('/sync/caldav/configure', config)
    return response.data
  },

  // Test CalDAV connection
  testCalDAVConnection: async (serverUrl: string, username: string, password: string): Promise<{ message: string; status: string }> => {
    const response = await api.post('/sync/caldav/test', { serverUrl, username, password })
    return response.data
  },

}

export const exportApi = {
  // Export all data
  exportData: async (): Promise<any> => {
    const response = await api.get('/export/all')
    return response.data
  },

  // Import data
  importData: async (data: any): Promise<{ success: boolean; message: string; results: any }> => {
    const response = await api.post('/export/import', data)
    return response.data
  },
}

export const calendarApi = {
  // Export a specific calendar as ICS file
  exportCalendar: async (listId: string): Promise<Blob> => {
    const response = await api.get(`/export/ics/${listId}`, {
      responseType: 'blob'
    })
    return response.data
  },

  // Import a calendar from ICS file
  importCalendar: async (icsContent: string, calendarId: number): Promise<{ success: boolean; message: string; results: any }> => {
    console.log('=== API CALL DEBUG ===')
    console.log('icsContent length:', icsContent.length)
    console.log('calendarId:', calendarId, 'type:', typeof calendarId)
    console.log('Request payload:', { icsContent: icsContent.substring(0, 100) + '...', calendarId })
    
    const response = await api.post('/export/import/ics', {
      icsContent,
      collectionName: calendarId.toString()
    })
    return response.data
  },
}

export default api