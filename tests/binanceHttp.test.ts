/**
 * Unit tests for the Binance HTTP & signing helpers.
 *
 * Covers:
 *  - encodeParams
 *  - signHmac
 *  - buildSignedPayload
 *  - validateRequiredParams
 *  - validateRequiredWhen
 */

import {
    encodeParams,
    signHmac,
    buildSignedPayload,
    validateRequiredParams,
    validateRequiredWhen,
    executeBinanceRequest,
} from '../nodes/BinanceUniversal/binanceHttp';

/* ──────────────────────────────── encodeParams ──────────────────────────── */

describe('encodeParams', () => {
    it('should encode simple key/value pairs', () => {
        const result = encodeParams({ symbol: 'BTCUSDT', side: 'BUY' });
        expect(result).toBe('symbol=BTCUSDT&side=BUY');
    });

    it('should encode numeric values as strings', () => {
        const result = encodeParams({ limit: 500, price: 42000.5 });
        expect(result).toBe('limit=500&price=42000.5');
    });

    it('should filter out undefined, null, and empty string values', () => {
        const result = encodeParams({
            symbol: 'ETHUSDT',
            side: undefined,
            type: null,
            timeInForce: '',
            quantity: 1,
        });
        expect(result).toBe('symbol=ETHUSDT&quantity=1');
    });

    it('should return an empty string for empty input', () => {
        expect(encodeParams({})).toBe('');
    });

    it('should return an empty string when all values are undefined/null/empty', () => {
        expect(encodeParams({ a: undefined, b: null, c: '' })).toBe('');
    });

    it('should URL-encode special characters', () => {
        const result = encodeParams({ msg: 'hello world', data: 'a=b&c=d' });
        // encodeURIComponent encodes space as %20 (not +)
        expect(result).toContain('msg=hello%20world');
        expect(result).toContain('data=a%3Db%26c%3Dd');
    });

    // ── Array handling ──

    it('should repeat key for array of primitives', () => {
        const result = encodeParams({ asset: ['BTC', 'USDT', 'ETH'] });
        expect(result).toBe('asset=BTC&asset=USDT&asset=ETH');
    });

    it('should use dot notation for array of objects', () => {
        const result = encodeParams({ orderArgs: [{ symbol: 'BTCUSDT', side: 'BUY' }] });
        expect(result).toBe('orderArgs[0].symbol=BTCUSDT&orderArgs[0].side=BUY');
    });

    it('should index multiple objects in array with correct bracket notation', () => {
        const result = encodeParams({
            orderArgs: [
                { symbol: 'BTCUSDT', side: 'BUY' },
                { symbol: 'ETHUSDT', side: 'SELL' },
            ],
        });
        expect(result).toBe(
            'orderArgs[0].symbol=BTCUSDT&orderArgs[0].side=BUY&orderArgs[1].symbol=ETHUSDT&orderArgs[1].side=SELL',
        );
    });

    it('should skip undefined/null/empty-string sub-values inside array objects', () => {
        const result = encodeParams({
            orderArgs: [{ symbol: 'BTCUSDT', price: undefined, note: '', qty: null }],
        });
        expect(result).toBe('orderArgs[0].symbol=BTCUSDT');
    });

    it('should produce empty string for an empty array', () => {
        expect(encodeParams({ assets: [] })).toBe('');
    });

    it('should encode special characters inside array object sub-values', () => {
        const result = encodeParams({ orderArgs: [{ clientId: 'my order/1' }] });
        expect(result).toContain('orderArgs[0].clientId=my%20order%2F1');
    });

    it('should handle an array mixed with other params', () => {
        const result = encodeParams({ symbol: 'BTCUSDT', asset: ['BTC', 'USDT'] });
        expect(result).toBe('symbol=BTCUSDT&asset=BTC&asset=USDT');
    });

    it('should encode primitive array values that contain special chars', () => {
        const result = encodeParams({ ids: ['a b', 'c&d'] });
        expect(result).toBe('ids=a%20b&ids=c%26d');
    });

    it('should handle boolean values', () => {
        const result = encodeParams({ isIsolated: true, dualSidePosition: false });
        expect(result).toBe('isIsolated=true&dualSidePosition=false');
    });

    it('should handle zero as a valid value', () => {
        const result = encodeParams({ countdownTime: 0 });
        expect(result).toBe('countdownTime=0');
    });
});

/* ──────────────────────────────── signHmac ──────────────────────────────── */

describe('signHmac', () => {
    it('should produce correct HMAC SHA256 hex digest', () => {
        // Known test vector from Binance docs
        const secret = 'NhqPtmdSJYdKjVHjA7PZj4Mge3R5YNiP1e3UZjInClVN65XAbvqqM6A7H5fATj0j';
        const payload = 'symbol=LTCBTC&side=BUY&type=LIMIT&timeInForce=GTC&quantity=1&price=0.1&recvWindow=5000&timestamp=1499827319559';
        const expected = 'c8db56825ae71d6d79447849e617115f4a920fa2acdcab2b053c4b2838bd6b71';

        const result = signHmac(secret, payload);
        expect(result).toBe(expected);
    });

    it('should return a 64-character hex string', () => {
        const result = signHmac('secret', 'data');
        expect(result).toHaveLength(64);
        expect(result).toMatch(/^[0-9a-f]{64}$/);
    });

    it('should produce different signatures for different secrets', () => {
        const payload = 'symbol=BTCUSDT';
        const sig1 = signHmac('secret1', payload);
        const sig2 = signHmac('secret2', payload);
        expect(sig1).not.toBe(sig2);
    });

    it('should produce different signatures for different payloads', () => {
        const secret = 'mySecret';
        const sig1 = signHmac(secret, 'symbol=BTCUSDT');
        const sig2 = signHmac(secret, 'symbol=ETHUSDT');
        expect(sig1).not.toBe(sig2);
    });

    it('should handle empty payload', () => {
        const result = signHmac('secret', '');
        expect(result).toHaveLength(64);
        expect(result).toMatch(/^[0-9a-f]{64}$/);
    });
});

/* ─────────────────────────── buildSignedPayload ─────────────────────────── */

describe('buildSignedPayload', () => {
    const secret = 'testSecret123';

    it('should add timestamp if not present', () => {
        const before = Date.now();
        const { allParams } = buildSignedPayload({ symbol: 'BTCUSDT' }, secret);
        const after = Date.now();

        expect(allParams.timestamp).toBeDefined();
        expect(allParams.timestamp).toBeGreaterThanOrEqual(before);
        expect(allParams.timestamp).toBeLessThanOrEqual(after);
    });

    it('should preserve existing timestamp', () => {
        const fixedTs = 1699999999999;
        const { allParams } = buildSignedPayload({ symbol: 'BTCUSDT', timestamp: fixedTs }, secret);
        expect(allParams.timestamp).toBe(fixedTs);
    });

    it('should add recvWindow if provided and not already set', () => {
        const { allParams } = buildSignedPayload({ symbol: 'BTCUSDT' }, secret, 5000);
        expect(allParams.recvWindow).toBe(5000);
    });

    it('should not overwrite existing recvWindow', () => {
        const { allParams } = buildSignedPayload(
            { symbol: 'BTCUSDT', recvWindow: 10000 },
            secret,
            5000,
        );
        expect(allParams.recvWindow).toBe(10000);
    });

    it('should append a valid signature to the signed string', () => {
        const { signedString, allParams } = buildSignedPayload(
            { symbol: 'BTCUSDT', timestamp: 1699999999999 },
            secret,
        );
        expect(signedString).toContain('&signature=');
        expect(allParams.signature).toBeDefined();
        expect(allParams.signature).toHaveLength(64);
    });

    it('should produce a correctly structured signed string', () => {
        const { signedString } = buildSignedPayload(
            { symbol: 'ETHUSDT', side: 'BUY', timestamp: 1700000000000 },
            secret,
        );

        // Should start with the params and end with &signature=<hex>
        expect(signedString).toMatch(
            /^symbol=ETHUSDT&side=BUY&timestamp=1700000000000&signature=[0-9a-f]{64}$/,
        );
    });

    it('should produce a deterministic signature for the same input', () => {
        const params = { symbol: 'BTCUSDT', timestamp: 1699999999999 };
        const r1 = buildSignedPayload({ ...params }, secret);
        const r2 = buildSignedPayload({ ...params }, secret);
        expect(r1.allParams.signature).toBe(r2.allParams.signature);
        expect(r1.signedString).toBe(r2.signedString);
    });

    it('should not mutate the original params object', () => {
        const original = { symbol: 'BTCUSDT' };
        const originalCopy = { ...original };
        buildSignedPayload(original, secret);
        expect(original).toEqual(originalCopy);
    });

    it('should handle empty params (timestamp + signature only)', () => {
        const { signedString, allParams } = buildSignedPayload({}, secret);
        expect(allParams.timestamp).toBeDefined();
        expect(allParams.signature).toBeDefined();
        expect(signedString).toMatch(/^timestamp=\d+&signature=[0-9a-f]{64}$/);
    });
});

/* ─────────────────────── validateRequiredParams ─────────────────────────── */

describe('validateRequiredParams', () => {
    it('should return empty array when all required params are present', () => {
        const params = { symbol: 'BTCUSDT', side: 'BUY', type: 'LIMIT' };
        const result = validateRequiredParams(params, ['symbol', 'side', 'type']);
        expect(result).toEqual([]);
    });

    it('should return missing param names', () => {
        const params = { symbol: 'BTCUSDT' };
        const result = validateRequiredParams(params, ['symbol', 'side', 'type']);
        expect(result).toEqual(['side', 'type']);
    });

    it('should treat undefined as missing', () => {
        const params = { symbol: undefined };
        const result = validateRequiredParams(params, ['symbol']);
        expect(result).toEqual(['symbol']);
    });

    it('should treat null as missing', () => {
        const params = { symbol: null };
        const result = validateRequiredParams(params, ['symbol']);
        expect(result).toEqual(['symbol']);
    });

    it('should treat empty string as missing', () => {
        const params = { symbol: '' };
        const result = validateRequiredParams(params, ['symbol']);
        expect(result).toEqual(['symbol']);
    });

    it('should treat zero as present (valid value)', () => {
        const params = { countdownTime: 0 };
        const result = validateRequiredParams(params, ['countdownTime']);
        expect(result).toEqual([]);
    });

    it('should treat false as present (valid value)', () => {
        const params = { dualSidePosition: false };
        const result = validateRequiredParams(params, ['dualSidePosition']);
        expect(result).toEqual([]);
    });

    it('should handle empty required list', () => {
        const result = validateRequiredParams({}, []);
        expect(result).toEqual([]);
    });

    it('should handle empty params with required list', () => {
        const result = validateRequiredParams({}, ['symbol', 'side']);
        expect(result).toEqual(['symbol', 'side']);
    });
});

/* ──────────────────────── validateRequiredWhen ───────────────────────────── */

describe('validateRequiredWhen', () => {
    it('should return no errors when no rules are provided', () => {
        const result = validateRequiredWhen({ type: 'LIMIT' }, []);
        expect(result).toEqual([]);
    });

    it('should return no errors when trigger condition is not met', () => {
        const rules = [
            {
                paramName: 'price',
                requiredWhen: { param: 'type', values: ['LIMIT', 'STOP'] },
            },
        ];
        const result = validateRequiredWhen({ type: 'MARKET', price: undefined }, rules);
        expect(result).toEqual([]);
    });

    it('should return no errors when trigger condition is met and param is present', () => {
        const rules = [
            {
                paramName: 'price',
                requiredWhen: { param: 'type', values: ['LIMIT'] },
            },
        ];
        const result = validateRequiredWhen({ type: 'LIMIT', price: '42000' }, rules);
        expect(result).toEqual([]);
    });

    it('should return an error when trigger condition is met and param is missing', () => {
        const rules = [
            {
                paramName: 'price',
                requiredWhen: { param: 'type', values: ['LIMIT'] },
            },
        ];
        const result = validateRequiredWhen({ type: 'LIMIT' }, rules);
        expect(result).toHaveLength(1);
        expect(result[0]).toContain('"price"');
        expect(result[0]).toContain('"type"');
        expect(result[0]).toContain('"LIMIT"');
    });

    it('should return an error when param is null', () => {
        const rules = [
            {
                paramName: 'timeInForce',
                requiredWhen: { param: 'type', values: ['LIMIT'] },
            },
        ];
        const result = validateRequiredWhen({ type: 'LIMIT', timeInForce: null }, rules);
        expect(result).toHaveLength(1);
        expect(result[0]).toContain('"timeInForce"');
    });

    it('should return an error when param is empty string', () => {
        const rules = [
            {
                paramName: 'stopPrice',
                requiredWhen: { param: 'type', values: ['STOP', 'STOP_MARKET'] },
            },
        ];
        const result = validateRequiredWhen({ type: 'STOP', stopPrice: '' }, rules);
        expect(result).toHaveLength(1);
        expect(result[0]).toContain('"stopPrice"');
    });

    it('should handle multiple rules with multiple violations', () => {
        const rules = [
            {
                paramName: 'price',
                requiredWhen: { param: 'type', values: ['LIMIT'] },
            },
            {
                paramName: 'timeInForce',
                requiredWhen: { param: 'type', values: ['LIMIT'] },
            },
        ];
        const result = validateRequiredWhen({ type: 'LIMIT' }, rules);
        expect(result).toHaveLength(2);
    });

    it('should handle multiple rules with partial violations', () => {
        const rules = [
            {
                paramName: 'price',
                requiredWhen: { param: 'type', values: ['LIMIT'] },
            },
            {
                paramName: 'timeInForce',
                requiredWhen: { param: 'type', values: ['LIMIT'] },
            },
        ];
        const result = validateRequiredWhen({ type: 'LIMIT', price: '42000' }, rules);
        expect(result).toHaveLength(1);
        expect(result[0]).toContain('"timeInForce"');
    });

    it('should match any value in the values array', () => {
        const rules = [
            {
                paramName: 'stopPrice',
                requiredWhen: { param: 'type', values: ['STOP', 'STOP_MARKET', 'TAKE_PROFIT', 'TAKE_PROFIT_MARKET'] },
            },
        ];

        expect(validateRequiredWhen({ type: 'STOP' }, rules)).toHaveLength(1);
        expect(validateRequiredWhen({ type: 'STOP_MARKET' }, rules)).toHaveLength(1);
        expect(validateRequiredWhen({ type: 'TAKE_PROFIT' }, rules)).toHaveLength(1);
        expect(validateRequiredWhen({ type: 'TAKE_PROFIT_MARKET' }, rules)).toHaveLength(1);
        expect(validateRequiredWhen({ type: 'MARKET' }, rules)).toHaveLength(0);
        expect(validateRequiredWhen({ type: 'LIMIT' }, rules)).toHaveLength(0);
    });

    it('should handle missing trigger param gracefully', () => {
        const rules = [
            {
                paramName: 'price',
                requiredWhen: { param: 'type', values: ['LIMIT'] },
            },
        ];
        // If 'type' is missing, String(undefined) === 'undefined' which shouldn't match 'LIMIT'
        const result = validateRequiredWhen({}, rules);
        expect(result).toEqual([]);
    });
});

/* ──────────────────────── executeBinanceRequest ─────────────────────────── */

describe('executeBinanceRequest', () => {
    function createMockContext(httpResponse: any = {
        statusCode: 200,
        headers: {},
        body: '{"status":"ok"}',
    }) {
        return {
            getNode: jest.fn().mockReturnValue({ name: 'BinanceUniversal', type: 'binance' }),
            helpers: {
                httpRequest: jest.fn().mockResolvedValue(httpResponse),
            },
        } as any;
    }

    const BASE = {
        baseUrl: 'https://api.binance.com',
        method: 'GET' as const,
        path: '/api/v3/ping',
        security: 'NONE' as const,
        params: {} as Record<string, any>,
        apiGroup: 'spot',
    };

    /* ── Security validation ── */

    it('should throw when API_KEY security but no apiKey provided', async () => {
        const ctx = createMockContext();
        await expect(
            executeBinanceRequest(ctx, { ...BASE, security: 'API_KEY' }),
        ).rejects.toThrow('API Key is required');
    });

    it('should throw when SIGNED security but no apiKey provided', async () => {
        const ctx = createMockContext();
        await expect(
            executeBinanceRequest(ctx, { ...BASE, security: 'SIGNED' }),
        ).rejects.toThrow('API Key is required');
    });

    it('should throw when SIGNED security but no apiSecret provided', async () => {
        const ctx = createMockContext();
        await expect(
            executeBinanceRequest(ctx, { ...BASE, security: 'SIGNED', apiKey: 'myKey' }),
        ).rejects.toThrow('API Secret is required');
    });

    /* ── NONE security GET ── */

    it('should build plain query string for NONE security GET with params', async () => {
        const ctx = createMockContext();
        await executeBinanceRequest(ctx, { ...BASE, params: { symbol: 'BTCUSDT', limit: 10 } });

        const call = ctx.helpers.httpRequest.mock.calls[0][0];
        expect(call.url).toBe('https://api.binance.com/api/v3/ping?symbol=BTCUSDT&limit=10');
        expect(call.headers).not.toHaveProperty('X-MBX-APIKEY');
        expect(call.method).toBe('GET');
    });

    it('should omit query string when NONE security GET has no params', async () => {
        const ctx = createMockContext();
        await executeBinanceRequest(ctx, BASE);

        const call = ctx.helpers.httpRequest.mock.calls[0][0];
        expect(call.url).toBe('https://api.binance.com/api/v3/ping');
    });

    it('should filter out undefined/null/empty-string params from the query string', async () => {
        const ctx = createMockContext();
        await executeBinanceRequest(ctx, {
            ...BASE,
            params: { symbol: 'BTCUSDT', side: undefined, type: null, tif: '' },
        });

        const call = ctx.helpers.httpRequest.mock.calls[0][0];
        expect(call.url).toBe('https://api.binance.com/api/v3/ping?symbol=BTCUSDT');
    });

    /* ── API_KEY security ── */

    it('should inject X-MBX-APIKEY header for API_KEY security', async () => {
        const ctx = createMockContext();
        await executeBinanceRequest(ctx, { ...BASE, security: 'API_KEY', apiKey: 'myApiKey123' });

        const call = ctx.helpers.httpRequest.mock.calls[0][0];
        expect(call.headers['X-MBX-APIKEY']).toBe('myApiKey123');
    });

    /* ── SIGNED GET ── */

    it('should append timestamp, recvWindow, and signature for SIGNED GET', async () => {
        const ctx = createMockContext();
        await executeBinanceRequest(ctx, {
            ...BASE,
            security: 'SIGNED',
            apiKey: 'myKey',
            apiSecret: 'mySecret',
            params: { symbol: 'BTCUSDT' },
            recvWindow: 5000,
        });

        const call = ctx.helpers.httpRequest.mock.calls[0][0];
        expect(call.url).toContain('symbol=BTCUSDT');
        expect(call.url).toContain('recvWindow=5000');
        expect(call.url).toContain('timestamp=');
        expect(call.url).toMatch(/&signature=[0-9a-f]{64}$/);
        expect(call.headers['X-MBX-APIKEY']).toBe('myKey');
    });

    it('should add timestamp even when no user params provided for SIGNED GET', async () => {
        const ctx = createMockContext();
        await executeBinanceRequest(ctx, {
            ...BASE,
            security: 'SIGNED',
            apiKey: 'myKey',
            apiSecret: 'mySecret',
        });

        const call = ctx.helpers.httpRequest.mock.calls[0][0];
        expect(call.url).toMatch(/\?timestamp=\d+&signature=[0-9a-f]{64}$/);
    });

    /* ── SIGNED POST (form-encoded) ── */

    it('should put signed params in query string for SIGNED POST without sendAsJson', async () => {
        const ctx = createMockContext({ statusCode: 200, headers: {}, body: '{"orderId":1}' });
        await executeBinanceRequest(ctx, {
            ...BASE,
            method: 'POST',
            path: '/api/v3/order',
            security: 'SIGNED',
            apiKey: 'myKey',
            apiSecret: 'mySecret',
            params: { symbol: 'BTCUSDT', side: 'BUY' },
        });

        const call = ctx.helpers.httpRequest.mock.calls[0][0];
        expect(call.method).toBe('POST');
        expect(call.url).toContain('symbol=BTCUSDT');
        expect(call.url).toContain('side=BUY');
        expect(call.url).toMatch(/&signature=[0-9a-f]{64}/);
        // body should be absent (params go entirely in query string)
        expect(call.body).toBeUndefined();
    });

    it('should merge body into params before signing for SIGNED POST', async () => {
        const ctx = createMockContext({ statusCode: 200, headers: {}, body: '{"orderId":1}' });
        await executeBinanceRequest(ctx, {
            ...BASE,
            method: 'POST',
            path: '/api/v3/order',
            security: 'SIGNED',
            apiKey: 'myKey',
            apiSecret: 'mySecret',
            params: { symbol: 'BTCUSDT' },
            body: { side: 'BUY', type: 'MARKET' },
        });

        const call = ctx.helpers.httpRequest.mock.calls[0][0];
        expect(call.url).toContain('symbol=BTCUSDT');
        expect(call.url).toContain('side=BUY');
        expect(call.url).toContain('type=MARKET');
        expect(call.url).toMatch(/&signature=[0-9a-f]{64}/);
    });

    /* ── SIGNED POST with sendAsJson ── */

    it('should put signed params in query string and original body as JSON for SIGNED POST sendAsJson', async () => {
        const ctx = createMockContext({ statusCode: 200, headers: {}, body: '{"orderId":99}' });
        await executeBinanceRequest(ctx, {
            ...BASE,
            method: 'POST',
            path: '/api/v3/order',
            security: 'SIGNED',
            apiKey: 'myKey',
            apiSecret: 'mySecret',
            params: { symbol: 'BTCUSDT' },
            body: { clientOrderId: 'abc123' },
            sendAsJson: true,
        });

        const call = ctx.helpers.httpRequest.mock.calls[0][0];
        expect(call.url).toContain('symbol=BTCUSDT');
        expect(call.url).toMatch(/&signature=[0-9a-f]{64}/);
        expect(call.headers['Content-Type']).toBe('application/json');
        expect(call.body).toBe('{"clientOrderId":"abc123"}');
    });

    /* ── Non-signed POST form-encoded ── */

    it('should send URL-encoded body for non-signed POST without sendAsJson', async () => {
        const ctx = createMockContext({ statusCode: 200, headers: {}, body: '{}' });
        await executeBinanceRequest(ctx, {
            ...BASE,
            method: 'POST',
            path: '/api/v3/userDataStream',
            security: 'API_KEY',
            apiKey: 'myKey',
            params: {},
            body: { listenKey: 'abc' },
        });

        const call = ctx.helpers.httpRequest.mock.calls[0][0];
        expect(call.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
        expect(call.body).toContain('listenKey=abc');
    });

    /* ── Non-signed POST JSON ── */

    it('should send JSON body for non-signed POST with sendAsJson', async () => {
        const ctx = createMockContext({ statusCode: 200, headers: {}, body: '{}' });
        await executeBinanceRequest(ctx, {
            ...BASE,
            method: 'POST',
            path: '/api/v3/userDataStream',
            security: 'API_KEY',
            apiKey: 'myKey',
            params: { symbol: 'BTCUSDT' },
            sendAsJson: true,
        });

        const call = ctx.helpers.httpRequest.mock.calls[0][0];
        expect(call.headers['Content-Type']).toBe('application/json');
        expect(() => JSON.parse(call.body)).not.toThrow();
        const parsed = JSON.parse(call.body);
        expect(parsed.symbol).toBe('BTCUSDT');
    });

    /* ── DELETE method ── */

    it('should sign and use query string for SIGNED DELETE', async () => {
        const ctx = createMockContext({ statusCode: 200, headers: {}, body: '{"status":"CANCELED"}' });
        await executeBinanceRequest(ctx, {
            ...BASE,
            method: 'DELETE',
            path: '/api/v3/order',
            security: 'SIGNED',
            apiKey: 'myKey',
            apiSecret: 'mySecret',
            params: { symbol: 'BTCUSDT', orderId: 12345 },
        });

        const call = ctx.helpers.httpRequest.mock.calls[0][0];
        expect(call.method).toBe('DELETE');
        expect(call.url).toContain('symbol=BTCUSDT');
        expect(call.url).toContain('orderId=12345');
        expect(call.url).toMatch(/&signature=[0-9a-f]{64}/);
    });

    /* ── Binance error response ── */

    it('should throw on Binance negative error code in 200 response', async () => {
        const ctx = createMockContext({
            statusCode: 200,
            headers: {},
            body: JSON.stringify({ code: -1121, msg: 'Invalid symbol.' }),
        });
        await expect(executeBinanceRequest(ctx, BASE)).rejects.toThrow(
            'Binance API Error -1121: Invalid symbol.',
        );
    });

    it('should NOT throw when response has a positive code field', async () => {
        const ctx = createMockContext({
            statusCode: 200,
            headers: {},
            body: JSON.stringify({ code: 200, result: 'ok' }),
        });
        const result = await executeBinanceRequest(ctx, BASE);
        expect(result.data.result).toBe('ok');
    });

    it('should NOT throw for valid response that has no code field', async () => {
        const ctx = createMockContext({
            statusCode: 200,
            headers: {},
            body: JSON.stringify({ orderId: 12345, status: 'FILLED' }),
        });
        const result = await executeBinanceRequest(ctx, BASE);
        expect(result.data.orderId).toBe(12345);
    });

    /* ── HTTP error responses ── */

    it('should throw on HTTP 400 response', async () => {
        const ctx = createMockContext({
            statusCode: 400,
            headers: {},
            body: JSON.stringify({ msg: 'Bad request' }),
        });
        await expect(executeBinanceRequest(ctx, BASE)).rejects.toMatchObject({
            description: expect.stringContaining('HTTP Status: 400'),
        });
    });

    it('should throw on HTTP 429 rate-limit response', async () => {
        const ctx = createMockContext({
            statusCode: 429,
            headers: {},
            body: JSON.stringify({ msg: 'Too Many Requests' }),
        });
        await expect(executeBinanceRequest(ctx, BASE)).rejects.toMatchObject({
            description: expect.stringContaining('HTTP Status: 429'),
        });
    });

    it('should throw on HTTP 500 response', async () => {
        const ctx = createMockContext({
            statusCode: 500,
            headers: {},
            body: JSON.stringify({ msg: 'Internal Server Error' }),
        });
        await expect(executeBinanceRequest(ctx, BASE)).rejects.toMatchObject({
            description: expect.stringContaining('HTTP Status: 500'),
        });
    });

    it('should use "Unknown error" message when error body has no msg/message', async () => {
        const ctx = createMockContext({
            statusCode: 503,
            headers: {},
            body: JSON.stringify({}),
        });
        await expect(executeBinanceRequest(ctx, BASE)).rejects.toMatchObject({
            description: expect.stringContaining('Unknown error'),
        });
    });

    /* ── Non-JSON body ── */

    it('should return raw string for non-JSON 200 body', async () => {
        const ctx = createMockContext({ statusCode: 200, headers: {}, body: 'plain text response' });
        const result = await executeBinanceRequest(ctx, BASE);
        expect(result.data).toBe('plain text response');
    });

    /* ── Rate limit headers ── */

    it('should extract Binance rate-limit headers into meta.rateLimits', async () => {
        const ctx = createMockContext({
            statusCode: 200,
            headers: {
                'x-mbx-used-weight-1m': '10',
                'x-mbx-order-count-1s': '1',
                'x-sapi-used-ip-weight-1m': '100',
                'retry-after': '60',
                'content-type': 'application/json',
            },
            body: '{}',
        });
        const result = await executeBinanceRequest(ctx, BASE);
        expect(result.meta.rateLimits).toBeDefined();
        expect(result.meta.rateLimits!['x-mbx-used-weight-1m']).toBe('10');
        expect(result.meta.rateLimits!['x-mbx-order-count-1s']).toBe('1');
        expect(result.meta.rateLimits!['x-sapi-used-ip-weight-1m']).toBe('100');
        expect(result.meta.rateLimits!['retry-after']).toBe('60');
        expect(result.meta.rateLimits!['content-type']).toBeUndefined();
    });

    it('should omit rateLimits from meta when no rate-limit headers present', async () => {
        const ctx = createMockContext({
            statusCode: 200,
            headers: { 'content-type': 'application/json' },
            body: '{}',
        });
        const result = await executeBinanceRequest(ctx, BASE);
        expect(result.meta.rateLimits).toBeUndefined();
    });

    /* ── apiGroup resolution ── */

    it('should use passedApiGroup over path-based heuristic', async () => {
        const ctx = createMockContext({ statusCode: 200, headers: {}, body: '{}' });
        const result = await executeBinanceRequest(ctx, {
            ...BASE,
            path: '/sapi/v1/system/status',
            apiGroup: 'wallet',
        });
        expect(result.meta.apiGroup).toBe('wallet');
    });

    it('should resolve apiGroup to usdm for /fapi paths when apiGroup is not passed', async () => {
        const ctx = createMockContext({ statusCode: 200, headers: {}, body: '{}' });
        const result = await executeBinanceRequest(ctx, {
            ...BASE,
            path: '/fapi/v1/ping',
            apiGroup: undefined,
        });
        expect(result.meta.apiGroup).toBe('usdm');
    });

    it('should resolve apiGroup to wallet for /sapi paths when apiGroup is not passed', async () => {
        const ctx = createMockContext({ statusCode: 200, headers: {}, body: '{}' });
        const result = await executeBinanceRequest(ctx, {
            ...BASE,
            path: '/sapi/v1/system/status',
            apiGroup: undefined,
        });
        expect(result.meta.apiGroup).toBe('wallet');
    });

    it('should resolve apiGroup to spot for /api paths when apiGroup is not passed', async () => {
        const ctx = createMockContext({ statusCode: 200, headers: {}, body: '{}' });
        const result = await executeBinanceRequest(ctx, {
            ...BASE,
            path: '/api/v3/ping',
            apiGroup: undefined,
        });
        expect(result.meta.apiGroup).toBe('spot');
    });

    /* ── category in meta ── */

    it('should include category in meta when provided', async () => {
        const ctx = createMockContext({ statusCode: 200, headers: {}, body: '{}' });
        const result = await executeBinanceRequest(ctx, { ...BASE, category: 'SPOT' });
        expect(result.meta.category).toBe('SPOT');
    });

    it('should not include category key in meta when not provided', async () => {
        const ctx = createMockContext({ statusCode: 200, headers: {}, body: '{}' });
        const result = await executeBinanceRequest(ctx, BASE);
        expect(result.meta).not.toHaveProperty('category');
    });

    /* ── queryString snapshot ── */

    it('should populate meta.queryString with non-empty user params', async () => {
        const ctx = createMockContext({ statusCode: 200, headers: {}, body: '{}' });
        const result = await executeBinanceRequest(ctx, {
            ...BASE,
            params: { symbol: 'BTCUSDT', limit: 100 },
        });
        expect(result.meta.queryString).toEqual({ symbol: 'BTCUSDT', limit: 100 });
    });

    it('should omit meta.queryString when all user params are empty/null/undefined', async () => {
        const ctx = createMockContext({ statusCode: 200, headers: {}, body: '{}' });
        const result = await executeBinanceRequest(ctx, {
            ...BASE,
            params: { side: undefined, type: null, tif: '' },
        });
        expect(result.meta.queryString).toBeUndefined();
    });

    it('should omit meta.queryString when params object is empty', async () => {
        const ctx = createMockContext({ statusCode: 200, headers: {}, body: '{}' });
        const result = await executeBinanceRequest(ctx, BASE);
        expect(result.meta.queryString).toBeUndefined();
    });

    /* ── meta fields ── */

    it('should include method, path, baseUrl, and a 16-char hex requestId in meta', async () => {
        const ctx = createMockContext({ statusCode: 200, headers: {}, body: '{}' });
        const result = await executeBinanceRequest(ctx, BASE);
        expect(result.meta.method).toBe('GET');
        expect(result.meta.path).toBe('/api/v3/ping');
        expect(result.meta.baseUrl).toBe('https://api.binance.com');
        expect(result.meta.requestId).toMatch(/^[0-9a-f]{16}$/);
    });

    it('should generate a unique requestId per call', async () => {
        const ctx = createMockContext({ statusCode: 200, headers: {}, body: '{}' });
        const [r1, r2] = await Promise.all([
            executeBinanceRequest(ctx, BASE),
            executeBinanceRequest(ctx, BASE),
        ]);
        expect(r1.meta.requestId).not.toBe(r2.meta.requestId);
    });

    /* ── Network / unexpected errors ── */

    it('should throw NodeApiError wrapping a network error', async () => {
        const ctx = {
            getNode: jest.fn().mockReturnValue({ name: 'BinanceUniversal' }),
            helpers: {
                httpRequest: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
            },
        } as any;
        await expect(executeBinanceRequest(ctx, BASE)).rejects.toMatchObject({
            description: expect.stringContaining('ECONNREFUSED'),
        });
    });

    /* ── Direct (non-full) response ── */

    it('should parse JSON when httpRequest returns a plain string (no statusCode)', async () => {
        const ctx = {
            getNode: jest.fn().mockReturnValue({ name: 'BinanceUniversal' }),
            helpers: { httpRequest: jest.fn().mockResolvedValue('{"result":"ok"}') },
        } as any;
        const result = await executeBinanceRequest(ctx, BASE);
        expect(result.data).toEqual({ result: 'ok' });
    });

    it('should return raw string when direct response is not JSON', async () => {
        const ctx = {
            getNode: jest.fn().mockReturnValue({ name: 'BinanceUniversal' }),
            helpers: { httpRequest: jest.fn().mockResolvedValue('pong') },
        } as any;
        const result = await executeBinanceRequest(ctx, BASE);
        expect(result.data).toBe('pong');
    });

    it('should return non-string direct response as-is', async () => {
        const ctx = {
            getNode: jest.fn().mockReturnValue({ name: 'BinanceUniversal' }),
            helpers: { httpRequest: jest.fn().mockResolvedValue({ orderId: 99 }) },
        } as any;
        const result = await executeBinanceRequest(ctx, BASE);
        expect(result.data).toEqual({ orderId: 99 });
    });

    /* ── returnFullResponse / json flags ── */

    it('should set returnFullResponse=true and json=false on every request', async () => {
        const ctx = createMockContext();
        await executeBinanceRequest(ctx, BASE);

        const call = ctx.helpers.httpRequest.mock.calls[0][0];
        expect(call.returnFullResponse).toBe(true);
        expect(call.json).toBe(false);
        expect(call.ignoreHttpStatusErrors).toBe(true);
    });
});
