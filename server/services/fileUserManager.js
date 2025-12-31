const fs = require('fs').promises;
const path = require('path');
const bcrypt = require('bcryptjs');

const USERS_FILE = '/app/data/users.json';

// Ensure users file exists
async function ensureUsersFile() {
  try {
    await fs.access(USERS_FILE);
  } catch (error) {
    // File doesn't exist, create empty users array
    await fs.writeFile(USERS_FILE, JSON.stringify([], null, 2));
  }
}

// Get all users
async function getUsers() {
  try {
    await ensureUsersFile();
    const data = await fs.readFile(USERS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading users:', error);
    return [];
  }
}

// Get user by username
async function getUserByUsername(username) {
  const users = await getUsers();
  return users.find(u => u.username === username);
}

// Get user by ID
async function getUserById(id) {
  const users = await getUsers();
  return users.find(u => u.id === id);
}

// Create new user
async function createUser(username, password, email = null) {
  const users = await getUsers();
  
  // Check if user already exists
  if (users.find(u => u.username === username)) {
    throw new Error('User already exists');
  }
  
  // Hash password
  const passwordHash = await bcrypt.hash(password, 10);
  
  // Create new user
  const newUser = {
    id: users.length > 0 ? Math.max(...users.map(u => u.id)) + 1 : 1,
    username,
    passwordHash,
    email,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  
  users.push(newUser);
  await fs.writeFile(USERS_FILE, JSON.stringify(users, null, 2));
  
  // Return user without password hash
  const { passwordHash: _, ...userWithoutPassword } = newUser;
  return userWithoutPassword;
}

// Verify user credentials
async function verifyUser(username, password) {
  const user = await getUserByUsername(username);
  
  if (!user) {
    return null;
  }
  
  const isValid = await bcrypt.compare(password, user.passwordHash);
  if (!isValid) {
    return null;
  }
  
  // Return user without password hash
  const { passwordHash: _, ...userWithoutPassword } = user;
  return userWithoutPassword;
}

// Update user
async function updateUser(userId, updates) {
  const users = await getUsers();
  const userIndex = users.findIndex(u => u.id === userId);
  
  if (userIndex === -1) {
    throw new Error('User not found');
  }
  
  // If password is being updated, hash it
  if (updates.password) {
    updates.passwordHash = await bcrypt.hash(updates.password, 10);
    delete updates.password;
  }
  
  users[userIndex] = {
    ...users[userIndex],
    ...updates,
    updatedAt: new Date().toISOString()
  };
  
  await fs.writeFile(USERS_FILE, JSON.stringify(users, null, 2));
  
  const { passwordHash: _, ...userWithoutPassword } = users[userIndex];
  return userWithoutPassword;
}

// Delete user
async function deleteUser(userId) {
  const users = await getUsers();
  const filteredUsers = users.filter(u => u.id !== userId);
  
  if (users.length === filteredUsers.length) {
    throw new Error('User not found');
  }
  
  await fs.writeFile(USERS_FILE, JSON.stringify(filteredUsers, null, 2));
  return true;
}

// Check if any users exist
async function hasUsers() {
  const users = await getUsers();
  return users.length > 0;
}

module.exports = {
  getUsers,
  getUserByUsername,
  getUserById,
  createUser,
  verifyUser,
  updateUser,
  deleteUser,
  hasUsers
};
