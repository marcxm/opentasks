const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const fileManager = require('./fileManager');

class FileCalDAVSync {
  constructor() {
    this.serverUrl = null;
    this.username = null;
    this.password = null;
    this.collectionPath = '/calendars'; // Default collection path
    this.axiosInstance = null;
    this.isEnabled = false;
    this.syncInProgress = false;
    this.lastSync = null;
  }

  async initialize() {
    try {
      // Load configuration from file instead of database
      const configPath = '/app/data/caldav_config.json';
      try {
        const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
        this.serverUrl = config.serverUrl;
        this.username = config.username;
        this.password = config.password;
        this.collectionPath = config.collectionPath || '/calendars';
        
        if (this.serverUrl && this.username && this.password) {
          this.axiosInstance = axios.create({
            baseURL: this.serverUrl,
            auth: {
              username: this.username,
              password: this.password
            },
            timeout: 30000
          });
          this.isEnabled = true;
          console.log('FileCalDAV sync initialized successfully');
        } else {
          console.log('FileCalDAV sync disabled - missing configuration');
        }
      } catch (error) {
        console.log('No CalDAV configuration found, sync disabled');
        this.isEnabled = false;
      }
    } catch (error) {
      console.error('Error initializing FileCalDAV sync:', error);
      this.isEnabled = false;
    }
  }

  async configure(serverUrl, username, password, collectionPath = '/calendars') {
    this.serverUrl = serverUrl;
    this.username = username;
    this.password = password;
    this.collectionPath = collectionPath;
    
    // Use the full server URL as base URL
    const baseURL = serverUrl;
    console.log(`CalDAV baseURL: ${baseURL}`);
    
    this.axiosInstance = axios.create({
      baseURL: baseURL,
      auth: {
        username: this.username,
        password: this.password
      },
      timeout: 30000
    });
    
    this.isEnabled = true;
    
    // Save configuration
    const config = { serverUrl, username, password, collectionPath };
    await fs.writeFile('/app/data/caldav_config.json', JSON.stringify(config, null, 2));
    
    console.log('FileCalDAV sync configured successfully');
  }

  async sync() {
    if (this.syncInProgress) {
      console.log('FileCalDAV sync already in progress, skipping...');
      return;
    }

    if (!this.isEnabled) {
      console.log('FileCalDAV sync disabled - missing configuration');
      return;
    }

    this.syncInProgress = true;
    console.log('===== Starting FileCalDAV sync =====');
    console.log(`CalDAV sync configuration: serverUrl=${this.serverUrl}, username=${this.username}, baseURL=${this.axiosInstance?.defaults?.baseURL}`);

    try {
      // Discover collections on remote server
      console.log('Calling discoverCollections...');
      const remoteCollections = await this.discoverCollections();
      console.log(`Discovered ${remoteCollections.length} remote collections:`, remoteCollections);

      // Ensure local collections exist for each remote collection
      console.log('=== ENSURING LOCAL COLLECTIONS ===');
      for (const collectionName of remoteCollections) {
        console.log(`Ensuring collection: ${collectionName}`);
        await this.ensureLocalCollection(collectionName);
      }

      // Sync each collection
      console.log('=== STARTING COLLECTION SYNC ===');
      for (const collectionName of remoteCollections) {
        console.log(`About to sync collection: ${collectionName}`);
        await this.syncCollection(collectionName);
      }

      this.lastSync = new Date().toISOString();
      console.log('FileCalDAV sync completed successfully');
    } catch (error) {
      console.error('Error during FileCalDAV sync:', error);
      throw error;
    } finally {
      this.syncInProgress = false;
    }
  }

  async discoverCollections() {
    console.log('===== ENTERED discoverCollections method =====');
    try {
      // First, try to discover the user's home collection
      // Support both URL formats: with /dav.php in baseURL or separate
      const userPath = `${this.collectionPath}/${this.username}/`;
      console.log(`Discovering collections at: ${this.axiosInstance.defaults.baseURL}${userPath}`);
      console.log(`Full URL will be: ${this.axiosInstance.defaults.baseURL}${userPath}`);
      
      const response = await this.axiosInstance.request({
        method: 'PROPFIND',
        url: userPath,
        headers: {
          'Depth': '1',
          'Content-Type': 'application/xml'
        },
        data: `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:">
  <d:prop>
    <d:displayname/>
    <d:resourcetype/>
  </d:prop>
</d:propfind>`
      });
      
      console.log(`Collection discovery response status: ${response.status}`);
      console.log(`Collection discovery response data: ${response.data.substring(0, 500)}...`);

      const collections = [];
      const xml = response.data;
      
      // Simple XML parsing to extract collection names
      // Support both URL formats with flexible regex
      // Escape special regex characters in collectionPath
      const escapedPath = this.collectionPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`<d:href>[^<]*${escapedPath}\/[^\/]+\/([^\/]+)\/<\/d:href>`, 'g');
      const matches = xml.match(regex);
      console.log(`Found ${matches ? matches.length : 0} collection matches in XML`);
      if (matches) {
        for (const match of matches) {
          const escapedPath = this.collectionPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const regex = new RegExp(`${escapedPath}\/[^\/]+\/([^\/]+)\/`);
          const collectionName = match.match(regex)[1];
          console.log(`Processing collection: ${collectionName}`);
          if (collectionName && !collections.includes(collectionName)) {
            collections.push(collectionName);
            console.log(`Added collection: ${collectionName}`);
          }
        }
      }
      
      console.log(`Final collections list:`, collections);
      
      // Write to file for debugging
      try {
        await fs.writeFile('/app/data/discovered_collections.json', JSON.stringify({
          timestamp: new Date().toISOString(),
          collections: collections
        }, null, 2));
      } catch (e) {
        console.error('Error writing discovered collections:', e);
      }
      
      return collections;
    } catch (error) {
      console.error('Error discovering collections:', error);
      return [];
    }
  }

  async ensureLocalCollection(collectionName) {
    const existingCollection = await fileManager.getCollection(collectionName);
    if (!existingCollection) {
      console.log(`Creating local collection: ${collectionName}`);
      await fileManager.createCollection(collectionName);
    }
  }

  async syncCollection(collectionName) {
    console.log(`Syncing collection: ${collectionName}`);
    
    try {
      // Get remote tasks
      const remoteTasks = await this.fetchRemoteTasks(collectionName);
      console.log(`Found ${remoteTasks.length} remote tasks in ${collectionName}`);
      
      // Get local tasks
      const localTasks = await fileManager.getTasks(collectionName);
      console.log(`Found ${localTasks.length} local tasks in ${collectionName}`);
      
      // Create maps for easier comparison
      const remoteTaskMap = new Map();
      const localTaskMap = new Map();
      
      remoteTasks.forEach(task => remoteTaskMap.set(task.id, task));
      localTasks.forEach(task => localTaskMap.set(task.id, task));
      
      // Sync remote to local (download new/updated tasks)
      for (const [taskId, remoteTask] of remoteTaskMap) {
        const localTask = localTaskMap.get(taskId);
        
        if (!localTask) {
          // Check if this task was recently deleted locally
          // We'll create a simple "deleted tasks" tracking mechanism
          const wasRecentlyDeleted = await this.wasTaskRecentlyDeleted(taskId, collectionName);
          if (wasRecentlyDeleted) {
            console.log(`Skipping recently deleted task: ${taskId}`);
            continue;
          }
          
          // New task from remote
          console.log(`Creating new local task: ${taskId}`);
          await fileManager.createTask(remoteTask, collectionName);
        } else {
          // Compare modification times or content
          const needsUpdate = this.shouldUpdateTask(localTask, remoteTask);
          if (needsUpdate) {
            console.log(`Updating local task: ${taskId}`);
            await fileManager.updateTask(taskId, remoteTask, collectionName);
          }
        }
      }
      
      // Sync local to remote (upload new/updated tasks)
      for (const [taskId, localTask] of localTaskMap) {
        const remoteTask = remoteTaskMap.get(taskId);
        
        if (!remoteTask) {
          // New task from local
          console.log(`Uploading new task to remote: ${taskId}`);
          await this.uploadTaskToRemote(localTask, collectionName);
        } else {
          // Compare and upload if local is newer
          const needsUpload = this.shouldUploadTask(localTask, remoteTask);
          if (needsUpload) {
            console.log(`Uploading updated task to remote: ${taskId}`);
            await this.uploadTaskToRemote(localTask, collectionName);
          }
        }
      }
      
      // Handle deleted tasks (tasks that exist remotely but not locally)
      // These are tasks that were deleted locally and should be deleted from remote
      for (const [taskId, remoteTask] of remoteTaskMap) {
        const localTask = localTaskMap.get(taskId);
        
        if (!localTask) {
          // Task exists remotely but not locally - it was deleted locally
          console.log(`Deleting task from remote (was deleted locally): ${taskId}`);
          try {
            await this.deleteTaskFromRemote(taskId, collectionName);
          } catch (error) {
            console.error(`Failed to delete task ${taskId} from remote:`, error);
            // Continue with other tasks even if one deletion fails
          }
        }
      }
      
    } catch (error) {
      console.error(`Error syncing collection ${collectionName}:`, error);
      throw error;
    }
  }

  async fetchRemoteTasks(collectionName) {
    try {
      const collectionPath = `${this.collectionPath}/${this.username}/${collectionName}/`;
      console.log(`Fetching remote tasks from: ${this.axiosInstance.defaults.baseURL}${collectionPath}`);
      
      const response = await this.axiosInstance.request({
        method: 'PROPFIND',
        url: collectionPath,
        headers: {
          'Depth': '1',
          'Content-Type': 'application/xml'
        },
        data: `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:getetag/>
    <d:getlastmodified/>
    <cal:calendar-data/>
  </d:prop>
</d:propfind>`
      });

      const tasks = [];
      const xml = response.data;
      console.log(`Task fetch response status: ${response.status}`);
      console.log(`Task fetch response data length: ${xml.length}`);
      console.log(`Task fetch response data preview: ${xml.substring(0, 500)}...`);
      
      // Parse XML to extract task data
      // This is a simplified parser - in production you'd want a proper XML parser
      // Try both CDATA and direct content formats
      let taskMatches = xml.match(/<cal:calendar-data><!\[CDATA\[(.*?)\]\]><\/cal:calendar-data>/gs);
      if (!taskMatches || taskMatches.length === 0) {
        // Try direct content format (not CDATA)
        taskMatches = xml.match(/<cal:calendar-data>([\s\S]*?)<\/cal:calendar-data>/g);
      }
      console.log(`Found ${taskMatches ? taskMatches.length : 0} task matches in XML`);
      
      if (taskMatches) {
        for (const match of taskMatches) {
          let icsContent;
          if (match.includes('<![CDATA[')) {
            // CDATA format
            icsContent = match.replace(/<cal:calendar-data><!\[CDATA\[(.*?)\]\]><\/cal:calendar-data>/s, '$1');
          } else {
            // Direct content format
            icsContent = match.replace(/<cal:calendar-data>([\s\S]*?)<\/cal:calendar-data>/s, '$1');
          }
          try {
            const task = this.parseRemoteTask(icsContent);
            if (task) {
              tasks.push(task);
            }
          } catch (error) {
            console.warn('Error parsing remote task:', error.message);
          }
        }
      }
      
      return tasks;
    } catch (error) {
      console.error(`Error fetching remote tasks from ${collectionName}:`, error);
      return [];
    }
  }

  parseRemoteTask(icsContent) {
    try {
      // Use the same parsing logic as fileManager
      const taskId = this.extractUIDFromICS(icsContent);
      if (!taskId) return null;
      
      // Parse the ICS content to extract task data
      const task = fileManager.parseTaskICS(icsContent, taskId, '');
      return task;
    } catch (error) {
      console.error('Error parsing remote task:', error);
      return null;
    }
  }

  extractUIDFromICS(icsContent) {
    const uidMatch = icsContent.match(/UID:([^\r\n]+)/);
    return uidMatch ? uidMatch[1] : null;
  }

  async uploadTaskToRemote(task, collectionName) {
    try {
      const collectionPath = `${this.collectionPath}/${this.username}/${collectionName}/`;
      const filename = `${task.id}.ics`;
      
      const icsContent = fileManager.createTaskICS(task, task.id);
      
      const response = await this.axiosInstance.request({
        method: 'PUT',
        url: collectionPath + filename,
        headers: {
          'Content-Type': 'text/calendar'
        },
        data: icsContent
      });
      
      console.log(`Successfully uploaded task ${task.id} to remote`);
      return response;
    } catch (error) {
      console.error(`Error uploading task ${task.id} to remote:`, error);
      throw error;
    }
  }

  async deleteTaskFromRemote(taskId, collectionName) {
    try {
      const collectionPath = `${this.collectionPath}/${this.username}/${collectionName}/`;
      const filename = `${taskId}.ics`;
      
      const response = await this.axiosInstance.request({
        method: 'DELETE',
        url: collectionPath + filename
      });
      
      console.log(`Successfully deleted task ${taskId} from remote collection ${collectionName}`);
      return response;
    } catch (error) {
      // 404 is OK - task was already deleted
      if (error.response && error.response.status === 404) {
        console.log(`Task ${taskId} already deleted from remote collection ${collectionName}`);
        return;
      }
      console.error(`Error deleting task ${taskId} from remote:`, error);
      throw error;
    }
  }

  shouldUpdateTask(localTask, remoteTask) {
    // Compare based on last_modified timestamp - remote is newer
    const localModified = new Date(localTask.last_modified || 0).getTime();
    const remoteModified = new Date(remoteTask.last_modified || 0).getTime();
    
    // Update local if remote is newer
    return remoteModified > localModified;
  }

  shouldUploadTask(localTask, remoteTask) {
    // Compare based on last_modified timestamp - local is newer
    const localModified = new Date(localTask.last_modified || 0).getTime();
    const remoteModified = new Date(remoteTask.last_modified || 0).getTime();
    
    // Upload if local is newer
    return localModified > remoteModified;
  }

  async testConnection() {
    if (!this.isEnabled) {
      throw new Error('CalDAV sync not configured');
    }

    try {
      console.log(`Testing CalDAV connection to: ${this.axiosInstance.defaults.baseURL}${this.collectionPath}/${this.username}/`);
      const response = await this.axiosInstance.request({
        method: 'PROPFIND',
        url: `${this.collectionPath}/${this.username}/`,
        headers: {
          'Depth': '0',
          'Content-Type': 'application/xml'
        }
      });
      
      console.log(`CalDAV connection successful: ${response.status}`);
      return {
        success: true,
        status: response.status,
        message: 'Connection successful'
      };
    } catch (error) {
      console.error(`CalDAV connection failed:`, error.response?.status, error.message);
      return {
        success: false,
        status: error.response?.status || 0,
        message: error.message
      };
    }
  }

  // Check if a task was recently deleted locally
  async wasTaskRecentlyDeleted(taskId, collectionName) {
    try {
      const deletedTasksFile = path.join(fileManager.collectionsDir, collectionName, '.deleted_tasks.json');
      
      // Check if deleted tasks file exists
      try {
        await fs.access(deletedTasksFile);
      } catch {
        return false; // File doesn't exist, task wasn't deleted
      }
      
      const deletedTasksData = await fs.readFile(deletedTasksFile, 'utf8');
      const deletedTasks = JSON.parse(deletedTasksData);
      
      // Check if task is in deleted list and deletion was recent (within 24 hours)
      const deletedTask = deletedTasks[taskId];
      if (deletedTask) {
        const deletionTime = new Date(deletedTask.deletedAt);
        const now = new Date();
        const hoursSinceDeletion = (now - deletionTime) / (1000 * 60 * 60);
        
        if (hoursSinceDeletion < 24) {
          return true; // Task was recently deleted
        } else {
          // Remove old deletion record
          delete deletedTasks[taskId];
          await fs.writeFile(deletedTasksFile, JSON.stringify(deletedTasks, null, 2));
        }
      }
      
      return false;
    } catch (error) {
      console.error('Error checking if task was recently deleted:', error);
      return false;
    }
  }

  // Record a task as deleted locally
  async recordTaskDeletion(taskId, collectionName) {
    try {
      const deletedTasksFile = path.join(fileManager.collectionsDir, collectionName, '.deleted_tasks.json');
      
      let deletedTasks = {};
      try {
        const data = await fs.readFile(deletedTasksFile, 'utf8');
        deletedTasks = JSON.parse(data);
      } catch {
        // File doesn't exist, start with empty object
      }
      
      deletedTasks[taskId] = {
        deletedAt: new Date().toISOString(),
        collection: collectionName
      };
      
      await fs.writeFile(deletedTasksFile, JSON.stringify(deletedTasks, null, 2));
      console.log(`Recorded task ${taskId} as deleted in collection ${collectionName}`);
    } catch (error) {
      console.error('Error recording task deletion:', error);
    }
  }
}

module.exports = new FileCalDAVSync();