import axios from 'axios';

// Базовый URL для API
const API_BASE_URL = 'http://localhost:3000/api';

// Создаем инстанс axios с базовыми настройками
const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json'
  }
});

// Интерцептор для обработки ошибок
api.interceptors.response.use(
  response => response,
  error => {
    console.error('API Error:', error);
    return Promise.reject(error);
  }
);

// Сервис для работы со зданиями
export const buildingsAPI = {
  // Получить список зданий с пагинацией
  getBuildings: async (page = 1, limit = 10) => {
    try {
      const response = await api.get(`/buildings?page=${page}&limit=${limit}`);
      return response.data;
    } catch (error) {
      console.error('Error fetching buildings:', error);
      throw error;
    }
  },

  // Получить одно здание по ID
  getBuilding: async (id) => {
    try {
      const response = await api.get(`/buildings/${id}`);
      return response.data;
    } catch (error) {
      console.error(`Error fetching building ${id}:`, error);
      throw error;
    }
  },

  // Создать новое здание
  createBuilding: async (buildingData) => {
    try {
      const response = await api.post('/buildings', buildingData);
      return response.data;
    } catch (error) {
      console.error('Error creating building:', error);
      throw error;
    }
  },

  // Обновить здание
  updateBuilding: async (id, buildingData) => {
    try {
      const response = await api.put(`/buildings/${id}`, buildingData);
      return response.data;
    } catch (error) {
      console.error(`Error updating building ${id}:`, error);
      throw error;
    }
  },

  // Удалить здание
  deleteBuilding: async (id) => {
    try {
      const response = await api.delete(`/buildings/${id}`);
      return response.data;
    } catch (error) {
      console.error(`Error deleting building ${id}:`, error);
      throw error;
    }
  }
};

// Сервис для работы с контроллерами
export const controllersAPI = {
  // Получить список контроллеров с пагинацией
  getControllers: async (page = 1, limit = 10) => {
    try {
      const response = await api.get(`/controllers?page=${page}&limit=${limit}`);
      return response.data;
    } catch (error) {
      console.error('Error fetching controllers:', error);
      throw error;
    }
  },

  // Получить контроллеры для конкретного здания
  getBuildingControllers: async (buildingId) => {
    try {
      const response = await api.get(`/buildings/${buildingId}/controllers`);
      return response.data;
    } catch (error) {
      console.error(`Error fetching controllers for building ${buildingId}:`, error);
      throw error;
    }
  },

  // Получить один контроллер по ID
  getController: async (id) => {
    try {
      const response = await api.get(`/controllers/${id}`);
      return response.data;
    } catch (error) {
      console.error(`Error fetching controller ${id}:`, error);
      throw error;
    }
  },

  // Создать новый контроллер
  createController: async (controllerData) => {
    try {
      const response = await api.post('/controllers', controllerData);
      return response.data;
    } catch (error) {
      console.error('Error creating controller:', error);
      throw error;
    }
  },

  // Обновить контроллер
  updateController: async (id, controllerData) => {
    try {
      const response = await api.put(`/controllers/${id}`, controllerData);
      return response.data;
    } catch (error) {
      console.error(`Error updating controller ${id}:`, error);
      throw error;
    }
  },

  // Удалить контроллер
  deleteController: async (id) => {
    try {
      const response = await api.delete(`/controllers/${id}`);
      return response.data;
    } catch (error) {
      console.error(`Error deleting controller ${id}:`, error);
      throw error;
    }
  }
};

// Сервис для работы с метриками
export const metricsAPI = {
  // Получить список метрик с пагинацией
  getMetrics: async (page = 1, limit = 10) => {
    try {
      const response = await api.get(`/metrics?page=${page}&limit=${limit}`);
      return response.data;
    } catch (error) {
      console.error('Error fetching metrics:', error);
      throw error;
    }
  },

  // Получить метрики для конкретного контроллера
  getControllerMetrics: async (controllerId) => {
    try {
      const response = await api.get(`/controllers/${controllerId}/metrics`);
      return response.data;
    } catch (error) {
      console.error(`Error fetching metrics for controller ${controllerId}:`, error);
      throw error;
    }
  },

  // Добавить новую метрику
  createMetric: async (metricData) => {
    try {
      const response = await api.post('/metrics', metricData);
      return response.data;
    } catch (error) {
      console.error('Error creating metric:', error);
      throw error;
    }
  },

  // Удалить метрику
  deleteMetric: async (id) => {
    try {
      const response = await api.delete(`/metrics/${id}`);
      return response.data;
    } catch (error) {
      console.error(`Error deleting metric ${id}:`, error);
      throw error;
    }
  }
};

export default {
  buildingsAPI,
  controllersAPI,
  metricsAPI
};