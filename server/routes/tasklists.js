const express = require('express');
const { getDatabase } = require('../database/init');
const { validateTaskList } = require('../middleware/validation');
const { authenticateToken } = require('../middleware/auth');
const { broadcastUpdate } = require('../websocket/server');
const syncTrigger = require('../services/syncTrigger');

const router = express.Router();

// Get all task lists
router.get('/', authenticateToken, (req, res) => {
  try {
    const db = getDatabase();
    const { visible } = req.query;

    let query = 'SELECT * FROM task_lists';
    const params = [];

    if (visible !== undefined) {
      query += ' WHERE visible = ?';
      params.push(visible === 'true' ? 1 : 0);
    }

    query += ' ORDER BY name ASC';

    const taskLists = db.prepare(query).all(...params);
    res.json(taskLists);
  } catch (error) {
    console.error('Error fetching task lists:', error);
    res.status(500).json({ error: 'Failed to fetch task lists' });
  }
});

// Get a specific task list
router.get('/:id', authenticateToken, (req, res) => {
  try {
    const db = getDatabase();
    const listId = req.params.id;

    const taskList = db.prepare('SELECT * FROM task_lists WHERE id = ?').get(listId);

    if (!taskList) {
      return res.status(404).json({ error: 'Task list not found' });
    }

    res.json(taskList);
  } catch (error) {
    console.error('Error fetching task list:', error);
    res.status(500).json({ error: 'Failed to fetch task list' });
  }
});

// Create a new task list
router.post('/', authenticateToken, validateTaskList, (req, res) => {
  try {
    const db = getDatabase();
    const listData = req.body;

    const insertList = db.prepare(`
      INSERT INTO task_lists (name, color, account_name, account_type, visible, sync_enabled, owner, access_level)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = insertList.run(
      listData.name,
      listData.color,
      listData.account_name,
      listData.account_type,
      listData.visible ? 1 : 0,
      listData.sync_enabled ? 1 : 0,
      listData.owner || null,
      listData.access_level
    );

    const newList = db.prepare('SELECT * FROM task_lists WHERE id = ?').get(result.lastInsertRowid);

    // Broadcast update to connected clients
    broadcastUpdate('tasklist_created', newList);

    // Trigger sync for CalDAV lists
    if (listData.account_type === 'caldav') {
      syncTrigger.triggerImmediateSync(result.lastInsertRowid, 'create_list', result.lastInsertRowid);
    }

    res.status(201).json(newList);
  } catch (error) {
    console.error('Error creating task list:', error);
    res.status(500).json({ error: 'Failed to create task list' });
  }
});

// Update a task list
router.put('/:id', authenticateToken, validateTaskList, (req, res) => {
  try {
    const db = getDatabase();
    const listId = req.params.id;
    const updateData = req.body;

    // Check if task list exists
    const existingList = db.prepare('SELECT * FROM task_lists WHERE id = ?').get(listId);
    if (!existingList) {
      return res.status(404).json({ error: 'Task list not found' });
    }

    const updateList = db.prepare(`
      UPDATE task_lists 
      SET name = ?, color = ?, visible = ?, sync_enabled = ?, owner = ?, access_level = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);

    updateList.run(
      updateData.name,
      updateData.color,
      updateData.visible ? 1 : 0,
      updateData.sync_enabled ? 1 : 0,
      updateData.owner || null,
      updateData.access_level,
      listId
    );

    const updatedList = db.prepare('SELECT * FROM task_lists WHERE id = ?').get(listId);

    // Broadcast update to connected clients
    broadcastUpdate('tasklist_updated', updatedList);

    res.json(updatedList);
  } catch (error) {
    console.error('Error updating task list:', error);
    res.status(500).json({ error: 'Failed to update task list' });
  }
});

// Delete a task list
router.delete('/:id', authenticateToken, (req, res) => {
  try {
    const db = getDatabase();
    const listId = req.params.id;

    // Check if task list exists
    const existingList = db.prepare('SELECT * FROM task_lists WHERE id = ?').get(listId);
    if (!existingList) {
      return res.status(404).json({ error: 'Task list not found' });
    }

    // Check if there are tasks in this list
    const taskCount = db.prepare('SELECT COUNT(*) as count FROM tasks WHERE list_id = ? AND _deleted = 0').get(listId);
    if (taskCount.count > 0) {
      return res.status(400).json({ 
        error: 'Cannot delete task list with existing tasks',
        taskCount: taskCount.count
      });
    }

    // Delete the task list
    db.prepare('DELETE FROM task_lists WHERE id = ?').run(listId);

    // Broadcast update to connected clients
    broadcastUpdate('tasklist_deleted', { id: listId });

    res.json({ message: 'Task list deleted successfully' });
  } catch (error) {
    console.error('Error deleting task list:', error);
    res.status(500).json({ error: 'Failed to delete task list' });
  }
});

// Get tasks in a specific list
router.get('/:id/tasks', authenticateToken, (req, res) => {
  try {
    const db = getDatabase();
    const listId = req.params.id;
    const { status, limit = 100, offset = 0 } = req.query;

    let query = `
      SELECT t.*, tl.name as list_name, tl.color as list_color
      FROM tasks t
      LEFT JOIN task_lists tl ON t.list_id = tl.id
      WHERE t.list_id = ? AND t._deleted = 0
    `;
    
    const params = [listId];

    if (status !== undefined) {
      query += ' AND t.status = ?';
      params.push(status);
    }

    query += ' ORDER BY t.due ASC, t.priority ASC, t.created DESC';
    query += ' LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));

    const tasks = db.prepare(query).all(...params);

    // Get task count for pagination
    let countQuery = 'SELECT COUNT(*) as total FROM tasks WHERE list_id = ? AND _deleted = 0';
    const countParams = [listId];
    
    if (status !== undefined) {
      countQuery += ' AND status = ?';
      countParams.push(status);
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
    console.error('Error fetching tasks for list:', error);
    res.status(500).json({ error: 'Failed to fetch tasks for list' });
  }
});

module.exports = router;