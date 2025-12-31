const ical = require('ical.js');
const axios = require('axios');
const { getDatabase } = require('../database/init');
const { broadcastUpdate } = require('../websocket/server');

class CalDAVSync {
  constructor() {
    this.serverUrl = process.env.CALDAV_SERVER_URL;
    this.username = process.env.CALDAV_USERNAME;
    this.password = process.env.CALDAV_PASSWORD;
    this.collectionPath = process.env.CALDAV_COLLECTION_PATH || '/opentasks/';
    this.syncInterval = parseInt(process.env.CALDAV_SYNC_INTERVAL) || 15 * 60 * 1000; // 15 minutes
    this.isEnabled = !!(this.serverUrl && this.username && this.password);
    this.syncInProgress = false;
    this.lastSync = null;
    this.syncTimer = null;
    
    // Load configuration from database if not set in environment
    this.loadConfigFromDatabase();
    
    // Initialize axios instance
    this.initializeAxios();
  }

  loadConfigFromDatabase() {
    try {
      const db = getDatabase();
      const config = db.prepare('SELECT data FROM sync_state WHERE account_name = ? AND account_type = ?')
        .get('caldav_config', 'caldav');
      
      if (config && config.data) {
        const caldavConfig = JSON.parse(config.data);
        console.log('Loading CalDAV config from database:', caldavConfig);
        
        // Override environment variables with database config
        this.serverUrl = caldavConfig.serverUrl || this.serverUrl;
        this.username = caldavConfig.username || this.username;
        this.password = caldavConfig.password || this.password;
        this.collectionPath = caldavConfig.collectionPath || this.collectionPath;
        this.syncInterval = caldavConfig.syncInterval || this.syncInterval;
        this.isEnabled = !!(this.serverUrl && this.username && this.password);
        
        console.log('CalDAV config loaded:', {
          serverUrl: this.serverUrl,
          username: this.username,
          collectionPath: this.collectionPath,
          isEnabled: this.isEnabled
        });
      }
    } catch (error) {
      console.error('Error loading CalDAV config from database:', error);
    }
  }

  initializeAxios() {
    if (this.serverUrl && this.username && this.password) {
      this.axiosInstance = axios.create({
        baseURL: this.serverUrl,
        auth: {
          username: this.username,
          password: this.password
        },
        headers: {
          'Content-Type': 'application/xml'
        }
      });
      console.log('Axios instance initialized for CalDAV');
    } else {
      console.log('CalDAV not configured, skipping axios initialization');
    }
  }

  async start() {
    if (!this.isEnabled) {
      console.log('CalDAV sync disabled - missing configuration');
      return;
    }

    console.log(`CalDAV sync enabled for ${this.serverUrl}`);
    console.log(`Sync interval: ${this.syncInterval / 1000} seconds`);

    // Perform initial sync
    await this.sync();

    // Schedule periodic syncs
    this.syncTimer = setInterval(() => {
      this.sync();
    }, this.syncInterval);
  }

  stop() {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
  }

  async sync() {
    if (this.syncInProgress) {
      console.log('CalDAV sync already in progress, skipping...');
      return;
    }

    if (!this.isEnabled) {
      console.log('CalDAV sync disabled - missing configuration');
      return;
    }

    this.syncInProgress = true;
    console.log('Starting CalDAV sync...');
    console.log('DEBUG: CalDAV sync starting with axios instance:', !!this.axiosInstance);

    try {
      // Get all tasks from local database (including deleted ones that need syncing)
      const db = getDatabase();
      const localTasks = db.prepare(`
        SELECT t.*, tl.name as list_name, tl.color as list_color
        FROM tasks t
        LEFT JOIN task_lists tl ON t.list_id = tl.id
        WHERE t._dirty = 1
      `).all();

      // Get remote tasks from CalDAV server
      console.log('Fetching remote tasks...');
      const remoteTasks = await this.fetchRemoteTasks();
      console.log(`Fetched ${remoteTasks.length} remote tasks`);

      // Sync local changes to remote
      console.log(`Syncing ${localTasks.length} local tasks to remote...`);
      await this.syncLocalToRemote(localTasks);

      // Sync remote changes to local
      console.log(`Syncing ${remoteTasks.length} remote tasks to local...`);
      await this.syncRemoteToLocal(remoteTasks);

      // Update sync state
      this.lastSync = new Date().toISOString();
      db.prepare(`
        INSERT OR REPLACE INTO sync_state (account_name, account_type, data)
        VALUES (?, ?, ?)
      `).run('caldav', 'caldav', JSON.stringify({
        lastSync: this.lastSync,
        serverUrl: this.serverUrl,
        status: 'success'
      }));

      console.log('CalDAV sync completed successfully');
      broadcastUpdate('sync_completed', { 
        lastSync: this.lastSync,
        status: 'success'
      });
      
      // Broadcast task lists update to refresh the UI
      broadcastUpdate('tasklists_updated', {});

    } catch (error) {
      console.error('CalDAV sync failed:', error);
      broadcastUpdate('sync_failed', { 
        error: error.message,
        status: 'error'
      });
    } finally {
      this.syncInProgress = false;
      console.log('CalDAV sync completed');
    }
  }

  async fetchRemoteTasks() {
    try {
      console.log('fetchRemoteTasks: Starting to fetch remote tasks');
      // Discover CalDAV collections
      console.log('fetchRemoteTasks: Calling discoverCollections');
      const collections = await this.discoverCollections();
      console.log('fetchRemoteTasks: Collections discovered:', collections);
      
      const tasks = [];
      for (const collection of collections) {
        const collectionTasks = await this.fetchTasksFromCollection(collection);
        // Add collection information to each task
        collectionTasks.forEach(task => {
          task.collection = collection;
        });
        tasks.push(...collectionTasks);
      }
      
      return tasks;
    } catch (error) {
      console.error('Error fetching remote tasks:', error);
      throw error;
    }
  }

  async discoverCollections() {
    const discoverUrl = this.serverUrl + this.collectionPath;
    console.log(`Discovering collections from ${discoverUrl} with collection path ${this.collectionPath}`);
    
    try {
      // First try with Depth: 1 on the collection path
      const response = await this.axiosInstance.request({
        method: 'PROPFIND',
        url: this.collectionPath,
        headers: {
          'Depth': '1',
          'Content-Type': 'application/xml'
        },
        data: `<?xml version="1.0" encoding="utf-8" ?>
          <D:propfind xmlns:D="DAV:">
            <D:prop>
              <D:resourcetype/>
              <D:displayname/>
            </D:prop>
          </D:propfind>`
      });

      console.log('PROPFIND response status:', response.status);
      console.log('PROPFIND response data length:', response.data.length);
      console.log('PROPFIND response data preview:', response.data.substring(0, 1000));
      
      // Log the full response for debugging (but limit to reasonable size)
      if (response.data.length > 1000) {
        console.log('PROPFIND response data (full):', response.data);
      }

      // Parse XML response to find collections
      const collections = [];
      // This is a simplified parser - in production you'd use a proper XML parser
      // Look for various href patterns since different DAV servers use different formats:
      // - <href> (generic)
      // - <D:href> (DAV namespace)
      // - <d:href> (lowercase DAV namespace - Baikal)
      // - <cal:href> (CalDAV namespace)
      const matches = response.data.match(/<[^:>]*:?href[^>]*>([^<]+)<\/[^:>]*:?href>/gi);
      console.log('Found href matches:', matches);
      console.log('Total href matches found:', matches ? matches.length : 0);
      
      // Also extract display names from the response
      const displayNameMatches = response.data.match(/<[^:>]*:?displayname[^>]*>([^<]+)<\/[^:>]*:?displayname>/gi);
      console.log('Found display name matches:', displayNameMatches);
      if (matches) {
        matches.forEach(match => {
          const href = match.replace(/<\/?[^:>]*:?href[^>]*>/gi, '');
          console.log(`Checking href: ${href}`);
          
          // Normalize the href for comparison
          const normalizedHref = href.endsWith('/') ? href : href + '/';
          const normalizedCollectionPath = this.collectionPath.endsWith('/') ? this.collectionPath : this.collectionPath + '/';
          
          console.log(`  - normalizedHref: ${normalizedHref}`);
          console.log(`  - normalizedCollectionPath: ${normalizedCollectionPath}`);
          console.log(`  - startsWith: ${normalizedHref.startsWith(normalizedCollectionPath)}`);
          console.log(`  - not equal: ${normalizedHref !== normalizedCollectionPath}`);
          console.log(`  - ends with slash: ${normalizedHref.endsWith('/')}`);
          console.log(`  - length check: ${normalizedHref.length > normalizedCollectionPath.length}`);
          console.log(`  - not .ics file: ${!normalizedHref.match(/\.ics\/$/)}`);
          
          // Check if this href represents a collection under our configured path
          // Different DAV servers use different path structures:
          // - Radicale: /john/collection/ -> collection path /john
          // - Baikal: /dav.php/calendars/john/collection/ -> collection path /john
          // - Generic: /user/john/collection/ -> collection path /john
          
          const collectionPathClean = normalizedCollectionPath.replace(/^\/+|\/+$/g, '');
          const hrefClean = normalizedHref.replace(/^\/+|\/+$/g, '');
          
          // Check if href contains our collection path (flexible matching)
          const containsCollectionPath = hrefClean.includes(collectionPathClean) || 
                                       hrefClean.includes('/' + collectionPathClean) ||
                                       hrefClean.endsWith('/' + collectionPathClean);
          
          // Look for collections that are under the configured collection path
          // Exclude individual .ics files and only include actual collections
          if ((normalizedHref.startsWith(normalizedCollectionPath) || containsCollectionPath) && 
              normalizedHref !== normalizedCollectionPath && 
              normalizedHref.endsWith('/') && 
              normalizedHref.length > normalizedCollectionPath.length &&
              !normalizedHref.match(/\.ics\/$/) &&
              !normalizedHref.includes('/inbox/') && // Exclude inbox/outbox
              !normalizedHref.includes('/outbox/') && // Exclude inbox/outbox
              !normalizedHref.includes('/principals/')) { // Exclude principals
            console.log(`✅ Adding collection: ${href}`);
            collections.push(href);
          } else {
            console.log(`❌ Skipping href: ${href} (doesn't match criteria)`);
          }
        });
      }

      console.log(`Discovered ${collections.length} collections:`, collections);
      
      // If no collections found, try the root path
      if (collections.length === 0) {
        console.log(`No collections found at ${this.collectionPath}, trying root path...`);
        try {
          const rootResponse = await this.axiosInstance.request({
            method: 'PROPFIND',
            url: '/',
            headers: {
              'Depth': '1',
              'Content-Type': 'application/xml'
            },
            data: `<?xml version="1.0" encoding="utf-8" ?>
              <D:propfind xmlns:D="DAV:">
                <D:prop>
                  <D:resourcetype/>
                  <D:displayname/>
                </D:prop>
              </D:propfind>`
          });
          
          console.log('Root PROPFIND response status:', rootResponse.status);
          console.log('Root PROPFIND response data length:', rootResponse.data.length);
          
          // Parse root response
          const rootMatches = rootResponse.data.match(/<[^:>]*:?href[^>]*>([^<]+)<\/[^:>]*:?href>/gi);
          if (rootMatches) {
            console.log('Root href matches:', rootMatches);
            rootMatches.forEach(match => {
              const href = match.replace(/<\/?[^:>]*:?href[^>]*>/gi, '');
              if (href.startsWith(this.collectionPath) && href !== this.collectionPath) {
                console.log(`Found collection in root response: ${href}`);
                collections.push(href);
              }
            });
          }
        } catch (rootError) {
          console.error('Error querying root path:', rootError);
        }
      }
      
      // If still no collections found, fall back to the configured collection path
      if (collections.length === 0) {
        console.log(`No collections discovered, using configured collection path: ${this.collectionPath}`);
        return [this.collectionPath];
      }
      
      return collections;
    } catch (error) {
      console.error('Error discovering collections:', error);
      // Fall back to the configured collection path if discovery fails
      console.log(`Collection discovery failed, using configured collection path: ${this.collectionPath}`);
      return [this.collectionPath];
    }
  }

  async fetchTasksFromCollection(collectionPath) {
    console.log(`Fetching tasks from collection: ${collectionPath}`);
    const fullUrl = this.serverUrl.replace('/dav.php/calendars', '') + collectionPath;
    try {
      const response = await axios.request({
        method: 'REPORT',
        url: fullUrl,
        auth: {
          username: this.username,
          password: this.password
        },
        headers: {
          'Content-Type': 'application/xml',
          'Depth': '1'
        },
        data: `<?xml version="1.0" encoding="utf-8" ?>
          <C:calendar-query xmlns:C="urn:ietf:params:xml:ns:caldav">
            <D:prop xmlns:D="DAV:">
              <D:getetag/>
              <D:getlastmodified/>
              <C:calendar-data/>
            </D:prop>
            <C:filter>
              <C:comp-filter name="VCALENDAR">
                <C:comp-filter name="VTODO"/>
              </C:comp-filter>
            </C:filter>
          </C:calendar-query>`
      });
      
      console.log(`Response status: ${response.status}`);
      
      return this.parseCalDAVResponse(response.data);
    } catch (error) {
      console.error(`Error fetching tasks from collection ${collectionPath}:`, error);
      return [];
    }
  }

  parseCalDAVResponse(xmlData) {
    const tasks = [];
    
    console.log('Parsing CalDAV response, length:', xmlData.length);
    console.log('First 500 chars of response:', xmlData.substring(0, 500));
    
    // Parse the CalDAV response to extract both calendar data and metadata
    // Try different response patterns
    let responseMatches = xmlData.match(/<D:response>([\s\S]*?)<\/D:response>/g);
    if (!responseMatches) {
      responseMatches = xmlData.match(/<response>([\s\S]*?)<\/response>/g);
    }
    if (!responseMatches) {
      responseMatches = xmlData.match(/<[^:]*:response>([\s\S]*?)<\/[^:]*:response>/g);
    }
    
    console.log('Found response matches:', responseMatches ? responseMatches.length : 0);
    
    if (responseMatches) {
      responseMatches.forEach((responseMatch, index) => {
        console.log(`Processing response ${index + 1}/${responseMatches.length}`);
        
        // Extract href (resource path) - universal pattern for any namespace
        let hrefMatch = responseMatch.match(/<[^:>]*:?href[^>]*>([^<]+)<\/[^:>]*:?href>/i);
        if (!hrefMatch) {
          hrefMatch = responseMatch.match(/<href[^>]*>([^<]+)<\/href>/i);
        }
        if (!hrefMatch) {
          console.log('No href found in response');
          return;
        }
        console.log('Found href:', hrefMatch[1]);
        
        // Extract ETag - universal pattern for any namespace
        let etagMatch = responseMatch.match(/<[^:>]*:?getetag[^>]*>([^<]+)<\/[^:>]*:?getetag>/i);
        if (!etagMatch) {
          etagMatch = responseMatch.match(/<getetag[^>]*>([^<]+)<\/getetag>/i);
        }
        const etag = etagMatch ? etagMatch[1] : null;
        console.log('Found ETag:', etag);
        
        // Extract last modified - universal pattern for any namespace
        let lastModifiedMatch = responseMatch.match(/<[^:>]*:?getlastmodified[^>]*>([^<]+)<\/[^:>]*:?getlastmodified>/i);
        if (!lastModifiedMatch) {
          lastModifiedMatch = responseMatch.match(/<getlastmodified[^>]*>([^<]+)<\/getlastmodified>/i);
        }
        const lastModified = lastModifiedMatch ? lastModifiedMatch[1] : null;
        console.log('Found last modified:', lastModified);
        
        // Extract calendar data - universal pattern for any namespace
        let calendarDataMatch = responseMatch.match(/<[^:>]*:?calendar-data[^>]*>([\s\S]*?)<\/[^:>]*:?calendar-data>/i);
        if (!calendarDataMatch) {
          calendarDataMatch = responseMatch.match(/<calendar-data[^>]*>([\s\S]*?)<\/calendar-data>/i);
        }
        if (!calendarDataMatch) {
          console.log('No calendar data found in response');
          return;
        }
        console.log('Found calendar data, length:', calendarDataMatch[1].length);
        
        const icalData = calendarDataMatch[1];
        try {
          const jcalData = ical.parse(icalData);
          const vcalendar = new ical.Component(jcalData);
          const vtodos = vcalendar.getAllSubcomponents('vtodo');
          console.log('Found VTodos:', vtodos.length);
          
          vtodos.forEach((vtodo, vtodoIndex) => {
            console.log(`Processing VTodo ${vtodoIndex + 1}/${vtodos.length}`);
            const task = this.parseVTodo(vtodo);
            if (task) {
              // Add CalDAV metadata
              task.etag = etag;
              task.last_modified = lastModified;
              task.href = hrefMatch[1];
              tasks.push(task);
              console.log('Added task:', task.title, 'UID:', task._uid);
            }
          });
        } catch (error) {
          console.error('Error parsing iCalendar data:', error);
        }
      });
    }
    
    console.log('Total tasks parsed:', tasks.length);
    return tasks;
  }

  parseVTodo(vtodo) {
    try {
      const summary = vtodo.getFirstPropertyValue('summary') || '';
      const description = vtodo.getFirstPropertyValue('description') || '';
      const due = vtodo.getFirstPropertyValue('due');
      const dtstart = vtodo.getFirstPropertyValue('dtstart');
      const status = vtodo.getFirstPropertyValue('status') || 'NEEDS-ACTION';
      const priority = vtodo.getFirstPropertyValue('priority') || 0;
      const uid = vtodo.getFirstPropertyValue('uid');
      const location = vtodo.getFirstPropertyValue('location') || '';
      const url = vtodo.getFirstPropertyValue('url') || '';
      const organizer = vtodo.getFirstPropertyValue('organizer') || '';
      const percentComplete = vtodo.getFirstPropertyValue('percent-complete') || 0;
      const completed = vtodo.getFirstPropertyValue('completed');

      // Convert CalDAV status to our status
      let taskStatus = 0; // Pending
      if (status === 'COMPLETED') taskStatus = 2;
      else if (status === 'IN-PROCESS') taskStatus = 1;
      else if (status === 'CANCELLED') taskStatus = 3;

      // Convert CalDAV priority to our priority (1-9 -> 1-5)
      let taskPriority = 0;
      if (priority > 0) {
        taskPriority = Math.ceil(priority / 2);
      }

      return {
        _uid: uid,
        title: summary,
        description: description,
        due: due ? new Date(due).toISOString() : null,
        dtstart: dtstart ? new Date(dtstart).toISOString() : null,
        status: taskStatus,
        priority: taskPriority,
        location: location,
        url: url,
        organizer: organizer,
        percent_complete: parseInt(percentComplete) || 0,
        completed: completed ? new Date(completed).toISOString() : null,
        _sync_id: uid,
        _dirty: 0, // Remote tasks are clean
        source: 'caldav'
      };
    } catch (error) {
      console.error('Error parsing VTodo:', error);
      return null;
    }
  }

  async syncLocalToRemote(localTasks) {
    for (const task of localTasks) {
      try {
        console.log('Processing dirty task:', task.id, 'title:', task.title, 'status:', task.status, 'deleted:', task._deleted);
        
        // Check if this task should be synced (only CalDAV lists)
        const collectionPath = await this.getCollectionPathForTask(task);
        if (!collectionPath) {
          console.log(`Skipping task ${task.id} - not in a CalDAV list`);
          continue;
        }
        
        if (task._deleted === 1) {
          // Task was deleted locally, delete from remote
          if (task._uid) {
            console.log(`Deleting task ${task.id} (${task.title}) from remote server`);
            await this.deleteRemoteTask(task);
          }
        } else if (task._uid) {
          // Update existing task
          await this.updateRemoteTask(task);
        } else {
          // Create new task
          await this.createRemoteTask(task);
        }

        // Mark as synced
        const db = getDatabase();
        db.prepare('UPDATE tasks SET _dirty = 0 WHERE id = ?').run(task.id);
      } catch (error) {
        console.error(`Error syncing task ${task.id} to remote:`, error);
      }
    }
  }

  async syncRemoteToLocal(remoteTasks) {
    const db = getDatabase();
    
    // First, ensure all discovered collections have corresponding task lists
    // This ensures empty collections are also visible in the UI
    const collections = await this.discoverCollections();
    console.log(`Ensuring task lists exist for ${collections.length} discovered collections`);
    
    for (const collection of collections) {
      try {
        const taskList = await this.getOrCreateTaskListForCollection(collection);
        console.log(`Task list ready for collection ${collection}: ${taskList.name} (ID: ${taskList.id})`);
      } catch (error) {
        console.error(`Error creating task list for collection ${collection}:`, error);
      }
    }
    
    // Clean up task lists that don't belong to the current DAV server
    await this.cleanupOrphanedTaskLists(collections);
    
    // Then process remote tasks (download from DAV)
    for (const remoteTask of remoteTasks) {
      try {
        // Get or create task list for this collection
        const taskList = await this.getOrCreateTaskListForCollection(remoteTask.collection);
        
        // Check if task already exists locally
        const existingTask = db.prepare('SELECT * FROM tasks WHERE _uid = ?').get(remoteTask._uid);
        
        if (existingTask) {
          // Update existing task if ETag has changed (more reliable than last_modified)
          const localEtag = existingTask.etag;
          const remoteEtag = remoteTask.etag;
          
          if (remoteEtag && localEtag !== remoteEtag) {
            console.log(`Updating task ${existingTask.id} (${remoteTask.title}) - ETag changed from ${localEtag} to ${remoteEtag}`);
            await this.updateLocalTask(existingTask.id, remoteTask, taskList.id);
          } else if (!localEtag && remoteEtag) {
            // Local task doesn't have ETag, update it
            console.log(`Updating task ${existingTask.id} (${remoteTask.title}) - adding ETag ${remoteEtag}`);
            await this.updateLocalTask(existingTask.id, remoteTask, taskList.id);
          }
        } else {
          // Create new task
          console.log(`Creating new task: ${remoteTask.title} (${remoteTask._uid})`);
          await this.createLocalTask(remoteTask, taskList.id);
        }
      } catch (error) {
        console.error(`Error syncing remote task ${remoteTask._uid} to local:`, error);
      }
    }
  }

  async createRemoteTask(task) {
    const vtodo = this.createVTodo(task);
    const vcalendar = new ical.Component(['vcalendar', [], [vtodo]]);
    const icalData = vcalendar.toString();

    // Get the correct collection path for this task's list
    const taskCollectionPath = await this.getCollectionPathForTask(task);
    console.log('Using collection path for new task:', taskCollectionPath);

    const filename = `${task._uid || Date.now()}.ics`;
    const collectionPath = taskCollectionPath.endsWith('/') ? taskCollectionPath : taskCollectionPath + '/';
    const url = this.serverUrl + collectionPath + filename;

    await axios.request({
      method: 'PUT',
      url: url,
      auth: {
        username: this.username,
        password: this.password
      },
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8'
      },
      data: icalData
    });

    // Update local task with UID
    const db = getDatabase();
    db.prepare('UPDATE tasks SET _uid = ?, _sync_id = ? WHERE id = ?')
      .run(task._uid || filename.replace('.ics', ''), task._uid || filename.replace('.ics', ''), task.id);
  }

  async updateRemoteTask(task) {
    console.log('Updating remote task:', task.id, 'status:', task.status, 'title:', task.title);
    
    try {
      // Create a full iCal data with all fields
      const icalData = this.createMinimalICalData(task);
      console.log('Created iCal data, length:', icalData.length);
      console.log('iCal data content:');
      console.log(icalData);

      // Get the correct collection path for this task's list
      const taskCollectionPath = await this.getCollectionPathForTask(task);
      console.log('Using collection path for task:', taskCollectionPath);

      const filename = `${task._uid}.ics`;
      const collectionPath = taskCollectionPath.endsWith('/') ? taskCollectionPath : taskCollectionPath + '/';
      const url = this.serverUrl + collectionPath + filename;

      console.log('Sending task to Radicale:', url);
      console.log('Making axios request...');
      const response = await axios.request({
        method: 'PUT',
        url: url,
        auth: {
          username: this.username,
          password: this.password
        },
        headers: {
          'Content-Type': 'text/calendar'
        },
        data: icalData
      });
      console.log('Axios request completed. Status:', response.status);
      console.log('Successfully synced task', task.id, 'to Radicale. Status:', response.status);
      
      // Update local task with new ETag from response
      const etag = response.headers.etag || response.headers['etag'];
      if (etag) {
        const db = getDatabase();
        db.prepare('UPDATE tasks SET etag = ? WHERE id = ?').run(etag, task.id);
        console.log(`Updated local task ${task.id} with new ETag: ${etag}`);
      }
    } catch (error) {
      console.error('Error updating remote task', task.id, ':', error);
      throw error;
    }
  }

  async deleteRemoteTask(task) {
    console.log('Deleting remote task:', task.id, 'title:', task.title, 'uid:', task._uid);
    
    try {
      // Get the correct collection path for this task's list
      const taskCollectionPath = await this.getCollectionPathForTask(task);
      console.log('Using collection path for deletion:', taskCollectionPath);

      const filename = `${task._uid}.ics`;
      const collectionPath = taskCollectionPath.endsWith('/') ? taskCollectionPath : taskCollectionPath + '/';
      const url = this.serverUrl + collectionPath + filename;

      console.log('Deleting task from Radicale:', url);
      const response = await axios.request({
        method: 'DELETE',
        url: url,
        auth: {
          username: this.username,
          password: this.password
        }
      });
      console.log('Successfully deleted task', task.id, 'from Radicale. Status:', response.status);
    } catch (error) {
      console.error('Error deleting remote task', task.id, ':', error);
      // Don't throw error for 404 (task already deleted) or 410 (gone)
      if (error.response && (error.response.status === 404 || error.response.status === 410)) {
        console.log('Task was already deleted from remote server');
      } else {
        throw error;
      }
    }
  }

  async getCollectionPathForTask(task) {
    const db = getDatabase();
    
    // Get the task list for this task
    const taskList = db.prepare(`
      SELECT * FROM task_lists 
      WHERE id = ?
    `).get(task.list_id);
    
    if (!taskList) {
      console.log('No task list found for task, using default collection path');
      return this.collectionPath;
    }
    
    // Only sync CalDAV task lists, not local ones
    if (taskList.account_type !== 'caldav') {
      console.log(`Task list "${taskList.name}" is not a CalDAV list (${taskList.account_type}), skipping sync`);
      return null; // This will cause the task to be skipped
    }
    
    // Map task list name to collection path
    // "Personal/tasks" -> "/personal/tasks"
    // "Work/contacts" -> "/work/contacts"
    const collectionPath = '/' + taskList.name.toLowerCase();
    console.log(`Mapped task list "${taskList.name}" to collection path "${collectionPath}"`);
    
    return collectionPath;
  }

  createMinimalICalData(task) {
    const uid = task._uid || `task-${task.id}-${Date.now()}`;
    const summary = task.title || 'Untitled Task';
    const status = task.status === 2 ? 'COMPLETED' : (task.status === 1 ? 'IN-PROCESS' : 'NEEDS-ACTION');
    const now = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    
    let icalData = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//OpenTasks//OpenTasks//EN
BEGIN:VTODO
UID:${uid}
SUMMARY:${summary}
STATUS:${status}
DTSTAMP:${now}`;

    // Add description if present
    if (task.description && typeof task.description === 'string' && task.description.trim()) {
      icalData += `\nDESCRIPTION:${task.description.trim()}`;
    }

    // Add due date if present
    if (task.due && task.due !== null && task.due !== '') {
      try {
        const dueDate = new Date(task.due);
        if (!isNaN(dueDate.getTime())) {
          const dueStr = dueDate.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
          icalData += `\nDUE:${dueStr}`;
        }
      } catch (e) {
        console.warn('Invalid due date for task', task.id, ':', task.due);
      }
    }

    // Add start date if present
    if (task.dtstart && task.dtstart !== null && task.dtstart !== '') {
      try {
        const startDate = new Date(task.dtstart);
        if (!isNaN(startDate.getTime())) {
          const startStr = startDate.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
          icalData += `\nDTSTART:${startStr}`;
        }
      } catch (e) {
        console.warn('Invalid dtstart date for task', task.id, ':', task.dtstart);
      }
    }

    // Add location if present
    if (task.location && typeof task.location === 'string' && task.location.trim()) {
      icalData += `\nLOCATION:${task.location.trim()}`;
    }

    // Add organizer if present
    if (task.organizer && typeof task.organizer === 'string' && task.organizer.trim()) {
      icalData += `\nORGANIZER:${task.organizer.trim()}`;
    }

    // Add priority if present
    if (task.priority && typeof task.priority === 'number' && task.priority > 0) {
      icalData += `\nPRIORITY:${task.priority * 2}`;
    }

    // Add created date if present
    if (task.created && task.created !== null && task.created !== '') {
      try {
        const createdDate = new Date(task.created);
        if (!isNaN(createdDate.getTime())) {
          const createdStr = createdDate.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
          icalData += `\nCREATED:${createdStr}`;
        }
      } catch (e) {
        console.warn('Invalid created date for task', task.id, ':', task.created);
      }
    }

    if (task.status === 2) {
      icalData += `\nCOMPLETED:${now}`;
    }

    icalData += `\nEND:VTODO
END:VCALENDAR`;

    return icalData;
  }

  createVTodo(task) {
    console.log('Creating VTodo for task:', task.id, 'title:', task.title, 'status:', task.status);
    
    try {
      const vtodo = new ical.Component('vtodo');
      
      // Required properties - ensure they're strings
      const uid = String(task._uid || `task-${task.id}-${Date.now()}`);
      const summary = String(task.title || 'Untitled Task');
      
      vtodo.addPropertyWithValue('uid', uid);
      vtodo.addPropertyWithValue('summary', summary);
      
      // Set status
      let status = 'NEEDS-ACTION';
      if (task.status === 2) status = 'COMPLETED';
      else if (task.status === 1) status = 'IN-PROCESS';
      else if (task.status === 3) status = 'CANCELLED';
      vtodo.addPropertyWithValue('status', status);

      // Add DTSTAMP (required for iCal)
      const now = new Date();
      vtodo.addPropertyWithValue('dtstamp', new ical.Time.fromJSDate(now, true)); // true = UTC

      // Optional properties - only add if they exist and are valid
      if (task.description && typeof task.description === 'string' && task.description.trim()) {
        vtodo.addPropertyWithValue('description', task.description.trim());
      }
      
      if (task.due && task.due !== null && task.due !== '') {
        try {
          const dueDate = new Date(task.due);
          if (!isNaN(dueDate.getTime())) {
            // Create iCal time in UTC to preserve timezone information
            const icalTime = new ical.Time.fromJSDate(dueDate, true); // true = UTC
            vtodo.addPropertyWithValue('due', icalTime);
          }
        } catch (e) {
          console.warn('Invalid due date for task', task.id, ':', task.due);
        }
      }
      
      if (task.dtstart && task.dtstart !== null && task.dtstart !== '') {
        try {
          const startDate = new Date(task.dtstart);
          if (!isNaN(startDate.getTime())) {
            // Create iCal time in UTC to preserve timezone information
            const icalTime = new ical.Time.fromJSDate(startDate, true); // true = UTC
            vtodo.addPropertyWithValue('dtstart', icalTime);
          }
        } catch (e) {
          console.warn('Invalid dtstart date for task', task.id, ':', task.dtstart);
        }
      }
      
      if (task.location && typeof task.location === 'string' && task.location.trim()) {
        vtodo.addPropertyWithValue('location', task.location.trim());
      }
      
      if (task.url && typeof task.url === 'string' && task.url.trim()) {
        vtodo.addPropertyWithValue('url', task.url.trim());
      }
      
      if (task.organizer && typeof task.organizer === 'string' && task.organizer.trim()) {
        vtodo.addPropertyWithValue('organizer', task.organizer.trim());
      }

      // Set priority (convert our 1-5 to CalDAV 1-9)
      if (task.priority && typeof task.priority === 'number' && task.priority > 0) {
        vtodo.addPropertyWithValue('priority', task.priority * 2);
      }

      // Set timestamps - ensure they're valid dates
      if (task.created && task.created !== null && task.created !== '') {
        try {
          const createdDate = new Date(task.created);
          if (!isNaN(createdDate.getTime())) {
            // Create iCal time in UTC to preserve timezone information
            const icalTime = new ical.Time.fromJSDate(createdDate, true); // true = UTC
            vtodo.addPropertyWithValue('created', icalTime);
          }
        } catch (e) {
          console.warn('Invalid created date for task', task.id, ':', task.created);
        }
      }

      console.log('VTodo created successfully for task:', task.id);
      return vtodo;
    } catch (error) {
      console.error('Error creating VTodo for task', task.id, ':', error);
      throw error;
    }
  }

  async getOrCreateTaskListForCollection(collectionPath) {
    const db = getDatabase();
    
    // Generate a name for the collection
    const collectionName = this.getCollectionDisplayName(collectionPath);
    
    // Check if task list already exists for this collection
    // First try exact name match
    let taskList = db.prepare(`
      SELECT * FROM task_lists 
      WHERE account_name = ? AND account_type = ? AND name = ?
    `).get(this.username, 'caldav', collectionName);
    
    // If not found, try to find by collection path stored in the owner field for reference
    if (!taskList) {
      taskList = db.prepare(`
        SELECT * FROM task_lists 
        WHERE account_name = ? AND account_type = ? AND owner = ?
      `).get(this.username, 'caldav', collectionPath);
    }
    
    if (!taskList) {
      // Create new task list for this collection
      const insertList = db.prepare(`
        INSERT INTO task_lists (name, color, account_name, account_type, visible, sync_enabled, access_level, owner)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      
      const result = insertList.run(
        collectionName,
        '#2196F3', // Default blue color
        this.username,
        'caldav',
        1, // visible
        1, // sync_enabled
        0, // access_level
        collectionPath // Store original collection path for reference
      );
      
      taskList = db.prepare('SELECT * FROM task_lists WHERE id = ?').get(result.lastInsertRowid);
      
      // Broadcast task list creation
      broadcastUpdate('tasklist_created', taskList);
      
      console.log(`Created task list for collection: ${collectionName} (${collectionPath})`);
    } else {
      console.log(`Found existing task list for collection: ${collectionName} (${collectionPath})`);
    }
    
    return taskList;
  }

  getCollectionDisplayName(collectionPath) {
    // Convert collection path to a clean display name
    // Handle different DAV server formats:
    // - Baikal: "/dav.php/calendars/john/testcal/" -> "Testcal"
    // - Radicale: "/john/testcal/" -> "Testcal"
    // - Generic: "/user/username/tasks" -> "Tasks"
    
    let name = collectionPath.replace(/^\/+|\/+$/g, ''); // Remove leading/trailing slashes
    if (!name) return 'Root';
    
    // Split path into parts
    const pathParts = name.split('/');
    
    // Skip common DAV server prefixes and system paths
    const skipPrefixes = [
      'dav.php', 'calendars', 'caldav', 'carddav', 'user', 'home', 
      'public', 'private', 'principals', 'users', 'collections'
    ];
    
    // Find the meaningful parts (skip prefixes and system paths)
    const meaningfulParts = pathParts.filter(part => 
      part && 
      !skipPrefixes.includes(part.toLowerCase()) &&
      !part.match(/^[a-f0-9-]{8,}$/i) && // Skip UUIDs
      part !== 'inbox' && 
      part !== 'outbox'
      // Note: 'default' is now allowed as it's a valid collection name
    );
    
    if (meaningfulParts.length > 0) {
      // Use the last meaningful part as the collection name
      name = meaningfulParts[meaningfulParts.length - 1];
    } else {
      // Fallback to the last part of the path
      name = pathParts[pathParts.length - 1] || 'Root';
    }
    
    // Return the name as-is, preserving original casing
    return name;
  }

  async syncLocalUpdatesToRemote(collections) {
    const db = getDatabase();
    
    // Get all local tasks that have been updated and need to be synced to server
    const updatedTasks = db.prepare(`
      SELECT t.*, tl.owner as collection_path, tl.name as list_name
      FROM tasks t
      JOIN task_lists tl ON t.list_id = tl.id
      WHERE tl.account_name = ? AND tl.account_type = 'caldav'
      AND t._uid IS NOT NULL AND t._uid != ''
      AND t.etag IS NOT NULL AND t.etag != ''
      AND (t.last_synced IS NULL OR t.last_modified > t.last_synced)
    `).all(this.username);
    
    console.log(`Found ${updatedTasks.length} updated local tasks to sync to DAV server (updates)`);
    
    for (const localTask of updatedTasks) {
      try {
        // Find the collection for this task list
        const collection = collections.find(col => 
          col === localTask.collection_path ||
          col === localTask.collection_path.replace(/\/$/, '') ||
          col === localTask.collection_path + '/' ||
          localTask.collection_path === col + '/' ||
          localTask.collection_path === col
        );
        
        if (!collection) {
          console.log(`No collection found for updated task ${localTask.id} (${localTask.title})`);
          continue;
        }
        
        // Update the task on the DAV server
        await this.updateTaskOnServer(localTask, collection);
        
        // Update last_synced timestamp
        db.prepare('UPDATE tasks SET last_synced = ? WHERE id = ?').run(new Date().toISOString(), localTask.id);
        
      } catch (error) {
        console.error(`Error syncing updated task ${localTask.id} to server:`, error);
      }
    }
  }

  async updateTaskOnServer(localTask, collectionPath) {
    try {
      // Convert local task to VTodo format
      const vtodo = this.createVTodoFromLocalTask(localTask);
      const icalData = vtodo.toString();
      
      // Generate filename for the task
      const filename = `${localTask._uid}.ics`;
      // Remove the leading slash and dav.php/calendars from collectionPath since serverUrl already includes it
      const relativePath = collectionPath.replace(/^\/dav\.php\/calendars/, '');
      const taskUrl = `${relativePath}${filename}`;
      
      console.log(`Updating task ${localTask.id} (${localTask.title}) at ${taskUrl}`);
      
      // Update the task on the DAV server
      // Decode HTML entities in ETag before using it
      const decodedEtag = localTask.etag ? localTask.etag.replace(/&quot;/g, '"').replace(/&amp;/g, '&') : null;
      
      const response = await this.axiosInstance.request({
        method: 'PUT',
        url: taskUrl,
        data: icalData,
        headers: {
          'Content-Type': 'text/calendar',
          'If-Match': decodedEtag // Use decoded ETag for conditional update
        }
      });
      
      // Extract ETag from response headers
      const etag = response.headers.etag || response.headers['etag'];
      if (etag) {
        // Update local task with new ETag
        const db = getDatabase();
        db.prepare('UPDATE tasks SET etag = ? WHERE id = ?').run(etag, localTask.id);
        console.log(`Task ${localTask.id} updated successfully with ETag: ${etag}`);
      } else {
        console.log(`Task ${localTask.id} updated successfully but no ETag received`);
      }
      
    } catch (error) {
      console.error(`Error updating task ${localTask.id} on server:`, error);
      throw error;
    }
  }

  async syncLocalToRemote(collections) {
    const db = getDatabase();
    
    // Get all local tasks that are not synced to the server
    const localTasks = db.prepare(`
      SELECT t.*, tl.owner as collection_path, tl.name as list_name
      FROM tasks t
      JOIN task_lists tl ON t.list_id = tl.id
      WHERE tl.account_name = ? AND tl.account_type = 'caldav'
      AND (t._uid IS NULL OR t._uid = '' OR t.etag IS NULL OR t.etag = '')
    `).all(this.username);
    
    console.log(`Found ${localTasks.length} local tasks to sync to DAV server (initial upload)`);
    
    for (const localTask of localTasks) {
      try {
        // Find the collection for this task list
        const collection = collections.find(col => 
          col === localTask.collection_path ||
          col === localTask.collection_path.replace(/\/$/, '') ||
          col === localTask.collection_path + '/' ||
          localTask.collection_path === col + '/' ||
          localTask.collection_path === col
        );
        
        if (!collection) {
          console.log(`No collection found for task ${localTask.id} (${localTask.title})`);
          continue;
        }
        
        // Generate a UID if the task doesn't have one
        if (!localTask._uid || localTask._uid === '') {
          const uid = this.generateUID();
          db.prepare('UPDATE tasks SET _uid = ? WHERE id = ?').run(uid, localTask.id);
          localTask._uid = uid;
        }
        
        // Upload the task to the DAV server
        await this.uploadTaskToServer(localTask, collection);
        
      } catch (error) {
        console.error(`Error syncing local task ${localTask.id} to server:`, error);
      }
    }
  }

  async cleanupOrphanedTaskLists(existingCollections) {
    const db = getDatabase();
    
    // Get all CalDAV task lists for this account
    const caldavTaskLists = db.prepare(`
      SELECT * FROM task_lists 
      WHERE account_name = ? AND account_type = ?
    `).all(this.username, 'caldav');
    
    console.log(`Checking ${caldavTaskLists.length} CalDAV task lists - removing those not in current DAV server`);
    
    for (const taskList of caldavTaskLists) {
      // Check if this task list's collection still exists on the server
      const collectionPath = taskList.owner || `/${taskList.name.toLowerCase()}/`;
      const collectionExists = existingCollections.some(collection => 
        collection === collectionPath || 
        collection === collectionPath.replace(/\/$/, '') ||
        collection === collectionPath + '/' ||
        collectionPath === collection + '/' ||
        collectionPath === collection
      );
      
      if (!collectionExists) {
        // This task list doesn't belong to the current DAV server connection
        // Remove it completely, regardless of whether it has tasks
        console.log(`Removing task list that doesn't belong to current DAV server: ${taskList.name} (${collectionPath})`);
        
        // First, delete all tasks in this list
        const taskCount = db.prepare('SELECT COUNT(*) as count FROM tasks WHERE list_id = ? AND _deleted = 0').get(taskList.id);
        if (taskCount.count > 0) {
          console.log(`Deleting ${taskCount.count} tasks from removed list: ${taskList.name}`);
          db.prepare('DELETE FROM tasks WHERE list_id = ?').run(taskList.id);
        }
        
        // Then delete the task list itself
        db.prepare('DELETE FROM task_lists WHERE id = ?').run(taskList.id);
        broadcastUpdate('tasklist_deleted', { id: taskList.id });
      } else {
        // Collection exists, check if the task list name needs to be updated to the new clean format
        const expectedName = this.getCollectionDisplayName(collectionPath);
        if (taskList.name !== expectedName && taskList.name.includes('Dav.php Calendars')) {
          console.log(`Updating task list name from "${taskList.name}" to "${expectedName}"`);
          db.prepare('UPDATE task_lists SET name = ? WHERE id = ?').run(expectedName, taskList.id);
          broadcastUpdate('tasklist_updated', { ...taskList, name: expectedName });
        }
      }
    }
  }

  async uploadTaskToServer(localTask, collectionPath) {
    try {
      // Convert local task to VTodo format
      const vtodo = this.createVTodoFromLocalTask(localTask);
      const icalData = vtodo.toString();
      
      // Generate filename for the task
      const filename = `${localTask._uid}.ics`;
      // Remove the leading slash and dav.php/calendars from collectionPath since serverUrl already includes it
      const relativePath = collectionPath.replace(/^\/dav\.php\/calendars/, '');
      const taskUrl = `${relativePath}${filename}`;
      
      console.log(`Uploading task ${localTask.id} (${localTask.title}) to ${taskUrl}`);
      
      // Upload the task to the DAV server
      console.log(`Full task URL: ${this.serverUrl}${taskUrl}`);
      console.log(`Uploading task ${localTask.id} (${localTask.title}) to DAV server`);
      
      const response = await this.axiosInstance.request({
        method: 'PUT',
        url: taskUrl,
        data: icalData,
        headers: {
          'Content-Type': 'text/calendar',
          'User-Agent': 'OpenTasks/1.0'
        }
      });
      
      // Extract ETag from response headers
      const etag = response.headers.etag || response.headers['etag'];
      if (etag) {
        // Update local task with ETag
        const db = getDatabase();
        db.prepare('UPDATE tasks SET etag = ? WHERE id = ?').run(etag, localTask.id);
        console.log(`Task ${localTask.id} uploaded successfully with ETag: ${etag}`);
      } else {
        // Set a placeholder ETag to mark as synced
        const db = getDatabase();
        const placeholderEtag = `uploaded-${Date.now()}`;
        db.prepare('UPDATE tasks SET etag = ? WHERE id = ?').run(placeholderEtag, localTask.id);
        console.log(`Task ${localTask.id} uploaded successfully, set placeholder ETag: ${placeholderEtag}`);
      }
      
    } catch (error) {
      console.error(`Error uploading task ${localTask.id} to server:`, error);
      if (error.response) {
        console.error(`Response status: ${error.response.status}`);
        console.error(`Response data:`, error.response.data);
        console.error(`Response headers:`, error.response.headers);
      }
      throw error;
    }
  }

  createVTodoFromLocalTask(localTask) {
    // Create a complete VCALENDAR with VTODO
    const vcalendar = new ical.Component(['vcalendar', [], []]);
    vcalendar.addPropertyWithValue('version', '2.0');
    vcalendar.addPropertyWithValue('prodid', '-//OpenTasks//OpenTasks//EN');
    
    const vtodo = new ical.Component(['vtodo', [], []]);
    
    // Add UID
    vtodo.addPropertyWithValue('uid', localTask._uid);
    
    // Add summary (title)
    if (localTask.title && localTask.title.trim()) {
      vtodo.addPropertyWithValue('summary', localTask.title.trim());
    }
    
    // Add description
    if (localTask.description && localTask.description.trim()) {
      vtodo.addPropertyWithValue('description', localTask.description.trim());
    }
    
    // Add status - map numeric status to CalDAV status strings
    if (localTask.status !== undefined && localTask.status !== null) {
      let caldavStatus;
      switch (parseInt(localTask.status)) {
        case 0:
          caldavStatus = 'NEEDS-ACTION';
          break;
        case 1:
          caldavStatus = 'IN-PROGRESS';
          break;
        case 2:
          caldavStatus = 'COMPLETED';
          break;
        default:
          caldavStatus = 'NEEDS-ACTION';
      }
      vtodo.addPropertyWithValue('status', caldavStatus);
      
      // For completed tasks, add COMPLETED property with completion timestamp
      if (parseInt(localTask.status) === 2) {
        const completedDate = localTask.updated || localTask.last_modified || new Date().toISOString();
        try {
          const completedTime = new Date(completedDate);
          if (!isNaN(completedTime.getTime())) {
            const icalTime = new ical.Time.fromJSDate(completedTime, true);
            vtodo.addPropertyWithValue('completed', icalTime);
          }
        } catch (e) {
          console.warn('Invalid completion date for task', localTask.id, ':', completedDate);
        }
      }
    }
    
    // Add priority
    if (localTask.priority && typeof localTask.priority === 'number' && localTask.priority > 0) {
      vtodo.addPropertyWithValue('priority', localTask.priority * 2);
    }
    
    // Add due date
    if (localTask.due_date) {
      try {
        const dueDate = new Date(localTask.due_date);
        if (!isNaN(dueDate.getTime())) {
          const icalTime = new ical.Time.fromJSDate(dueDate, true);
          vtodo.addPropertyWithValue('due', icalTime);
        }
      } catch (e) {
        console.warn('Invalid due date for task', localTask.id, ':', localTask.due_date);
      }
    }
    
    // Add created date
    if (localTask.created) {
      try {
        const createdDate = new Date(localTask.created);
        if (!isNaN(createdDate.getTime())) {
          const icalTime = new ical.Time.fromJSDate(createdDate, true);
          vtodo.addPropertyWithValue('created', icalTime);
        }
      } catch (e) {
        console.warn('Invalid created date for task', localTask.id, ':', localTask.created);
      }
    }
    
    // Add last modified
    if (localTask.updated) {
      try {
        const updatedDate = new Date(localTask.updated);
        if (!isNaN(updatedDate.getTime())) {
          const icalTime = new ical.Time.fromJSDate(updatedDate, true);
          vtodo.addPropertyWithValue('last-modified', icalTime);
        }
      } catch (e) {
        console.warn('Invalid updated date for task', localTask.id, ':', localTask.updated);
      }
    }
    
    // Add location
    if (localTask.location && localTask.location.trim()) {
      vtodo.addPropertyWithValue('location', localTask.location.trim());
    }
    
    // Add URL
    if (localTask.url && localTask.url.trim()) {
      vtodo.addPropertyWithValue('url', localTask.url.trim());
    }
    
    // Add organizer
    if (localTask.organizer && localTask.organizer.trim()) {
      vtodo.addPropertyWithValue('organizer', localTask.organizer.trim());
    }
    
    // Add the VTODO to the VCALENDAR
    vcalendar.addSubcomponent(vtodo);
    
    return vcalendar;
  }

  generateUID() {
    // Generate a UUID-like identifier
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  async createLocalTask(remoteTask, listId) {
    const db = getDatabase();

    const insertTask = db.prepare(`
      INSERT INTO tasks (
        list_id, title, description, location, url, organizer,
        priority, status, dtstart, due, percent_complete, completed, _uid, _sync_id, _dirty, etag
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertTask.run(
      listId,
      remoteTask.title,
      remoteTask.description || null,
      remoteTask.location || null,
      remoteTask.url || null,
      remoteTask.organizer || null,
      remoteTask.priority,
      remoteTask.status,
      remoteTask.dtstart || null,
      remoteTask.due || null,
      remoteTask.percent_complete || 0,
      remoteTask.completed || null,
      remoteTask._uid,
      remoteTask._sync_id,
      0, // Not dirty since it came from remote
      remoteTask.etag || null
    );

    const newTask = db.prepare('SELECT * FROM tasks WHERE _uid = ?').get(remoteTask._uid);
    broadcastUpdate('task_created', newTask);
  }

  async updateLocalTask(taskId, remoteTask, listId) {
    const db = getDatabase();
    
    const updateTask = db.prepare(`
      UPDATE tasks SET
        list_id = ?, title = ?, description = ?, location = ?, url = ?, organizer = ?,
        priority = ?, status = ?, dtstart = ?, due = ?, percent_complete = ?, completed = ?, last_modified = CURRENT_TIMESTAMP, etag = ?, _dirty = 0
      WHERE id = ?
    `);

    updateTask.run(
      listId,
      remoteTask.title,
      remoteTask.description || null,
      remoteTask.location || null,
      remoteTask.url || null,
      remoteTask.organizer || null,
      remoteTask.priority,
      remoteTask.status,
      remoteTask.dtstart || null,
      remoteTask.due || null,
      remoteTask.percent_complete || 0,
      remoteTask.completed || null,
      remoteTask.etag || null,
      taskId
    );

    const updatedTask = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
    broadcastUpdate('task_updated', updatedTask);
  }

  getStatus() {
    return {
      enabled: this.isEnabled,
      lastSync: this.lastSync,
      syncInProgress: this.syncInProgress,
      serverUrl: this.serverUrl,
      syncInterval: this.syncInterval
    };
  }
}

module.exports = CalDAVSync;