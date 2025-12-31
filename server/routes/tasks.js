const express = require('express');
const { getDatabase } = require('../database/init');
const { validateTask, validateTaskUpdate } = require('../middleware/validation');
const { authenticateToken } = require('../middleware/auth');
const { broadcastUpdate } = require('../websocket/server');
const syncTrigger = require('../services/syncTrigger');

const router = express.Router();

// Get all tasks with optional filtering
router.get('/', authenticateToken, (req, res) => {
  try {
    const db = getDatabase();
    const { 
      list_id, 
      listId, // Also accept listId for frontend compatibility
      status, 
      priority, 
      due_after, 
      due_before,
      search,
      excludeStatus, // New parameter to exclude specific status
      limit = 100,
      offset = 0
    } = req.query;

    let query = `
      SELECT t.*, tl.name as list_name, tl.color as list_color
      FROM tasks t
      LEFT JOIN task_lists tl ON t.list_id = tl.id
      WHERE t._deleted = 0
    `;
    
    const params = [];

    const effectiveListId = list_id || listId;
    if (effectiveListId && effectiveListId !== 'all') {
      query += ' AND t.list_id = ?';
      params.push(effectiveListId);
    }

    if (status !== undefined && status !== 'all') {
      query += ' AND t.status = ?';
      params.push(status);
      console.log('Filtering by status:', status, 'type:', typeof status);
    }

    if (excludeStatus !== undefined) {
      query += ' AND t.status != ?';
      params.push(excludeStatus);
    }

    if (priority !== undefined && priority !== 'all') {
      query += ' AND t.priority = ?';
      params.push(priority);
    }

    if (due_after) {
      query += ' AND t.due >= ?';
      params.push(due_after);
    }

    if (due_before) {
      query += ' AND t.due <= ?';
      params.push(due_before);
    }

    if (search) {
      query += ' AND (t.title LIKE ? OR t.description LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }

    query += ' ORDER BY t.due ASC, t.priority ASC, t.created DESC';
    query += ' LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));

    const tasks = db.prepare(query).all(...params);
    
    console.log('Query:', query);
    console.log('Params:', params);
    console.log('Tasks returned:', tasks.length);
    if (status === '2') {
      console.log('Completed tasks:', tasks.map(t => ({ id: t.id, title: t.title, status: t.status, statusType: typeof t.status })));
    }
    
    // Get task counts for pagination
    let countQuery = 'SELECT COUNT(*) as total FROM tasks t WHERE t._deleted = 0';
    const countParams = [];
    
    if (list_id) {
      countQuery += ' AND t.list_id = ?';
      countParams.push(list_id);
    }
    
    const total = db.prepare(countQuery).get(...countParams).total;

    res.json({
      tasks,
      pagination: {
        total,
        limit: parseInt(limit),
        offset: parseInt(offset),
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching tasks:', error);
    res.status(500).json({ error: 'Failed to fetch tasks' });
  }
});

// Get a specific task
router.get('/:id', authenticateToken, (req, res) => {
  try {
    const db = getDatabase();
    const taskId = req.params.id;

    const task = db.prepare(`
      SELECT t.*, tl.name as list_name, tl.color as list_color
      FROM tasks t
      LEFT JOIN task_lists tl ON t.list_id = tl.id
      WHERE t.id = ? AND t._deleted = 0
    `).get(taskId);

    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    // Get task properties (attachments, alarms, etc.)
    const properties = db.prepare(`
      SELECT * FROM properties WHERE task_id = ?
    `).all(taskId);

    // Get child tasks
    const children = db.prepare(`
      SELECT id, title, status, due FROM tasks 
      WHERE parent_id = ? AND _deleted = 0
      ORDER BY sorting, created
    `).all(taskId);

    res.json({
      ...task,
      properties,
      children
    });
  } catch (error) {
    console.error('Error fetching task:', error);
    res.status(500).json({ error: 'Failed to fetch task' });
  }
});

// Create a new task
router.post('/', authenticateToken, validateTask, (req, res) => {
  try {
    const db = getDatabase();
    const taskData = req.body;

    // Generate UID if not provided
    if (!taskData._uid) {
      taskData._uid = require('uuid').v4();
    }

    const insertTask = db.prepare(`
      INSERT INTO tasks (
        list_id, title, description, priority, status, dtstart, is_allday, due, _uid, _dirty
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = insertTask.run(
      taskData.list_id,
      taskData.title,
      taskData.description || null,
      taskData.priority || 0,
      taskData.status || 0,
      taskData.dtstart ? (taskData.dtstart instanceof Date ? taskData.dtstart.toISOString() : taskData.dtstart) : null,
      taskData.is_allday || 0,
      taskData.due ? (taskData.due instanceof Date ? taskData.due.toISOString() : taskData.due) : null,
      taskData._uid,
      1
    );

    const newTask = db.prepare(`
      SELECT t.*, tl.name as list_name, tl.color as list_color
      FROM tasks t
      LEFT JOIN task_lists tl ON t.list_id = tl.id
      WHERE t.id = ?
    `).get(result.lastInsertRowid);

    // Broadcast update to connected clients
    broadcastUpdate('task_created', newTask);

    // Trigger sync for CalDAV lists
    syncTrigger.triggerSyncForList(taskData.list_id, 'create', result.lastInsertRowid);

    res.status(201).json(newTask);
  } catch (error) {
    console.error('Error creating task:', error);
    res.status(500).json({ error: 'Failed to create task' });
  }
});

// Update a task
router.put('/:id', authenticateToken, validateTaskUpdate, (req, res) => {
  try {
    const db = getDatabase();
    const taskId = req.params.id;
    const updateData = req.body;

    // Check if task exists
    const existingTask = db.prepare('SELECT * FROM tasks WHERE id = ? AND _deleted = 0').get(taskId);
    if (!existingTask) {
      return res.status(404).json({ error: 'Task not found' });
    }

    // Build dynamic update query
    const updateFields = [];
    const values = [];

    Object.keys(updateData).forEach(key => {
      if (key !== 'id' && updateData[key] !== undefined) {
        updateFields.push(`${key} = ?`);
        
        // Handle date fields properly for SQLite
        let value = updateData[key];
        if (key === 'dtstart' || key === 'due') {
          if (value instanceof Date) {
            value = value.toISOString();
          } else if (typeof value === 'string' && value !== '') {
            // Ensure it's a valid ISO string
            try {
              new Date(value).toISOString();
            } catch (e) {
              console.error(`Invalid date format for ${key}:`, value);
              value = null;
            }
          } else if (value === '') {
            value = null;
          }
        }
        
        values.push(value);
      }
    });

    if (updateFields.length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    updateFields.push('last_modified = CURRENT_TIMESTAMP');
    updateFields.push('_dirty = 1');
    values.push(taskId);

    const updateQuery = `UPDATE tasks SET ${updateFields.join(', ')} WHERE id = ?`;
    db.prepare(updateQuery).run(...values);

    // Get updated task
    const updatedTask = db.prepare(`
      SELECT t.*, tl.name as list_name, tl.color as list_color
      FROM tasks t
      LEFT JOIN task_lists tl ON t.list_id = tl.id
      WHERE t.id = ?
    `).get(taskId);

    // Broadcast update to connected clients
    broadcastUpdate('task_updated', updatedTask);

    // Trigger sync for CalDAV lists
    syncTrigger.triggerSyncForList(existingTask.list_id, 'update', taskId);

    res.json(updatedTask);
  } catch (error) {
    console.error('Error updating task:', error);
    res.status(500).json({ error: 'Failed to update task' });
  }
});

// Delete a task (soft delete)
router.delete('/:id', authenticateToken, (req, res) => {
  try {
    const db = getDatabase();
    const taskId = req.params.id;

    // Check if task exists
    const existingTask = db.prepare('SELECT * FROM tasks WHERE id = ? AND _deleted = 0').get(taskId);
    if (!existingTask) {
      return res.status(404).json({ error: 'Task not found' });
    }

    // Soft delete the task
    db.prepare('UPDATE tasks SET _deleted = 1, _dirty = 1 WHERE id = ?').run(taskId);

    // Also soft delete child tasks
    db.prepare('UPDATE tasks SET _deleted = 1, _dirty = 1 WHERE parent_id = ?').run(taskId);

    // Broadcast update to connected clients
    broadcastUpdate('task_deleted', { id: taskId });

    // Trigger sync for CalDAV lists
    syncTrigger.triggerSyncForList(existingTask.list_id, 'delete', taskId);

    res.json({ message: 'Task deleted successfully' });
  } catch (error) {
    console.error('Error deleting task:', error);
    res.status(500).json({ error: 'Failed to delete task' });
  }
});

// Complete a task
router.patch('/:id/complete', authenticateToken, (req, res) => {
  try {
    const db = getDatabase();
    const taskId = req.params.id;

    const result = db.prepare(`
      UPDATE tasks 
      SET status = 2, completed = CURRENT_TIMESTAMP, _dirty = 1
      WHERE id = ? AND _deleted = 0
    `).run(taskId);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const updatedTask = db.prepare(`
      SELECT t.*, tl.name as list_name, tl.color as list_color
      FROM tasks t
      LEFT JOIN task_lists tl ON t.list_id = tl.id
      WHERE t.id = ?
    `).get(taskId);

    // Broadcast update to connected clients
    broadcastUpdate('task_completed', updatedTask);

    // Trigger sync for CalDAV lists
    syncTrigger.triggerSyncForList(updatedTask.list_id, 'complete', taskId);

    res.json(updatedTask);
  } catch (error) {
    console.error('Error completing task:', error);
    res.status(500).json({ error: 'Failed to complete task' });
  }
});

// Toggle task status (between completed and pending)
router.patch('/:id/toggle', authenticateToken, (req, res) => {
  try {
    const db = getDatabase();
    const taskId = req.params.id;

    // Get current task status
    const currentTask = db.prepare('SELECT * FROM tasks WHERE id = ? AND _deleted = 0').get(taskId);
    if (!currentTask) {
      return res.status(404).json({ error: 'Task not found' });
    }

    // Toggle between completed (2) and pending (0)
    const newStatus = currentTask.status === 2 ? 0 : 2;
    const completedValue = newStatus === 2 ? 'CURRENT_TIMESTAMP' : 'NULL';

    const result = db.prepare(`
      UPDATE tasks 
      SET status = ?, completed = ${completedValue}, _dirty = 1
      WHERE id = ? AND _deleted = 0
    `).run(newStatus, taskId);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const updatedTask = db.prepare(`
      SELECT t.*, tl.name as list_name, tl.color as list_color
      FROM tasks t
      LEFT JOIN task_lists tl ON t.list_id = tl.id
      WHERE t.id = ?
    `).get(taskId);

    // Broadcast update to connected clients
    broadcastUpdate('task_toggled', updatedTask);

    // Trigger sync for CalDAV lists
    syncTrigger.triggerSyncForList(updatedTask.list_id, 'toggle', taskId);

    res.json(updatedTask);
  } catch (error) {
    console.error('Error toggling task:', error);
    res.status(500).json({ error: 'Failed to toggle task' });
  }
});

// Search tasks
router.get('/search/:query', authenticateToken, (req, res) => {
  try {
    const db = getDatabase();
    const searchQuery = req.params.query;
    const { limit = 50 } = req.query;

    const tasks = db.prepare(`
      SELECT t.*, tl.name as list_name, tl.color as list_color
      FROM tasks t
      LEFT JOIN task_lists tl ON t.list_id = tl.id
      WHERE t._deleted = 0 
      AND (t.title LIKE ? OR t.description LIKE ? OR t.location LIKE ?)
      ORDER BY 
        CASE 
          WHEN t.title LIKE ? THEN 1
          WHEN t.description LIKE ? THEN 2
          ELSE 3
        END,
        t.due ASC
      LIMIT ?
    `).all(
      `%${searchQuery}%`,
      `%${searchQuery}%`,
      `%${searchQuery}%`,
      `%${searchQuery}%`,
      `%${searchQuery}%`,
      parseInt(limit)
    );

    res.json({ tasks, query: searchQuery });
  } catch (error) {
    console.error('Error searching tasks:', error);
    res.status(500).json({ error: 'Failed to search tasks' });
  }
});

// Delete a task
router.delete('/:id', authenticateToken, (req, res) => {
  try {
    const db = getDatabase();
    const taskId = req.params.id;

    // Check if task exists
    const existingTask = db.prepare('SELECT * FROM tasks WHERE id = ? AND _deleted = 0').get(taskId);
    if (!existingTask) {
      return res.status(404).json({ error: 'Task not found' });
    }

    // Mark task as deleted instead of actually deleting it (soft delete)
    const result = db.prepare(`
      UPDATE tasks 
      SET _deleted = 1, _dirty = 1, last_modified = CURRENT_TIMESTAMP
      WHERE id = ? AND _deleted = 0
    `).run(taskId);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }

    // Broadcast update to connected clients
    broadcastUpdate('task_deleted', { id: taskId });

    // Trigger sync for CalDAV lists
    syncTrigger.triggerSyncForList(existingTask.list_id, 'delete', taskId);

    res.status(204).send(); // No content response for successful deletion
  } catch (error) {
    console.error('Error deleting task:', error);
    res.status(500).json({ error: 'Failed to delete task' });
  }
});

module.exports = router;