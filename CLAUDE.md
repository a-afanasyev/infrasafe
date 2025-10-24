# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview
InfraSafe is a digital platform for monitoring and managing multi-apartment buildings. It collects data from IoT controllers, processes metrics, and provides real-time visualization through interactive maps and analytics dashboards.

## Key Commands

### Development
```bash
# Start development environment with hot-reload
docker-compose -f docker-compose.dev.yml up

# Start production environment
docker-compose up

# Backend only (requires PostgreSQL running)
npm start          # Port 3000
npm run dev        # With nodemon hot-reload

# Run linting
npm run lint

# Frontend development server at http://localhost:8080
# Backend API at http://localhost:3000
# Swagger docs at http://localhost:3000/api-docs
```

### Testing
```bash
# Run all Jest tests
npm test

# Run specific test suites
npm run test:unit         # Unit tests only
npm run test:integration  # Integration tests
npm run test:security     # Security tests
npm run test:coverage     # With coverage report

# Run unified test framework
./tests/orchestrator/unified-test-runner.sh all    # All tests
./tests/orchestrator/unified-test-runner.sh quick  # Quick check
./tests/orchestrator/unified-test-runner.sh health # System health

# Legacy test scripts
./test_api.sh        # Full API test (2-3 minutes)
./test_api_quick.sh  # Quick API test (~10 seconds)
```

### Database Management
```bash
# Connect to database
psql postgresql://postgres:postgres@localhost:5432/infrasafe

# Initialize database (auto-runs in Docker)
psql -U postgres -d infrasafe -f database/init/01_schema.sql
psql -U postgres -d infrasafe -f database/init/02_test_data.sql

# Check database health
psql -U postgres -d infrasafe -c "SELECT COUNT(*) FROM buildings;"
```

## Architecture Overview

### Three-Layer Architecture
1. **Controllers Layer** (`src/controllers/`) - HTTP request handling, validation, response formatting
2. **Services Layer** (`src/services/`) - Business logic, data processing, external integrations
3. **Models Layer** (`src/models/`) - Database operations, SQL queries, data persistence

### Critical Architecture Issues

#### AdminController Monolith
- **Problem**: `src/controllers/adminController.js` contains 67,890 lines managing ALL entities
- **Impact**: Unmaintainable, violates Single Responsibility Principle
- **Solution**: Split into separate controllers per entity (AdminBuildingController, AdminMetricsController, etc.)

#### Frontend Monoliths
- **Problem**: `public/admin.js` (2,298 lines) and `public/script.js` (1,415 lines) contain all logic
- **Solution**: Implement modular architecture with separate modules for API client, UI components, state management

#### SQL Injection Vulnerabilities
- **Location**: Direct string interpolation in sort/order parameters
- **Example**: `query += \` ORDER BY \${sort} \${order.toUpperCase()}\``
- **Fix**: Validate against whitelist of allowed columns before interpolation

### Database Architecture
- **PostgreSQL 15+ with PostGIS** for geospatial data
- **Partitioning**: Metrics table partitioned by month for performance
- **Key Tables**: buildings, controllers, metrics, users, alerts, transformers
- **Materialized Views**: Used for analytics and aggregated metrics

### API Structure
- **Base URL**: `/api`
- **Authentication**: JWT tokens (Bearer scheme)
- **Main Endpoints**:
  - `/api/auth/*` - Authentication (login, register, refresh)
  - `/api/buildings/*` - Building CRUD operations
  - `/api/controllers/*` - Controller management
  - `/api/metrics/*` - Metrics ingestion and retrieval
  - `/api/analytics/*` - Analytics and reporting (25+ endpoints)
  - `/api/alerts/*` - Alert system (10+ endpoints)

### Frontend Architecture
- **Vanilla JavaScript** (no framework)
- **Leaflet.js** for interactive maps
- **Chart.js** for data visualization
- **Global state** in window-scoped variables
- **API communication** via fetch with JWT headers

## Current State & Known Issues

### Working Features
- JWT authentication with refresh tokens
- Building and controller CRUD operations
- Real-time metrics visualization on maps
- Alert system with cooldown logic
- Analytics dashboards with transformer load monitoring
- Swagger API documentation

### Known Problems
1. **Console.error vs Logger inconsistency** - Some routes use console.error instead of logger
2. **Code duplication** in water-related routes (waterSourceRoutes, waterSupplierRoutes, waterLineRoutes)
3. **Missing Repository Pattern** - Models directly execute SQL, making testing difficult
4. **No Dependency Injection** - Hard-coded dependencies make unit testing challenging
5. **Frontend lacks modularity** - All logic in global scope, no component structure

## Testing Infrastructure

### Test Coverage
- **Jest Tests**: 100% passing (41/41 tests)
- **Smoke Tests**: 66.6% passing (6/9 tests)
- **Load Tests**: Requires fixing (jq parsing issues)
- **Health Checks**: 100% functional

### Test Data
- **Default Admin**: admin / admin123
- **Test User**: testuser / TestPass123
- **17 test buildings** in Tashkent with realistic coordinates
- **34 metric records** with realistic sensor data

## Development Notes

### Port Detection
The system automatically detects the API port in this order:
1. Port 3000 (default development)
2. Port 8080 (Docker/production)
3. Port 3001-3010 (fallback range)

### Environment Variables
```bash
# Required
DB_HOST=postgres
DB_PORT=5432
DB_NAME=infrasafe
DB_USER=postgres
DB_PASSWORD=postgres
JWT_SECRET=your-secret-key

# Optional
NODE_ENV=development|production
PORT=3000
CORS_ORIGINS=http://localhost:8080
```

### Docker Volumes
- `postgres_data`: Persistent database storage
- `./src:/app/src`: Backend source code (dev mode)
- `./public:/usr/share/nginx/html/public`: Frontend files
- `./logs:/app/logs`: Application logs

## Critical Files to Understand

### Backend Core
- `src/server.js` - Express server setup and middleware
- `src/routes/index.js` - Main router aggregating all routes
- `src/middleware/auth.js` - JWT authentication logic
- `src/config/database.js` - PostgreSQL connection pool

### Frontend Core
- `public/script.js` - Main map interface and building visualization
- `public/admin.js` - Admin panel for CRUD operations
- `index.html` - Main map view
- `admin.html` - Admin dashboard

### Database Schema
- `database/init/01_schema.sql` - Complete database structure
- `database/init/02_test_data.sql` - Test data for development