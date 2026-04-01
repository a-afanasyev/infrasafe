jest.mock('../../../src/utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
}));

const { CircuitBreaker, CircuitBreakerFactory } = require('../../../src/utils/circuitBreaker');

describe('CircuitBreaker', () => {
    let breaker;

    afterEach(() => {
        if (breaker) {
            breaker.destroy();
            breaker = null;
        }
    });

    describe('constructor', () => {
        test('initializes with default options', () => {
            breaker = new CircuitBreaker();
            expect(breaker.state).toBe('CLOSED');
            expect(breaker.failureThreshold).toBe(5);
            expect(breaker.resetTimeout).toBe(60000);
            expect(breaker.failureCount).toBe(0);
            expect(breaker.successCount).toBe(0);
            expect(breaker.name).toBe('Circuit Breaker');
        });

        test('initializes with custom options', () => {
            breaker = new CircuitBreaker({
                failureThreshold: 3,
                resetTimeout: 5000,
                monitoringInterval: 2000,
                name: 'Test Breaker'
            });
            expect(breaker.failureThreshold).toBe(3);
            expect(breaker.resetTimeout).toBe(5000);
            expect(breaker.monitoringInterval).toBe(2000);
            expect(breaker.name).toBe('Test Breaker');
        });
    });

    describe('execute - CLOSED state', () => {
        beforeEach(() => {
            breaker = new CircuitBreaker({ failureThreshold: 3, resetTimeout: 100 });
        });

        test('executes operation successfully in CLOSED state', async () => {
            const result = await breaker.execute(() => Promise.resolve('success'));
            expect(result).toBe('success');
            expect(breaker.state).toBe('CLOSED');
            expect(breaker.stats.successfulRequests).toBe(1);
            expect(breaker.stats.totalRequests).toBe(1);
        });

        test('increments failure count on error', async () => {
            await expect(
                breaker.execute(() => Promise.reject(new Error('fail')))
            ).rejects.toThrow('fail');
            expect(breaker.failureCount).toBe(1);
            expect(breaker.stats.failedRequests).toBe(1);
        });

        test('stays CLOSED when failures below threshold', async () => {
            for (let i = 0; i < 2; i++) {
                await breaker.execute(() => Promise.reject(new Error('fail'))).catch(() => {});
            }
            expect(breaker.state).toBe('CLOSED');
            expect(breaker.failureCount).toBe(2);
        });
    });

    describe('state transition: CLOSED -> OPEN', () => {
        beforeEach(() => {
            breaker = new CircuitBreaker({ failureThreshold: 3, resetTimeout: 100 });
        });

        test('opens circuit after reaching failure threshold', async () => {
            for (let i = 0; i < 3; i++) {
                await breaker.execute(() => Promise.reject(new Error('fail'))).catch(() => {});
            }
            expect(breaker.state).toBe('OPEN');
            expect(breaker.stats.circuitOpened).toBe(1);
        });

        test('resets failure count on success', async () => {
            await breaker.execute(() => Promise.reject(new Error('fail'))).catch(() => {});
            await breaker.execute(() => Promise.reject(new Error('fail'))).catch(() => {});
            await breaker.execute(() => Promise.resolve('ok'));
            expect(breaker.failureCount).toBe(0);
            // Now 2 more failures should not open circuit since counter was reset
            await breaker.execute(() => Promise.reject(new Error('fail'))).catch(() => {});
            await breaker.execute(() => Promise.reject(new Error('fail'))).catch(() => {});
            expect(breaker.state).toBe('CLOSED');
        });
    });

    describe('OPEN state behavior', () => {
        beforeEach(() => {
            breaker = new CircuitBreaker({ failureThreshold: 2, resetTimeout: 200 });
        });

        test('throws error immediately when circuit is OPEN and timeout not elapsed', async () => {
            // Open the circuit
            await breaker.execute(() => Promise.reject(new Error('fail'))).catch(() => {});
            await breaker.execute(() => Promise.reject(new Error('fail'))).catch(() => {});
            expect(breaker.state).toBe('OPEN');

            await expect(
                breaker.execute(() => Promise.resolve('should not run'))
            ).rejects.toThrow('Сервис временно недоступен');
        });

        test('uses fallback when circuit is OPEN', async () => {
            await breaker.execute(() => Promise.reject(new Error('fail'))).catch(() => {});
            await breaker.execute(() => Promise.reject(new Error('fail'))).catch(() => {});
            expect(breaker.state).toBe('OPEN');

            const result = await breaker.execute(
                () => Promise.resolve('should not run'),
                () => Promise.resolve('fallback-result')
            );
            expect(result).toBe('fallback-result');
        });

        test('throws when OPEN, fallback fails, and timeout not elapsed', async () => {
            await breaker.execute(() => Promise.reject(new Error('fail'))).catch(() => {});
            await breaker.execute(() => Promise.reject(new Error('fail'))).catch(() => {});

            await expect(
                breaker.execute(
                    () => Promise.resolve('x'),
                    () => Promise.reject(new Error('fallback-fail'))
                )
            ).rejects.toThrow('Сервис временно недоступен');
        });
    });

    describe('state transition: OPEN -> HALF_OPEN', () => {
        test('transitions to HALF_OPEN after resetTimeout', async () => {
            breaker = new CircuitBreaker({ failureThreshold: 2, resetTimeout: 50 });

            // Open the circuit
            await breaker.execute(() => Promise.reject(new Error('fail'))).catch(() => {});
            await breaker.execute(() => Promise.reject(new Error('fail'))).catch(() => {});
            expect(breaker.state).toBe('OPEN');

            // Wait for reset timeout
            await new Promise(r => setTimeout(r, 60));

            // Next execute should transition to HALF_OPEN and try the operation
            const result = await breaker.execute(() => Promise.resolve('half-open-success'));
            expect(result).toBe('half-open-success');
            // After 1 success in HALF_OPEN, needs 3 total to close
            expect(breaker.state).toBe('HALF_OPEN');
        });
    });

    describe('state transition: HALF_OPEN -> CLOSED', () => {
        test('closes circuit after 3 consecutive successes in HALF_OPEN', async () => {
            breaker = new CircuitBreaker({ failureThreshold: 2, resetTimeout: 50 });

            // Open the circuit
            await breaker.execute(() => Promise.reject(new Error('fail'))).catch(() => {});
            await breaker.execute(() => Promise.reject(new Error('fail'))).catch(() => {});

            // Wait for reset timeout
            await new Promise(r => setTimeout(r, 60));

            // 3 successes needed to close from HALF_OPEN
            await breaker.execute(() => Promise.resolve('ok'));
            expect(breaker.state).toBe('HALF_OPEN');
            await breaker.execute(() => Promise.resolve('ok'));
            expect(breaker.state).toBe('HALF_OPEN');
            await breaker.execute(() => Promise.resolve('ok'));
            expect(breaker.state).toBe('CLOSED');
            expect(breaker.stats.circuitClosed).toBeGreaterThanOrEqual(1);
        });
    });

    describe('state transition: HALF_OPEN -> OPEN', () => {
        test('re-opens circuit on failure in HALF_OPEN state', async () => {
            breaker = new CircuitBreaker({ failureThreshold: 2, resetTimeout: 50 });

            // Open the circuit
            await breaker.execute(() => Promise.reject(new Error('fail'))).catch(() => {});
            await breaker.execute(() => Promise.reject(new Error('fail'))).catch(() => {});

            // Wait for reset timeout
            await new Promise(r => setTimeout(r, 60));

            // Transition to HALF_OPEN with first attempt, then fail
            await breaker.execute(() => Promise.resolve('ok')); // moves to HALF_OPEN
            expect(breaker.state).toBe('HALF_OPEN');

            await expect(
                breaker.execute(() => Promise.reject(new Error('fail-again')))
            ).rejects.toThrow('fail-again');
            expect(breaker.state).toBe('OPEN');
        });

        test('uses fallback when operation fails in HALF_OPEN state', async () => {
            breaker = new CircuitBreaker({ failureThreshold: 2, resetTimeout: 50 });

            await breaker.execute(() => Promise.reject(new Error('fail'))).catch(() => {});
            await breaker.execute(() => Promise.reject(new Error('fail'))).catch(() => {});

            await new Promise(r => setTimeout(r, 60));

            // Move to HALF_OPEN
            await breaker.execute(() => Promise.resolve('ok'));
            expect(breaker.state).toBe('HALF_OPEN');

            // Failure in HALF_OPEN with fallback
            const result = await breaker.execute(
                () => Promise.reject(new Error('half-open-fail')),
                () => Promise.resolve('fallback-in-half-open')
            );
            expect(result).toBe('fallback-in-half-open');
            expect(breaker.state).toBe('OPEN');
        });
    });

    describe('reset', () => {
        test('resets state to CLOSED and clears counters', async () => {
            breaker = new CircuitBreaker({ failureThreshold: 2, resetTimeout: 60000 });

            await breaker.execute(() => Promise.reject(new Error('fail'))).catch(() => {});
            await breaker.execute(() => Promise.reject(new Error('fail'))).catch(() => {});
            expect(breaker.state).toBe('OPEN');

            breaker.reset();
            expect(breaker.state).toBe('CLOSED');
            expect(breaker.failureCount).toBe(0);
            expect(breaker.successCount).toBe(0);
            expect(breaker.lastFailureTime).toBeNull();
        });
    });

    describe('getState', () => {
        test('returns comprehensive state object', () => {
            breaker = new CircuitBreaker({ name: 'TestBreaker' });
            const state = breaker.getState();
            expect(state).toHaveProperty('state', 'CLOSED');
            expect(state).toHaveProperty('failureCount', 0);
            expect(state).toHaveProperty('successCount', 0);
            expect(state).toHaveProperty('lastFailureTime', null);
            expect(state).toHaveProperty('nextAttempt');
            expect(state).toHaveProperty('timeUntilRetry');
            expect(state).toHaveProperty('stats');
            expect(state.stats).toHaveProperty('totalRequests', 0);
        });
    });

    describe('isAvailable', () => {
        test('returns true when CLOSED', () => {
            breaker = new CircuitBreaker();
            expect(breaker.isAvailable()).toBe(true);
        });

        test('returns false when OPEN and timeout not elapsed', () => {
            breaker = new CircuitBreaker({ failureThreshold: 1, resetTimeout: 60000 });
            breaker.state = 'OPEN';
            breaker.nextAttempt = Date.now() + 60000;
            expect(breaker.isAvailable()).toBe(false);
        });

        test('returns true when OPEN but timeout elapsed', () => {
            breaker = new CircuitBreaker();
            breaker.state = 'OPEN';
            breaker.nextAttempt = Date.now() - 1;
            expect(breaker.isAvailable()).toBe(true);
        });

        test('returns true when HALF_OPEN', () => {
            breaker = new CircuitBreaker();
            breaker.state = 'HALF_OPEN';
            expect(breaker.isAvailable()).toBe(true);
        });
    });

    describe('setFailureThreshold', () => {
        test('updates failureThreshold', () => {
            breaker = new CircuitBreaker();
            breaker.setFailureThreshold(10);
            expect(breaker.failureThreshold).toBe(10);
        });
    });

    describe('setResetTimeout', () => {
        test('updates resetTimeout', () => {
            breaker = new CircuitBreaker();
            breaker.setResetTimeout(120000);
            expect(breaker.resetTimeout).toBe(120000);
        });
    });

    describe('destroy', () => {
        test('clears monitoring timer', () => {
            breaker = new CircuitBreaker();
            expect(breaker.monitoringTimer).toBeTruthy();
            breaker.destroy();
            expect(breaker.monitoringTimer).toBeNull();
        });

        test('is safe to call multiple times', () => {
            breaker = new CircuitBreaker();
            breaker.destroy();
            breaker.destroy(); // should not throw
            expect(breaker.monitoringTimer).toBeNull();
        });
    });
});

describe('CircuitBreakerFactory', () => {
    const breakers = [];
    afterEach(() => {
        breakers.forEach(b => b.destroy());
        breakers.length = 0;
    });

    test('createAnalyticsBreaker returns breaker with analytics settings', () => {
        const b = CircuitBreakerFactory.createAnalyticsBreaker();
        breakers.push(b);
        expect(b.name).toBe('Analytics');
        expect(b.failureThreshold).toBe(3);
        expect(b.resetTimeout).toBe(30000);
    });

    test('createAnalyticsBreaker accepts custom name', () => {
        const b = CircuitBreakerFactory.createAnalyticsBreaker('CustomAnalytics');
        breakers.push(b);
        expect(b.name).toBe('CustomAnalytics');
    });

    test('createDatabaseBreaker returns breaker with DB settings', () => {
        const b = CircuitBreakerFactory.createDatabaseBreaker();
        breakers.push(b);
        expect(b.name).toBe('Database');
        expect(b.failureThreshold).toBe(5);
        expect(b.resetTimeout).toBe(60000);
    });

    test('createExternalServiceBreaker returns breaker with external settings', () => {
        const b = CircuitBreakerFactory.createExternalServiceBreaker();
        breakers.push(b);
        expect(b.name).toBe('External Service');
        expect(b.failureThreshold).toBe(2);
        expect(b.resetTimeout).toBe(120000);
    });
});
