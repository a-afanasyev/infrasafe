module.exports = {
  type: "object",
  required: ["type", "infrastructure_id", "infrastructure_type", "severity", "message"],
  properties: {
    type: {
      type: "string",
      description: "Тип алерта",
      example: "MANUAL_ALERT"
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
    }
  }
}; 