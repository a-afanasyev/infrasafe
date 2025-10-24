module.exports = {
  type: "object",
  required: ["id", "name", "address", "latitude", "longitude", "capacity_kva"],
  properties: {
    id: {
      type: "string",
      description: "Уникальный идентификатор трансформатора"
    },
    name: {
      type: "string",
      description: "Название трансформатора"
    },
    address: {
      type: "string",
      description: "Адрес расположения"
    },
    latitude: {
      type: "number",
      description: "Широта",
      minimum: -90,
      maximum: 90
    },
    longitude: {
      type: "number",
      description: "Долгота",
      minimum: -180,
      maximum: 180
    },
    capacity_kva: {
      type: "number",
      description: "Мощность в кВА",
      minimum: 0
    },
    voltage_primary: {
      type: "number",
      description: "Первичное напряжение (В)"
    },
    voltage_secondary: {
      type: "number",
      description: "Вторичное напряжение (В)"
    },
    manufacturer: {
      type: "string",
      description: "Производитель"
    },
    model: {
      type: "string",
      description: "Модель"
    },
    installation_date: {
      type: "string",
      format: "date",
      description: "Дата установки"
    },
    last_maintenance: {
      type: "string",
      format: "date",
      description: "Дата последнего обслуживания"
    },
    status: {
      type: "string",
      enum: ["active", "maintenance", "inactive"],
      default: "active",
      description: "Статус трансформатора"
    },
    load_percentage: {
      type: "number",
      description: "Текущая загрузка в процентах",
      minimum: 0,
      maximum: 100
    }
  }
}; 