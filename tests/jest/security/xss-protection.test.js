/**
 * Тесты защиты от XSS атак
 * 
 * Этот набор тестов проверяет, что исправления T013 работают корректно
 * и система защищена от XSS через innerHTML и другие векторы атак.
 * 
 * @author Security Team
 * @date 2025-10-19
 */

const fs = require('fs');
const path = require('path');

describe('XSS Protection Tests', () => {
    describe('DOMSecurity Utility', () => {
        // Проверка наличия и корректности domSecurity.js
        
        test('domSecurity.js should exist', () => {
            const filePath = path.join(__dirname, '../../../public/utils/domSecurity.js');
            expect(fs.existsSync(filePath)).toBe(true);
        });
        
        test('domSecurity.js should export all required functions', () => {
            const content = fs.readFileSync(
                path.join(__dirname, '../../../public/utils/domSecurity.js'),
                'utf8'
            );
            
            expect(content).toContain('setSecureText');
            expect(content).toContain('setSecureHTML');
            expect(content).toContain('showSecureErrorMessage');
            expect(content).toContain('showSecureSuccessMessage');
            expect(content).toContain('clearContainer');
            expect(content).toContain('createSecureTableRow');
            expect(content).toContain('escapeHTML');
        });
        
        test('domSecurity.js should reference DOMPurify', () => {
            const content = fs.readFileSync(
                path.join(__dirname, '../../../public/utils/domSecurity.js'),
                'utf8'
            );
            
            expect(content).toContain('DOMPurify');
        });
    });
    
    describe('innerHTML Usage Audit', () => {
        // Проверка что innerHTML используется только в безопасных местах
        
        const criticalFiles = [
            { path: 'public/admin.js', maxUnsafe: 16 }, // Baseline после T013, цель: уменьшить до 10
            { path: 'public/script.js', maxUnsafe: 15 }, // Baseline после T013
            { path: 'public/map-layers-control.js', maxUnsafe: 5 } // Baseline после T013
        ];
        
        criticalFiles.forEach(({ path: file, maxUnsafe }) => {
            test(`${file} should have minimal unsafe innerHTML usage (max ${maxUnsafe})`, () => {
                const content = fs.readFileSync(
                    path.join(__dirname, '../../../', file),
                    'utf8'
                );
                
                // Подсчитываем innerHTML
                const innerHTMLMatches = content.match(/\.innerHTML\s*=/g) || [];
                const safeComments = content.match(/ИСПРАВЛЕНИЕ XSS|DOMPurify|DOMSecurity/g) || [];
                
                // Проверяем что количество innerHTML не превышает лимит
                expect(innerHTMLMatches.length).toBeLessThanOrEqual(maxUnsafe);
                
                // Проверяем что есть комментарии о безопасности
                expect(safeComments.length).toBeGreaterThan(0);
            });
        });
        
        test('map-layers-control.js should not have inline event handlers', () => {
            const content = fs.readFileSync(
                path.join(__dirname, '../../../public/map-layers-control.js'),
                'utf8'
            );
            
            // Проверяем отсутствие inline onclick/onchange в innerHTML
            const dangerousPatterns = [
                /innerHTML\s*=\s*['"`].*onclick/gi,
                /innerHTML\s*=\s*['"`].*onchange/gi,
                /innerHTML\s*=\s*['"`].*onerror/gi,
                /innerHTML\s*=\s*['"`].*onload/gi
            ];
            
            dangerousPatterns.forEach(pattern => {
                const matches = content.match(pattern);
                expect(matches).toBeNull();
            });
        });
    });
    
    describe('DOMPurify Integration', () => {
        // Проверка подключения DOMPurify
        
        const htmlFiles = [
            'index.html',
            'admin.html',
            'public/login.html'
        ];
        
        htmlFiles.forEach(file => {
            test(`${file} should include DOMPurify`, () => {
                const content = fs.readFileSync(
                    path.join(__dirname, '../../../', file),
                    'utf8'
                );
                
                expect(content).toMatch(/dompurify|DOMPurify/i);
            });
            
            test(`${file} should include domSecurity.js`, () => {
                const content = fs.readFileSync(
                    path.join(__dirname, '../../../', file),
                    'utf8'
                );
                
                expect(content).toContain('domSecurity.js');
            });
        });
    });
    
    describe('CSP Headers', () => {
        // Проверка CSP заголовков в nginx конфигурации
        
        test('nginx.dev.conf should have CSP headers', () => {
            const content = fs.readFileSync(
                path.join(__dirname, '../../../nginx.dev.conf'),
                'utf8'
            );
            
            expect(content).toContain('Content-Security-Policy');
            expect(content).toContain('X-Content-Type-Options');
            expect(content).toContain('X-Frame-Options');
            expect(content).toContain('X-XSS-Protection');
        });
        
        test('nginx.conf should have CSP headers', () => {
            const content = fs.readFileSync(
                path.join(__dirname, '../../../nginx.conf'),
                'utf8'
            );
            
            expect(content).toContain('Content-Security-Policy');
            expect(content).toContain('X-Content-Type-Options');
            expect(content).toContain('X-Frame-Options');
            expect(content).toContain('Strict-Transport-Security');
        });
        
        test('CSP should restrict script sources', () => {
            const content = fs.readFileSync(
                path.join(__dirname, '../../../nginx.conf'),
                'utf8'
            );
            
            // Проверяем что CSP ограничивает источники скриптов
            expect(content).toMatch(/script-src[^;]*'self'/);
        });
        
        test('CSP should prevent framing attacks', () => {
            const content = fs.readFileSync(
                path.join(__dirname, '../../../nginx.conf'),
                'utf8'
            );
            
            // Проверяем наличие frame-ancestors в CSP
            expect(content).toMatch(/frame-ancestors/);
        });
    });
    
    describe('Secure DOM Methods', () => {
        // Проверка использования безопасных методов
        
        test('script.js should use textContent for simple text', () => {
            const content = fs.readFileSync(
                path.join(__dirname, '../../../public/script.js'),
                'utf8'
            );
            
            // Проверяем наличие textContent использований
            const textContentMatches = content.match(/\.textContent\s*=/g) || [];
            expect(textContentMatches.length).toBeGreaterThan(5);
        });
        
        test('admin.js should use createElement for DOM building', () => {
            const content = fs.readFileSync(
                path.join(__dirname, '../../../public/admin.js'),
                'utf8'
            );
            
            // Проверяем использование createElement
            const createElementMatches = content.match(/document\.createElement/g) || [];
            expect(createElementMatches.length).toBeGreaterThan(10);
        });
        
        test('map-layers-control.js should use addEventListener instead of inline handlers', () => {
            const content = fs.readFileSync(
                path.join(__dirname, '../../../public/map-layers-control.js'),
                'utf8'
            );
            
            // Проверяем использование addEventListener
            const addEventListenerMatches = content.match(/addEventListener/g) || [];
            expect(addEventListenerMatches.length).toBeGreaterThan(3);
        });
    });
    
    describe('XSS Prevention Patterns', () => {
        // Проверка общих паттернов предотвращения XSS
        
        test('No eval() usage in critical files', () => {
            const criticalFiles = [
                'public/admin.js',
                'public/script.js',
                'public/map-layers-control.js'
            ];
            
            criticalFiles.forEach(file => {
                const content = fs.readFileSync(
                    path.join(__dirname, '../../../', file),
                    'utf8'
                );
                
                // Проверяем отсутствие eval()
                expect(content).not.toMatch(/\beval\s*\(/);
            });
        });
        
        test('No document.write() usage', () => {
            const criticalFiles = [
                'public/admin.js',
                'public/script.js',
                'public/map-layers-control.js'
            ];
            
            criticalFiles.forEach(file => {
                const content = fs.readFileSync(
                    path.join(__dirname, '../../../', file),
                    'utf8'
                );
                
                // Проверяем отсутствие document.write()
                expect(content).not.toMatch(/document\.write\s*\(/);
            });
        });
        
        test('login.html should use safe DOM methods for error messages', () => {
            const content = fs.readFileSync(
                path.join(__dirname, '../../../public/login.html'),
                'utf8'
            );

            // Проверяем использование безопасных методов (textContent или DOMSecurity)
            const usesSafeDOM = content.includes('textContent') || content.includes('DOMSecurity.showSecureErrorMessage');
            expect(usesSafeDOM).toBe(true);
            // Не должно быть innerHTML для пользовательских данных
            expect(content).not.toMatch(/innerHTML\s*=\s*[^'"`]*message/);
        });
    });
    
    describe('Code Comments and Documentation', () => {
        // Проверка наличия комментариев о безопасности
        
        test('Modified files should have XSS fix comments', () => {
            const modifiedFiles = [
                'public/map-layers-control.js',
                'public/script.js'
            ];
            
            modifiedFiles.forEach(file => {
                const content = fs.readFileSync(
                    path.join(__dirname, '../../../', file),
                    'utf8'
                );
                
                // Проверяем наличие комментариев об исправлении XSS
                expect(content).toMatch(/ИСПРАВЛЕНИЕ XSS/);
            });
        });
    });
});

