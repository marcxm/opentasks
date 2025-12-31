const express = require('express');
const fileManager = require('../services/fileManager');
const { broadcastUpdate } = require('../websocket/server');

const router = express.Router();

// Get all task lists
router.get('/', async (req, res) => {
  try {
    const collections = await fileManager.getCollections();
    res.json(collections);
  } catch (error) {
    console.error('Error fetching task lists:', error);
    res.status(500).json({ error: 'Failed to fetch task lists' });
  }
});

// Get a specific task list
router.get('/:id', async (req, res) => {
  try {
    const listId = req.params.id;
    const collection = await fileManager.getCollection(listId);
    
    if (!collection) {
      return res.status(404).json({ error: 'Task list not found' });
    }

    res.json(collection);
  } catch (error) {
    console.error('Error fetching task list:', error);
    res.status(500).json({ error: 'Failed to fetch task list' });
  }
});

// Create a new task list
router.post('/', async (req, res) => {
  try {
    const { name, color = '#007bff' } = req.body;
    
    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }

    // Check if collection already exists
    const existingCollection = await fileManager.getCollection(name);
    if (existingCollection) {
      return res.status(409).json({ error: 'Task list with this name already exists' });
    }

    const collection = await fileManager.createCollection(name, color);
    
    // Broadcast update to connected clients
    broadcastUpdate('list_created', collection);

    res.status(201).json(collection);
  } catch (error) {
    console.error('Error creating task list:', error);
    res.status(500).json({ error: 'Failed to create task list' });
  }
});

// Update a task list
router.put('/:id', async (req, res) => {
  try {
    const listId = req.params.id;
    const { name, color } = req.body;

    const existingCollection = await fileManager.getCollection(listId);
    if (!existingCollection) {
      return res.status(404).json({ error: 'Task list not found' });
    }

    // Update collection metadata
    const metadataPath = `/app/data/collections/${listId}/.metadata.json`;
    const fs = require('fs').promises;
    
    let metadata = {
      name: existingCollection.name,
      color: existingCollection.color,
      created: existingCollection.created || new Date().toISOString(),
      type: 'caldav'
    };

    if (name !== undefined) metadata.name = name;
    if (color !== undefined) metadata.color = color;

    await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));

    const updatedCollection = {
      id: listId,
      name: metadata.name,
      color: metadata.color,
      type: metadata.type,
      path: existingCollection.path
    };
    
    // Broadcast update to connected clients
    broadcastUpdate('list_updated', updatedCollection);

    res.json(updatedCollection);
  } catch (error) {
    console.error('Error updating task list:', error);
    res.status(500).json({ error: 'Failed to update task list' });
  }
});

// Delete a task list
router.delete('/:id', async (req, res) => {
  try {
    const listId = req.params.id;
    const { force = false } = req.query;

    const collection = await fileManager.getCollection(listId);
    if (!collection) {
      return res.status(404).json({ error: 'Task list not found' });
    }

    // Check if collection has tasks
    const tasks = await fileManager.getTasks(listId);
    if (tasks.length > 0 && !force) {
      return res.status(400).json({ 
        error: 'Cannot delete task list with tasks. Use force=true to delete anyway.',
        taskCount: tasks.length
      });
    }

    // Delete collection directory
    const fs = require('fs').promises;
    const path = require('path');
    const collectionPath = path.join('/app/data/collections', listId);
    
    await fs.rm(collectionPath, { recursive: true, force: true });
    
    // Broadcast update to connected clients
    broadcastUpdate('list_deleted', { id: listId });

    res.json({ message: 'Task list deleted successfully' });
  } catch (error) {
    console.error('Error deleting task list:', error);
    res.status(500).json({ error: 'Failed to delete task list' });
  }
});

// Get tasks for a specific list
router.get('/:id/tasks', async (req, res) => {
  try {
    const listId = req.params.id;
    const { 
      status, 
      priority, 
      due_after, 
      due_before,
      search,
      excludeStatus,
      limit = 100,
      offset = 0
    } = req.query;

    let tasks = await fileManager.getTasks(listId);
    
    // Apply filters
    if (status !== undefined && status !== 'all') {
      tasks = tasks.filter(task => task.status == status);
    }

    if (excludeStatus !== undefined) {
      tasks = tasks.filter(task => task.status != excludeStatus);
    }

    if (priority !== undefined && priority !== 'all') {
      tasks = tasks.filter(task => task.priority == priority);
    }

    if (due_after) {
      const afterDate = new Date(due_after);
      tasks = tasks.filter(task => {
        if (!task.due) return false;
        return new Date(task.due) >= afterDate;
      });
    }

    if (due_before) {
      const beforeDate = new Date(due_before);
      tasks = tasks.filter(task => {
        if (!task.due) return false;
        return new Date(task.due) <= beforeDate;
      });
    }

    if (search) {
      const searchLower = search.toLowerCase();
      tasks = tasks.filter(task => 
        task.title.toLowerCase().includes(searchLower) ||
        (task.description && task.description.toLowerCase().includes(searchLower)) ||
        (task.location && task.location.toLowerCase().includes(searchLower))
      );
    }

    // Apply pagination
    const total = tasks.length;
    const paginatedTasks = tasks.slice(offset, offset + parseInt(limit));

    res.json({
      tasks: paginatedTasks,
      total,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
  } catch (error) {
    console.error('Error fetching tasks for list:', error);
    res.status(500).json({ error: 'Failed to fetch tasks for list' });
  }
});

module.exports = router;