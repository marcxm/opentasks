import React, { useState, useEffect } from 'react'
import { Routes, Route } from 'react-router-dom'
import { Box } from '@mui/material'
import { useQueryClient } from '@tanstack/react-query'

import Layout from './components/Layout'
import Login from './components/Login'
import TaskList from './pages/TaskList'
import AllTasks from './pages/AllTasks'
import TaskDetail from './pages/TaskDetail'
import TaskEdit from './pages/TaskEdit'
import Settings from './pages/Settings'
import CalDAVSettings from './pages/CalDAVSettings'
import { isAuthenticated, getCurrentUser } from './services/auth'

function App() {
  const [authenticated, setAuthenticated] = useState(false)
  const [loading, setLoading] = useState(true)
  const queryClient = useQueryClient()

  useEffect(() => {
    const checkAuth = async () => {
      if (isAuthenticated()) {
        try {
          const user = await getCurrentUser()
          if (user) {
            setAuthenticated(true)
          }
        } catch (error) {
          console.error('Auth check failed:', error)
        }
      }
      setLoading(false)
    }

    checkAuth()
  }, [])

  const handleLoginSuccess = () => {
    setAuthenticated(true)
    // Invalidate all queries to ensure fresh data is fetched after login
    queryClient.invalidateQueries()
  }

  const handleLogout = () => {
    setAuthenticated(false)
  }

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
        Loading...
      </Box>
    )
  }

  if (!authenticated) {
    return <Login onLoginSuccess={handleLoginSuccess} />
  }

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      <Layout onLogout={handleLogout}>
        <Routes>
          <Route path="/" element={<TaskList />} />
          <Route path="/tasks" element={<AllTasks />} />
          <Route path="/tasks/:id" element={<TaskDetail />} />
          <Route path="/tasks/:id/edit" element={<TaskEdit />} />
          <Route path="/tasks/new" element={<TaskEdit />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/settings/caldav" element={<CalDAVSettings />} />
        </Routes>
      </Layout>
    </Box>
  )
}

export default App