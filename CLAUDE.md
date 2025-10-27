# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview
InfraSafe is a digital IoT monitoring platform for multi-apartment buildings. It collects data from intelligent controllers (industrial PCs with sensors), processes metrics, and provides real-time visualization through interactive maps and analytics dashboards. The system monitors electrical supply, water systems, heating, and environmental conditions with predictive analytics and automated alerting.

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
npm run test:watch        # Watch mode for development
npm run test:all          # All test suites sequentially

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
psql -U postgres -d infrasafe -f database/init/01_init_database.sql
psql -U postgres -d infrasafe -f database/init/02_test_data.sql

# Check database health
psql -U postgres -d infrasafe -c "SELECT COUNT(*) FROM buildings;"

# View Docker logs
docker-compose logs postgres
```

## Architecture Overview

### Three-Layer Architecture
1. **Controllers Layer** (`src/controllers/`) - HTTP request handling, validation, response formatting
2. **Services Layer** (`src/services/`) - Business logic, data processing, external integrations
3. **Models Layer** (`src/models/`) - Database operations, SQL queries, data persistence

### Key Architectural Patterns
- **JWT Authentication**: Token-based auth with refresh tokens, blacklist, and account locking
- **Circuit Breaker Pattern**: Resilience in `src/services/analyticsService.js` for fault tolerance
- **Multi-layer Caching**: Redis-ready architecture with in-memory fallback in `src/services/cacheService.js`
- **Alert System**: Automatic checking with 15-minute cooldown to prevent flooding
- **SQL Injection Prevention**: Whitelist validation in `src/utils/queryValidation.js`
- **Global Error Handling**: Centralized middleware in `src/middleware/errorHandler.js`

### Critical Architecture Issues

#### AdminController Monolith
- **Problem**: `src/controllers/adminController.js` contains 71KB managing ALL entities
- **Impact**: Unmaintainable, violates Single Responsibility Principle
- **Solution**: Split into separate controllers per entity (AdminBuildingController, AdminMetricsController, etc.)

#### Frontend Monoliths
- **Problem**: `public/admin.js` (2,298 lines) and `public/script.js` (1,415 lines) contain all logic
- **Solution**: Implement modular architecture with separate modules for API client, UI components, state management

#### SQL Injection Vulnerabilities
- **Location**: Direct string interpolation in sort/order parameters
- **Example**: `query += \` ORDER BY \${sort} \${order.toUpperCase()}\``
- **Fix**: Validate against whitelist of allowed columns before interpolation (use `queryValidation.js`)

### Database Architecture
- **PostgreSQL 15+ with PostGIS** for geospatial data (GIST indexes)
- **Partitioning**: Metrics table partitioned by month for performance
- **Key Tables**:
  - Core: `users`, `buildings`, `controllers`, `metrics`, `alerts`, `alert_types`
  - Infrastructure: `power_transformers`, `cold_water_sources`, `heat_sources`, `water_lines`, `water_suppliers`
- **Materialized Views**: Used for analytics and aggregated transformer load monitoring
- **Geometry Types**: PostGIS POINT type with SRID 4326 for coordinates

### API Structure
- **Base URL**: `/api` (proxied through Nginx in production)
- **Authentication**: JWT tokens (Bearer scheme) required for POST/PUT/DELETE/PATCH
- **Main Endpoint Groups (15+ route files)**:
  - `/api/auth/*` - Authentication (login, register, refresh, logout, blacklist)
  - `/api/buildings/*` - Building CRUD with pagination, filtering, sorting
  - `/api/controllers/*` - Controller management
  - `/api/metrics/*` - Metrics ingestion and retrieval
  - `/api/transformers/*` - Power transformer data
  - `/api/lines/*` - Electrical transmission lines
  - `/api/cold-water-sources/*` - Water infrastructure
  - `/api/heat-sources/*` - Heating systems
  - `/api/water-lines/*` - Water distribution
  - `/api/water-suppliers/*` - Water supply companies
  - `/api/analytics/*` - Analytics and reporting (25+ endpoints with Circuit Breaker)
  - `/api/alerts/*` - Alert system (10+ endpoints with cooldown logic)
  - `/api/admin/*` - Optimized admin operations (30KB route file)
  - `/api-docs` - Swagger UI documentation

### Frontend Architecture
- **Vanilla JavaScript** (no framework) - ES6+ with HTML5, CSS3
- **Leaflet.js** for interactive maps with:
  - Marker clustering for performance
  - Multiple layers (buildings, transformers, water sources, heat sources)
  - Layer controls with visibility toggling
  - Custom icons and popups
- **Chart.js** for data visualization
- **Global state** in window-scoped variables (pagination, filters, sorting, selections)
- **APIClient class** - Custom API client with JWT token handling and auto-refresh
- **XSS Protection** - DOMPurify integration for sanitization (`public/utils/domSecurity.js`)
- **Responsive Design** - Mobile-friendly with collapsible sidebar

### Infrastructure Monitoring Features
The platform monitors:
- **⚡ Electrical Supply**: Voltage, current, phase balance, transformer load (85% and 95% thresholds)
- **💧 Water Systems**: Pressure, temperature, flow rate for cold/hot water and heating
- **🌡 Environmental**: Temperature, humidity, gas detection (CH₄, CO), air quality (PM2.5)
- **📊 Analytics**: Predictive analytics, anomaly detection, energy efficiency recommendations

## Current State & Known Issues

### Working Features
- JWT authentication with refresh tokens and blacklist
- Building and controller CRUD operations with pagination/filtering/sorting
- Real-time metrics visualization on maps with marker clustering
- Alert system with cooldown logic (15 minutes)
- Analytics dashboards with transformer load monitoring
- Circuit Breaker pattern for resilience
- Multi-layer caching for performance
- Swagger API documentation
- Batch operations in admin UI (multi-select, bulk delete/update)

### Known Problems
1. **Console.error vs Logger inconsistency** - Some routes use console.error instead of logger
2. **Code duplication** in water-related routes (waterSourceRoutes, waterSupplierRoutes, waterLineRoutes)
3. **Missing Repository Pattern** - Models directly execute SQL, making testing difficult
4. **No Dependency Injection** - Hard-coded dependencies make unit testing challenging
5. **Frontend lacks modularity** - All logic in global scope, no component structure
6. **Load Tests Broken** - jq parsing issues need fixing

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
2. Port 8080 (Docker/production via Nginx)
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
JWT_REFRESH_SECRET=your-refresh-secret

# Optional
NODE_ENV=development|production
PORT=3000
CORS_ORIGINS=http://localhost:8080
LOG_LEVEL=info|debug|warn|error
```

### Docker Services
- **frontend**: Nginx serving static files and proxying API requests (port 8080)
- **app**: Node.js Express backend (port 3000)
- **postgres**: PostgreSQL 15+ with PostGIS extension (port 5435)

### Docker Volumes
- `postgres_data`: Persistent database storage
- `./src:/app/src`: Backend source code (dev mode)
- `./public:/usr/share/nginx/html/public`: Frontend files
- `./logs:/app/logs`: Application logs

## Critical Files to Understand

### Backend Core
- `src/server.js` - Express server setup and middleware chain
- `src/config/app.js` - Express app configuration (Helmet, CORS, rate limiting)
- `src/routes/index.js` - Main router aggregating all routes
- `src/middleware/auth.js` - JWT authentication logic with blacklist check
- `src/config/database.js` - PostgreSQL connection pool

### Services Layer (Business Logic)
- `src/services/authService.js` - User authentication, token management
- `src/services/analyticsService.js` - Circuit Breaker pattern implementation
- `src/services/cacheService.js` - Multi-layer caching strategy
- `src/services/alertService.js` - Alert system with cooldown logic

### Frontend Core
- `public/script.js` - Main map interface with Leaflet (1,415 lines)
- `public/admin.js` - Admin panel for CRUD operations (2,298 lines)
- `public/admin-auth.js` - Authentication flow for admin panel
- `public/map-layers-control.js` - Layer management and visibility controls
- `index.html` - Main map view
- `admin.html` - Admin dashboard

### Database Schema
- `database/init/01_init_database.sql` - Complete database structure with PostGIS (~36KB)
- `database/init/02_test_data.sql` - Test data fixtures for development

### Utilities
- `src/utils/logger.js` - Winston logger with file rotation
- `src/utils/circuitBreaker.js` - Circuit Breaker pattern implementation
- `src/utils/queryValidation.js` - SQL injection prevention utilities
- `public/utils/domSecurity.js` - XSS protection utilities
