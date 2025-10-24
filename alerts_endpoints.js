// Добавить в swagger_init_debug.js перед закрывающей скобкой paths:

module.exports = {
  "/api/alerts": {
    "get": {
      "summary": "Получить активные алерты",
      "description": "Возвращает список активных алертов с фильтрацией",
      "tags": ["Alerts"],
      "parameters": [
        {
          "in": "query",
          "name": "severity",
          "schema": {
            "type": "string",
            "enum": ["LOW", "MEDIUM", "HIGH", "CRITICAL"]
          }
        }
      ],
      "responses": {
        "200": {
          "description": "Список активных алертов",
          "content": {
            "application/json": {
              "example": {
                "success": true,
                "data": [
                  {
                    "alert_id": 1,
                    "severity": "HIGH", 
                    "message": "Превышение температуры",
                    "infrastructure_type": "heating",
                    "created_at": "2024-01-10T14:30:00Z"
                  }
                ]
              }
            }
          }
        }
      }
    }
  }
};
