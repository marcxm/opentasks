const syncManager = require('./syncManager');
const fileManager = require('./fileManager');

class SyncTrigger {
  constructor() {
    this.syncInProgress = false;
    this.syncQueue = [];
    this.syncTimeout = null;
  }

  /**
   * Trigger sync for a specific task list
   * @param {string} listId - The ID of the task list that changed
   * @param {string} operation - The operation that triggered the sync (create, update, delete)
   * @param {string} taskId - The ID of the task that changed
   */
  async triggerSyncForList(listId, operation, taskId) {
    try {
      // Get the collection to check if it exists
      const collection = await fileManager.getCollection(listId);
      
      if (!collection) {
        console.log(`Collection ${listId} not found, skipping sync trigger`);
        return;
      }

      // In file-based system, we sync all collections that are managed by CalDAV
      // (i.e., not local-only collections)
      console.log(`Triggering sync for collection "${collection.name}" (${operation} operation on task ${taskId})`);
      
      // Add to sync queue to avoid multiple simultaneous syncs
      this.syncQueue.push({ listId, operation, taskId, timestamp: Date.now() });
      
      // Debounce sync calls - wait 2 seconds before triggering to batch multiple changes
      if (this.syncTimeout) {
        clearTimeout(this.syncTimeout);
      }
      
      this.syncTimeout = setTimeout(() => {
        this.processSyncQueue();
      }, 2000); // 2 second debounce
      
    } catch (error) {
      console.error('Error triggering sync for list:', error);
    }
  }

  /**
   * Process the sync queue
   */
  async processSyncQueue() {
    if (this.syncInProgress) {
      console.log('Sync already in progress, skipping trigger');
      return;
    }

    if (this.syncQueue.length === 0) {
      return;
    }

    this.syncInProgress = true;
    const queueLength = this.syncQueue.length;
    
    console.log(`Processing sync queue with ${queueLength} items`);
    
    try {
      const caldavSync = syncManager.getCalDAVSync();
      if (caldavSync && caldavSync.isEnabled) {
        // Trigger a full sync
        await caldavSync.sync();
        console.log('Sync triggered successfully from queue');
      } else {
        console.log('CalDAV sync not enabled, skipping');
      }
    } catch (error) {
      console.error('Error processing sync queue:', error);
    } finally {
      this.syncInProgress = false;
      this.syncQueue = []; // Clear the queue
    }
  }

  /**
   * Trigger immediate sync (no debouncing)
   * @param {string} listId - The ID of the task list that changed
   * @param {string} operation - The operation that triggered the sync
   * @param {string} taskId - The ID of the task that changed
   */
  async triggerImmediateSync(listId, operation, taskId) {
    try {
      const collection = await fileManager.getCollection(listId);
      
      if (!collection) {
        return;
      }

      console.log(`Triggering immediate sync for collection "${collection.name}" (${operation} operation on task ${taskId})`);
      
      const caldavSync = syncManager.getCalDAVSync();
      if (caldavSync && caldavSync.isEnabled) {
        await caldavSync.sync();
        console.log('Immediate sync completed');
      }
    } catch (error) {
      console.error('Error triggering immediate sync:', error);
    }
  }
}

// Create singleton instance
const syncTrigger = new SyncTrigger();

module.exports = syncTrigger;