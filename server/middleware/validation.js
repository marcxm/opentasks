const Joi = require('joi');

const taskSchema = Joi.object({
  list_id: Joi.string().min(1).max(100).required(),
  title: Joi.string().min(1).max(500).required(),
  description: Joi.string().max(5000).allow('').optional(),
  location: Joi.string().max(200).allow('').optional(),
  geo: Joi.string().pattern(/^-?\d+\.?\d*,-?\d+\.?\d*$/).allow('').optional(),
  url: Joi.string().uri().max(500).allow('').optional(),
  organizer: Joi.string().email().max(200).allow('').optional(),
  priority: Joi.number().integer().min(0).max(9).default(0),
  classification: Joi.number().integer().valid(0, 1, 2).optional(),
  task_color: Joi.string().pattern(/^#[0-9A-Fa-f]{6}$/).allow('').optional(),
  dtstart: Joi.alternatives().try(Joi.date().iso(), Joi.string().isoDate(), Joi.valid(null)).optional(),
  is_allday: Joi.alternatives().try(Joi.boolean(), Joi.number().integer().valid(0, 1)).default(false),
  tz: Joi.string().max(50).allow('').optional(),
  due: Joi.alternatives().try(Joi.date().iso(), Joi.string().isoDate(), Joi.valid(null)).optional(),
  duration: Joi.string().max(100).allow('').optional(),
  rdate: Joi.string().max(1000).allow('').optional(),
  exdate: Joi.string().max(1000).allow('').optional(),
  rrule: Joi.string().max(1000).allow('').optional(),
  parent_id: Joi.number().integer().positive().optional(),
  sorting: Joi.string().max(100).allow('').optional(),
  status: Joi.number().integer().valid(0, 1, 2, 3).default(0),
  percent_complete: Joi.number().integer().min(0).max(100).optional(),
  _uid: Joi.string().uuid().optional()
});

const taskUpdateSchema = Joi.object({
  list_id: Joi.string().min(1).max(100).optional(),
  title: Joi.string().min(1).max(500).optional(),
  description: Joi.string().max(5000).allow('').optional(),
  location: Joi.string().max(200).allow('').optional(),
  geo: Joi.string().pattern(/^-?\d+\.?\d*,-?\d+\.?\d*$/).allow('').optional(),
  url: Joi.string().uri().max(500).allow('').optional(),
  organizer: Joi.string().email().max(200).allow('').optional(),
  priority: Joi.number().integer().min(0).max(9).optional(),
  classification: Joi.number().integer().valid(0, 1, 2).optional(),
  task_color: Joi.string().pattern(/^#[0-9A-Fa-f]{6}$/).allow('').optional(),
  dtstart: Joi.alternatives().try(Joi.date().iso(), Joi.string().isoDate(), Joi.valid(null)).optional(),
  is_allday: Joi.alternatives().try(Joi.boolean(), Joi.number().integer().valid(0, 1)).optional(),
  tz: Joi.string().max(50).allow('').optional(),
  due: Joi.alternatives().try(Joi.date().iso(), Joi.string().isoDate(), Joi.valid(null)).optional(),
  duration: Joi.string().max(100).allow('').optional(),
  rdate: Joi.string().max(1000).allow('').optional(),
  exdate: Joi.string().max(1000).allow('').optional(),
  rrule: Joi.string().max(1000).allow('').optional(),
  parent_id: Joi.number().integer().positive().optional(),
  sorting: Joi.string().max(100).allow('').optional(),
  status: Joi.number().integer().valid(0, 1, 2, 3).optional(),
  percent_complete: Joi.number().integer().min(0).max(100).optional()
});

const taskListSchema = Joi.object({
  name: Joi.string().min(1).max(200).required(),
  color: Joi.string().pattern(/^#[0-9A-Fa-f]{6}$/).default('#2196F3'),
  account_name: Joi.string().max(100).default('Local'),
  account_type: Joi.string().max(100).default('org.dmfs.account.LOCAL'),
  visible: Joi.boolean().default(true),
  sync_enabled: Joi.boolean().default(false),
  owner: Joi.string().email().max(200).optional(),
  access_level: Joi.number().integer().min(0).max(3).default(0)
});

const categorySchema = Joi.object({
  name: Joi.string().min(1).max(100).required(),
  color: Joi.string().pattern(/^#[0-9A-Fa-f]{6}$/).default('#757575'),
  account_name: Joi.string().max(100).default('Local'),
  account_type: Joi.string().max(100).default('org.dmfs.account.LOCAL')
});

function validateTask(req, res, next) {
  const { error, value } = taskSchema.validate(req.body);
  if (error) {
    return res.status(400).json({ 
      error: 'Validation error', 
      details: error.details.map(d => d.message) 
    });
  }
  req.body = value;
  next();
}

function validateTaskUpdate(req, res, next) {
  const { error, value } = taskUpdateSchema.validate(req.body);
  if (error) {
    return res.status(400).json({ 
      error: 'Validation error', 
      details: error.details.map(d => d.message) 
    });
  }
  req.body = value;
  next();
}

function validateTaskList(req, res, next) {
  const { error, value } = taskListSchema.validate(req.body);
  if (error) {
    return res.status(400).json({ 
      error: 'Validation error', 
      details: error.details.map(d => d.message) 
    });
  }
  req.body = value;
  next();
}

function validateCategory(req, res, next) {
  const { error, value } = categorySchema.validate(req.body);
  if (error) {
    return res.status(400).json({ 
      error: 'Validation error', 
      details: error.details.map(d => d.message) 
    });
  }
  req.body = value;
  next();
}

module.exports = {
  validateTask,
  validateTaskUpdate,
  validateTaskList,
  validateCategory
};