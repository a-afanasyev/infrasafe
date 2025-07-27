module.exports = {
  "/api/alerts": {
    get: {
      summary: "Получить активные алерты",
      tags: ["Alerts"],
      parameters: [
        {
          in: "query",
          name: "severity",
          schema: {
            type: "string",
            enum: ["INFO", "WARNING", "CRITICAL"]
          },
          description: "Фильтр по уровню важности"
        },
        {
          in: "query",
          name: "infrastructure_type",
          schema: {
            type: "string",
            enum: ["transformer", "water_source", "heat_source"]
          },
          description: "Фильтр по типу инфраструктуры"
        },
        {
          in: "query",
          name: "limit",
          schema: {
            type: "integer",
            default: 100
          },
          description: "Максимальное количество результатов"
        }
      ],
      responses: {
        "200": {
          description: "Список активных алертов",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  success: {
                    type: "boolean"
                  },
                  data: {
                    type: "array",
                    items: {
                      $ref: "#/components/schemas/Alert"
                    }
                  },
                  count: {
                    type: "integer"
                  }
                }
              }
            }
          }
        }
      }
    },
    post: {
      summary: "Создать алерт вручную",
      tags: ["Alerts"],
      security: [{ bearerAuth: [] }],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              $ref: "#/components/schemas/AlertCreate"
            }
          }
        }
      },
      responses: {
        "201": {
          description: "Алерт успешно создан",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  success: {
                    type: "boolean"
                  },
                  message: {
                    type: "string"
                  },
                  data: {
                    $ref: "#/components/schemas/Alert"
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}; 