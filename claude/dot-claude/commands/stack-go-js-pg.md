---
description: Plan an app with Go backend, SQLite/Postgres, and vanilla JS frontend
argument-hint: [app-name or description]
model: opus
---

Create a detailed implementation plan for building an application: $ARGUMENTS

## Tech Stack

- **Backend**: Go (Golang)
- **Database**: PostgreSQL (preferred) or SQLite
- **Frontend**: Vanilla JavaScript (no frameworks)
- **Development**: Claude Code

## Planning Process

### 1. Requirements Gathering

First, interview me using AskUserQuestion to understand:
- Core functionality and features
- Data models and relationships
- Authentication/authorization needs
- API endpoints required
- Performance requirements
- Deployment target (local, cloud, etc.)

### 2. Architecture Design

Create a plan covering:

**Backend (Go)**
- Project structure (cmd/, internal/, pkg/, etc.)
- HTTP router choice (stdlib net/http, chi, gorilla/mux, etc.)
- Database driver (pgx for Postgres, modernc.org/sqlite for SQLite)
- Middleware needs (logging, CORS, auth)
- Configuration management
- Error handling strategy

**Database**
- Schema design with tables and relationships
- Migration strategy (golang-migrate, goose, or raw SQL)
- Indexing strategy
- Connection pooling

**API Design**
- RESTful endpoint structure
- Request/response formats (JSON)
- Error response format
- Versioning strategy if needed

### 3. Frontend Design

**IMPORTANT**: Use the `/frontend-design` skill to design the frontend interface. This includes:
- Page layouts and component structure
- HTML semantic structure
- CSS architecture (vanilla CSS, CSS custom properties)
- JavaScript module organization
- State management approach (vanilla patterns)
- API integration layer
- Progressive enhancement strategy

### 4. Implementation Phases

Break down into ordered phases:
1. Database schema and migrations
2. Go project scaffolding
3. Core API endpoints
4. Frontend HTML/CSS structure
5. Frontend JavaScript functionality
6. Integration and testing
7. Documentation

### 5. File Structure

Propose a complete file structure like:
```
project/
├── cmd/
│   └── server/
│       └── main.go
├── internal/
│   ├── handler/
│   ├── model/
│   ├── repository/
│   └── service/
├── migrations/
├── web/
│   ├── static/
│   │   ├── css/
│   │   └── js/
│   └── templates/
├── go.mod
└── Makefile
```

### 6. Development Commands

Include Makefile targets or scripts for:
- `make run` - Start development server
- `make migrate` - Run database migrations
- `make test` - Run tests
- `make build` - Build production binary

## Output

Write the complete plan to a markdown file in the project directory, then ask if I want to proceed with implementation.
