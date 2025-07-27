module.exports = {
  pagination: {
    in: "query",
    schema: {
      type: "object",
      properties: {
        page: {
          type: "integer",
          default: 1,
          minimum: 1,
          description: "Номер страницы"
        },
        per_page: {
          type: "integer",
          default: 10,
          minimum: 1,
          maximum: 100,
          description: "Количество записей на странице"
        }
      }
    }
  },
  sorting: {
    in: "query",
    schema: {
      type: "object",
      properties: {
        sort_by: {
          type: "string",
          description: "Поле для сортировки"
        },
        order: {
          type: "string",
          enum: ["asc", "desc"],
          default: "asc",
          description: "Порядок сортировки"
        }
      }
    }
  },
  dateRange: {
    in: "query",
    schema: {
      type: "object",
      properties: {
        start_date: {
          type: "string",
          format: "date-time",
          description: "Начальная дата"
        },
        end_date: {
          type: "string",
          format: "date-time",
          description: "Конечная дата"
        }
      }
    }
  },
  search: {
    in: "query",
    schema: {
      type: "object",
      properties: {
        q: {
          type: "string",
          description: "Поисковый запрос"
        }
      }
    }
  }
}; 