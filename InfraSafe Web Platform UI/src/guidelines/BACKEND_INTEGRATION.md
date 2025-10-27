# Документация по интеграции фронтенда InfraSafe с Node.js Backend

## 📋 Содержание
1. [Обзор архитектуры](#обзор-архитектуры)
2. [Настройка API клиента](#настройка-api-клиента)
3. [Аутентификация](#аутентификация)
4. [Интеграция компонентов](#интеграция-компонентов)
5. [Обработка ошибок](#обработка-ошибок)
6. [WebSocket для real-time данных](#websocket-для-real-time-данных)
7. [Типы данных](#типы-данных)

---

## 🏗️ Обзор архитектуры

### Текущая структура фронтенда
```
InfraSafe Frontend (React + TypeScript)
├── Компоненты UI
├── Управление состоянием (useState, useEffect)
├── Локальные данные (mock data)
└── Типы данных (types.ts)
```

### Целевая архитектура с backend
```
Frontend ↔️ API Layer ↔️ Node.js Backend ↔️ Database
                                        ↔️ IoT Devices
```

---

## ⚙️ Настройка API клиента

### 1. Создание API service

Создайте файл `/services/api.ts`:

```typescript
// services/api.ts
// Базовая настройка для всех API запросов

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

// Интерфейс для ответа API
interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

// Класс для работы с API
class ApiService {
  private baseUrl: string;
  private token: string | null = null;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
    // Загружаем токен из localStorage при инициализации
    this.token = localStorage.getItem('auth_token');
  }

  // Установка токена после авторизации
  setToken(token: string) {
    this.token = token;
    localStorage.setItem('auth_token', token);
  }

  // Удаление токена при выходе
  clearToken() {
    this.token = null;
    localStorage.removeItem('auth_token');
  }

  // Базовый метод для всех запросов
  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<ApiResponse<T>> {
    try {
      // Формируем заголовки
      const headers: HeadersInit = {
        'Content-Type': 'application/json',
        ...options.headers,
      };

      // Добавляем токен если он есть
      if (this.token) {
        headers['Authorization'] = `Bearer ${this.token}`;
      }

      // Выполняем запрос
      const response = await fetch(`${this.baseUrl}${endpoint}`, {
        ...options,
        headers,
      });

      // Парсим ответ
      const data = await response.json();

      // Проверяем статус ответа
      if (!response.ok) {
        return {
          success: false,
          error: data.message || 'Ошибка при выполнении запроса',
        };
      }

      return {
        success: true,
        data: data,
      };
    } catch (error) {
      console.error('API Request Error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Неизвестная ошибка',
      };
    }
  }

  // GET запрос
  async get<T>(endpoint: string): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, { method: 'GET' });
  }

  // POST запрос
  async post<T>(endpoint: string, body: any): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  // PUT запрос
  async put<T>(endpoint: string, body: any): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
  }

  // DELETE запрос
  async delete<T>(endpoint: string): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, { method: 'DELETE' });
  }
}

// Экспортируем единственный экземпляр API service
export const api = new ApiService(API_BASE_URL);
```

### 2. Переменные окружения

Создайте файл `.env.local` в корне проекта:

```env
# Backend API URL
VITE_API_URL=http://localhost:3000/api

# WebSocket URL
VITE_WS_URL=ws://localhost:3000

# Другие настройки
VITE_APP_NAME=InfraSafe
VITE_APP_VERSION=1.0.0
```

---

## 🔐 Аутентификация

### Обновление AuthPage.tsx

Создайте файл `/services/auth.service.ts`:

```typescript
// services/auth.service.ts
// Сервис для работы с аутентификацией

import { api } from './api';

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface RegisterData {
  name: string;
  email: string;
  password: string;
  role?: 'admin' | 'manager' | 'user';
}

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'manager' | 'user';
  avatar?: string;
  createdAt: string;
}

export interface AuthResponse {
  user: AuthUser;
  token: string;
}

class AuthService {
  // Вход в систему
  async login(credentials: LoginCredentials): Promise<AuthResponse | null> {
    try {
      const response = await api.post<AuthResponse>('/auth/login', credentials);
      
      if (response.success && response.data) {
        // Сохраняем токен
        api.setToken(response.data.token);
        // Сохраняем данные пользователя
        localStorage.setItem('user', JSON.stringify(response.data.user));
        return response.data;
      }
      
      throw new Error(response.error || 'Ошибка авторизации');
    } catch (error) {
      console.error('Login error:', error);
      return null;
    }
  }

  // Регистрация нового пользователя
  async register(data: RegisterData): Promise<AuthResponse | null> {
    try {
      const response = await api.post<AuthResponse>('/auth/register', data);
      
      if (response.success && response.data) {
        // Сохраняем токен
        api.setToken(response.data.token);
        // Сохраняем данные пользователя
        localStorage.setItem('user', JSON.stringify(response.data.user));
        return response.data;
      }
      
      throw new Error(response.error || 'Ошибка регистрации');
    } catch (error) {
      console.error('Register error:', error);
      return null;
    }
  }

  // Выход из системы
  async logout(): Promise<void> {
    try {
      await api.post('/auth/logout', {});
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      // Очищаем локальные данные в любом случае
      api.clearToken();
      localStorage.removeItem('user');
    }
  }

  // Получение текущего пользователя
  getCurrentUser(): AuthUser | null {
    const userStr = localStorage.getItem('user');
    if (userStr) {
      try {
        return JSON.parse(userStr);
      } catch {
        return null;
      }
    }
    return null;
  }

  // Проверка авторизации
  isAuthenticated(): boolean {
    return !!localStorage.getItem('auth_token');
  }

  // Обновление профиля
  async updateProfile(data: Partial<AuthUser>): Promise<AuthUser | null> {
    try {
      const response = await api.put<AuthUser>('/auth/profile', data);
      
      if (response.success && response.data) {
        localStorage.setItem('user', JSON.stringify(response.data));
        return response.data;
      }
      
      return null;
    } catch (error) {
      console.error('Update profile error:', error);
      return null;
    }
  }
}

export const authService = new AuthService();
```

### Интеграция в AuthPage.tsx

```typescript
// components/AuthPage.tsx
// Пример интеграции авторизации

import { useState } from 'react';
import { authService } from '../services/auth.service';
import { toast } from 'sonner';

export function AuthPage({ onLogin, t }: AuthPageProps) {
  const [isLogin, setIsLogin] = useState(true);
  const [loading, setLoading] = useState(false);
  
  // Данные формы
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    name: '',
  });

  // Обработка входа
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const result = await authService.login({
        email: formData.email,
        password: formData.password,
      });

      if (result) {
        // Показываем успешное уведомление
        toast.success(t.language === 'ru' ? 'Вход выполнен успешно' : 
                      t.language === 'en' ? 'Login successful' : 
                      'Muvaffaqiyatli kirildi');
        
        // Вызываем callback для обновления состояния в App
        onLogin(result.user);
      } else {
        toast.error(t.language === 'ru' ? 'Неверный email или пароль' :
                    t.language === 'en' ? 'Invalid email or password' :
                    'Noto\'g\'ri email yoki parol');
      }
    } catch (error) {
      toast.error(t.language === 'ru' ? 'Ошибка при входе' :
                  t.language === 'en' ? 'Login error' :
                  'Kirish xatosi');
    } finally {
      setLoading(false);
    }
  };

  // Обработка регистрации
  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const result = await authService.register({
        name: formData.name,
        email: formData.email,
        password: formData.password,
      });

      if (result) {
        toast.success(t.language === 'ru' ? 'Регистрация успешна' :
                      t.language === 'en' ? 'Registration successful' :
                      'Ro\'yxatdan o\'tish muvaffaqiyatli');
        
        onLogin(result.user);
      } else {
        toast.error(t.language === 'ru' ? 'Ошибка регистрации' :
                    t.language === 'en' ? 'Registration error' :
                    'Ro\'yxatdan o\'tish xatosi');
      }
    } catch (error) {
      toast.error(t.language === 'ru' ? 'Ошибка при регистрации' :
                  t.language === 'en' ? 'Registration error' :
                  'Ro\'yxatdan o\'tish xatosi');
    } finally {
      setLoading(false);
    }
  };

  // ... остальной код компонента
}
```

---

## 🔌 Интеграция компонентов

### 1. Dashboard - Получение объектов

Создайте файл `/services/buildings.service.ts`:

```typescript
// services/buildings.service.ts
// Сервис для работы с объектами недвижимости

import { api } from './api';
import type { Building } from '../components/types';

export interface BuildingsFilter {
  status?: string[];
  search?: string;
  limit?: number;
  offset?: number;
}

export interface BuildingsResponse {
  buildings: Building[];
  total: number;
  hasMore: boolean;
}

class BuildingsService {
  // Получение списка объектов
  async getBuildings(filter?: BuildingsFilter): Promise<BuildingsResponse | null> {
    try {
      // Формируем query параметры
      const params = new URLSearchParams();
      
      if (filter?.status && filter.status.length > 0) {
        params.append('status', filter.status.join(','));
      }
      if (filter?.search) {
        params.append('search', filter.search);
      }
      if (filter?.limit) {
        params.append('limit', filter.limit.toString());
      }
      if (filter?.offset) {
        params.append('offset', filter.offset.toString());
      }

      const queryString = params.toString();
      const endpoint = `/buildings${queryString ? `?${queryString}` : ''}`;
      
      const response = await api.get<BuildingsResponse>(endpoint);
      
      if (response.success && response.data) {
        return response.data;
      }
      
      return null;
    } catch (error) {
      console.error('Get buildings error:', error);
      return null;
    }
  }

  // Получение одного объекта
  async getBuilding(id: string): Promise<Building | null> {
    try {
      const response = await api.get<Building>(`/buildings/${id}`);
      
      if (response.success && response.data) {
        return response.data;
      }
      
      return null;
    } catch (error) {
      console.error('Get building error:', error);
      return null;
    }
  }

  // Создание объекта (только для admin/manager)
  async createBuilding(data: Omit<Building, 'id'>): Promise<Building | null> {
    try {
      const response = await api.post<Building>('/buildings', data);
      
      if (response.success && response.data) {
        return response.data;
      }
      
      return null;
    } catch (error) {
      console.error('Create building error:', error);
      return null;
    }
  }

  // Обновление объекта
  async updateBuilding(id: string, data: Partial<Building>): Promise<Building | null> {
    try {
      const response = await api.put<Building>(`/buildings/${id}`, data);
      
      if (response.success && response.data) {
        return response.data;
      }
      
      return null;
    } catch (error) {
      console.error('Update building error:', error);
      return null;
    }
  }

  // Удаление объекта
  async deleteBuilding(id: string): Promise<boolean> {
    try {
      const response = await api.delete(`/buildings/${id}`);
      return response.success;
    } catch (error) {
      console.error('Delete building error:', error);
      return false;
    }
  }

  // Получение статистики
  async getStatistics(): Promise<any | null> {
    try {
      const response = await api.get('/buildings/statistics');
      
      if (response.success && response.data) {
        return response.data;
      }
      
      return null;
    } catch (error) {
      console.error('Get statistics error:', error);
      return null;
    }
  }
}

export const buildingsService = new BuildingsService();
```

### Интеграция в Dashboard.tsx

```typescript
// components/Dashboard.tsx
// Обновленный компонент Dashboard с интеграцией API

import { useState, useEffect } from 'react';
import { buildingsService } from '../services/buildings.service';
import type { Building } from './types';

export function Dashboard() {
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Состояние фильтров
  const [filters, setFilters] = useState({
    status: [] as string[],
    search: '',
  });

  // Загрузка данных при монтировании и изменении фильтров
  useEffect(() => {
    loadBuildings();
  }, [filters]);

  // Функция загрузки объектов
  const loadBuildings = async () => {
    setLoading(true);
    setError(null);

    try {
      const result = await buildingsService.getBuildings(filters);
      
      if (result) {
        setBuildings(result.buildings);
      } else {
        setError('Не удалось загрузить данные');
      }
    } catch (err) {
      setError('Ошибка при загрузке данных');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  // Обработка изменения фильтров
  const handleFilterChange = (newFilters: typeof filters) => {
    setFilters(newFilters);
  };

  // Показываем загрузку
  if (loading) {
    return <div>Загрузка...</div>;
  }

  // Показываем ошибку
  if (error) {
    return <div>Ошибка: {error}</div>;
  }

  // Рендерим данные
  return (
    <div>
      <FilterPanel onFilterChange={handleFilterChange} />
      <MapView buildings={buildings} />
    </div>
  );
}
```

### 2. Sensors - Данные датчиков

Создайте файл `/services/sensors.service.ts`:

```typescript
// services/sensors.service.ts
// Сервис для работы с данными датчиков

import { api } from './api';

export interface SensorData {
  id: string;
  buildingId: string;
  type: 'temperature' | 'humidity' | 'pressure' | 'water' | 'electricity' | 'gas';
  value: number;
  unit: string;
  timestamp: string;
  status: 'normal' | 'warning' | 'critical';
}

export interface SensorHistory {
  sensorId: string;
  data: Array<{
    timestamp: string;
    value: number;
  }>;
}

class SensorsService {
  // Получение данных всех датчиков здания
  async getBuildingSensors(buildingId: string): Promise<SensorData[] | null> {
    try {
      const response = await api.get<SensorData[]>(`/sensors/building/${buildingId}`);
      
      if (response.success && response.data) {
        return response.data;
      }
      
      return null;
    } catch (error) {
      console.error('Get building sensors error:', error);
      return null;
    }
  }

  // Получение истории показаний датчика
  async getSensorHistory(
    sensorId: string,
    from?: string,
    to?: string
  ): Promise<SensorHistory | null> {
    try {
      const params = new URLSearchParams();
      if (from) params.append('from', from);
      if (to) params.append('to', to);
      
      const queryString = params.toString();
      const endpoint = `/sensors/${sensorId}/history${queryString ? `?${queryString}` : ''}`;
      
      const response = await api.get<SensorHistory>(endpoint);
      
      if (response.success && response.data) {
        return response.data;
      }
      
      return null;
    } catch (error) {
      console.error('Get sensor history error:', error);
      return null;
    }
  }

  // Обновление настроек датчика
  async updateSensorSettings(
    sensorId: string,
    settings: any
  ): Promise<boolean> {
    try {
      const response = await api.put(`/sensors/${sensorId}/settings`, settings);
      return response.success;
    } catch (error) {
      console.error('Update sensor settings error:', error);
      return false;
    }
  }
}

export const sensorsService = new SensorsService();
```

### 3. Alerts - Система уведомлений

Создайте файл `/services/alerts.service.ts`:

```typescript
// services/alerts.service.ts
// Сервис для работы с уведомлениями и алертами

import { api } from './api';

export interface Alert {
  id: string;
  buildingId: string;
  sensorId?: string;
  type: 'warning' | 'error' | 'info';
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
  resolved: boolean;
}

class AlertsService {
  // Получение списка уведомлений
  async getAlerts(unreadOnly: boolean = false): Promise<Alert[] | null> {
    try {
      const endpoint = unreadOnly ? '/alerts?unread=true' : '/alerts';
      const response = await api.get<Alert[]>(endpoint);
      
      if (response.success && response.data) {
        return response.data;
      }
      
      return null;
    } catch (error) {
      console.error('Get alerts error:', error);
      return null;
    }
  }

  // Отметить уведомление как прочитанное
  async markAsRead(alertId: string): Promise<boolean> {
    try {
      const response = await api.put(`/alerts/${alertId}/read`, {});
      return response.success;
    } catch (error) {
      console.error('Mark alert as read error:', error);
      return false;
    }
  }

  // Отметить уведомление как решенное
  async resolveAlert(alertId: string): Promise<boolean> {
    try {
      const response = await api.put(`/alerts/${alertId}/resolve`, {});
      return response.success;
    } catch (error) {
      console.error('Resolve alert error:', error);
      return false;
    }
  }

  // Получение количества непрочитанных
  async getUnreadCount(): Promise<number> {
    try {
      const response = await api.get<{ count: number }>('/alerts/unread/count');
      
      if (response.success && response.data) {
        return response.data.count;
      }
      
      return 0;
    } catch (error) {
      console.error('Get unread count error:', error);
      return 0;
    }
  }
}

export const alertsService = new AlertsService();
```

---

## 🚨 Обработка ошибок

### Глобальный обработчик ошибок

Создайте файл `/utils/errorHandler.ts`:

```typescript
// utils/errorHandler.ts
// Централизованная обработка ошибок

import { toast } from 'sonner';

export interface AppError {
  code: string;
  message: string;
  details?: any;
}

export class ErrorHandler {
  // Обработка API ошибок
  static handleApiError(error: any, language: 'ru' | 'en' | 'uz' = 'ru') {
    const messages = {
      ru: {
        network: 'Ошибка сети. Проверьте подключение к интернету',
        unauthorized: 'Необходима авторизация',
        forbidden: 'Доступ запрещен',
        notFound: 'Ресурс не найден',
        serverError: 'Ошибка сервера. Попробуйте позже',
        unknown: 'Неизвестная ошибка',
      },
      en: {
        network: 'Network error. Check your internet connection',
        unauthorized: 'Authorization required',
        forbidden: 'Access forbidden',
        notFound: 'Resource not found',
        serverError: 'Server error. Try again later',
        unknown: 'Unknown error',
      },
      uz: {
        network: 'Tarmoq xatosi. Internet aloqangizni tekshiring',
        unauthorized: 'Avtorizatsiya talab qilinadi',
        forbidden: 'Kirish taqiqlangan',
        notFound: 'Resurs topilmadi',
        serverError: 'Server xatosi. Keyinroq urinib ko\'ring',
        unknown: 'Noma\'lum xato',
      },
    };

    let messageKey: keyof typeof messages.ru = 'unknown';

    if (error.code === 'NETWORK_ERROR') {
      messageKey = 'network';
    } else if (error.status === 401) {
      messageKey = 'unauthorized';
    } else if (error.status === 403) {
      messageKey = 'forbidden';
    } else if (error.status === 404) {
      messageKey = 'notFound';
    } else if (error.status >= 500) {
      messageKey = 'serverError';
    }

    const message = messages[language][messageKey];
    toast.error(message);
    
    // Логируем в консоль для отладки
    console.error('API Error:', error);
  }

  // Обработка ошибок валидации
  static handleValidationError(errors: Record<string, string[]>, language: 'ru' | 'en' | 'uz' = 'ru') {
    const errorMessages = Object.entries(errors)
      .map(([field, messages]) => `${field}: ${messages.join(', ')}`)
      .join('\n');

    toast.error(errorMessages);
  }
}
```

---

## 🔄 WebSocket для real-time данных

### Настройка WebSocket клиента

Создайте файл `/services/websocket.service.ts`:

```typescript
// services/websocket.service.ts
// Сервис для real-time обновлений через WebSocket

const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:3000';

export type WebSocketMessage = {
  type: 'sensor_update' | 'alert' | 'building_status' | 'connection';
  data: any;
};

export type MessageHandler = (message: WebSocketMessage) => void;

class WebSocketService {
  private ws: WebSocket | null = null;
  private handlers: Map<string, Set<MessageHandler>> = new Map();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectTimeout: number | null = null;

  // Подключение к WebSocket серверу
  connect(token?: string) {
    try {
      // Создаем подключение
      const url = token ? `${WS_URL}?token=${token}` : WS_URL;
      this.ws = new WebSocket(url);

      // Обработка открытия соединения
      this.ws.onopen = () => {
        console.log('WebSocket connected');
        this.reconnectAttempts = 0;
        
        // Отправляем сообщение о подключении
        this.emit({
          type: 'connection',
          data: { status: 'connected' },
        });
      };

      // Обработка входящих сообщений
      this.ws.onmessage = (event) => {
        try {
          const message: WebSocketMessage = JSON.parse(event.data);
          this.emit(message);
        } catch (error) {
          console.error('Failed to parse WebSocket message:', error);
        }
      };

      // Обработка ошибок
      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
      };

      // Обработка закрытия соединения
      this.ws.onclose = () => {
        console.log('WebSocket disconnected');
        this.handleReconnect();
      };
    } catch (error) {
      console.error('Failed to connect WebSocket:', error);
    }
  }

  // Переподклю��ение при обрыве связи
  private handleReconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
      
      console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
      
      this.reconnectTimeout = window.setTimeout(() => {
        this.connect();
      }, delay);
    } else {
      console.error('Max reconnection attempts reached');
    }
  }

  // Отключение
  disconnect() {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }
    
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    
    this.handlers.clear();
  }

  // Подписка на события
  subscribe(type: string, handler: MessageHandler) {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    this.handlers.get(type)?.add(handler);
  }

  // Отписка от событий
  unsubscribe(type: string, handler: MessageHandler) {
    this.handlers.get(type)?.delete(handler);
  }

  // Отправка сообщения всем подписчикам
  private emit(message: WebSocketMessage) {
    const handlers = this.handlers.get(message.type);
    if (handlers) {
      handlers.forEach(handler => handler(message));
    }
    
    // Также отправляем всем подписанным на все события
    const allHandlers = this.handlers.get('*');
    if (allHandlers) {
      allHandlers.forEach(handler => handler(message));
    }
  }

  // Отправка сообщения на сервер
  send(message: WebSocketMessage) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      console.warn('WebSocket is not connected');
    }
  }
}

export const wsService = new WebSocketService();
```

### Использование WebSocket в компонентах

```typescript
// Пример использования в Dashboard.tsx

import { useEffect } from 'react';
import { wsService } from '../services/websocket.service';

export function Dashboard() {
  useEffect(() => {
    // Подключаемся к WebSocket
    const token = localStorage.getItem('auth_token');
    wsService.connect(token || undefined);

    // Подписываемся на обновления датчиков
    const handleSensorUpdate = (message: WebSocketMessage) => {
      console.log('Sensor update:', message.data);
      // Обновляем состояние компонента
      // updateSensorData(message.data);
    };

    // Подписываемся на алерты
    const handleAlert = (message: WebSocketMessage) => {
      console.log('New alert:', message.data);
      // Показываем уведомление
      toast.warning(message.data.message);
    };

    wsService.subscribe('sensor_update', handleSensorUpdate);
    wsService.subscribe('alert', handleAlert);

    // Отписываемся при размонтировании
    return () => {
      wsService.unsubscribe('sensor_update', handleSensorUpdate);
      wsService.unsubscribe('alert', handleAlert);
      wsService.disconnect();
    };
  }, []);

  // ... остальной код
}
```

---

## 📝 Типы данных

### Обновление types.ts

```typescript
// components/types.ts
// Расширенные типы данных для интеграции с backend

// Пользователь
export interface User {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'manager' | 'user' | 'guest';
  avatar?: string;
  createdAt: string;
  updatedAt?: string;
}

// Объект недвижимости
export interface Building {
  id: string;
  name: string;
  address: string;
  coordinates: {
    lat: number;
    lng: number;
  };
  status: 'normal' | 'warning' | 'error' | 'sensor' | 'unknown';
  type: 'residential' | 'commercial' | 'industrial';
  floors: number;
  apartments?: number;
  sensors: Sensor[];
  createdAt: string;
  updatedAt?: string;
  metadata?: Record<string, any>;
}

// Датчик
export interface Sensor {
  id: string;
  buildingId: string;
  name: string;
  type: 'temperature' | 'humidity' | 'pressure' | 'water' | 'electricity' | 'gas' | 'smoke' | 'motion';
  value: number;
  unit: string;
  status: 'normal' | 'warning' | 'critical' | 'offline';
  lastUpdate: string;
  thresholds?: {
    min?: number;
    max?: number;
    critical?: number;
  };
}

// Алерт/Уведомление
export interface Alert {
  id: string;
  buildingId: string;
  sensorId?: string;
  type: 'info' | 'warning' | 'error' | 'critical';
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
  resolved: boolean;
  resolvedAt?: string;
  resolvedBy?: string;
}

// Фильтры
export interface FilterOptions {
  status: string[];
  search: string;
  types?: string[];
  dateRange?: {
    from: string;
    to: string;
  };
}

// Статистика
export interface Statistics {
  total: number;
  byStatus: Record<string, number>;
  bySensor: Record<string, number>;
  alerts: {
    total: number;
    unread: number;
    byType: Record<string, number>;
  };
}
```

---

## 🎯 Примеры интеграции по компонентам

### App.tsx - Главны�� компонент

```typescript
// App.tsx
// Обновленный главный компонент с интеграцией backend

import { useState, useEffect } from 'react';
import { authService } from './services/auth.service';
import { wsService } from './services/websocket.service';
import type { User } from './components/types';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // Проверяем авторизацию при загрузке
  useEffect(() => {
    const initAuth = async () => {
      const currentUser = authService.getCurrentUser();
      if (currentUser) {
        setUser(currentUser);
        
        // Подключаемся к WebSocket если пользователь авторизован
        const token = localStorage.getItem('auth_token');
        if (token) {
          wsService.connect(token);
        }
      }
      setLoading(false);
    };

    initAuth();

    // Отключаемся от WebSocket при размонтировании
    return () => {
      wsService.disconnect();
    };
  }, []);

  // Обработка успешной авторизации
  const handleLogin = (loggedUser: User) => {
    setUser(loggedUser);
    
    // Подключаемся к WebSocket
    const token = localStorage.getItem('auth_token');
    if (token) {
      wsService.connect(token);
    }
  };

  // Обработка выхода
  const handleLogout = async () => {
    await authService.logout();
    setUser(null);
    wsService.disconnect();
  };

  if (loading) {
    return <div>Загрузка...</div>;
  }

  // ... остальной код
}
```

---

## 🔧 Настройка окружения разработки

### package.json - добавьте proxy для разработки

```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    // ... существующие зависимости
  }
}
```

### vite.config.ts - настройка прокси

```typescript
// vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
```

---

## 📌 Структура Backend API

### Ожидаемые эндпоинты от Node.js backend:

```
POST   /api/auth/login          - Авторизация
POST   /api/auth/register       - Регистрация
POST   /api/auth/logout         - Выход
GET    /api/auth/profile        - Получение профиля
PUT    /api/auth/profile        - Обновление профиля

GET    /api/buildings           - Список объектов
GET    /api/buildings/:id       - Один объект
POST   /api/buildings           - Создание объекта
PUT    /api/buildings/:id       - Обновление объекта
DELETE /api/buildings/:id       - Удаление объекта
GET    /api/buildings/statistics - Статистика

GET    /api/sensors/building/:id - Датчики здания
GET    /api/sensors/:id/history  - История показаний
PUT    /api/sensors/:id/settings - Настройки датчика

GET    /api/alerts              - Список алертов
GET    /api/alerts/unread/count - Количество непрочитанных
PUT    /api/alerts/:id/read     - Отметить прочитанным
PUT    /api/alerts/:id/resolve  - Решить алерт

WS     /                        - WebSocket подключение
```

---

## ✅ Чеклист интеграции

- [ ] Создать `.env.local` с URL backend
- [ ] Создать `/services/api.ts`
- [ ] Создать `/services/auth.service.ts`
- [ ] Создать `/services/buildings.service.ts`
- [ ] Создать `/services/sensors.service.ts`
- [ ] Создать `/services/alerts.service.ts`
- [ ] Создать `/services/websocket.service.ts`
- [ ] Создать `/utils/errorHandler.ts`
- [ ] Обновить `App.tsx` для работы с API
- [ ] Обновить `AuthPage.tsx` для авторизации
- [ ] Обновить `Dashboard.tsx` для загрузки данных
- [ ] Обновить `types.ts` с новыми типами
- [ ] Настроить vite.config.ts proxy
- [ ] Протестировать все API вызовы
- [ ] Протестировать WebSocket подключение
- [ ] Добавить обработку ошибок

---

## 🚀 Дальнейшие улучшения

1. **Кэширование данных** - React Query или SWR
2. **Оптимистичные обновления** - Обновление UI до ответа сервера
3. **Offline режим** - Service Workers и IndexedDB
4. **Пагинация** - Бесконечный скролл для больших списков
5. **Сжатие данных** - Gzip для API responses
6. **Rate limiting** - Ограничение частоты запросов
7. **Retry логика** - Автоматические повторы при ошибках
8. **Мониторинг** - Логирование ошибок (Sentry, LogRocket)

---

## 📞 Поддержка

При возникновении вопросов или проблем с интеграцией:
- Проверьте консоль браузера на ошибки
- Убедитесь что backend сервер запущен
- Проверьте переменные окружения
- Используйте Network tab в DevTools для отладки запросов

---

**Дата:** 23 октября 2025  
**Версия:** 1.0.0  
**Платформа:** InfraSafe Frontend
