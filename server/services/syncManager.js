const fileCalDAVSync = require('./fileCalDAVSync');

class SyncManager {
  constructor() {
    this.caldavSync = null;
  }

  initialize() {
    if (!this.caldavSync) {
      this.caldavSync = fileCalDAVSync;
    }
    return this.caldavSync;
  }

  getCalDAVSync() {
    return this.caldavSync || this.initialize();
  }

  startCalDAVSync() {
    const sync = this.getCalDAVSync();
    sync.start();
    return sync;
  }

  stopCalDAVSync() {
    if (this.caldavSync) {
      this.caldavSync.stop();
    }
  }

  restartCalDAVSync() {
    this.stopCalDAVSync();
    this.caldavSync = new CalDAVSync();
    this.caldavSync.start();
    return this.caldavSync;
  }

  async triggerManualSync() {
    const sync = this.getCalDAVSync();
    
    if (sync && sync.isEnabled) {
      console.log('Manual sync triggered');
      await sync.sync();
      return { success: true, message: 'Sync completed successfully' };
    } else {
      throw new Error('CalDAV sync is not enabled or not available');
    }
  }
}

// Create a singleton instance
const syncManager = new SyncManager();

module.exports = syncManager;