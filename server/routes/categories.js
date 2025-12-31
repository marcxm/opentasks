const express = require('express');
const { getDatabase } = require('../database/init');
const { validateCategory } = require('../middleware/validation');
const { authenticateToken } = require('../middleware/auth');
const { broadcastUpdate } = require('../websocket/server');

const router = express.Router();

// Get all categories
router.get('/', authenticateToken, (req, res) => {
  try {
    const db = getDatabase();
    const categories = db.prepare('SELECT * FROM categories ORDER BY name ASC').all();
    res.json(categories);
  } catch (error) {
    console.error('Error fetching categories:', error);
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

// Create a new category
router.post('/', authenticateToken, validateCategory, (req, res) => {
  try {
    const db = getDatabase();
    const categoryData = req.body;

    const insertCategory = db.prepare(`
      INSERT INTO categories (name, color, account_name, account_type)
      VALUES (?, ?, ?, ?)
    `);

    const result = insertCategory.run(
      categoryData.name,
      categoryData.color,
      categoryData.account_name,
      categoryData.account_type
    );

    const newCategory = db.prepare('SELECT * FROM categories WHERE id = ?').get(result.lastInsertRowid);

    // Broadcast update to connected clients
    broadcastUpdate('category_created', newCategory);

    res.status(201).json(newCategory);
  } catch (error) {
    console.error('Error creating category:', error);
    res.status(500).json({ error: 'Failed to create category' });
  }
});

// Update a category
router.put('/:id', authenticateToken, validateCategory, (req, res) => {
  try {
    const db = getDatabase();
    const categoryId = req.params.id;
    const updateData = req.body;

    // Check if category exists
    const existingCategory = db.prepare('SELECT * FROM categories WHERE id = ?').get(categoryId);
    if (!existingCategory) {
      return res.status(404).json({ error: 'Category not found' });
    }

    const updateCategory = db.prepare(`
      UPDATE categories 
      SET name = ?, color = ?
      WHERE id = ?
    `);

    updateCategory.run(updateData.name, updateData.color, categoryId);

    const updatedCategory = db.prepare('SELECT * FROM categories WHERE id = ?').get(categoryId);

    // Broadcast update to connected clients
    broadcastUpdate('category_updated', updatedCategory);

    res.json(updatedCategory);
  } catch (error) {
    console.error('Error updating category:', error);
    res.status(500).json({ error: 'Failed to update category' });
  }
});

// Delete a category
router.delete('/:id', authenticateToken, (req, res) => {
  try {
    const db = getDatabase();
    const categoryId = req.params.id;

    // Check if category exists
    const existingCategory = db.prepare('SELECT * FROM categories WHERE id = ?').get(categoryId);
    if (!existingCategory) {
      return res.status(404).json({ error: 'Category not found' });
    }

    // Delete the category
    db.prepare('DELETE FROM categories WHERE id = ?').run(categoryId);

    // Broadcast update to connected clients
    broadcastUpdate('category_deleted', { id: categoryId });

    res.json({ message: 'Category deleted successfully' });
  } catch (error) {
    console.error('Error deleting category:', error);
    res.status(500).json({ error: 'Failed to delete category' });
  }
});

module.exports = router;