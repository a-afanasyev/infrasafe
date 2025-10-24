module.exports = {
  type: "object",
  properties: {
    code: {
      type: "string",
      enum: [
        "VALIDATION_ERROR",
        "AUTHENTICATION_ERROR",
        "AUTHORIZATION_ERROR",
        "RESOURCE_NOT_FOUND",
        "RESOURCE_CONFLICT",
        "RATE_LIMIT_EXCEEDED",
        "INTERNAL_SERVER_ERROR",
        "SERVICE_UNAVAILABLE",
        "DATABASE_ERROR",
        "INVALID_REQUEST"
      ],
      description: "Код ошибки"
    },
    details: {
      type: "object",
      description: "Дополнительная информация об ошибке",
      properties: {
        field: {
          type: "string",
          description: "Поле, вызвавшее ошибку (для ошибок валидации)"
        },
        constraint: {
          type: "string",
          description: "Нарушенное ограничение"
        },
        value: {
          type: "string",
          description: "Значение, вызвавшее ошибку"
        },
        resource_id: {
          type: "string",
          description: "ID ресурса (для ошибок конфликта или отсутствия ресурса)"
        },
        retry_after: {
          type: "integer",
          description: "Время до следующей попытки (для rate limit)"
        }
      }
    }
  },
  examples: {
    validation_error: {
      code: "VALIDATION_ERROR",
      message: "Ошибка валидации данных",
      details: {
        field: "email",
        constraint: "format",
        value: "invalid-email"
      }
    },
    not_found: {
      code: "RESOURCE_NOT_FOUND",
      message: "Ресурс не найден",
      details: {
        resource_id: "123"
      }
    },
    rate_limit: {
      code: "RATE_LIMIT_EXCEEDED",
      message: "Превышен лимит запросов",
      details: {
        retry_after: 60
      }
    }
  }
}; 