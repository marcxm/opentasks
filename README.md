# OpenTasks

A modern, web-based task management application with CalDAV synchronization, user authentication, and server-side preference storage.

## Features

- **Task Management**: Create, edit, delete, and organize tasks
- **User Authentication**: Secure login/register system with JWT tokens
- **Server-Side Preferences**: List selections persist across all sessions (including incognito mode)
- **CalDAV Synchronization**: Sync tasks with external CalDAV servers (Radicale, Nextcloud, etc.)
- **Real-time Updates**: WebSocket-based real-time task updates
- **Responsive Design**: Modern Material-UI interface that works on all devices
- **Multi-user Support**: Each user has their own tasks and preferences

## Technology Stack

- **Backend**: Node.js, Express.js, flat-file file storage for collections - no DB, JWT authentication
- **Frontend**: React, TypeScript, Material-UI, React Query
- **Flat-file storage**: no database
- **Authentication**: JWT tokens with bcryptjs password hashing
- **Sync**: CalDAV protocol support with ical.js
- **Containerization**: Docker & Docker Compose

## Quick Start

1. **Clone the repository**:
   ```bash
   git clone https://github.com/marcxm/opentasks.git
   cd opentasks
   ```

2. **Start the application**:
   ```bash
   docker compose up -d
   ```

3. **Access the application**:
   - Open http://localhost:3000 in your browser
   - Login with default credentials: `admin` / `admin`
   - Or register a new account

## Configuration

### Environment Variables

Create a `.env` file in the project root:

```env
# JWT Secret - Change this to a secure random string in production
JWT_SECRET=supersecretjwt

# Data directory for persistent storage
DATA_DIR=./data

# Uploads directory for file attachments
UPLOADS_DIR=./uploads
```

### CalDAV Setup

1. Go to Settings → CalDAV Sync
2. Enter your CalDAV server details
3. Enable synchronization
4. Tasks will sync automatically every 15 minutes

## Development

### Backend Development

```bash
cd server
npm install
npm run dev
```

### Frontend Development

```bash
cd client
npm install
npm run dev
```

## API Endpoints

### Authentication
- `POST /api/auth/login` - User login
- `POST /api/auth/register` - User registration
- `GET /api/auth/me` - Get current user

### Tasks
- `GET /api/tasks` - Get all tasks
- `POST /api/tasks` - Create task
- `PUT /api/tasks/:id` - Update task
- `DELETE /api/tasks/:id` - Delete task

### Task Lists
- `GET /api/tasklists` - Get all task lists
- `POST /api/tasklists` - Create task list
- `PUT /api/tasklists/:id` - Update task list
- `DELETE /api/tasklists/:id` - Delete task list

### Preferences
- `GET /api/preferences` - Get user preferences
- `POST /api/preferences` - Set preference
- `POST /api/preferences/batch` - Set multiple preferences

## Database Schema

The application uses SQLite with the following main tables:
- `users` - User accounts and authentication
- `user_preferences` - User-specific settings
- `task_lists` - Task list definitions
- `tasks` - Task data
- `sync_state` - CalDAV synchronization state

## Security

- JWT token authentication
- Password hashing with bcryptjs
- CORS protection
- Rate limiting
- Helmet security headers
- Input validation and sanitization

## License

This project is licensed under the Apache 2.0 License - see the LICENSE file for details.

## Acknowledgments

- Inspired by the original OpenTasks Android application
- Built with modern web technologies for cross-platform compatibility
- CalDAV protocol support for interoperability with existing task management systems
