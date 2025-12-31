const express = require('express')
const router = express.Router()
const { getDatabase } = require('../database/init')
const { authenticateToken } = require('../middleware/auth')
const ical = require('ical.js')


// Export a specific calendar as ICS file
router.get('/export/:listId', authenticateToken, (req, res) => {
  try {
    const userId = req.user.id
    const { listId } = req.params
    const db = getDatabase()

    // Get the task list
    const taskList = db.prepare(`
      SELECT * FROM task_lists 
      WHERE id = ?
    `).get(listId)

    if (!taskList) {
      return res.status(404).json({ error: 'Task list not found' })
    }

    // Get all tasks for this list
    const tasks = db.prepare(`
      SELECT * FROM tasks 
      WHERE list_id = ? AND _deleted = 0
      ORDER BY created
    `).all(listId)

    // Create ICS calendar
    const calendar = new ical.Component(['vcalendar', [], []])
    calendar.addPropertyWithValue('version', '2.0')
    calendar.addPropertyWithValue('prodid', '-//OpenTasks//OpenTasks Calendar//EN')
    calendar.addPropertyWithValue('calscale', 'GREGORIAN')
    calendar.addPropertyWithValue('method', 'PUBLISH')

    // Add calendar name
    calendar.addPropertyWithValue('x-wr-calname', taskList.name)

    // Convert each task to VTODO
    tasks.forEach(task => {
      const vtodo = new ical.Component(['vtodo', [], []])
      
      // Basic properties
      vtodo.addPropertyWithValue('uid', task._uid || `task-${task.id}@opentasks.local`)
      vtodo.addPropertyWithValue('summary', task.title)
      
      if (task.description) {
        vtodo.addPropertyWithValue('description', task.description)
      }
      
      if (task.location) {
        vtodo.addPropertyWithValue('location', task.location)
      }
      
      if (task.url) {
        vtodo.addPropertyWithValue('url', task.url)
      }

      // Status mapping
      let status = 'NEEDS-ACTION'
      if (task.status === 2) { // Completed
        status = 'COMPLETED'
      } else if (task.status === 1) { // In Progress
        status = 'IN-PROCESS'
      }
      vtodo.addPropertyWithValue('status', status)

      // Priority mapping (0-9 to 0-9, but inverted for iCal)
      if (task.priority && task.priority > 0) {
        const icalPriority = Math.max(1, 10 - task.priority)
        vtodo.addPropertyWithValue('priority', icalPriority)
      }

      // Completion
      if (task.completed) {
        const completedTime = ical.Time.fromJSDate(new Date(task.completed))
        vtodo.addPropertyWithValue('completed', completedTime)
      }

      // Due date
      if (task.due) {
        const dueTime = ical.Time.fromJSDate(new Date(task.due))
        if (task.is_allday) {
          dueTime.isDate = true
        }
        vtodo.addPropertyWithValue('due', dueTime)
      }

      // Start date
      if (task.dtstart) {
        const startTime = ical.Time.fromJSDate(new Date(task.dtstart))
        if (task.is_allday) {
          startTime.isDate = true
        }
        vtodo.addPropertyWithValue('dtstart', startTime)
      }

      // Created and modified timestamps
      if (task.created) {
        const createdTime = ical.Time.fromJSDate(new Date(task.created))
        vtodo.addPropertyWithValue('created', createdTime)
      }

      if (task.last_modified) {
        const modifiedTime = ical.Time.fromJSDate(new Date(task.last_modified))
        vtodo.addPropertyWithValue('last-modified', modifiedTime)
      }

      // Percent complete
      if (task.percent_complete !== null && task.percent_complete !== undefined) {
        vtodo.addPropertyWithValue('percent-complete', task.percent_complete)
      }

      // Add VTODO to calendar
      calendar.addSubcomponent(vtodo)
    })

    // Generate ICS content
    const icsContent = calendar.toString()

    // Set headers for file download
    const filename = `${taskList.name.replace(/[^a-zA-Z0-9]/g, '_')}.ics`
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')
    
    res.send(icsContent)

  } catch (error) {
    console.error('Calendar export error:', error)
    res.status(500).json({ error: 'Failed to export calendar' })
  }
})

// Import a calendar from ICS file
router.post('/import', authenticateToken, (req, res) => {
  try {
    console.log('=== BACKEND IMPORT DEBUG ===')
    console.log('Request body keys:', Object.keys(req.body || {}))
    console.log('Request body icsContent exists:', !!req.body?.icsContent)
    console.log('Request body calendarId exists:', !!req.body?.calendarId)
    console.log('Request body calendarId value:', req.body?.calendarId)
    console.log('User:', req.user)
    
    const userId = req.user?.userId
    const { icsContent, calendarId } = req.body
    const db = getDatabase()

    console.log('Parsed userId:', userId)
    console.log('Parsed icsContent length:', icsContent?.length)
    console.log('Parsed calendarId:', calendarId, 'type:', typeof calendarId)

    if (!icsContent) {
      console.log('ERROR: Missing icsContent')
      return res.status(400).json({ error: 'ICS content is required' })
    }

    if (!calendarId) {
      console.log('ERROR: Missing calendarId')
      return res.status(400).json({ error: 'Calendar ID is required' })
    }

    // Get user info to verify ownership
    const user = db.prepare(`
      SELECT username FROM users WHERE id = ?
    `).get(userId)
    
    if (!user) {
      return res.status(401).json({ error: 'User not found' })
    }

    // Verify the calendar exists and belongs to the user
    const taskList = db.prepare(`
      SELECT * FROM task_lists 
      WHERE id = ? AND account_name = ?
    `).get(calendarId, user.username)

    if (!taskList) {
      return res.status(404).json({ error: 'Calendar not found or access denied' })
    }

    // Parse ICS content
    const jcalData = ical.parse(icsContent)
    const calendar = new ical.Component(jcalData)

    const listId = calendarId

    // Get all VTODO components
    const vtodos = calendar.getAllSubcomponents('vtodo')
    
    let importedTasks = 0
    let errors = 0

    // Insert tasks
    const insertTask = db.prepare(`
      INSERT INTO tasks (
        list_id, title, description, location, url, priority, status, 
        due, dtstart, completed, created, last_modified, 
        percent_complete, _uid, is_allday
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    vtodos.forEach(vtodo => {
      try {
        // Extract properties
        const summary = vtodo.getFirstPropertyValue('summary') || 'Untitled Task'
        const description = vtodo.getFirstPropertyValue('description') || ''
        const location = vtodo.getFirstPropertyValue('location') || ''
        const url = vtodo.getFirstPropertyValue('url') || ''
        const uid = vtodo.getFirstPropertyValue('uid') || `imported-${Date.now()}-${Math.random()}`
        
        // Status mapping
        const status = vtodo.getFirstPropertyValue('status') || 'NEEDS-ACTION'
        let taskStatus = 0 // Not started
        if (status === 'COMPLETED') {
          taskStatus = 2
        } else if (status === 'IN-PROCESS') {
          taskStatus = 1
        }

        // Priority mapping (invert iCal priority)
        const icalPriority = vtodo.getFirstPropertyValue('priority') || 0
        const taskPriority = icalPriority > 0 ? Math.max(0, 10 - icalPriority) : 0

        // Dates
        const dueProp = vtodo.getFirstProperty('due')
        const due = dueProp ? dueProp.getFirstValue().toJSDate().toISOString() : null
        const dueIsAllDay = dueProp && dueProp.getFirstValue().isDate

        const startProp = vtodo.getFirstProperty('dtstart')
        const dtstart = startProp ? startProp.getFirstValue().toJSDate().toISOString() : null
        const startIsAllDay = startProp && startProp.getFirstValue().isDate

        const completedProp = vtodo.getFirstProperty('completed')
        const completed = completedProp ? completedProp.getFirstValue().toJSDate().toISOString() : null

        const createdProp = vtodo.getFirstProperty('created')
        const created = createdProp ? createdProp.getFirstValue().toJSDate().toISOString() : new Date().toISOString()

        const modifiedProp = vtodo.getFirstProperty('last-modified')
        const lastModified = modifiedProp ? modifiedProp.getFirstValue().toJSDate().toISOString() : new Date().toISOString()

        // Percent complete
        const percentComplete = vtodo.getFirstPropertyValue('percent-complete') || 0

        // Determine if all-day based on any date property
        const isAllDay = dueIsAllDay || startIsAllDay

        insertTask.run(
          listId,
          summary,
          description,
          location,
          url,
          taskPriority,
          taskStatus,
          due,
          dtstart,
          completed,
          created,
          lastModified,
          percentComplete,
          uid,
          isAllDay ? 1 : 0
        )

        importedTasks++

      } catch (error) {
        console.error('Error importing task:', error)
        errors++
      }
    })

    res.json({
      success: true,
      message: `Calendar imported successfully`,
      results: {
        calendarName: taskList.name,
        listId: listId,
        tasksImported: importedTasks,
        errors: errors
      }
    })

  } catch (error) {
    console.error('Calendar import error:', error)
    res.status(500).json({ error: 'Failed to import calendar' })
  }
})

module.exports = router