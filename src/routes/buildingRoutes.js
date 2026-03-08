const express = require('express');
const buildingController = require('../controllers/buildingController');
const { applyCrudRateLimit } = require('../middleware/rateLimiter');
const { validateBuildingCreate } = require('../middleware/validators');
const router = express.Router();

/**
 * @swagger
 * /buildings:
 *   get:
 *     summary: Получить список всех зданий
 *     description: Возвращает список всех зданий с пагинацией
 *     security: [] # Без авторизации
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Номер страницы
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *         description: Количество элементов на странице
 *       - in: query
 *         name: sort
 *         schema:
 *           type: string
 *           default: building_id
 *         description: Поле для сортировки
 *       - in: query
 *         name: order
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *           default: asc
 *         description: Порядок сортировки
 *     responses:
 *       200:
 *         description: Успешный ответ со списком зданий
 */
router.get('/', buildingController.getAllBuildings);

/**
 * @swagger
 * /buildings/search:
 *   get:
 *     summary: Поиск зданий в радиусе
 *     description: Находит здания в заданном радиусе от указанных координат
 *     security: [] # Без авторизации
 *     parameters:
 *       - in: query
 *         name: latitude
 *         required: true
 *         schema:
 *           type: number
 *           minimum: -90
 *           maximum: 90
 *         description: Широта центральной точки
 *       - in: query
 *         name: longitude
 *         required: true
 *         schema:
 *           type: number
 *           minimum: -180
 *           maximum: 180
 *         description: Долгота центральной точки
 *       - in: query
 *         name: radius
 *         required: true
 *         schema:
 *           type: number
 *           minimum: 0.1
 *           maximum: 100
 *         description: Радиус поиска в километрах
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *           maximum: 100
 *         description: Максимальное количество результатов
 *     responses:
 *       200:
 *         description: Найденные здания с расстояниями
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       building_id:
 *                         type: integer
 *                       name:
 *                         type: string
 *                       address:
 *                         type: string
 *                       latitude:
 *                         type: number
 *                       longitude:
 *                         type: number
 *                       distance:
 *                         type: number
 *                         description: Расстояние в километрах
 *       400:
 *         description: Неверные параметры поиска
 */
router.get('/search', buildingController.findBuildingsInRadius);

/**
 * @swagger
 * /buildings/statistics:
 *   get:
 *     summary: Статистика зданий
 *     description: Возвращает аналитику по зданиям (по городам и управляющим компаниям)
 *     security: [] # Без авторизации
 *     responses:
 *       200:
 *         description: Статистика зданий
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     total:
 *                       type: integer
 *                       description: Общее количество зданий
 *                     by_city:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           city:
 *                             type: string
 *                           count:
 *                             type: integer
 *                     by_management_company:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           company:
 *                             type: string
 *                           count:
 *                             type: integer
 *       500:
 *         description: Ошибка сервера
 */
router.get('/statistics', buildingController.getBuildingsStatistics);

/**
 * @swagger
 * /buildings/{id}:
 *   get:
 *     summary: Получить здание по ID
 *     description: Возвращает одно здание по его ID
 *     security: [] # Без авторизации
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID здания
 *     responses:
 *       200:
 *         description: Успешный ответ с информацией о здании
 *       404:
 *         description: Здание не найдено
 */
router.get('/:id', buildingController.getBuildingById);

/**
 * @swagger
 * /buildings:
 *   post:
 *     summary: Создать новое здание
 *     description: Создает новое здание
 *     security:
 *       - bearerAuth: [] # Требуется авторизация
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - address
 *               - latitude
 *               - longitude
 *             properties:
 *               name:
 *                 type: string
 *               address:
 *                 type: string
 *               latitude:
 *                 type: number
 *               longitude:
 *                 type: number
 *     responses:
 *       201:
 *         description: Здание успешно создано
 *       400:
 *         description: Ошибка валидации данных
 *       401:
 *         description: Отсутствует токен авторизации
 *       403:
 *         description: Недействительный токен
 */
router.post('/', applyCrudRateLimit, validateBuildingCreate, buildingController.createBuilding);

/**
 * @swagger
 * /buildings/{id}:
 *   put:
 *     summary: Обновить здание
 *     description: Обновляет существующее здание по его ID
 *     security:
 *       - bearerAuth: [] # Требуется авторизация
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID здания
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               address:
 *                 type: string
 *               latitude:
 *                 type: number
 *               longitude:
 *                 type: number
 *     responses:
 *       200:
 *         description: Здание успешно обновлено
 *       404:
 *         description: Здание не найдено
 *       400:
 *         description: Ошибка валидации данных
 *       401:
 *         description: Отсутствует токен авторизации
 *       403:
 *         description: Недействительный токен
 */
router.put('/:id', applyCrudRateLimit, validateBuildingCreate, buildingController.updateBuilding);

/**
 * @swagger
 * /buildings/{id}:
 *   delete:
 *     summary: Удалить здание
 *     description: Удаляет здание по его ID
 *     security:
 *       - bearerAuth: [] # Требуется авторизация
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID здания
 *     responses:
 *       200:
 *         description: Здание успешно удалено
 *       404:
 *         description: Здание не найдено
 *       400:
 *         description: Невозможно удалить здание с привязанными контроллерами
 *       401:
 *         description: Отсутствует токен авторизации
 *       403:
 *         description: Недействительный токен
 */
router.delete('/:id', applyCrudRateLimit, buildingController.deleteBuilding);

module.exports = router;