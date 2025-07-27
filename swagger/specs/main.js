const auth = require('../paths/auth');
const buildings = require('../paths/buildings');
const controllers = require('../paths/controllers');
const metrics = require('../paths/metrics');
const transformers = require('../paths/transformers');
const analytics = require('../paths/analytics');
const waterSources = require('../paths/waterSources');
const alerts = require('../paths/alerts');

const Alert = require('../schemas/Alert');
const AlertCreate = require('../schemas/AlertCreate');

const swaggerSpec = {
  openapi: "3.0.0",
  info: {
    title: "Infrasafe Habitat IQ API",
    version: "1.0.0",
    description: "API документация для системы мониторинга зданий и инфраструктуры"
  },
  servers: [
    {
      url: "http://localhost:3000/api",
      description: "Development server"
    }
  ],
  paths: {
    ...auth,
    ...buildings,
    ...controllers,
    ...metrics,
    ...transformers,
    ...analytics,
    ...waterSources,
    ...alerts
  },
  components: {
    schemas: {
      Alert,
      AlertCreate
    },
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT"
      }
    }
  },
  tags: [
    { name: "Authentication", description: "Операции авторизации и управления пользователями" },
    { name: "Buildings", description: "Управление зданиями" },
    { name: "Controllers", description: "Управление контроллерами" },
    { name: "Metrics", description: "Управление метриками и телеметрией" },
    { name: "Transformers", description: "Управление трансформаторами" },
    { name: "Analytics", description: "Аналитические данные и отчеты" },
    { name: "Water Sources", description: "Управление источниками воды" },
    { name: "Telemetry", description: "Телеметрические данные" },
    { name: "Alerts", description: "Система уведомлений и мониторинга алертов" }
  ]
};

module.exports = swaggerSpec; 