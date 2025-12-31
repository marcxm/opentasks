const express = require('express')
const router = express.Router()
const { getDatabase } = require('../database/init')
const { authenticateToken } = require('../middleware/auth')

// Export all tasks and lists as JSON
router.get('/export', authenticateToken, (req, res) => {
  try {
    const userId = req.user.id
    const db = getDatabase()
    
    // Get all task lists for the user
    const taskLists = db.prepare(`
      SELECT id, name, color, account_name, account_type, visible, sync_enabled, access_level, owner, created_at, updated_at
      FROM task_lists 
      WHERE account_name = ?
      ORDER BY name
    `).all(userId)
    
    // Get all tasks for the user
    const tasks = db.prepare(`
      SELECT t.*, tl.name as list_name, tl.account_type
      FROM tasks t
      JOIN task_lists tl ON t.list_id = tl.id
      WHERE tl.account_name = ?
      ORDER BY t.created
    `).all(userId)
    
    // Get all categories for the user
    const categories = db.prepare(`
      SELECT * FROM categories 
      WHERE account_name = ?
      ORDER BY name
    `).all(userId)
    
    const exportData = {
      version: '1.0',
      exportDate: new Date().toISOString(),
      user: userId,
      taskLists: taskLists,
      tasks: tasks,
      categories: categories
    }
    
    res.json(exportData)
  } catch (error) {
    console.error('Export error:', error)
    res.status(500).json({ error: 'Failed to export data' })
  }
})

// Import tasks and lists from JSON
router.post('/import', authenticateToken, (req, res) => {
  try {
    const userId = req.user.id
    const db = getDatabase()
    const { taskLists, tasks, categories } = req.body
    
    if (!taskLists || !tasks) {
      return res.status(400).json({ error: 'Invalid import data: missing taskLists or tasks' })
    }
    
    const results = {
      taskLists: { created: 0, updated: 0, errors: 0 },
      tasks: { created: 0, updated: 0, errors: 0 },
      categories: { created: 0, updated: 0, errors: 0 }
    }
    
    // Import categories first (if any)
    if (categories && categories.length > 0) {
      const insertCategory = db.prepare(`
        INSERT OR REPLACE INTO categories (id, account_name, account_type, name, color, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      
      categories.forEach(category => {
        try {
          insertCategory.run(
            category.id,
            userId,
            category.account_type || 'org.dmfs.account.LOCAL',
            category.name,
            category.color || '#2196F3',
            category.created_at || new Date().toISOString()
          )
          results.categories.created++
        } catch (error) {
          console.error('Error importing category:', error)
          results.categories.errors++
        }
      })
    }
    
    // Import task lists
    const insertTaskList = db.prepare(`
      INSERT OR REPLACE INTO task_lists (id, name, color, account_name, account_type, visible, sync_enabled, access_level, owner, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    
    taskLists.forEach(list => {
      try {
        insertTaskList.run(
          list.id,
          list.name,
          list.color || '#2196F3',
          userId, // Set current user as owner
          list.account_type || 'org.dmfs.account.LOCAL', // Default to local
          list.visible !== undefined ? list.visible : 1,
          list.sync_enabled !== undefined ? list.sync_enabled : 0,
          list.access_level || 0,
          list.owner || '',
          list.created_at || new Date().toISOString(),
          list.updated_at || new Date().toISOString()
        )
        results.taskLists.created++
      } catch (error) {
        console.error('Error importing task list:', error)
        results.taskLists.errors++
      }
    })
    
    // Import tasks
    const insertTask = db.prepare(`
      INSERT OR REPLACE INTO tasks (
        id, list_id, title, description, status, priority, due, dtstart, 
        completed, created, last_modified, _uid, etag, 
        last_synced, location, url, percent_complete
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    
    tasks.forEach(task => {
      try {
        // Find the corresponding list_id for this task
        const taskList = taskLists.find(list => list.name === task.list_name)
        if (!taskList) {
          console.error('Task list not found for task:', task.title)
          results.tasks.errors++
          return
        }
        
        insertTask.run(
          task.id,
          taskList.id, // Use the imported list ID
          task.title,
          task.description || '',
          task.status || 0,
          task.priority || 0,
          task.due || task.due_date || null,
          task.dtstart || task.start_date || null,
          task.completed || task.completed_date || null,
          task.created || task.created_at || new Date().toISOString(),
          task.last_modified || new Date().toISOString(),
          task._uid || null,
          task.etag || null,
          task.last_synced || null,
          task.location || null,
          task.url || null,
          task.percent_complete || 0
        )
        results.tasks.created++
      } catch (error) {
        console.error('Error importing task:', error)
        results.tasks.errors++
      }
    })
    
    res.json({
      success: true,
      message: 'Import completed successfully',
      results: results
    })
    
  } catch (error) {
    console.error('Import error:', error)
    res.status(500).json({ error: 'Failed to import data' })
  }
})

module.exports = router