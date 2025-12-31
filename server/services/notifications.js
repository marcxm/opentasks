const cron = require('node-cron');
const fileManager = require('./fileManager');
const { broadcastUpdate } = require('../websocket/server');

function startNotificationScheduler() {
  // Check for due tasks every minute
  cron.schedule('* * * * *', () => {
    checkDueTasks();
  });
  
  // Check for starting tasks every 5 minutes
  cron.schedule('*/5 * * * *', () => {
    checkStartingTasks();
  });
  
  console.log('Notification scheduler started');
}

async function checkDueTasks() {
  try {
    const now = new Date();
    const allTasks = await fileManager.getAllTasks();
    
    const dueTasks = allTasks.filter(task => {
      // Check if task is not completed and has a due date
      if (task.status === 2 || !task.due) return false;
      
      // Check if due date has passed
      const dueDate = new Date(task.due);
      return dueDate <= now;
    });
    
    for (const task of dueTasks) {
      // Get collection info for the task
      const collection = await fileManager.getCollection(task.list_id);
      const taskWithCollection = {
        ...task,
        list_name: collection?.name || 'Unknown',
        list_color: collection?.color || '#000000'
      };
      
      // Broadcast due task notification
      broadcastUpdate('task_due', taskWithCollection);
      
      // Log the notification
      console.log(`Task due: ${task.title} (ID: ${task.id})`);
    }
    
  } catch (error) {
    console.error('Error checking due tasks:', error);
  }
}

async function checkStartingTasks() {
  try {
    const now = new Date();
    const fiveMinutesFromNow = new Date(Date.now() + 5 * 60 * 1000);
    const allTasks = await fileManager.getAllTasks();
    
    const startingTasks = allTasks.filter(task => {
      // Check if task is not completed and has a start date
      if (task.status === 2 || !task.dtstart) return false;
      
      // Check if start date is within the next 5 minutes
      const startDate = new Date(task.dtstart);
      return startDate >= now && startDate <= fiveMinutesFromNow;
    });
    
    for (const task of startingTasks) {
      // Get collection info for the task
      const collection = await fileManager.getCollection(task.list_id);
      const taskWithCollection = {
        ...task,
        list_name: collection?.name || 'Unknown',
        list_color: collection?.color || '#000000'
      };
      
      // Broadcast starting task notification
      broadcastUpdate('task_starting', taskWithCollection);
      
      // Log the notification
      console.log(`Task starting: ${task.title} (ID: ${task.id})`);
    }
    
  } catch (error) {
    console.error('Error checking starting tasks:', error);
  }
}

module.exports = {
  startNotificationScheduler,
  checkDueTasks,
  checkStartingTasks
};