'use strict';

// [R2-37] The logger writes to stdout (Console) plus two DailyRotateFile
// transports. In a 12-factor deployment where an aggregator already collects the
// container's stdout, the file transports are redundant double-storage. A
// LOG_CONSOLE_ONLY env flag drops the file transports. Default (unset) must keep
// the historical console + 2-file behaviour so single-host prod is unchanged.
describe('logger transports (R2-37 LOG_CONSOLE_ONLY)', () => {
    const ORIGINAL = process.env.LOG_CONSOLE_ONLY;

    afterEach(() => {
        if (ORIGINAL === undefined) {
            delete process.env.LOG_CONSOLE_ONLY;
        } else {
            process.env.LOG_CONSOLE_ONLY = ORIGINAL;
        }
        jest.resetModules();
    });

    function loadLogger() {
        let logger;
        jest.isolateModules(() => {
            logger = require('../../../src/utils/logger');
        });
        return logger;
    }

    it('defaults to console + 2 rotating file transports when LOG_CONSOLE_ONLY is unset', () => {
        delete process.env.LOG_CONSOLE_ONLY;
        expect(loadLogger().transports).toHaveLength(3);
    });

    it('uses console-only when LOG_CONSOLE_ONLY=true', () => {
        process.env.LOG_CONSOLE_ONLY = 'true';
        const logger = loadLogger();
        expect(logger.transports).toHaveLength(1);
        // winston's Console transport self-identifies as name 'console' (checked
        // via name, not instanceof — jest.isolateModules gives the logger its own
        // winston copy, so a cross-registry instanceof would spuriously fail).
        expect(logger.transports[0].name).toBe('console');
    });

    it('accepts "1" as truthy', () => {
        process.env.LOG_CONSOLE_ONLY = '1';
        expect(loadLogger().transports).toHaveLength(1);
    });

    it('is case-insensitive (TRUE)', () => {
        process.env.LOG_CONSOLE_ONLY = 'TRUE';
        expect(loadLogger().transports).toHaveLength(1);
    });

    it('treats any other value as false (file transports stay on)', () => {
        process.env.LOG_CONSOLE_ONLY = 'no';
        expect(loadLogger().transports).toHaveLength(3);
    });
});
