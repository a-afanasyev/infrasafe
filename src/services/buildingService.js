const Building = require('../models/Building');
const Controller = require('../models/Controller');
const logger = require('../utils/logger');
const cacheService = require('./cacheService');

class BuildingService {
    constructor() {
        this.cachePrefix = 'building';
        this.defaultCacheTTL = 300; // 5 минут
    }

    // Получить все здания с пагинацией и кэшированием
    async getAllBuildings(page = 1, limit = 10, sort = 'building_id', order = 'asc') {
        try {
            const cacheKey = `${this.cachePrefix}:list:${page}:${limit}:${sort}:${order}`;

            // Проверяем кэш
            const cached = await cacheService.get(cacheKey, { ttl: this.defaultCacheTTL });
            if (cached) {
                logger.debug(`Buildings list получен из кэша: ${cacheKey}`);
                return cached;
            }

            // Получаем данные из БД
            const result = await Building.findAll(page, limit, sort, order);

            // Сохраняем в кэш
            await cacheService.set(cacheKey, result, { ttl: this.defaultCacheTTL });

            logger.info(`Получено ${result.data?.length || 0} зданий (страница ${page})`);
            return result;
        } catch (error) {
            logger.error(`Ошибка получения списка зданий: ${error.message}`);
            throw error;
        }
    }

    // Получить здание по ID с контроллерами (один запрос с JOIN)
    async getBuildingById(id) {
        try {
            const cacheKey = `${this.cachePrefix}:${id}:with_controllers`;

            // Проверяем кэш
            const cached = await cacheService.get(cacheKey, { ttl: this.defaultCacheTTL });
            if (cached) {
                logger.debug(`Building ${id} получен из кэша`);
                return cached;
            }

            // Один запрос с LEFT JOIN + json_agg (устраняет N+1)
            const result = await Building.findByIdWithControllers(id);
            if (!result) {
                logger.warn(`Здание с ID ${id} не найдено`);
                return null;
            }

            // Сохраняем в кэш
            await cacheService.set(cacheKey, result, { ttl: this.defaultCacheTTL });

            const controllerCount = Array.isArray(result.controllers) ? result.controllers.length : 0;
            logger.info(`Получено здание ${id} с ${controllerCount} контроллерами`);
            return result;
        } catch (error) {
            logger.error(`Ошибка получения здания ${id}: ${error.message}`);
            throw error;
        }
    }

    // Создать новое здание
    async createBuilding(buildingData) {
        try {
            // Валидация координат
            this.validateCoordinates(buildingData.latitude, buildingData.longitude);

            // Создаем здание
            const newBuilding = await Building.create(buildingData);

            // Инвалидируем кэш списков
            await this.invalidateBuildingListCache();

            logger.info(`Создано новое здание: ${newBuilding.name} (ID: ${newBuilding.building_id})`);
            return newBuilding;
        } catch (error) {
            logger.error(`Ошибка создания здания: ${error.message}`);
            throw error;
        }
    }

    // Обновить здание
    async updateBuilding(id, updateData) {
        try {
            // Валидация координат если они переданы
            if (updateData.latitude !== undefined || updateData.longitude !== undefined) {
                this.validateCoordinates(updateData.latitude, updateData.longitude);
            }

            const updatedBuilding = await Building.update(id, updateData);

            if (!updatedBuilding) {
                logger.warn(`Здание с ID ${id} не найдено для обновления`);
                return null;
            }

            // Инвалидируем кэш
            await this.invalidateBuildingCache(id);

            logger.info(`Обновлено здание ${id}: ${updatedBuilding.name}`);
            return updatedBuilding;
        } catch (error) {
            logger.error(`Ошибка обновления здания ${id}: ${error.message}`);
            throw error;
        }
    }

    // Удалить здание с проверкой связанных контроллеров
    async deleteBuilding(id) {
        try {
            // Проверяем наличие связанных контроллеров
            const controllers = await Controller.findByBuildingId(id);
            if (controllers.length > 0) {
                const error = new Error('Невозможно удалить здание с привязанными контроллерами');
                error.code = 'BUILDING_HAS_CONTROLLERS';
                error.controllers = controllers;
                throw error;
            }

            const result = await Building.delete(id);

            if (!result) {
                logger.warn(`Здание с ID ${id} не найдено для удаления`);
                return null;
            }

            // Инвалидируем кэш
            await this.invalidateBuildingCache(id);

            logger.info(`Удалено здание ${id}`);
            return result;
        } catch (error) {
            logger.error(`Ошибка удаления здания ${id}: ${error.message}`);
            throw error;
        }
    }

    // Поиск зданий по радиусу от координат
    async findBuildingsInRadius(latitude, longitude, radiusMeters = 1000) {
        try {
            this.validateCoordinates(latitude, longitude);

            const cacheKey = `${this.cachePrefix}:geo:${latitude}:${longitude}:${radiusMeters}`;

            // Проверяем кэш
            const cached = await cacheService.get(cacheKey, { ttl: this.defaultCacheTTL });
            if (cached) {
                logger.debug(`Buildings in radius получены из кэша`);
                return cached;
            }

            // Пока используем простой поиск через модель
            // В будущем можно добавить геопространственные запросы в Building модель
            const allBuildings = await Building.findAll(1, 1000, 'building_id', 'asc');

            const buildingsInRadius = allBuildings.data.filter(building => {
                if (!building.latitude || !building.longitude) return false;

                const distance = this.calculateDistance(
                    latitude, longitude,
                    building.latitude, building.longitude
                );

                return distance <= radiusMeters;
            });

            const result = {
                center: { latitude, longitude },
                radius: radiusMeters,
                buildings: buildingsInRadius
            };

            // Сохраняем в кэш
            await cacheService.set(cacheKey, result, { ttl: this.defaultCacheTTL });

            logger.info(`Найдено ${buildingsInRadius.length} зданий в радиусе ${radiusMeters}м`);
            return result;
        } catch (error) {
            logger.error(`Ошибка поиска зданий в радиусе: ${error.message}`);
            throw error;
        }
    }

    // Получить статистику по зданиям
    async getBuildingsStatistics() {
        try {
            const cacheKey = `${this.cachePrefix}:statistics`;

            // Проверяем кэш
            const cached = await cacheService.get(cacheKey, { ttl: this.defaultCacheTTL });
            if (cached) {
                return cached;
            }

            // Получаем все здания для подсчета статистики
            const allBuildings = await Building.findAll(1, 10000, 'building_id', 'asc');
            const buildings = allBuildings.data || [];

            // Подсчитываем статистику
            const stats = {
                total: buildings.length,
                by_town: {},
                by_management_company: {},
                with_coordinates: 0,
                without_coordinates: 0
            };

            buildings.forEach(building => {
                // По городам
                const town = building.town || 'Не указан';
                stats.by_town[town] = (stats.by_town[town] || 0) + 1;

                // По управляющим компаниям
                const company = building.management_company || 'Не указана';
                stats.by_management_company[company] = (stats.by_management_company[company] || 0) + 1;

                // Координаты
                if (building.latitude && building.longitude) {
                    stats.with_coordinates++;
                } else {
                    stats.without_coordinates++;
                }
            });

            // Сохраняем в кэш
            await cacheService.set(cacheKey, stats, { ttl: this.defaultCacheTTL });

            return stats;
        } catch (error) {
            logger.error(`Ошибка получения статистики зданий: ${error.message}`);
            throw error;
        }
    }

    // Валидация координат
    validateCoordinates(latitude, longitude) {
        if (latitude !== undefined && (latitude < -90 || latitude > 90)) {
            throw new Error('Некорректная широта. Должна быть между -90 и 90');
        }
        if (longitude !== undefined && (longitude < -180 || longitude > 180)) {
            throw new Error('Некорректная долгота. Должна быть между -180 и 180');
        }
    }

    // Расчет расстояния между координатами (формула гаверсинуса)
    calculateDistance(lat1, lon1, lat2, lon2) {
        const R = 6371000; // Радиус Земли в метрах
        const dLat = this.toRadians(lat2 - lat1);
        const dLon = this.toRadians(lon2 - lon1);

        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                  Math.cos(this.toRadians(lat1)) * Math.cos(this.toRadians(lat2)) *
                  Math.sin(dLon / 2) * Math.sin(dLon / 2);

        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    toRadians(degrees) {
        return degrees * (Math.PI / 180);
    }

    // Инвалидация кэша для конкретного здания
    async invalidateBuildingCache(buildingId) {
        try {
            await cacheService.invalidate(`${this.cachePrefix}:${buildingId}:with_controllers`);
            await this.invalidateBuildingListCache();
            await cacheService.invalidate(`${this.cachePrefix}:statistics`);
        } catch (error) {
            logger.warn(`Ошибка инвалидации кэша здания ${buildingId}: ${error.message}`);
        }
    }

    // Инвалидация кэша списков зданий
    async invalidateBuildingListCache() {
        try {
            await cacheService.invalidatePattern(`${this.cachePrefix}:list:`);
            await cacheService.invalidatePattern(`${this.cachePrefix}:geo:`);
        } catch (error) {
            logger.warn(`Ошибка инвалидации кэша списков зданий: ${error.message}`);
        }
    }
}

module.exports = new BuildingService();