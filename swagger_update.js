// Скрипт для добавления response examples в Swagger
const fs = require('fs');

// Читаем текущий swagger файл
let swaggerContent = fs.readFileSync('swagger_init_debug.js', 'utf8');

// Добавляем response examples для buildings
const buildingsExample = `
"example": {
  "success": true,
  "data": [
    {
      "building_id": 1,
      "name": "ЖК Северный",
      "address": "ул. Ленина, 45",
      "latitude": 41.2995,
      "longitude": 69.2401,
      "city": "Ташкент",
      "management_company": "Управляющая компания Север",
      "controller_count": 3
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 150,
    "pages": 15
  }
}`;

// Добавляем examples для controllers 
const controllersExample = `
"example": {
  "success": true,
  "data": [
    {
      "controller_id": 1,
      "name": "Контроллер-1A",
      "serial_number": "INF001A",
      "building_id": 1,
      "status": "online",
      "last_seen": "2024-01-10T14:30:00Z",
      "firmware_version": "v2.1.0"
    }
  ]
}`;

console.log('Response examples созданы');
