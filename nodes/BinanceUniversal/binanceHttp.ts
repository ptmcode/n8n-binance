/**
 * Binance HTTP request + HMAC signing helpers.
 *
 * This module provides:
 *  - HMAC SHA256 signing
 *  - Parameter encoding
 *  - Full request execution via n8n's httpRequest helper
 */

import * as crypto from 'crypto';
import type {
    IExecuteFunctions,
    IHttpRequestOptions,
    IHttpRequestMethods,
} from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';

export type SecurityType = 'NONE' | 'API_KEY' | 'SIGNED';

export interface BinanceRequestOptions {
    baseUrl: string;
    method: IHttpRequestMethods;
    path: string;
    security: SecurityType;
    params: Record<string, any>;
    body?: Record<string, any> | string;
    sendAsJson?: boolean;
    apiKey?: string;
    apiSecret?: string;
    recvWindow?: number;
    apiGroup?: string;
    category?: string;
}

/**
 * Encode params into a query string suitable for Binance signing.
 * Filters out undefined/null/'' values.
 * Handles array of primitives by repeating the key (e.g. asset=BTC&asset=USDT).
 * Handles array of objects by flattening with dot notation (e.g. orderArgs[0].symbol=BTCUSDT).
 * Note: We manually build the string to avoid URLSearchParams encoding brackets,
 * which would break Binance's signature verification.
 */
export function encodeParams(params: Record<string, any>): string {
    const parts: string[] = [];
    for (const [key, value] of Object.entries(params)) {
        if (value === undefined || value === null || value === '') continue;
        if (Array.isArray(value)) {
            for (let i = 0; i < value.length; i++) {
                const item = value[i];
                if (item !== null && typeof item === 'object') {
                    // Flatten object entries with dot notation: orderArgs[0].symbol=BTCUSDT
                    for (const [subKey, subVal] of Object.entries(item)) {
                        if (subVal === undefined || subVal === null || subVal === '') continue;
                        parts.push(`${key}[${i}].${subKey}=${encodeURIComponent(String(subVal))}`);
                    }
                } else {
                    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(item))}`);
                }
            }
        } else {
            parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
        }
    }
    return parts.join('&');
}

/**
 * Compute HMAC SHA256 signature.
 */
export function signHmac(secret: string, payload: string): string {
    return crypto
        .createHmac('sha256', secret)
        .update(payload)
        .digest('hex');
}

/**
 * Build a signed query/body string from params.
 * Adds timestamp if not present (for SIGNED requests).
 * Appends computed signature.
 */
export function buildSignedPayload(
    params: Record<string, any>,
    secret: string,
    recvWindow?: number,
): { signedString: string; allParams: Record<string, any> } {
    const allParams = { ...params };

    // Add timestamp if missing
    if (!allParams.timestamp) {
        allParams.timestamp = Date.now();
    }

    // Add recvWindow if provided and not already set
    if (recvWindow && !allParams.recvWindow) {
        allParams.recvWindow = recvWindow;
    }

    const payload = encodeParams(allParams);
    const signature = signHmac(secret, payload);
    allParams.signature = signature;

    const signedString = payload + '&signature=' + signature;
    return { signedString, allParams };
}

/**
 * Generate a random request ID for tracking.
 */
function generateRequestId(): string {
    return crypto.randomBytes(8).toString('hex');
}

/**
 * Execute a Binance REST request using n8n's built-in HTTP helper.
 *
 * Handles:
 *  - API key header injection
 *  - HMAC signing for SIGNED endpoints
 *  - Proper Content-Type for POST/PUT/DELETE
 *  - Error parsing from Binance error JSON
 */
export async function executeBinanceRequest(
    context: IExecuteFunctions,
    options: BinanceRequestOptions,
): Promise<{
    data: any;
    meta: {
        apiGroup: string;
        category?: string;
        method: string;
        path: string;
        baseUrl: string;
        requestId: string;
        queryString?: Record<string, any>;
        rateLimits?: Record<string, string>;
    };
}> {
    const requestId = generateRequestId();
    const { baseUrl, method, path, security, sendAsJson, apiKey, apiSecret, recvWindow, apiGroup: passedApiGroup, category } = options;
    let { params, body } = options;

    // Validate API key presence for secured endpoints
    if ((security === 'API_KEY' || security === 'SIGNED') && !apiKey) {
        throw new NodeApiError(context.getNode(), {
            message: 'API Key is required for this endpoint',
            description: `Endpoint ${method} ${path} requires an API key. Provide it via the apiKey parameter.`,
        } as any);
    }

    if (security === 'SIGNED' && !apiSecret) {
        throw new NodeApiError(context.getNode(), {
            message: 'API Secret is required for SIGNED endpoints',
            description: `Endpoint ${method} ${path} requires HMAC signing. Provide the apiSecret parameter.`,
        } as any);
    }

    // Build headers
    const headers: Record<string, string> = {};
    if (security === 'API_KEY' || security === 'SIGNED') {
        headers['X-MBX-APIKEY'] = apiKey!;
    }

    // Build URL and body
    const url = baseUrl + path;
    let fullUrl = url;
    let requestBody: string | undefined;

    if (method === 'GET') {
        // For GET, all params go as query string
        if (security === 'SIGNED') {
            const { signedString } = buildSignedPayload(params, apiSecret!, recvWindow);
            fullUrl = url + '?' + signedString;
        } else {
            const qs = encodeParams(params);
            if (qs) fullUrl = url + '?' + qs;
        }
    } else {
        // POST/PUT/DELETE
        if (security === 'SIGNED') {
            // Merge body params into params for signing
            const allParams = { ...params };
            if (body && typeof body === 'object') {
                Object.assign(allParams, body);
            }
            const { signedString } = buildSignedPayload(allParams, apiSecret!, recvWindow);

            if (sendAsJson) {
                // For JSON body, put signed params in query string
                fullUrl = url + '?' + signedString;
                headers['Content-Type'] = 'application/json';
                requestBody = typeof body === 'string' ? body : JSON.stringify(body || {});
            } else {
                // Binance SAPI/FAPI endpoints expect signed params in the query string for POST/DELETE
                // (same as GET). Sending them in the body causes -1022 signature errors.
                fullUrl = url + '?' + signedString;
            }
        } else {
            // Non-signed POST/PUT/DELETE
            if (sendAsJson) {
                headers['Content-Type'] = 'application/json';
                const allParams = { ...params };
                if (body && typeof body === 'object') Object.assign(allParams, body);
                requestBody = JSON.stringify(allParams);
            } else {
                headers['Content-Type'] = 'application/x-www-form-urlencoded';
                const allParams = { ...params };
                if (body && typeof body === 'object') Object.assign(allParams, body);
                requestBody = encodeParams(allParams);
            }
        }
    }

    // Build n8n request options
    const httpOptions: IHttpRequestOptions = {
        method,
        url: fullUrl,
        headers,
        returnFullResponse: true,
        ignoreHttpStatusErrors: true,
        json: false,
    };

    if (requestBody !== undefined && method !== 'GET') {
        httpOptions.body = requestBody;
    }

    try {
        const response = await context.helpers.httpRequest(httpOptions);

        // Parse response
        let responseData: any;
        let responseHeaders: Record<string, string> = {};
        let statusCode: number;

        if (typeof response === 'object' && response !== null && 'statusCode' in response) {
            // Full response object
            statusCode = (response as any).statusCode;
            responseHeaders = (response as any).headers || {};
            const rawBody = (response as any).body;

            if (typeof rawBody === 'string') {
                try {
                    responseData = JSON.parse(rawBody);
                } catch {
                    responseData = rawBody;
                }
            } else {
                responseData = rawBody;
            }
        } else {
            // Direct response (shouldn't happen with returnFullResponse)
            if (typeof response === 'string') {
                try {
                    responseData = JSON.parse(response);
                } catch {
                    responseData = response;
                }
            } else {
                responseData = response;
            }
            statusCode = 200;
        }

        // Check for Binance error response
        if (
            responseData &&
            typeof responseData === 'object' &&
            'code' in responseData &&
            'msg' in responseData &&
            responseData.code < 0
        ) {
            throw new NodeApiError(context.getNode(), {
                message: `Binance API Error ${responseData.code}: ${responseData.msg}`,
                description: `Request: ${method} ${path}\nError Code: ${responseData.code}\nMessage: ${responseData.msg}`,
            } as any, {
                httpCode: String(statusCode),
            });
        }

        if (statusCode >= 400) {
            const errMsg = responseData?.msg || responseData?.message || 'Unknown error';
            const errCode = responseData?.code || statusCode;
            throw new NodeApiError(context.getNode(), {
                message: `Binance API Error (HTTP ${statusCode}): ${errMsg}`,
                description: `Request: ${method} ${path}\nHTTP Status: ${statusCode}\nError Code: ${errCode}\nMessage: ${errMsg}`,
            } as any, {
                httpCode: String(statusCode),
            });
        }

        // Extract rate limit headers
        const rateLimits: Record<string, string> = {};
        for (const [key, value] of Object.entries(responseHeaders)) {
            const lk = key.toLowerCase();
            if (
                lk.startsWith('x-mbx-used-weight') ||
                lk.startsWith('x-mbx-order-count') ||
                lk.startsWith('x-sapi-used') ||
                lk === 'retry-after'
            ) {
                rateLimits[key] = String(value);
            }
        }

        // Determine apiGroup: use the explicitly passed value, fall back to path-based heuristic
        const resolvedApiGroup = passedApiGroup
            || (path.startsWith('/fapi') ? 'usdm' : path.startsWith('/sapi') ? 'wallet' : 'spot');

        // Build query string snapshot (non-empty user-supplied params, excluding signature/timestamp added by signing)
        const queryStringSnapshot: Record<string, any> = {};
        for (const [key, value] of Object.entries(params)) {
            if (value === undefined || value === null || value === '') continue;
            queryStringSnapshot[key] = value;
        }

        return {
            data: responseData,
            meta: {
                apiGroup: resolvedApiGroup,
                ...(category ? { category } : {}),
                method,
                path,
                baseUrl,
                requestId,
                ...(Object.keys(queryStringSnapshot).length > 0 ? { queryString: queryStringSnapshot } : {}),
                ...(Object.keys(rateLimits).length > 0 ? { rateLimits } : {}),
            },
        };
    } catch (error: any) {
        if (error instanceof NodeApiError) throw error;

        throw new NodeApiError(context.getNode(), {
            message: `Request to Binance failed: ${error.message}`,
            description: `${method} ${path} - ${error.message}`,
        } as any);
    }
}

/**
 * Validate that all required parameters are present.
 * Returns an array of missing parameter names.
 */
export function validateRequiredParams(
    params: Record<string, any>,
    requiredNames: string[],
): string[] {
    const missing: string[] = [];
    for (const name of requiredNames) {
        if (params[name] === undefined || params[name] === null || params[name] === '') {
            missing.push(name);
        }
    }
    return missing;
}

/**
 * Validate conditional requiredWhen rules.
 * Returns an array of error messages for violations.
 */
export function validateRequiredWhen(
    params: Record<string, any>,
    rules: Array<{ paramName: string; requiredWhen: { param: string; values: string[] } }>,
): string[] {
    const errors: string[] = [];
    for (const rule of rules) {
        const triggerValue = String(params[rule.requiredWhen.param] || '');
        if (rule.requiredWhen.values.includes(triggerValue)) {
            if (params[rule.paramName] === undefined || params[rule.paramName] === null || params[rule.paramName] === '') {
                errors.push(
                    `Parameter "${rule.paramName}" is required when "${rule.requiredWhen.param}" is "${triggerValue}"`,
                );
            }
        }
    }
    return errors;
}
