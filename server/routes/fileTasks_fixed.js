const express = require('express');
const fileManager = require('../services/fileManager');
const syncTrigger = require('../services/syncTrigger');
const { validateTask, validateTaskUpdate } = require('../middleware/validation');
const { broadcastUpdate } = require('../websocket/server');

const router = express.Router();

// Helper function to handle timezone conversion for dates
function handleTimezoneForDates(taskData) {
  if (taskData.dtstart) {
    // Convert Date object to string if needed, then handle timezone
    const dtstartStr = taskData.dtstart instanceof Date ? taskData.dtstart.toISOString() : String(taskData.dtstart);
    
    // If dtstart doesn't end with Z, treat it as local time
    if (!dtstartStr.endsWith('Z') && !dtstartStr.includes('+') && !dtstartStr.includes('-', 10)) {
      const localDate = new Date(dtstartStr);
      taskData.dtstart = localDate.toISOString();
    } else if (taskData.dtstart instanceof Date) {
      taskData.dtstart = taskData.dtstart.toISOString();
    }
  }
  
  if (taskData.due) {
    // Convert Date object to string if needed, then handle timezone
    const dueStr = taskData.due instanceof Date ? taskData.due.toISOString() : String(taskData.due);
    
    // If due doesn't end with Z, treat it as local time
    if (!dueStr.endsWith('Z') && !dueStr.includes('+') && !dueStr.includes('-', 10)) {
      const localDate = new Date(dueStr);
      taskData.due = localDate.toISOString();
    } else if (taskData.due instanceof Date) {
      taskData.due = taskData.due.toISOString();
    }
  }
}

// Get all tasks with optional filtering
router.get('/', async (req, res) => {
  try {
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

    const effectiveListId = list_id || listId;
    let tasks;

    if (effectiveListId) {
      tasks = await fileManager.getTasks(effectiveListId);
    } else {
      tasks = await fileManager.getAllTasks();
    }

    // Apply filters
    if (status !== undefined) {
      tasks = tasks.filter(task => task.status == status);
    }

    if (excludeStatus !== undefined) {
      tasks = tasks.filter(task => task.status != excludeStatus);
    }

    if (priority !== undefined) {
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
        (task.description && task.description.toLowerCase().includes(searchLower))
      );
    }

    // Add list_id field to each task for frontend compatibility
    tasks = tasks.map(task => ({
      ...task,
      list_id: task.collection
    }));

    const total = tasks.length;
    const paginatedTasks = tasks.slice(offset, offset + parseInt(limit));

    res.json({
      tasks: paginatedTasks,
      total,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
  } catch (error) {
    console.error('Error fetching tasks:', error);
    res.status(500).json({ error: 'Failed to fetch tasks' });
  }
});

// Create a new task
router.post('/', validateTask, async (req, res) => {
  try {
    const { list_id, listId, ...taskData } = req.body;
    
    const effectiveListId = list_id || listId;
    if (!effectiveListId) {
      return res.status(400).json({ error: 'List ID is required' });
    }

    // Handle timezone for date fields
    handleTimezoneForDates(taskData);

    // Ensure collection exists
    let collection = await fileManager.getCollection(effectiveListId);
    if (!collection) {
      collection = await fileManager.createCollection(effectiveListId);
    }

    const task = await fileManager.createTask(taskData, effectiveListId);
    
    // Broadcast update to connected clients
    broadcastUpdate('task_created', task);

    // Trigger sync for CalDAV lists
    syncTrigger.triggerSyncForList(effectiveListId, 'create', task.id);

    res.status(201).json(task);
  } catch (error) {
    console.error('Error creating task:', error);
    res.status(500).json({ error: 'Failed to create task' });
  }
});

// Get a specific task
router.get('/:id', async (req, res) => {
  try {
    const taskId = req.params.id;
    const { list_id, listId } = req.query;
    
    let effectiveListId = list_id || listId;
    let task;
    
    if (effectiveListId) {
      task = await fileManager.getTask(taskId, effectiveListId);
    } else {
      // Find the task across all collections
      const allTasks = await fileManager.getAllTasks();
      task = allTasks.find(t => t.id === taskId);
    }
    
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }
    res.json(task);
  } catch (error) {
    console.error('Error fetching task:', error);
    res.status(500).json({ error: 'Failed to fetch task' });
  }
});

// Update a task
router.put('/:id', validateTaskUpdate, async (req, res) => {
  try {
    const taskId = req.params.id;
    const { list_id, listId, ...taskData } = req.body;
    
    // Handle timezone for date fields
    handleTimezoneForDates(taskData);
    
    // Find the task's current location
    const allTasks = await fileManager.getAllTasks();
    const currentTask = allTasks.find(t => t.id === taskId);
    
    if (!currentTask) {
      return res.status(404).json({ error: 'Task not found' });
    }
    
    const currentCollection = currentTask.collection;
    const newCollection = list_id || listId || currentCollection;
    
    let task;
    
    // Check if we're moving the task to a different list
    if (newCollection !== currentCollection) {
      console.log(`Moving task ${taskId} from ${currentCollection} to ${newCollection}`);
      
      // Delete from old collection (both locally and remotely)
      await fileManager.deleteTask(taskId, currentCollection);
      
      // Also delete from remote CalDAV server
      const syncManager = require('../services/syncManager');
      const caldavSync = syncManager.getCalDAVSync();
      if (caldavSync && caldavSync.isEnabled) {
        try {
          await caldavSync.deleteTaskFromRemote(taskId, currentCollection);
        } catch (error) {
          console.error(`Failed to delete task from remote server:`, error);
          // Continue anyway - we'll fix it on next sync
        }
      }
      
      // Create in new collection
      const fullTaskData = {
        ...currentTask,
        ...taskData,
        id: taskId, // Keep the same task ID
        list_id: newCollection
      };
      task = await fileManager.createTask(fullTaskData, newCollection);
      
      // Upload to new collection on remote server
      if (caldavSync && caldavSync.isEnabled) {
        try {
          await caldavSync.uploadTaskToRemote(task, newCollection);
        } catch (error) {
          console.error(`Failed to upload task to remote server:`, error);
          // Continue anyway - we'll fix it on next sync
        }
      }
      
      // Trigger sync for both collections
      syncTrigger.triggerSyncForList(currentCollection, 'delete', taskId);
      syncTrigger.triggerSyncForList(newCollection, 'create', taskId);
    } else {
      // Update in place
      task = await fileManager.updateTask(taskId, taskData, currentCollection);
      
      // Immediately upload to remote server for in-place updates
      const syncManager = require('../services/syncManager');
      const caldavSync = syncManager.getCalDAVSync();
      if (caldavSync && caldavSync.isEnabled) {
        try {
          await caldavSync.uploadTaskToRemote(task, currentCollection);
        } catch (error) {
          console.error(`Failed to upload task to remote server:`, error);
          // Continue anyway - we'll fix it on next sync
        }
      }
      
      syncTrigger.triggerSyncForList(currentCollection, 'update', taskId);
    }
    
    // Broadcast update to connected clients
    broadcastUpdate('task_updated', task);
    
    res.json(task);
  } catch (error) {
    console.error('Error updating task:', error);
    res.status(500).json({ error: 'Failed to update task' });
  }
});

// Delete a task
router.delete('/:id', async (req, res) => {
  try {
    const taskId = req.params.id;
    const { list_id, listId } = req.query;
    
    let effectiveListId = list_id || listId;
    if (!effectiveListId) {
      // Find the task across all collections
      const allTasks = await fileManager.getAllTasks();
      const currentTask = allTasks.find(t => t.id === taskId);
      if (currentTask) {
        effectiveListId = currentTask.collection;
      }
    }
    
    if (!effectiveListId) {
      return res.status(404).json({ error: 'Task not found' });
    }
    
    const deleted = await fileManager.deleteTask(taskId, effectiveListId);
    if (!deleted) {
      return res.status(404).json({ error: 'Task not found' });
    }
    
    // Record the deletion and delete from remote server
    const syncManager = require('../services/syncManager');
    const caldavSync = syncManager.getCalDAVSync();
    if (caldavSync && caldavSync.isEnabled) {
      try {
        // Record the deletion to prevent re-download during sync
        await caldavSync.recordTaskDeletion(taskId, effectiveListId);
        
        // Delete from remote server
        await caldavSync.deleteTaskFromRemote(taskId, effectiveListId);
        console.log(`Task ${taskId} deleted from remote server and recorded as deleted`);
      } catch (error) {
        console.error(`Failed to delete task from remote server:`, error);
        // Still record the deletion locally to prevent re-download
        try {
          await caldavSync.recordTaskDeletion(taskId, effectiveListId);
        } catch (recordError) {
          console.error(`Failed to record task deletion:`, recordError);
        }
      }
    }
    
    // Broadcast update to connected clients
    broadcastUpdate('task_deleted', { id: taskId, list_id: effectiveListId });
    
    // Trigger sync
    syncTrigger.triggerSyncForList(effectiveListId, 'delete', taskId);
    
    res.json({ message: 'Task deleted successfully' });
  } catch (error) {
    console.error('Error deleting task:', error);
    res.status(500).json({ error: 'Failed to delete task' });
  }
});

// Toggle task completion status
router.patch('/:id/toggle', async (req, res) => {
  try {
    const taskId = req.params.id;
    const { list_id, listId } = req.body;
    
    let effectiveListId = list_id || listId;
    let currentTask;
    
    if (effectiveListId) {
      currentTask = await fileManager.getTask(taskId, effectiveListId);
    } else {
      const allTasks = await fileManager.getAllTasks();
      currentTask = allTasks.find(t => t.id === taskId);
      if (currentTask) {
        effectiveListId = currentTask.collection;
      }
    }
    
    if (!currentTask) {
      return res.status(404).json({ error: 'Task not found' });
    }
    
    const newStatus = currentTask.status === 2 ? 0 : 2;
    const completedValue = newStatus === 2 ? new Date().toISOString() : null;
    const percentComplete = newStatus === 2 ? 100 : 0;
    
    const task = await fileManager.updateTask(taskId, {
      status: newStatus,
      completed: completedValue,
      percent_complete: percentComplete,
      last_modified: new Date().toISOString()
    }, effectiveListId);
    
    // Immediately upload to remote server
    const syncManager = require('../services/syncManager');
    const caldavSync = syncManager.getCalDAVSync();
    if (caldavSync && caldavSync.isEnabled) {
      try {
        await caldavSync.uploadTaskToRemote(task, effectiveListId);
      } catch (error) {
        console.error(`Failed to upload task to remote server:`, error);
        // Continue anyway - we'll fix it on next sync
      }
    }
    
    // Broadcast update to connected clients
    broadcastUpdate('task_updated', task);
    
    // Trigger sync
    syncTrigger.triggerSyncForList(effectiveListId, 'update', taskId);
    
    res.json(task);
  } catch (error) {
    console.error('Error toggling task status:', error);
    res.status(500).json({ error: 'Failed to update task status' });
  }
});

// Bulk operations
router.post('/bulk', async (req, res) => {
  try {
    const { action, taskIds, list_id, listId, ...updateData } = req.body;
    
    const effectiveListId = list_id || listId;
    if (!effectiveListId) {
      return res.status(400).json({ error: 'List ID is required' });
    }
    
    if (!Array.isArray(taskIds) || taskIds.length === 0) {
      return res.status(400).json({ error: 'Task IDs array is required' });
    }
    
    const results = [];
    
    for (const taskId of taskIds) {
      try {
        let result;
        
        switch (action) {
          case 'delete':
            result = await fileManager.deleteTask(taskId, effectiveListId);
            if (result) {
              // Record the deletion and delete from remote server
              const syncManager = require('../services/syncManager');
              const caldavSync = syncManager.getCalDAVSync();
              if (caldavSync && caldavSync.isEnabled) {
                try {
                  await caldavSync.recordTaskDeletion(taskId, effectiveListId);
                  await caldavSync.deleteTaskFromRemote(taskId, effectiveListId);
                } catch (error) {
                  console.error(`Failed to delete task ${taskId} from remote server:`, error);
                }
              }
              syncTrigger.triggerSyncForList(effectiveListId, 'delete', taskId);
            }
            break;
            
          case 'update':
            // Handle timezone for date fields
            handleTimezoneForDates(updateData);
            result = await fileManager.updateTask(taskId, updateData, effectiveListId);
            if (result) {
              // Immediately upload to remote server
              const syncManager = require('../services/syncManager');
              const caldavSync = syncManager.getCalDAVSync();
              if (caldavSync && caldavSync.isEnabled) {
                try {
                  await caldavSync.uploadTaskToRemote(result, effectiveListId);
                } catch (error) {
                  console.error(`Failed to upload task ${taskId} to remote server:`, error);
                }
              }
              syncTrigger.triggerSyncForList(effectiveListId, 'update', taskId);
            }
            break;
            
          default:
            throw new Error(`Unknown action: ${action}`);
        }
        
        results.push({ taskId, success: !!result, action });
      } catch (error) {
        console.error(`Error processing task ${taskId}:`, error);
        results.push({ taskId, success: false, error: error.message, action });
      }
    }
    
    // Broadcast update to connected clients
    broadcastUpdate('tasks_bulk_updated', { action, results });
    
    res.json({ 
      message: `Bulk ${action} completed`, 
      results,
      successCount: results.filter(r => r.success).length,
      errorCount: results.filter(r => !r.success).length
    });
  } catch (error) {
    console.error('Error in bulk operation:', error);
    res.status(500).json({ error: 'Failed to perform bulk operation' });
  }
});

module.exports = router;