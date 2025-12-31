const express = require('express');
const fileManager = require('../services/fileManager');
const fs = require('fs').promises;
const path = require('path');

const router = express.Router();

// Export all data
router.get('/all', async (req, res) => {
  try {
    const collections = await fileManager.getCollections();
    const exportData = {
      version: '2.0',
      exportDate: new Date().toISOString(),
      collections: []
    };

    for (const collection of collections) {
      const collectionData = await fileManager.exportCollection(collection.id);
      exportData.collections.push(collectionData);
    }

    res.json(exportData);
  } catch (error) {
    console.error('Error exporting all data:', error);
    res.status(500).json({ error: 'Failed to export data' });
  }
});

// Export specific collection
router.get('/collection/:id', async (req, res) => {
  try {
    const collectionId = req.params.id;
    const collectionData = await fileManager.exportCollection(collectionId);
    
    res.json(collectionData);
  } catch (error) {
    console.error('Error exporting collection:', error);
    if (error.message.includes('not found')) {
      res.status(404).json({ error: 'Collection not found' });
    } else {
      res.status(500).json({ error: 'Failed to export collection' });
    }
  }
});

// Import data
router.post('/import', async (req, res) => {
  try {
    const { collections } = req.body;
    
    if (!Array.isArray(collections)) {
      return res.status(400).json({ error: 'Collections array is required' });
    }

    const results = [];
    
    for (const collectionData of collections) {
      try {
        const result = await fileManager.importCollection(collectionData);
        results.push({
          success: true,
          collection: result.collection,
          taskCount: result.tasks.length
        });
      } catch (error) {
        results.push({
          success: false,
          collection: collectionData.collection?.name || 'Unknown',
          error: error.message
        });
      }
    }

    res.json({
      message: 'Import completed',
      results
    });
  } catch (error) {
    console.error('Error importing data:', error);
    res.status(500).json({ error: 'Failed to import data' });
  }
});

// Export as ICS files (downloadable)
router.get('/ics/:collectionId', async (req, res) => {
  try {
    const collectionId = req.params.collectionId;
    const collection = await fileManager.getCollection(collectionId);
    
    if (!collection) {
      return res.status(404).json({ error: 'Collection not found' });
    }

    const tasks = await fileManager.getTasks(collectionId);
    
    // Create a full calendar ICS file with all components
    const icsContent = fileManager.createFullCalendarICS(collection, tasks);

    res.setHeader('Content-Type', 'text/calendar');
    res.setHeader('Content-Disposition', `attachment; filename="${collectionId}.ics"`);
    res.send(icsContent);
  } catch (error) {
    console.error('Error exporting ICS:', error);
    res.status(500).json({ error: 'Failed to export ICS file' });
  }
});

// Export individual task as ICS
router.get('/ics/:collectionId/:taskId', async (req, res) => {
  try {
    const { collectionId, taskId } = req.params;
    
    const task = await fileManager.getTask(taskId, collectionId);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const icsContent = fileManager.createTaskICS(task, taskId);
    
    res.setHeader('Content-Type', 'text/calendar');
    res.setHeader('Content-Disposition', `attachment; filename="${taskId}.ics"`);
    res.send(icsContent);
  } catch (error) {
    console.error('Error exporting task ICS:', error);
    res.status(500).json({ error: 'Failed to export task ICS file' });
  }
});

// Import from ICS file
router.post('/import/ics', async (req, res) => {
  try {
    const { collectionName, icsContent } = req.body;
    
    if (!collectionName || !icsContent) {
      return res.status(400).json({ 
        error: 'Collection name and ICS content are required' 
      });
    }

    // Parse full ICS content to extract all components
    const components = fileManager.parseFullCalendarICS(icsContent);
    
    if (components.todos.length === 0 && components.events.length === 0 && components.journals.length === 0) {
      return res.status(400).json({ error: 'No valid calendar components found in ICS content' });
    }

    // Ensure collection exists
    let collection = await fileManager.getCollection(collectionName);
    if (!collection) {
      // Use calendar metadata if available
      const collectionData = {
        name: components.calendar.name || collectionName,
        color: components.calendar.color || '#007bff',
        type: components.calendar.type || 'caldav'
      };
      collection = await fileManager.createCollection(collectionName, collectionData);
    }

    // Import all components
    const importedTasks = [];
    const importedEvents = [];
    const importedJournals = [];
    const importedFreebusy = [];

    // Import tasks (VTODO)
    for (const taskData of components.todos) {
      const task = await fileManager.createTask(taskData, collectionName);
      importedTasks.push(task);
    }

    // Import events (VEVENT) - store as tasks for now, but could be extended
    for (const eventData of components.events) {
      const eventTask = {
        ...eventData,
        title: eventData.title,
        description: eventData.description,
        location: eventData.location,
        url: eventData.url,
        organizer: eventData.organizer,
        priority: parseInt(eventData.priority) || 0,
        status: eventData.status === 'CANCELLED' ? 2 : 0, // Map event status to task status
        due: eventData.dtend || eventData.dtstart,
        categories: eventData.categories
      };
      const task = await fileManager.createTask(eventTask, collectionName);
      importedEvents.push(task);
    }

    // Import journals (VJOURNAL) - store as tasks
    for (const journalData of components.journals) {
      const journalTask = {
        ...journalData,
        title: journalData.title,
        description: journalData.description,
        priority: 0,
        status: journalData.status === 'CANCELLED' ? 2 : 0,
        categories: journalData.categories
      };
      const task = await fileManager.createTask(journalTask, collectionName);
      importedJournals.push(task);
    }

    // Import freebusy (VFREEBUSY) - store as tasks
    for (const freebusyData of components.freebusy) {
      const freebusyTask = {
        ...freebusyData,
        title: `Free/Busy: ${freebusyData.organizer}`,
        description: `Free/Busy information for ${freebusyData.organizer}`,
        priority: 0,
        status: 0,
        due: freebusyData.dtend || freebusyData.dtstart
      };
      const task = await fileManager.createTask(freebusyTask, collectionName);
      importedFreebusy.push(task);
    }

    const totalImported = importedTasks.length + importedEvents.length + importedJournals.length + importedFreebusy.length;

    res.json({
      message: 'Full calendar import completed successfully',
      collection: collection,
      summary: {
        tasks: importedTasks.length,
        events: importedEvents.length,
        journals: importedJournals.length,
        freebusy: importedFreebusy.length,
        total: totalImported
      },
      components: {
        tasks: importedTasks,
        events: importedEvents,
        journals: importedJournals,
        freebusy: importedFreebusy
      }
    });
  } catch (error) {
    console.error('Error importing ICS:', error);
    res.status(500).json({ error: 'Failed to import ICS file' });
  }
});


module.exports = router;