module.exports = {
  type: "object",
  required: ["controller_id"],
  properties: {
    metric_id: {
      type: "integer",
      description: "Уникальный идентификатор метрики"
    },
    controller_id: {
      type: "integer",
      description: "ID контроллера, с которого получены данные"
    },
    temperature: {
      type: "number",
      description: "Температура в градусах Цельсия"
    },
    humidity: {
      type: "number",
      description: "Влажность в процентах",
      minimum: 0,
      maximum: 100
    },
    pressure: {
      type: "number",
      description: "Давление в паскалях"
    },
    co2_level: {
      type: "number",
      description: "Уровень CO2 в ppm"
    },
    voltage: {
      type: "number",
      description: "Напряжение в вольтах"
    },
    timestamp: {
      type: "string",
      format: "date-time",
      description: "Время измерения"
    },
    created_at: {
      type: "string",
      format: "date-time",
      description: "Время создания записи"
    }
  }
}; 