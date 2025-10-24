module.exports = {
  type: "object",
  properties: {
    alert_id: {
      type: "integer",
      description: "Уникальный идентификатор алерта"
    },
    type: {
      type: "string",
      description: "Тип алерта",
      example: "TRANSFORMER_OVERLOAD"
    },
    infrastructure_id: {
      type: "string",
      description: "ID инфраструктурного объекта"
    },
    infrastructure_type: {
      type: "string",
      enum: ["transformer", "water_source", "heat_source"],
      description: "Тип инфраструктурного объекта"
    },
    severity: {
      type: "string",
      enum: ["INFO", "WARNING", "CRITICAL"],
      description: "Уровень важности алерта"
    },
    status: {
      type: "string",
      enum: ["active", "acknowledged", "resolved"],
      description: "Статус алерта"
    },
    message: {
      type: "string",
      description: "Сообщение алерта"
    },
    affected_buildings: {
      type: "integer",
      description: "Количество затронутых зданий"
    },
    data: {
      type: "object",
      description: "Дополнительные данные алерта"
    },
    created_at: {
      type: "string",
      format: "date-time",
      description: "Время создания"
    },
    acknowledged_at: {
      type: "string",
      format: "date-time",
      description: "Время подтверждения"
    },
    resolved_at: {
      type: "string",
      format: "date-time",
      description: "Время закрытия"
    }
  }
}; 