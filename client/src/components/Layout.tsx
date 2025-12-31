import React, { useState } from 'react'
import {
  AppBar,
  Toolbar,
  Typography,
  IconButton,
  Drawer,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Box,
  Fab,
  useTheme,
  useMediaQuery,
  Button,
} from '@mui/material'
import {
  Menu as MenuIcon,
  Add as AddIcon,
  Settings as SettingsIcon,
  Home as HomeIcon,
  Logout as LogoutIcon,
} from '@mui/icons-material'
import { useNavigate, useLocation } from 'react-router-dom'
import { logout } from '../services/auth'

interface LayoutProps {
  children: React.ReactNode
  onLogout: () => void
}

const Layout: React.FC<LayoutProps> = ({ children, onLogout }) => {
  const navigate = useNavigate()
  const location = useLocation()
  const theme = useTheme()
  const isMobile = useMediaQuery(theme.breakpoints.down('md'))
  
  // On desktop, drawer is always open. On mobile, it can be toggled
  const [drawerOpen, setDrawerOpen] = useState(!isMobile)

  const menuItems = [
    { text: 'Home', icon: <HomeIcon />, path: '/' },
    { text: 'Settings', icon: <SettingsIcon />, path: '/settings' },
  ]

  const handleDrawerToggle = () => {
    // Only allow toggling on mobile
    if (isMobile) {
      setDrawerOpen(!drawerOpen)
    }
  }

  const handleMenuClick = (path: string) => {
    navigate(path)
    if (isMobile) {
      setDrawerOpen(false)
    }
  }

  // Update drawer state when screen size changes
  React.useEffect(() => {
    if (!isMobile) {
      setDrawerOpen(true) // Always open on desktop
    }
  }, [isMobile])

  const handleAddTask = () => {
    navigate('/tasks/new')
  }

  const handleLogout = () => {
    logout()
    onLogout()
  }

  return (
    <>
      <AppBar position="fixed" sx={{ zIndex: theme.zIndex.drawer + 1 }}>
        <Toolbar>
          <IconButton
            color="inherit"
            aria-label="open drawer"
            edge="start"
            onClick={handleDrawerToggle}
            sx={{ 
              mr: 2,
              display: { xs: 'block', sm: 'none' } // Only show on mobile
            }}
          >
            <MenuIcon />
          </IconButton>
          <Typography variant="h6" noWrap component="div" sx={{ flexGrow: 1 }}>
            OpenTasks
          </Typography>
          <Button
            color="inherit"
            startIcon={<LogoutIcon />}
            onClick={handleLogout}
          >
            Logout
          </Button>
        </Toolbar>
      </AppBar>

      <Drawer
        variant={isMobile ? 'temporary' : 'persistent'}
        open={drawerOpen}
        onClose={isMobile ? handleDrawerToggle : undefined}
        sx={{
          width: 240,
          flexShrink: 0,
          '& .MuiDrawer-paper': {
            width: 240,
            boxSizing: 'border-box',
            top: 64,
            height: 'calc(100% - 64px)',
          },
        }}
      >
        <List>
          {menuItems.map((item) => (
            <ListItem
              button
              key={item.text}
              onClick={() => handleMenuClick(item.path)}
              selected={location.pathname === item.path}
            >
              <ListItemIcon>{item.icon}</ListItemIcon>
              <ListItemText primary={item.text} />
            </ListItem>
          ))}
        </List>
      </Drawer>

      <Box
        component="main"
        sx={{
          flexGrow: 1,
          p: { xs: 2, sm: 3 },
          width: { 
            xs: '100%', // Full width on mobile
            sm: 'calc(100% - 240px)' // Always account for drawer on desktop
          },
          transition: theme.transitions.create('width', {
            easing: theme.transitions.easing.sharp,
            duration: theme.transitions.duration.leavingScreen,
          }),
          overflow: 'hidden', // Prevent horizontal overflow
        }}
      >
        <Toolbar />
        {children}
      </Box>

      <Fab
        color="primary"
        aria-label="add task"
        sx={{
          position: 'fixed',
          bottom: 16,
          right: 16,
        }}
        onClick={handleAddTask}
      >
        <AddIcon />
      </Fab>
    </>
  )
}

export default Layout