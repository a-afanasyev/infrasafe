module.exports = {
  type: "object",
  required: ["success"],
  properties: {
    success: {
      type: "boolean",
      description: "Статус выполнения запроса"
    },
    message: {
      type: "string",
      description: "Сообщение о результате операции"
    },
    error: {
      type: "object",
      description: "Информация об ошибке (если есть)",
      properties: {
        code: {
          type: "string",
          description: "Код ошибки"
        },
        message: {
          type: "string",
          description: "Описание ошибки"
        },
        details: {
          type: "object",
          description: "Дополнительные детали ошибки"
        }
      }
    }
  }
}; 