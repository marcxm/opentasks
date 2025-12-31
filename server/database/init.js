const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs').promises;

let db = null;

async function initializeDatabase() {
  const dbPath = path.join(process.env.DATA_DIR || './data', 'opentasks.db');
  
  try {
    // Ensure data directory exists
    await fs.mkdir(path.dirname(dbPath), { recursive: true });
    
    // Initialize SQLite database
    db = new Database(dbPath);
    
    // Enable WAL mode for better concurrency
    db.pragma('journal_mode = WAL');
    
    // Create tables
    await createTables();
    
    // Run migrations
    await runMigrations();
    
    console.log('Database initialized successfully');
  } catch (error) {
    console.error('Database initialization failed:', error);
    throw error;
  }
}

async function runMigrations() {
  // Add last_synced column to tasks table if it doesn't exist
  try {
    db.exec(`ALTER TABLE tasks ADD COLUMN last_synced DATETIME`);
    console.log('Added last_synced column to tasks table');
  } catch (error) {
    // Column already exists, ignore error
    if (!error.message.includes('duplicate column name')) {
      console.error('Error adding last_synced column:', error);
    }
  }
  
  // Add etag column to tasks table if it doesn't exist
  try {
    db.exec(`ALTER TABLE tasks ADD COLUMN etag TEXT`);
    console.log('Added etag column to tasks table');
  } catch (error) {
    // Column already exists, ignore error
    if (!error.message.includes('duplicate column name')) {
      console.error('Error adding etag column:', error);
    }
  }
}

async function createTables() {
  // Task Lists table
  db.exec(`
    CREATE TABLE IF NOT EXISTS task_lists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      color TEXT DEFAULT '#2196F3',
      account_name TEXT DEFAULT 'Local',
      account_type TEXT DEFAULT 'org.dmfs.account.LOCAL',
      visible INTEGER DEFAULT 1,
      sync_enabled INTEGER DEFAULT 0,
      owner TEXT,
      access_level INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Tasks table
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      list_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      location TEXT,
      geo TEXT,
      url TEXT,
      organizer TEXT,
      priority INTEGER DEFAULT 0,
      classification INTEGER,
      completed DATETIME,
      completed_is_allday INTEGER DEFAULT 0,
      percent_complete INTEGER,
      status INTEGER DEFAULT 0,
      task_color TEXT,
      dtstart DATETIME,
      is_allday INTEGER DEFAULT 0,
      created DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_modified DATETIME DEFAULT CURRENT_TIMESTAMP,
      tz TEXT,
      due DATETIME,
      duration TEXT,
      rdate TEXT,
      exdate TEXT,
      rrule TEXT,
      original_instance_sync_id TEXT,
      original_instance_id INTEGER,
      original_instance_time DATETIME,
      original_instance_allday INTEGER DEFAULT 0,
      parent_id INTEGER,
      sorting TEXT,
      has_alarms INTEGER DEFAULT 0,
      has_properties INTEGER DEFAULT 0,
      pinned INTEGER DEFAULT 0,
      version INTEGER DEFAULT 1,
      _uid TEXT,
      _deleted INTEGER DEFAULT 0,
      _dirty INTEGER DEFAULT 0,
      sync1 TEXT,
      sync2 TEXT,
      sync3 TEXT,
      sync4 TEXT,
      sync5 TEXT,
      sync6 TEXT,
      sync7 TEXT,
      sync8 TEXT,
      _sync_id TEXT,
      etag TEXT,
      FOREIGN KEY (list_id) REFERENCES task_lists (id) ON DELETE CASCADE,
      FOREIGN KEY (parent_id) REFERENCES tasks (id) ON DELETE CASCADE
    )
  `);

  // Task Instances table (for recurring tasks)
  db.exec(`
    CREATE TABLE IF NOT EXISTS task_instances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL,
      instance_start DATETIME,
      instance_due DATETIME,
      instance_duration INTEGER,
      instance_original_time DATETIME,
      distance_from_current INTEGER DEFAULT 0,
      FOREIGN KEY (task_id) REFERENCES tasks (id) ON DELETE CASCADE
    )
  `);

  // Categories table
  db.exec(`
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_name TEXT DEFAULT 'Local',
      account_type TEXT DEFAULT 'org.dmfs.account.LOCAL',
      name TEXT NOT NULL,
      color TEXT DEFAULT '#757575',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Properties table (for attachments, alarms, etc.)
  db.exec(`
    CREATE TABLE IF NOT EXISTS properties (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL,
      mimetype TEXT NOT NULL,
      version INTEGER DEFAULT 1,
      data0 TEXT,
      data1 TEXT,
      data2 TEXT,
      data3 TEXT,
      data4 TEXT,
      data5 TEXT,
      data6 TEXT,
      data7 TEXT,
      data8 TEXT,
      data9 TEXT,
      data10 TEXT,
      data11 TEXT,
      data12 TEXT,
      data13 TEXT,
      data14 TEXT,
      data15 TEXT,
      prop_sync1 TEXT,
      prop_sync2 TEXT,
      prop_sync3 TEXT,
      prop_sync4 TEXT,
      prop_sync5 TEXT,
      prop_sync6 TEXT,
      prop_sync7 TEXT,
      prop_sync8 TEXT,
      FOREIGN KEY (task_id) REFERENCES tasks (id) ON DELETE CASCADE
    )
  `);

  // Alarms table
  db.exec(`
    CREATE TABLE IF NOT EXISTS alarms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL,
      alarm_id TEXT UNIQUE,
      last_trigger DATETIME,
      next_trigger DATETIME,
      FOREIGN KEY (task_id) REFERENCES tasks (id) ON DELETE CASCADE
    )
  `);

  // Sync state table
  db.exec(`
    CREATE TABLE IF NOT EXISTS sync_state (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_name TEXT UNIQUE NOT NULL,
      account_type TEXT NOT NULL,
      data TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Users table
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      email TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // User preferences table
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_preferences (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      selected_list_id INTEGER,
      theme TEXT DEFAULT 'light',
      language TEXT DEFAULT 'en',
      notifications_enabled INTEGER DEFAULT 1,
      hide_local_lists INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
      FOREIGN KEY (selected_list_id) REFERENCES task_lists (id) ON DELETE SET NULL,
      UNIQUE(user_id)
    )
  `);

  // Create indexes for better performance
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_tasks_list_id ON tasks(list_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due);
    CREATE INDEX IF NOT EXISTS idx_tasks_dtstart ON tasks(dtstart);
    CREATE INDEX IF NOT EXISTS idx_tasks_parent_id ON tasks(parent_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_deleted ON tasks(_deleted);
    CREATE INDEX IF NOT EXISTS idx_properties_task_id ON properties(task_id);
    CREATE INDEX IF NOT EXISTS idx_properties_mimetype ON properties(mimetype);
    CREATE INDEX IF NOT EXISTS idx_alarms_task_id ON alarms(task_id);
    CREATE INDEX IF NOT EXISTS idx_alarms_next_trigger ON alarms(next_trigger);
    CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
    CREATE INDEX IF NOT EXISTS idx_user_preferences_user_id ON user_preferences(user_id);
  `);

  // Create triggers for updating timestamps
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS update_tasks_timestamp 
    AFTER UPDATE ON tasks 
    BEGIN
      UPDATE tasks SET last_modified = CURRENT_TIMESTAMP WHERE id = NEW.id;
    END
  `);

  db.exec(`
    CREATE TRIGGER IF NOT EXISTS update_task_lists_timestamp 
    AFTER UPDATE ON task_lists 
    BEGIN
      UPDATE task_lists SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
    END
  `);

  // Insert default task list if none exists
  const defaultList = db.prepare('SELECT COUNT(*) as count FROM task_lists').get();
  if (defaultList.count === 0) {
    db.prepare(`
      INSERT INTO task_lists (name, color, account_name, account_type, visible, sync_enabled)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('My Tasks', '#2196F3', 'Local', 'org.dmfs.account.LOCAL', 1, 0);
  }

  // Add missing columns for CalDAV sync if they don't exist
  try {
    db.exec(`ALTER TABLE tasks ADD COLUMN _sync_id TEXT`);
  } catch (error) {
    // Column already exists, ignore error
  }
  
  try {
    db.exec(`ALTER TABLE tasks ADD COLUMN etag TEXT`);
  } catch (error) {
    // Column already exists, ignore error
  }

  // Migrate user_preferences table to new structure
  try {
    // Check if user_preferences table exists and what structure it has
    const tableExists = db.prepare(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name='user_preferences'
    `).get();
    
    if (tableExists) {
      // Check if the old structure exists (preference_key column)
      const oldStructure = db.prepare("PRAGMA table_info(user_preferences)").all();
      const hasOldStructure = oldStructure.some(col => col.name === 'preference_key');
      const hasNewStructure = oldStructure.some(col => col.name === 'default_task_list_id');
      
      if (hasOldStructure && !hasNewStructure) {
        console.log('Migrating user_preferences table to new structure...');
        
        // Create new table with new structure
        db.exec(`
          CREATE TABLE user_preferences_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            default_task_list_id INTEGER,
            selected_list_id INTEGER,
            theme TEXT DEFAULT 'light',
            language TEXT DEFAULT 'en',
            notifications_enabled INTEGER DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
            FOREIGN KEY (default_task_list_id) REFERENCES task_lists (id) ON DELETE SET NULL,
            FOREIGN KEY (selected_list_id) REFERENCES task_lists (id) ON DELETE SET NULL,
            UNIQUE(user_id)
          )
        `);
        
        // Migrate data from old structure to new structure
        const oldPreferences = db.prepare(`
          SELECT user_id, preference_key, preference_value 
          FROM user_preferences 
          ORDER BY user_id
        `).all();
        
        const userPreferences = {};
        oldPreferences.forEach(pref => {
          if (!userPreferences[pref.user_id]) {
            userPreferences[pref.user_id] = {
              user_id: pref.user_id,
              default_task_list_id: null,
              selected_list_id: null,
              theme: 'light',
              language: 'en',
              notifications_enabled: 1
            };
          }
          
          if (pref.preference_key === 'defaultTaskListId') {
            userPreferences[pref.user_id].default_task_list_id = pref.preference_value ? parseInt(pref.preference_value) : null;
          } else if (pref.preference_key === 'selectedListId') {
            userPreferences[pref.user_id].selected_list_id = pref.preference_value ? parseInt(pref.preference_value) : null;
          }
        });
        
        // Insert migrated data
        const insertStmt = db.prepare(`
          INSERT INTO user_preferences_new (user_id, default_task_list_id, selected_list_id, theme, language, notifications_enabled)
          VALUES (?, ?, ?, ?, ?, ?)
        `);
        
        Object.values(userPreferences).forEach(pref => {
          insertStmt.run(
            pref.user_id,
            pref.default_task_list_id,
            pref.selected_list_id,
            pref.theme,
            pref.language,
            pref.notifications_enabled
          );
        });
        
        // Drop old table and rename new table
        db.exec(`DROP TABLE user_preferences`);
        db.exec(`ALTER TABLE user_preferences_new RENAME TO user_preferences`);
        
        console.log('User preferences table migration completed');
      } else if (!hasNewStructure) {
        // Table exists but doesn't have the new structure, recreate it
        console.log('Recreating user_preferences table with new structure...');
        db.exec(`DROP TABLE user_preferences`);
        db.exec(`
          CREATE TABLE user_preferences (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            default_task_list_id INTEGER,
            selected_list_id INTEGER,
            theme TEXT DEFAULT 'light',
            language TEXT DEFAULT 'en',
            notifications_enabled INTEGER DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
            FOREIGN KEY (default_task_list_id) REFERENCES task_lists (id) ON DELETE SET NULL,
            FOREIGN KEY (selected_list_id) REFERENCES task_lists (id) ON DELETE SET NULL,
            UNIQUE(user_id)
          )
        `);
      }
    }
  } catch (error) {
    console.error('Error migrating user_preferences table:', error);
    // If migration fails, try to create the new table anyway
    try {
      db.exec(`DROP TABLE IF EXISTS user_preferences`);
      db.exec(`
        CREATE TABLE user_preferences (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          default_task_list_id INTEGER,
          selected_list_id INTEGER,
          theme TEXT DEFAULT 'light',
          language TEXT DEFAULT 'en',
          notifications_enabled INTEGER DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
          FOREIGN KEY (default_task_list_id) REFERENCES task_lists (id) ON DELETE SET NULL,
          FOREIGN KEY (selected_list_id) REFERENCES task_lists (id) ON DELETE SET NULL,
          UNIQUE(user_id)
        )
      `);
    } catch (createError) {
      console.error('Error creating new user_preferences table:', createError);
    }
  }

  // Migration: Remove default_task_list_id and add hide_local_lists
  try {
    const tableInfo = db.prepare("PRAGMA table_info(user_preferences)").all();
    const hasDefaultTaskListId = tableInfo.some(col => col.name === 'default_task_list_id');
    const hasHideLocalLists = tableInfo.some(col => col.name === 'hide_local_lists');
    
    if (hasDefaultTaskListId || !hasHideLocalLists) {
      console.log('Migrating user_preferences table: removing default_task_list_id and adding hide_local_lists...');
      
      // Create new table with updated structure
      db.exec(`
        CREATE TABLE user_preferences_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          selected_list_id INTEGER,
          theme TEXT DEFAULT 'light',
          language TEXT DEFAULT 'en',
          notifications_enabled INTEGER DEFAULT 1,
          hide_local_lists INTEGER DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
          FOREIGN KEY (selected_list_id) REFERENCES task_lists (id) ON DELETE SET NULL,
          UNIQUE(user_id)
        )
      `);
      
      // Migrate existing data
      const existingPrefs = db.prepare(`
        SELECT user_id, selected_list_id, theme, language, notifications_enabled, created_at, updated_at
        FROM user_preferences
      `).all();
      
      const insertStmt = db.prepare(`
        INSERT INTO user_preferences_new (user_id, selected_list_id, theme, language, notifications_enabled, hide_local_lists, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      
      existingPrefs.forEach(pref => {
        insertStmt.run(
          pref.user_id,
          pref.selected_list_id,
          pref.theme,
          pref.language,
          pref.notifications_enabled,
          0, // Default hide_local_lists to 0 (false)
          pref.created_at,
          pref.updated_at
        );
      });
      
      // Replace old table with new one
      db.exec(`DROP TABLE user_preferences`);
      db.exec(`ALTER TABLE user_preferences_new RENAME TO user_preferences`);
      
      console.log('User preferences table migration completed (removed default_task_list_id, added hide_local_lists)');
    }
  } catch (error) {
    console.error('Error migrating user_preferences table (default_task_list_id removal):', error);
  }

  // Don't insert default user - let users register themselves
  // const defaultUser = db.prepare('SELECT COUNT(*) as count FROM users').get();
  // if (defaultUser.count === 0) {
  //   const bcrypt = require('bcryptjs');
  //   const hashedPassword = bcrypt.hashSync('admin', 10);
  //   db.prepare(`
  //     INSERT INTO users (username, password_hash, email)
  //     VALUES (?, ?, ?)
  //   `).run('admin', hashedPassword, 'admin@opentasks.local');
  // }
}

function getDatabase() {
  if (!db) {
    throw new Error('Database not initialized');
  }
  return db;
}

module.exports = {
  initializeDatabase,
  getDatabase
};