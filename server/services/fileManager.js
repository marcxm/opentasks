const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const ical = require('ical.js');

class FileManager {
  constructor() {
    this.dataDir = '/app/data';
    this.collectionsDir = path.join(this.dataDir, 'collections');
    this.ensureDataDirectories();
  }

  async ensureDataDirectories() {
    try {
      await fs.mkdir(this.dataDir, { recursive: true });
      await fs.mkdir(this.collectionsDir, { recursive: true });
    } catch (error) {
      console.error('Error creating data directories:', error);
    }
  }

  // Collection (task list) management
  async createCollection(name, metadata = {}) {
    const collectionPath = path.join(this.collectionsDir, name);
    await fs.mkdir(collectionPath, { recursive: true });
    
    // Create collection metadata file
    const collectionMetadata = {
      name: metadata.name || name,
      color: metadata.color || '#007bff',
      created: new Date().toISOString(),
      type: metadata.type || 'caldav'
    };
    
    await fs.writeFile(
      path.join(collectionPath, '.metadata.json'),
      JSON.stringify(collectionMetadata, null, 2)
    );
    
    return { name, color: collectionMetadata.color, path: collectionPath };
  }

  async getCollections() {
    try {
      const entries = await fs.readdir(this.collectionsDir, { withFileTypes: true });
      const collections = [];
      
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          const metadataPath = path.join(this.collectionsDir, entry.name, '.metadata.json');
          try {
            const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
            collections.push({
              id: entry.name,
              name: metadata.name,
              color: metadata.color,
              type: metadata.type || 'caldav',
              path: path.join(this.collectionsDir, entry.name)
            });
          } catch (error) {
            console.warn(`Could not read metadata for collection ${entry.name}:`, error.message);
            // Create default metadata
            collections.push({
              id: entry.name,
              name: entry.name,
              color: '#007bff',
              type: 'caldav',
              path: path.join(this.collectionsDir, entry.name)
            });
          }
        }
      }
      
      return collections;
    } catch (error) {
      console.error('Error reading collections:', error);
      return [];
    }
  }

  async getCollection(name) {
    const collections = await this.getCollections();
    return collections.find(c => c.id === name);
  }

  // Task management
  async createTask(taskData, collectionName) {
    const taskId = taskData.id || uuidv4();
    const filename = `${taskId}.ics`;
    const collectionPath = path.join(this.collectionsDir, collectionName);
    
    // Ensure collection exists
    await fs.mkdir(collectionPath, { recursive: true });
    
    // Create ICS file
    const icsContent = this.createTaskICS(taskData, taskId);
    const filePath = path.join(collectionPath, filename);
    
    await fs.writeFile(filePath, icsContent);
    
    return {
      id: taskId,
      ...taskData,
      collection: collectionName,
      filePath
    };
  }

  async updateTask(taskId, taskData, collectionName) {
    const filename = `${taskId}.ics`;
    const filePath = path.join(this.collectionsDir, collectionName, filename);
    
    // Check if file exists
    try {
      await fs.access(filePath);
    } catch (error) {
      throw new Error(`Task ${taskId} not found in collection ${collectionName}`);
    }
    
    // Get existing task data to merge with updates
    const existingTask = await this.getTask(taskId, collectionName);
    if (!existingTask) {
      throw new Error(`Task ${taskId} not found in collection ${collectionName}`);
    }
    
    // Merge existing task data with update data
    const mergedTaskData = {
      ...existingTask,
      ...taskData,
      id: taskId // Ensure ID is preserved
    };
    
    // Update ICS file
    const icsContent = this.createTaskICS(mergedTaskData, taskId);
    await fs.writeFile(filePath, icsContent);
    
    return {
      ...mergedTaskData,
      collection: collectionName,
      filePath
    };
  }

  async deleteTask(taskId, collectionName) {
    const filename = `${taskId}.ics`;
    const filePath = path.join(this.collectionsDir, collectionName, filename);
    
    try {
      await fs.unlink(filePath);
      return true;
    } catch (error) {
      if (error.code === 'ENOENT') {
        return false; // File already deleted
      }
      throw error;
    }
  }

  async getTask(taskId, collectionName) {
    const filename = `${taskId}.ics`;
    const filePath = path.join(this.collectionsDir, collectionName, filename);
    
    try {
      const icsContent = await fs.readFile(filePath, 'utf8');
      return this.parseTaskICS(icsContent, taskId, collectionName);
    } catch (error) {
      if (error.code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  async getTasks(collectionName) {
    const collectionPath = path.join(this.collectionsDir, collectionName);
    
    try {
      const files = await fs.readdir(collectionPath);
      const tasks = [];
      
      for (const file of files) {
        if (file.endsWith('.ics') && !file.startsWith('.')) {
          const taskId = path.basename(file, '.ics');
          try {
            const task = await this.getTask(taskId, collectionName);
            if (task) {
              tasks.push(task);
            }
          } catch (error) {
            console.warn(`Error reading task ${taskId}:`, error.message);
          }
        }
      }
      
      return tasks;
    } catch (error) {
      console.error(`Error reading tasks from collection ${collectionName}:`, error);
      return [];
    }
  }

  async getAllTasks() {
    const collections = await this.getCollections();
    const allTasks = [];
    
    for (const collection of collections) {
      const tasks = await this.getTasks(collection.id);
      allTasks.push(...tasks.map(task => ({
        ...task,
        list_name: collection.name,
        list_color: collection.color
      })));
    }
    
    return allTasks;
  }

  // Full iCalendar file operations
  createFullCalendarICS(collectionData, tasks = []) {
    const now = new Date();
    const nowStr = now.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    
    let ics = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//OpenTasks//OpenTasks//EN
CALSCALE:GREGORIAN
METHOD:PUBLISH`;

    // Add collection metadata as X-PROPERTIES
    if (collectionData.name) {
      ics += `\nX-WR-CALNAME:${this.escapeICS(collectionData.name)}`;
    }
    if (collectionData.color) {
      const color = typeof collectionData.color === 'string' ? collectionData.color : collectionData.color.color || '#007bff';
      ics += `\nX-WR-CALCOLOR:${color}`;
    }
    if (collectionData.type) {
      ics += `\nX-WR-CALTYPE:${collectionData.type}`;
    }

    // Add all tasks as VTODO components
    for (const task of tasks) {
      ics += '\n' + this.createTaskICS(task, task.id).replace(/BEGIN:VCALENDAR[\s\S]*?BEGIN:VTODO/, 'BEGIN:VTODO').replace(/END:VCALENDAR$/, '');
    }

    ics += '\nEND:VCALENDAR';
    return ics;
  }

  // ICS file operations
  createTaskICS(taskData, taskId) {
    const now = new Date();
    const nowStr = this.formatDateForICS(now);
    
    // Map status
    let status = 'NEEDS-ACTION';
    if (taskData.status === 2) status = 'COMPLETED';
    else if (taskData.status === 1) status = 'IN-PROCESS';
    
    // Map priority
    let priority = '';
    if (taskData.priority) {
      if (taskData.priority >= 7) priority = '9';
      else if (taskData.priority >= 4) priority = '5';
      else if (taskData.priority >= 1) priority = '1';
    }
    
    let ics = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//OpenTasks//OpenTasks//EN
BEGIN:VTODO
UID:${taskId}
DTSTAMP:${nowStr}
SUMMARY:${this.escapeICS(taskData.title || 'Untitled Task')}`;

    if (status !== 'NEEDS-ACTION') {
      ics += `\nSTATUS:${status}`;
    }
    
    if (priority) {
      ics += `\nPRIORITY:${priority}`;
    }
    
    if (taskData.description) {
      ics += `\nDESCRIPTION:${this.escapeICS(taskData.description)}`;
    }
    
    if (taskData.location) {
      ics += `\nLOCATION:${this.escapeICS(taskData.location)}`;
    }
    
    if (taskData.url) {
      ics += `\nURL:${this.escapeICS(taskData.url)}`;
    }
    
    if (taskData.organizer) {
      ics += `\nORGANIZER:${this.escapeICS(taskData.organizer)}`;
    }
    
    if (taskData.due) {
      const dueStr = this.formatDateForICS(taskData.due);
      if (dueStr) {
        ics += `\nDUE:${dueStr}`;
      }
    }
    
    if (taskData.dtstart) {
      const startStr = this.formatDateForICS(taskData.dtstart);
      if (startStr) {
        ics += `\nDTSTART:${startStr}`;
      }
    }
    
    if (taskData.completed) {
      const completedStr = this.formatDateForICS(taskData.completed);
      if (completedStr) {
        ics += `\nCOMPLETED:${completedStr}`;
      }
    }
    
    if (taskData.percent_complete !== undefined) {
      ics += `\nPERCENT-COMPLETE:${taskData.percent_complete}`;
    }
    
    if (taskData.categories) {
      ics += `\nCATEGORIES:${this.escapeICS(taskData.categories)}`;
    }
    
    // Add LAST-MODIFIED timestamp
    const lastModified = taskData.last_modified ? new Date(taskData.last_modified) : now;
    const lastModifiedStr = this.formatDateForICS(lastModified);
    if (lastModifiedStr) {
      ics += `\nLAST-MODIFIED:${lastModifiedStr}`;
    }
    
    // Add CREATED timestamp if available
    if (taskData.created) {
      const createdStr = this.formatDateForICS(taskData.created);
      if (createdStr) {
        ics += `\nCREATED:${createdStr}`;
      }
    }
    
    ics += `\nEND:VTODO
END:VCALENDAR`;
    
    return ics;
  }

  parseTaskICS(icsContent, taskId, collectionName) {
    try {
      const jcal = ical.parse(icsContent);
      const vcalendar = new ical.Component(jcal);
      const vtodo = vcalendar.getFirstSubcomponent('vtodo');
      
      if (!vtodo) {
        throw new Error('No VTODO component found in ICS file');
      }
      
      // Parse basic properties
      const summary = vtodo.getFirstPropertyValue('summary') || 'Untitled Task';
      const description = vtodo.getFirstPropertyValue('description') || '';
      const location = vtodo.getFirstPropertyValue('location') || '';
      const url = vtodo.getFirstPropertyValue('url') || '';
      const organizer = vtodo.getFirstPropertyValue('organizer') || '';
      const categories = vtodo.getFirstPropertyValue('categories') || '';
      
      // Parse status
      const status = vtodo.getFirstPropertyValue('status') || 'NEEDS-ACTION';
      let statusCode = 0; // Pending
      if (status === 'COMPLETED') statusCode = 2;
      else if (status === 'IN-PROCESS') statusCode = 1;
      
      // Parse priority
      const priority = vtodo.getFirstPropertyValue('priority') || 0;
      let priorityCode = 0;
      if (priority >= 7) priorityCode = 3; // High
      else if (priority >= 4) priorityCode = 2; // Medium
      else if (priority >= 1) priorityCode = 1; // Low
      
      // Parse dates
      const due = vtodo.getFirstPropertyValue('due');
      const dtstart = vtodo.getFirstPropertyValue('dtstart');
      const completed = vtodo.getFirstPropertyValue('completed');
      
      // Parse percent complete
      const percentComplete = vtodo.getFirstPropertyValue('percent-complete') || 0;
      
      // Parse timestamps
      const lastModified = vtodo.getFirstPropertyValue('last-modified');
      const dtstamp = vtodo.getFirstPropertyValue('dtstamp');
      const created = vtodo.getFirstPropertyValue('created');
      
      return {
        id: taskId,
        title: summary,
        description,
        location,
        url,
        organizer,
        priority: priorityCode,
        status: statusCode,
        dtstart: dtstart ? this.parseICSDate(dtstart) : null,
        due: due ? this.parseICSDate(due) : null,
        completed: completed ? this.parseICSDate(completed) : null,
        percent_complete: percentComplete,
        categories,
        collection: collectionName,
        created: created ? this.parseICSDate(created) : new Date().toISOString(),
        last_modified: lastModified ? this.parseICSDate(lastModified) : (dtstamp ? this.parseICSDate(dtstamp) : new Date().toISOString())
      };
    } catch (error) {
      console.error(`Error parsing ICS file for task ${taskId}:`, error);
      throw error;
    }
  }

  escapeICS(text) {
    if (!text) return '';
    return String(text)
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '');
  }

  // Helper method to format date as floating time for ICS
  formatDateForICS(date) {
    if (!date) return null;
    const d = new Date(date);
    if (isNaN(d.getTime())) return null;
    
    // Format as YYYYMMDDTHHMMSS (floating time, no timezone - interpreted in local timezone)
    // This ensures the time appears the same in all CalDAV clients
    const year = d.getUTCFullYear();
    const month = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    const hours = String(d.getUTCHours()).padStart(2, '0');
    const minutes = String(d.getUTCMinutes()).padStart(2, '0');
    const seconds = String(d.getUTCSeconds()).padStart(2, '0');
    
    return `${year}${month}${day}T${hours}${minutes}${seconds}`;
  }

  // Helper method to parse ICS date and convert to ISO string
  parseICSDate(icsDate) {
    if (!icsDate) return null;
    
    // If it's already a Date object, convert to ISO string
    if (icsDate instanceof Date) {
      console.log('parseICSDate: Got Date object:', icsDate.toISOString());
      return icsDate.toISOString();
    }
    
    // If it's a Moment.js object, convert to ISO string
    if (icsDate && typeof icsDate.toISOString === 'function') {
      const isoStr = icsDate.toISOString();
      console.log('parseICSDate: Got Moment with toISOString:', isoStr);
      return isoStr;
    }
    
    // If it's a Moment.js object with toDate method, convert to Date first
    if (icsDate && typeof icsDate.toDate === 'function') {
      const date = icsDate.toDate();
      console.log('parseICSDate: Got Moment with toDate:', date.toISOString());
      return date.toISOString();
    }
    
    // Convert to string if it's not already
    const dateStr = String(icsDate).trim();
    console.log('parseICSDate: Processing string:', dateStr);
    
    // If it's already an ISO string format, parse it directly
    if (dateStr.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)) {
      console.log('parseICSDate: ISO string format detected');
      const date = new Date(dateStr);
      if (!isNaN(date.getTime())) {
        return date.toISOString();
      }
    }
    
    // Handle different ICS date formats
    // For CalDAV tasks, we always treat times as floating (no timezone conversion)
    // This ensures tasks show the same time in all clients
    
    // Strip any timezone info (Z suffix or +/-HHMM offset)
    let cleanDateStr = dateStr;
    
    // Remove Z suffix if present
    if (cleanDateStr.endsWith('Z')) {
      cleanDateStr = cleanDateStr.slice(0, -1);
    }
    
    // Remove timezone offset if present (e.g., +0300, -0500, +03:00, -05:00)
    cleanDateStr = cleanDateStr.replace(/[+-]\d{2}:?\d{2}$/, '');
    
    console.log('parseICSDate: Cleaned string:', cleanDateStr);
    
    // Parse the date components
    const year = parseInt(cleanDateStr.substring(0, 4));
    const month = parseInt(cleanDateStr.substring(4, 6)) - 1;
    const day = parseInt(cleanDateStr.substring(6, 8));
    const hours = parseInt(cleanDateStr.substring(9, 11));
    const minutes = parseInt(cleanDateStr.substring(11, 13));
    const seconds = parseInt(cleanDateStr.substring(13, 15));
    
    console.log(`parseICSDate: Parsed components: ${year}-${month+1}-${day} ${hours}:${minutes}:${seconds}`);
    
    // Store as UTC with the time components as-is (floating time)
    const utcDate = new Date(Date.UTC(year, month, day, hours, minutes, seconds));
    const result = utcDate.toISOString();
    console.log('parseICSDate: Final result:', result);
    return result;
  }

  // Parse full iCalendar file and extract all components
  parseFullCalendarICS(icsContent) {
    const components = {
      calendar: {},
      events: [],
      todos: [],
      journals: [],
      freebusy: [],
      other: []
    };

    try {
      // Extract calendar properties
      const calProps = icsContent.match(/^[A-Z-]+:.*$/gm) || [];
      for (const prop of calProps) {
        if (prop.startsWith('X-WR-CALNAME:')) {
          components.calendar.name = prop.substring(13);
        } else if (prop.startsWith('X-WR-CALCOLOR:')) {
          components.calendar.color = prop.substring(14);
        } else if (prop.startsWith('X-WR-CALTYPE:')) {
          components.calendar.type = prop.substring(13);
        }
      }

      // Extract VEVENT components
      const eventMatches = icsContent.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g) || [];
      for (const eventContent of eventMatches) {
        const event = this.parseVEvent(eventContent);
        if (event) components.events.push(event);
      }

      // Extract VTODO components
      const todoMatches = icsContent.match(/BEGIN:VTODO[\s\S]*?END:VTODO/g) || [];
      for (const todoContent of todoMatches) {
        const todo = this.parseVTodo(todoContent);
        if (todo) components.todos.push(todo);
      }

      // Extract VJOURNAL components
      const journalMatches = icsContent.match(/BEGIN:VJOURNAL[\s\S]*?END:VJOURNAL/g) || [];
      for (const journalContent of journalMatches) {
        const journal = this.parseVJournal(journalContent);
        if (journal) components.journals.push(journal);
      }

      // Extract VFREEBUSY components
      const freebusyMatches = icsContent.match(/BEGIN:VFREEBUSY[\s\S]*?END:VFREEBUSY/g) || [];
      for (const freebusyContent of freebusyMatches) {
        const freebusy = this.parseVFreebusy(freebusyContent);
        if (freebusy) components.freebusy.push(freebusy);
      }

    } catch (error) {
      console.error('Error parsing full calendar ICS:', error);
    }

    return components;
  }

  // Parse VTODO component
  parseVTodo(todoContent) {
    try {
      const uidMatch = todoContent.match(/UID:([^\r\n]+)/);
      if (!uidMatch) return null;

      const todo = {
        id: uidMatch[1],
        type: 'todo',
        title: this.extractProperty(todoContent, 'SUMMARY') || 'Untitled Task',
        description: this.extractProperty(todoContent, 'DESCRIPTION') || '',
        location: this.extractProperty(todoContent, 'LOCATION') || '',
        url: this.extractProperty(todoContent, 'URL') || '',
        organizer: this.extractProperty(todoContent, 'ORGANIZER') || '',
        status: this.mapTaskStatus(this.extractProperty(todoContent, 'STATUS')),
        priority: this.mapTaskPriority(this.extractProperty(todoContent, 'PRIORITY')),
        due: this.extractProperty(todoContent, 'DUE'),
        completed: this.extractProperty(todoContent, 'COMPLETED'),
        percent_complete: this.extractProperty(todoContent, 'PERCENT-COMPLETE') || '0',
        categories: this.extractProperty(todoContent, 'CATEGORIES') || '',
        created: this.extractProperty(todoContent, 'CREATED'),
        last_modified: this.extractProperty(todoContent, 'LAST-MODIFIED'),
        dtstamp: this.extractProperty(todoContent, 'DTSTAMP')
      };

      return todo;
    } catch (error) {
      console.warn('Error parsing VTODO:', error.message);
      return null;
    }
  }

  // Parse VEVENT component
  parseVEvent(eventContent) {
    try {
      const uidMatch = eventContent.match(/UID:([^\r\n]+)/);
      if (!uidMatch) return null;

      const event = {
        id: uidMatch[1],
        type: 'event',
        title: this.extractProperty(eventContent, 'SUMMARY') || 'Untitled Event',
        description: this.extractProperty(eventContent, 'DESCRIPTION') || '',
        location: this.extractProperty(eventContent, 'LOCATION') || '',
        url: this.extractProperty(eventContent, 'URL') || '',
        organizer: this.extractProperty(eventContent, 'ORGANIZER') || '',
        status: this.extractProperty(eventContent, 'STATUS') || 'CONFIRMED',
        priority: this.extractProperty(eventContent, 'PRIORITY') || '0',
        dtstart: this.extractProperty(eventContent, 'DTSTART'),
        dtend: this.extractProperty(eventContent, 'DTEND'),
        duration: this.extractProperty(eventContent, 'DURATION'),
        rrule: this.extractProperty(eventContent, 'RRULE'),
        categories: this.extractProperty(eventContent, 'CATEGORIES') || '',
        created: this.extractProperty(eventContent, 'CREATED'),
        last_modified: this.extractProperty(eventContent, 'LAST-MODIFIED'),
        dtstamp: this.extractProperty(eventContent, 'DTSTAMP')
      };

      return event;
    } catch (error) {
      console.warn('Error parsing VEVENT:', error.message);
      return null;
    }
  }

  // Parse VJOURNAL component
  parseVJournal(journalContent) {
    try {
      const uidMatch = journalContent.match(/UID:([^\r\n]+)/);
      if (!uidMatch) return null;

      const journal = {
        id: uidMatch[1],
        type: 'journal',
        title: this.extractProperty(journalContent, 'SUMMARY') || 'Untitled Journal',
        description: this.extractProperty(journalContent, 'DESCRIPTION') || '',
        status: this.extractProperty(journalContent, 'STATUS') || 'FINAL',
        categories: this.extractProperty(journalContent, 'CATEGORIES') || '',
        created: this.extractProperty(journalContent, 'CREATED'),
        last_modified: this.extractProperty(journalContent, 'LAST-MODIFIED'),
        dtstamp: this.extractProperty(journalContent, 'DTSTAMP')
      };

      return journal;
    } catch (error) {
      console.warn('Error parsing VJOURNAL:', error.message);
      return null;
    }
  }

  // Parse VFREEBUSY component
  parseVFreebusy(freebusyContent) {
    try {
      const uidMatch = freebusyContent.match(/UID:([^\r\n]+)/);
      if (!uidMatch) return null;

      const freebusy = {
        id: uidMatch[1],
        type: 'freebusy',
        organizer: this.extractProperty(freebusyContent, 'ORGANIZER') || '',
        dtstart: this.extractProperty(freebusyContent, 'DTSTART'),
        dtend: this.extractProperty(freebusyContent, 'DTEND'),
        created: this.extractProperty(freebusyContent, 'CREATED'),
        last_modified: this.extractProperty(freebusyContent, 'LAST-MODIFIED'),
        dtstamp: this.extractProperty(freebusyContent, 'DTSTAMP')
      };

      return freebusy;
    } catch (error) {
      console.warn('Error parsing VFREEBUSY:', error.message);
      return null;
    }
  }

  // Helper method to extract property values from ICS content
  extractProperty(content, propertyName) {
    const regex = new RegExp(`^${propertyName}:(.*)$`, 'm');
    const match = content.match(regex);
    return match ? match[1].trim() : null;
  }

  // Map ICS status to task status
  mapTaskStatus(icsStatus) {
    if (!icsStatus) return 0;
    switch (icsStatus.toUpperCase()) {
      case 'COMPLETED': return 2;
      case 'IN-PROCESS': return 1;
      case 'NEEDS-ACTION':
      case 'PENDING':
      default: return 0;
    }
  }

  // Map ICS priority to task priority
  mapTaskPriority(icsPriority) {
    if (!icsPriority) return 0;
    const priority = parseInt(icsPriority);
    if (priority >= 7) return 3;
    if (priority >= 4) return 2;
    if (priority >= 1) return 1;
    return 0;
  }

  // Export/Import functionality
  async exportCollection(collectionName) {
    const collection = await this.getCollection(collectionName);
    if (!collection) {
      throw new Error(`Collection ${collectionName} not found`);
    }
    
    const tasks = await this.getTasks(collectionName);
    return {
      collection: {
        name: collection.name,
        color: collection.color,
        type: collection.type
      },
      tasks: tasks.map(task => ({
        id: task.id,
        title: task.title,
        description: task.description,
        location: task.location,
        url: task.url,
        organizer: task.organizer,
        priority: task.priority,
        status: task.status,
        dtstart: task.dtstart,
        due: task.due,
        completed: task.completed,
        percent_complete: task.percent_complete,
        categories: task.categories
      }))
    };
  }

  async importCollection(collectionData) {
    const { collection, tasks } = collectionData;
    
    // Create collection
    const newCollection = await this.createCollection(collection.name, collection.color);
    
    // Import tasks
    const importedTasks = [];
    for (const taskData of tasks) {
      const task = await this.createTask(taskData, newCollection.id);
      importedTasks.push(task);
    }
    
    return {
      collection: newCollection,
      tasks: importedTasks
    };
  }
}

module.exports = new FileManager();