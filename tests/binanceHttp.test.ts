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
        // URLSearchParams encodes space as + and = / & appropriately
        expect(result).toContain('msg=hello+world');
        expect(result).toContain('data=a%3Db%26c%3Dd');
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
