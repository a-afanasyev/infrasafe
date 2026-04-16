'use strict';

const axios = require('axios');
const IntegrationConfig = require('../models/IntegrationConfig');
const { validateUKApiUrl } = require('../utils/urlValidation');
const logger = require('../utils/logger');

const TOKEN_CACHE_TTL_MS = 25 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10000;
const MAX_RETRIES = 3;
const BACKOFF_BASE_MS = 1000;

class UKApiClient {
    constructor() {
        this._token = null;
        this._tokenExpiresAt = 0;
        // Phase 11.4 (ARCH-110): dedup concurrent auth attempts. Under a
        // burst of cached-alert-forwarding, N parallel callers previously
        // fired N /auth/login requests. We now share one promise until it
        // settles; all callers await the same in-flight auth.
        this._authPromise = null;
    }

    async authenticate() {
        if (this._token && Date.now() < this._tokenExpiresAt) {
            return this._token;
        }
        if (this._authPromise) {
            return this._authPromise;
        }

        this._authPromise = this._doAuthenticate()
            .finally(() => { this._authPromise = null; });
        return this._authPromise;
    }

    async _doAuthenticate() {
        const apiUrl = await IntegrationConfig.get('uk_api_url');
        validateUKApiUrl(apiUrl);
        const username = process.env.UK_SERVICE_USER;
        const password = process.env.UK_SERVICE_PASSWORD;

        if (!apiUrl || !username || !password) {
            throw new Error('UK API credentials not configured (uk_api_url in DB + UK_SERVICE_USER/UK_SERVICE_PASSWORD env vars)');
        }

        const response = await axios.post(
            `${apiUrl}/auth/login`,
            { username, password },
            { timeout: REQUEST_TIMEOUT_MS }
        );

        this._token = response.data.token;
        this._tokenExpiresAt = Date.now() + TOKEN_CACHE_TTL_MS;

        logger.info('ukApiClient: authenticated with UK API');
        return this._token;
    }

    clearToken() {
        this._token = null;
        this._tokenExpiresAt = 0;
        this._authPromise = null;
    }

    async createRequest(data) {
        const token = await this.authenticate();
        const apiUrl = await IntegrationConfig.get('uk_api_url');
        validateUKApiUrl(apiUrl);

        let lastError;

        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
            try {
                const response = await axios.post(
                    `${apiUrl}/requests/create`,
                    {
                        building_external_id: data.building_external_id,
                        category: data.category,
                        urgency: data.urgency,
                        description: data.description,
                        idempotency_key: data.idempotency_key
                    },
                    {
                        headers: {
                            Authorization: `Bearer ${token}`,
                            'Content-Type': 'application/json',
                            'Idempotency-Key': data.idempotency_key
                        },
                        timeout: REQUEST_TIMEOUT_MS
                    }
                );

                logger.info(`ukApiClient: created UK request ${response.data.request_number} (attempt ${attempt + 1})`);
                return response.data;
            } catch (error) {
                lastError = error;
                logger.warn(`ukApiClient.createRequest attempt ${attempt + 1}/${MAX_RETRIES} failed: ${error.message}`);

                if (error.response && error.response.status === 401) {
                    this.clearToken();
                }

                if (attempt < MAX_RETRIES - 1) {
                    const delay = BACKOFF_BASE_MS * Math.pow(2, attempt); // 1s, 2s, 4s
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }

        throw lastError;
    }

    async get(path) {
        let token = await this.authenticate();
        const apiUrl = await IntegrationConfig.get('uk_api_url');
        validateUKApiUrl(apiUrl);

        try {
            const response = await axios.get(`${apiUrl}${path}`, {
                headers: { Authorization: `Bearer ${token}` },
                timeout: REQUEST_TIMEOUT_MS
            });
            return response.data;
        } catch (error) {
            // On 401, clear token and retry once with fresh auth
            if (error.response && error.response.status === 401) {
                this.clearToken();
                token = await this.authenticate();
                const response = await axios.get(`${apiUrl}${path}`, {
                    headers: { Authorization: `Bearer ${token}` },
                    timeout: REQUEST_TIMEOUT_MS
                });
                return response.data;
            }
            throw error;
        }
    }
}

module.exports = new UKApiClient();
