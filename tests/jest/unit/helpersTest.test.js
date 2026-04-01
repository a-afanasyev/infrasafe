const { createError, formatDateForDB, validateCoordinates, calculateBuildingStatus } = require('../../../src/utils/helpers');

describe('helpers', () => {
    describe('createError', () => {
        test('creates error with default status code 500', () => {
            const error = createError('Something went wrong');
            expect(error).toBeInstanceOf(Error);
            expect(error.message).toBe('Something went wrong');
            expect(error.statusCode).toBe(500);
        });

        test('creates error with custom status code', () => {
            const error = createError('Not found', 404);
            expect(error.message).toBe('Not found');
            expect(error.statusCode).toBe(404);
        });

        test('creates error with 400 status code', () => {
            const error = createError('Bad request', 400);
            expect(error.statusCode).toBe(400);
        });

        test('creates error with 401 status code', () => {
            const error = createError('Unauthorized', 401);
            expect(error.statusCode).toBe(401);
        });
    });

    describe('formatDateForDB', () => {
        test('formats a specific date correctly', () => {
            const date = new Date('2025-06-15T10:30:45.000Z');
            const result = formatDateForDB(date);
            expect(result).toBe('2025-06-15 10:30:45');
        });

        test('returns a date string when called with no arguments', () => {
            const result = formatDateForDB();
            // Should be in format YYYY-MM-DD HH:MM:SS
            expect(result).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
        });

        test('strips milliseconds and timezone', () => {
            const date = new Date('2025-01-01T00:00:00.999Z');
            const result = formatDateForDB(date);
            expect(result).toBe('2025-01-01 00:00:00');
        });

        test('replaces T separator with space', () => {
            const date = new Date('2024-12-31T23:59:59.000Z');
            const result = formatDateForDB(date);
            expect(result).not.toContain('T');
            expect(result).toBe('2024-12-31 23:59:59');
        });
    });

    describe('validateCoordinates', () => {
        test('returns true for valid coordinates', () => {
            expect(validateCoordinates(41.311, 69.279)).toBe(true);
        });

        test('returns true for boundary values', () => {
            expect(validateCoordinates(-90, -180)).toBe(true);
            expect(validateCoordinates(90, 180)).toBe(true);
            expect(validateCoordinates(0, 0)).toBe(true);
        });

        test('returns false for latitude out of range', () => {
            expect(validateCoordinates(91, 0)).toBe(false);
            expect(validateCoordinates(-91, 0)).toBe(false);
        });

        test('returns false for longitude out of range', () => {
            expect(validateCoordinates(0, 181)).toBe(false);
            expect(validateCoordinates(0, -181)).toBe(false);
        });

        test('returns false when both are out of range', () => {
            expect(validateCoordinates(100, 200)).toBe(false);
        });
    });

    describe('calculateBuildingStatus', () => {
        test('returns "ok" when all metrics are normal', () => {
            const metrics = {
                electricity_ph1: 220,
                electricity_ph2: 220,
                electricity_ph3: 220,
                cold_water_pressure: 3.0,
                hot_water_in_pressure: 2.5
            };
            expect(calculateBuildingStatus(metrics)).toBe('ok');
        });

        test('returns "critical" when all phases are zero', () => {
            const metrics = {
                electricity_ph1: 0,
                electricity_ph2: 0,
                electricity_ph3: 0,
                cold_water_pressure: 3.0,
                hot_water_in_pressure: 2.5
            };
            expect(calculateBuildingStatus(metrics)).toBe('critical');
        });

        test('returns "warning" when phase 1 voltage is too low', () => {
            const metrics = {
                electricity_ph1: 200, // below 210
                electricity_ph2: 220,
                electricity_ph3: 220,
                cold_water_pressure: 3.0,
                hot_water_in_pressure: 2.5
            };
            expect(calculateBuildingStatus(metrics)).toBe('warning');
        });

        test('returns "warning" when phase 2 voltage is too high', () => {
            const metrics = {
                electricity_ph1: 220,
                electricity_ph2: 240, // above 230
                electricity_ph3: 220,
                cold_water_pressure: 3.0,
                hot_water_in_pressure: 2.5
            };
            expect(calculateBuildingStatus(metrics)).toBe('warning');
        });

        test('returns "warning" when cold water pressure is zero', () => {
            const metrics = {
                electricity_ph1: 220,
                electricity_ph2: 220,
                electricity_ph3: 220,
                cold_water_pressure: 0,
                hot_water_in_pressure: 2.5
            };
            expect(calculateBuildingStatus(metrics)).toBe('warning');
        });

        test('returns "warning" when hot water pressure is zero', () => {
            const metrics = {
                electricity_ph1: 220,
                electricity_ph2: 220,
                electricity_ph3: 220,
                cold_water_pressure: 3.0,
                hot_water_in_pressure: 0
            };
            expect(calculateBuildingStatus(metrics)).toBe('warning');
        });

        test('returns "ok" at voltage boundary values (210 and 230)', () => {
            const metrics = {
                electricity_ph1: 210,
                electricity_ph2: 230,
                electricity_ph3: 215,
                cold_water_pressure: 1.0,
                hot_water_in_pressure: 0.5
            };
            expect(calculateBuildingStatus(metrics)).toBe('ok');
        });

        test('returns "warning" when phase 3 is out of range', () => {
            const metrics = {
                electricity_ph1: 220,
                electricity_ph2: 220,
                electricity_ph3: 209, // just below 210
                cold_water_pressure: 3.0,
                hot_water_in_pressure: 2.5
            };
            expect(calculateBuildingStatus(metrics)).toBe('warning');
        });

        test('critical check takes priority when all phases are zero regardless of water', () => {
            const metrics = {
                electricity_ph1: 0,
                electricity_ph2: 0,
                electricity_ph3: 0,
                cold_water_pressure: 0,
                hot_water_in_pressure: 0
            };
            expect(calculateBuildingStatus(metrics)).toBe('critical');
        });
    });
});
