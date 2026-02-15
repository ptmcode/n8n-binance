#!/usr/bin/env ts-node
/**
 * Generate the Spot catalog (spot.json) from the official Binance Spot OpenAPI spec.
 *
 * Usage:
 *   npx ts-node scripts/generateSpotCatalog.ts
 *
 * The script fetches the official Binance OpenAPI YAML, parses it,
 * and writes resources/catalogs/spot.json.
 */

import axios from 'axios';
import * as yaml from 'js-yaml';
import * as fs from 'fs';
import * as path from 'path';
import { CatalogEntry, CatalogParam } from './catalogTypes';

// Official Binance Spot OpenAPI spec location
const SPOT_OPENAPI_URL =
    'https://raw.githubusercontent.com/binance/binance-spot-api-docs/master/rest-api/openapi/spot_api.yaml';

// Fallback URLs in case primary changes
const FALLBACK_URLS = [
    'https://raw.githubusercontent.com/nicepay-dev/binance-api-docs/master/rest-api.yaml',
];

/** Map OpenAPI tags to human-friendly category names */
function tagToCategory(tag: string): string {
    const map: Record<string, string> = {
        market: 'Market Data',
        'market data': 'Market Data',
        trade: 'Trading',
        trading: 'Trading',
        account: 'Account',
        wallet: 'Wallet',
        'user data stream': 'User Data Streams',
        'user data streams': 'User Data Streams',
        userdatastream: 'User Data Streams',
        savings: 'Savings',
        staking: 'Staking',
        mining: 'Mining',
        futures: 'Futures',
        blvt: 'BLVT',
        bswap: 'BSwap',
        fiat: 'Fiat',
        c2c: 'C2C',
        'sub-account': 'Sub-Account',
        margin: 'Margin',
        'margin trading': 'Margin',
        loan: 'Crypto Loans',
        pay: 'Pay',
        convert: 'Convert',
        rebate: 'Rebate',
        nft: 'NFT',
        'gift card': 'Gift Card',
        general: 'General',
    };
    const lower = tag.toLowerCase().trim();
    return map[lower] || tag;
}

/** Map OpenAPI security to our security type */
function resolveSecurity(securityArr: any[] | undefined, pathStr: string): 'NONE' | 'API_KEY' | 'SIGNED' {
    if (!securityArr || securityArr.length === 0) {
        // Heuristic: /sapi/ endpoints almost always require at least API_KEY
        if (pathStr.startsWith('/sapi/')) return 'API_KEY';
        return 'NONE';
    }
    for (const sec of securityArr) {
        if (sec['ApiKeyAuth'] !== undefined && sec['ApiSignature'] !== undefined) return 'SIGNED';
        if (sec['signed'] !== undefined) return 'SIGNED';
        if (sec['SIGNED'] !== undefined) return 'SIGNED';
    }
    for (const sec of securityArr) {
        if (sec['ApiKeyAuth'] !== undefined) return 'API_KEY';
        if (sec['apiKey'] !== undefined) return 'API_KEY';
        if (sec['API_KEY'] !== undefined) return 'API_KEY';
    }
    return 'NONE';
}

/** Map OpenAPI type to simple type string */
function resolveParamType(schema: any): string {
    if (!schema) return 'STRING';
    if (schema.enum) return 'ENUM';
    const t = (schema.type || '').toUpperCase();
    switch (t) {
        case 'INTEGER':
            return 'LONG';
        case 'NUMBER':
            return 'DECIMAL';
        case 'BOOLEAN':
            return 'BOOLEAN';
        case 'ARRAY':
            return 'ARRAY';
        default:
            return 'STRING';
    }
}

async function fetchYaml(url: string): Promise<any> {
    const resp = await axios.get(url, { timeout: 30000, responseType: 'text' });
    return yaml.load(resp.data);
}

async function main() {
    let spec: any;
    const urls = [SPOT_OPENAPI_URL, ...FALLBACK_URLS];

    for (const url of urls) {
        try {
            console.log(`Trying to fetch Spot OpenAPI spec from: ${url}`);
            spec = await fetchYaml(url);
            if (spec && spec.paths) {
                console.log('Successfully parsed OpenAPI spec.');
                break;
            }
        } catch (err: any) {
            console.warn(`Failed to fetch from ${url}: ${err.message}`);
        }
    }

    if (!spec || !spec.paths) {
        console.log('Could not fetch live spec. Generating catalog from built-in definitions.');
        console.log('The catalog will contain the most commonly used endpoints.');
        generateFallbackCatalog();
        return;
    }

    const catalog: CatalogEntry[] = [];
    const paths = spec.paths;

    for (const [pathStr, pathItem] of Object.entries(paths) as [string, any][]) {
        for (const method of ['get', 'post', 'put', 'delete']) {
            const operation = pathItem[method];
            if (!operation) continue;

            const httpMethod = method.toUpperCase();
            const tags = operation.tags || ['General'];
            const category = tagToCategory(tags[0]);
            const security = resolveSecurity(operation.security, pathStr);

            // Extract weight from description or x-weight
            let weight = operation['x-weight'] || 1;
            const desc = operation.description || operation.summary || '';
            const weightMatch = desc.match(/weight[:\s]*(\d+)/i);
            if (weightMatch) weight = parseInt(weightMatch[1], 10);

            // Extract parameters
            const params: CatalogParam[] = [];
            if (operation.parameters) {
                for (const p of operation.parameters) {
                    const param = p.$ref ? resolveRef(spec, p.$ref) : p;
                    if (!param) continue;
                    const schema = param.schema || {};
                    const cp: CatalogParam = {
                        name: param.name,
                        type: resolveParamType(schema),
                        required: !!param.required,
                    };
                    if (param.description) cp.description = param.description;
                    if (schema.enum) cp.enumValues = schema.enum;
                    params.push(cp);
                }
            }

            // Extract request body params (for form-encoded)
            if (operation.requestBody) {
                const content = operation.requestBody.content || {};
                const formSchema =
                    content['application/x-www-form-urlencoded']?.schema ||
                    content['application/json']?.schema;
                if (formSchema) {
                    const props = formSchema.properties || {};
                    const requiredList: string[] = formSchema.required || [];
                    for (const [pName, pSchema] of Object.entries(props) as [string, any][]) {
                        const cp: CatalogParam = {
                            name: pName,
                            type: resolveParamType(pSchema),
                            required: requiredList.includes(pName),
                        };
                        if (pSchema.description) cp.description = pSchema.description;
                        if (pSchema.enum) cp.enumValues = pSchema.enum;
                        params.push(cp);
                    }
                }
            }

            const id = `spot:${httpMethod}:${pathStr}`;
            const docUrl = `https://developers.binance.com/docs/binance-spot-api-docs/rest-api`;
            const notes = desc.substring(0, 200);

            catalog.push({
                id,
                apiGroup: 'spot',
                category,
                method: httpMethod,
                path: pathStr,
                security,
                weight,
                params,
                notes,
                docUrl,
            });
        }
    }

    writeCatalog(catalog);
}

function resolveRef(spec: any, ref: string): any {
    const parts = ref.replace('#/', '').split('/');
    let obj = spec;
    for (const p of parts) {
        obj = obj?.[p];
    }
    return obj;
}

function writeCatalog(catalog: CatalogEntry[]) {
    const outDir = path.resolve(__dirname, '..', 'resources', 'catalogs');
    fs.mkdirSync(outDir, { recursive: true });
    const outFile = path.join(outDir, 'spot.json');
    fs.writeFileSync(outFile, JSON.stringify(catalog, null, 2), 'utf-8');
    console.log(`Wrote ${catalog.length} entries to ${outFile}`);
}

/**
 * Fallback: generate a catalog with the most commonly used Spot endpoints.
 * This is used when the live OpenAPI spec cannot be fetched.
 */
function generateFallbackCatalog() {
    const catalog: CatalogEntry[] = [
        // === General ===
        {
            id: 'spot:GET:/api/v3/ping',
            apiGroup: 'spot', category: 'General', method: 'GET', path: '/api/v3/ping',
            security: 'NONE', weight: 1, params: [], notes: 'Test connectivity to the Rest API.', docUrl: 'https://developers.binance.com/docs/binance-spot-api-docs/rest-api#test-connectivity',
        },
        {
            id: 'spot:GET:/api/v3/time',
            apiGroup: 'spot', category: 'General', method: 'GET', path: '/api/v3/time',
            security: 'NONE', weight: 1, params: [], notes: 'Test connectivity and get server time.', docUrl: 'https://developers.binance.com/docs/binance-spot-api-docs/rest-api#check-server-time',
        },
        {
            id: 'spot:GET:/api/v3/exchangeInfo',
            apiGroup: 'spot', category: 'General', method: 'GET', path: '/api/v3/exchangeInfo',
            security: 'NONE', weight: 20, params: [
                { name: 'symbol', type: 'STRING', required: false, description: 'Trading pair symbol' },
                { name: 'symbols', type: 'STRING', required: false, description: 'Array of symbols as JSON string e.g. ["BTCUSDT","ETHUSDT"]' },
                { name: 'permissions', type: 'STRING', required: false, description: 'Filter by permissions' },
            ], notes: 'Current exchange trading rules and symbol information.', docUrl: 'https://developers.binance.com/docs/binance-spot-api-docs/rest-api#exchange-information',
        },

        // === Market Data ===
        {
            id: 'spot:GET:/api/v3/depth',
            apiGroup: 'spot', category: 'Market Data', method: 'GET', path: '/api/v3/depth',
            security: 'NONE', weight: 5, params: [
                { name: 'symbol', type: 'STRING', required: true },
                { name: 'limit', type: 'LONG', required: false, description: 'Default 100; max 5000' },
            ], notes: 'Order book depth.', docUrl: 'https://developers.binance.com/docs/binance-spot-api-docs/rest-api#order-book',
        },
        {
            id: 'spot:GET:/api/v3/trades',
            apiGroup: 'spot', category: 'Market Data', method: 'GET', path: '/api/v3/trades',
            security: 'NONE', weight: 10, params: [
                { name: 'symbol', type: 'STRING', required: true },
                { name: 'limit', type: 'LONG', required: false, description: 'Default 500; max 1000' },
            ], notes: 'Get recent trades.', docUrl: 'https://developers.binance.com/docs/binance-spot-api-docs/rest-api#recent-trades-list',
        },
        {
            id: 'spot:GET:/api/v3/historicalTrades',
            apiGroup: 'spot', category: 'Market Data', method: 'GET', path: '/api/v3/historicalTrades',
            security: 'API_KEY', weight: 10, params: [
                { name: 'symbol', type: 'STRING', required: true },
                { name: 'limit', type: 'LONG', required: false },
                { name: 'fromId', type: 'LONG', required: false },
            ], notes: 'Get older trades.', docUrl: 'https://developers.binance.com/docs/binance-spot-api-docs/rest-api#old-trade-lookup',
        },
        {
            id: 'spot:GET:/api/v3/aggTrades',
            apiGroup: 'spot', category: 'Market Data', method: 'GET', path: '/api/v3/aggTrades',
            security: 'NONE', weight: 2, params: [
                { name: 'symbol', type: 'STRING', required: true },
                { name: 'fromId', type: 'LONG', required: false },
                { name: 'startTime', type: 'LONG', required: false },
                { name: 'endTime', type: 'LONG', required: false },
                { name: 'limit', type: 'LONG', required: false, description: 'Default 500; max 1000' },
            ], notes: 'Get compressed, aggregate trades.', docUrl: 'https://developers.binance.com/docs/binance-spot-api-docs/rest-api#compressedaggregate-trades-list',
        },
        {
            id: 'spot:GET:/api/v3/klines',
            apiGroup: 'spot', category: 'Market Data', method: 'GET', path: '/api/v3/klines',
            security: 'NONE', weight: 2, params: [
                { name: 'symbol', type: 'STRING', required: true },
                { name: 'interval', type: 'ENUM', required: true, enumValues: ['1s', '1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w', '1M'] },
                { name: 'startTime', type: 'LONG', required: false },
                { name: 'endTime', type: 'LONG', required: false },
                { name: 'timeZone', type: 'STRING', required: false },
                { name: 'limit', type: 'LONG', required: false, description: 'Default 500; max 1000' },
            ], notes: 'Kline/candlestick bars for a symbol.', docUrl: 'https://developers.binance.com/docs/binance-spot-api-docs/rest-api#klinecandlestick-data',
        },
        {
            id: 'spot:GET:/api/v3/uiKlines',
            apiGroup: 'spot', category: 'Market Data', method: 'GET', path: '/api/v3/uiKlines',
            security: 'NONE', weight: 2, params: [
                { name: 'symbol', type: 'STRING', required: true },
                { name: 'interval', type: 'ENUM', required: true, enumValues: ['1s', '1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w', '1M'] },
                { name: 'startTime', type: 'LONG', required: false },
                { name: 'endTime', type: 'LONG', required: false },
                { name: 'timeZone', type: 'STRING', required: false },
                { name: 'limit', type: 'LONG', required: false },
            ], notes: 'Modified kline data optimized for presentation of candlestick charts.', docUrl: 'https://developers.binance.com/docs/binance-spot-api-docs/rest-api#uiklines',
        },
        {
            id: 'spot:GET:/api/v3/avgPrice',
            apiGroup: 'spot', category: 'Market Data', method: 'GET', path: '/api/v3/avgPrice',
            security: 'NONE', weight: 2, params: [
                { name: 'symbol', type: 'STRING', required: true },
            ], notes: 'Current average price for a symbol.', docUrl: 'https://developers.binance.com/docs/binance-spot-api-docs/rest-api#current-average-price',
        },
        {
            id: 'spot:GET:/api/v3/ticker/24hr',
            apiGroup: 'spot', category: 'Market Data', method: 'GET', path: '/api/v3/ticker/24hr',
            security: 'NONE', weight: 5, params: [
                { name: 'symbol', type: 'STRING', required: false },
                { name: 'symbols', type: 'STRING', required: false },
                { name: 'type', type: 'ENUM', required: false, enumValues: ['FULL', 'MINI'] },
            ], notes: '24hr ticker price change statistics.', docUrl: 'https://developers.binance.com/docs/binance-spot-api-docs/rest-api#24hr-ticker-price-change-statistics',
        },
        {
            id: 'spot:GET:/api/v3/ticker/tradingDay',
            apiGroup: 'spot', category: 'Market Data', method: 'GET', path: '/api/v3/ticker/tradingDay',
            security: 'NONE', weight: 4, params: [
                { name: 'symbol', type: 'STRING', required: false },
                { name: 'symbols', type: 'STRING', required: false },
                { name: 'timeZone', type: 'STRING', required: false },
                { name: 'type', type: 'ENUM', required: false, enumValues: ['FULL', 'MINI'] },
            ], notes: 'Price change statistics for a trading day.', docUrl: 'https://developers.binance.com/docs/binance-spot-api-docs/rest-api#trading-day-ticker',
        },
        {
            id: 'spot:GET:/api/v3/ticker/price',
            apiGroup: 'spot', category: 'Market Data', method: 'GET', path: '/api/v3/ticker/price',
            security: 'NONE', weight: 2, params: [
                { name: 'symbol', type: 'STRING', required: false },
                { name: 'symbols', type: 'STRING', required: false },
            ], notes: 'Latest price for a symbol or symbols.', docUrl: 'https://developers.binance.com/docs/binance-spot-api-docs/rest-api#symbol-price-ticker',
        },
        {
            id: 'spot:GET:/api/v3/ticker/bookTicker',
            apiGroup: 'spot', category: 'Market Data', method: 'GET', path: '/api/v3/ticker/bookTicker',
            security: 'NONE', weight: 2, params: [
                { name: 'symbol', type: 'STRING', required: false },
                { name: 'symbols', type: 'STRING', required: false },
            ], notes: 'Best price/qty on the order book for a symbol or symbols.', docUrl: 'https://developers.binance.com/docs/binance-spot-api-docs/rest-api#symbol-order-book-ticker',
        },
        {
            id: 'spot:GET:/api/v3/ticker',
            apiGroup: 'spot', category: 'Market Data', method: 'GET', path: '/api/v3/ticker',
            security: 'NONE', weight: 4, params: [
                { name: 'symbol', type: 'STRING', required: false },
                { name: 'symbols', type: 'STRING', required: false },
                { name: 'windowSize', type: 'STRING', required: false, description: 'e.g. 1m,2h,1d. Defaults to 1d' },
                { name: 'type', type: 'ENUM', required: false, enumValues: ['FULL', 'MINI'] },
            ], notes: 'Rolling window price change statistics.', docUrl: 'https://developers.binance.com/docs/binance-spot-api-docs/rest-api#rolling-window-price-change-statistics',
        },

        // === Trading ===
        {
            id: 'spot:POST:/api/v3/order/test',
            apiGroup: 'spot', category: 'Trading', method: 'POST', path: '/api/v3/order/test',
            security: 'SIGNED', weight: 1, params: [
                { name: 'symbol', type: 'STRING', required: true },
                { name: 'side', type: 'ENUM', required: true, enumValues: ['BUY', 'SELL'] },
                { name: 'type', type: 'ENUM', required: true, enumValues: ['LIMIT', 'MARKET', 'STOP_LOSS', 'STOP_LOSS_LIMIT', 'TAKE_PROFIT', 'TAKE_PROFIT_LIMIT', 'LIMIT_MAKER'] },
                { name: 'timeInForce', type: 'ENUM', required: false, enumValues: ['GTC', 'IOC', 'FOK'] },
                { name: 'quantity', type: 'DECIMAL', required: false },
                { name: 'quoteOrderQty', type: 'DECIMAL', required: false },
                { name: 'price', type: 'DECIMAL', required: false },
                { name: 'newClientOrderId', type: 'STRING', required: false },
                { name: 'strategyId', type: 'LONG', required: false },
                { name: 'strategyType', type: 'LONG', required: false },
                { name: 'stopPrice', type: 'DECIMAL', required: false },
                { name: 'icebergQty', type: 'DECIMAL', required: false },
                { name: 'newOrderRespType', type: 'ENUM', required: false, enumValues: ['ACK', 'RESULT', 'FULL'] },
                { name: 'selfTradePreventionMode', type: 'ENUM', required: false, enumValues: ['EXPIRE_TAKER', 'EXPIRE_MAKER', 'EXPIRE_BOTH', 'NONE'] },
                { name: 'recvWindow', type: 'LONG', required: false },
            ], notes: 'Test new order creation (does not create real order).', docUrl: 'https://developers.binance.com/docs/binance-spot-api-docs/rest-api#test-new-order-trade',
        },
        {
            id: 'spot:POST:/api/v3/order',
            apiGroup: 'spot', category: 'Trading', method: 'POST', path: '/api/v3/order',
            security: 'SIGNED', weight: 1, params: [
                { name: 'symbol', type: 'STRING', required: true },
                { name: 'side', type: 'ENUM', required: true, enumValues: ['BUY', 'SELL'] },
                { name: 'type', type: 'ENUM', required: true, enumValues: ['LIMIT', 'MARKET', 'STOP_LOSS', 'STOP_LOSS_LIMIT', 'TAKE_PROFIT', 'TAKE_PROFIT_LIMIT', 'LIMIT_MAKER'] },
                { name: 'timeInForce', type: 'ENUM', required: false, enumValues: ['GTC', 'IOC', 'FOK'] },
                { name: 'quantity', type: 'DECIMAL', required: false },
                { name: 'quoteOrderQty', type: 'DECIMAL', required: false },
                { name: 'price', type: 'DECIMAL', required: false },
                { name: 'newClientOrderId', type: 'STRING', required: false },
                { name: 'strategyId', type: 'LONG', required: false },
                { name: 'strategyType', type: 'LONG', required: false },
                { name: 'stopPrice', type: 'DECIMAL', required: false },
                { name: 'trailingDelta', type: 'LONG', required: false },
                { name: 'icebergQty', type: 'DECIMAL', required: false },
                { name: 'newOrderRespType', type: 'ENUM', required: false, enumValues: ['ACK', 'RESULT', 'FULL'] },
                { name: 'selfTradePreventionMode', type: 'ENUM', required: false, enumValues: ['EXPIRE_TAKER', 'EXPIRE_MAKER', 'EXPIRE_BOTH', 'NONE'] },
                { name: 'recvWindow', type: 'LONG', required: false },
            ], notes: 'Send in a new order.', docUrl: 'https://developers.binance.com/docs/binance-spot-api-docs/rest-api#new-order-trade',
        },
        {
            id: 'spot:DELETE:/api/v3/order',
            apiGroup: 'spot', category: 'Trading', method: 'DELETE', path: '/api/v3/order',
            security: 'SIGNED', weight: 1, params: [
                { name: 'symbol', type: 'STRING', required: true },
                { name: 'orderId', type: 'LONG', required: false },
                { name: 'origClientOrderId', type: 'STRING', required: false },
                { name: 'newClientOrderId', type: 'STRING', required: false },
                { name: 'cancelRestrictions', type: 'ENUM', required: false, enumValues: ['ONLY_NEW', 'ONLY_PARTIALLY_FILLED'] },
                { name: 'recvWindow', type: 'LONG', required: false },
            ], notes: 'Cancel an active order.', docUrl: 'https://developers.binance.com/docs/binance-spot-api-docs/rest-api#cancel-order-trade',
        },
        {
            id: 'spot:DELETE:/api/v3/openOrders',
            apiGroup: 'spot', category: 'Trading', method: 'DELETE', path: '/api/v3/openOrders',
            security: 'SIGNED', weight: 1, params: [
                { name: 'symbol', type: 'STRING', required: true },
                { name: 'recvWindow', type: 'LONG', required: false },
            ], notes: 'Cancel all open orders on a symbol.', docUrl: 'https://developers.binance.com/docs/binance-spot-api-docs/rest-api#cancel-all-open-orders-on-a-symbol-trade',
        },
        {
            id: 'spot:GET:/api/v3/order',
            apiGroup: 'spot', category: 'Trading', method: 'GET', path: '/api/v3/order',
            security: 'SIGNED', weight: 4, params: [
                { name: 'symbol', type: 'STRING', required: true },
                { name: 'orderId', type: 'LONG', required: false },
                { name: 'origClientOrderId', type: 'STRING', required: false },
                { name: 'recvWindow', type: 'LONG', required: false },
            ], notes: 'Check an order status.', docUrl: 'https://developers.binance.com/docs/binance-spot-api-docs/rest-api#query-order-user_data',
        },
        {
            id: 'spot:POST:/api/v3/order/cancelReplace',
            apiGroup: 'spot', category: 'Trading', method: 'POST', path: '/api/v3/order/cancelReplace',
            security: 'SIGNED', weight: 1, params: [
                { name: 'symbol', type: 'STRING', required: true },
                { name: 'side', type: 'ENUM', required: true, enumValues: ['BUY', 'SELL'] },
                { name: 'type', type: 'ENUM', required: true, enumValues: ['LIMIT', 'MARKET', 'STOP_LOSS', 'STOP_LOSS_LIMIT', 'TAKE_PROFIT', 'TAKE_PROFIT_LIMIT', 'LIMIT_MAKER'] },
                { name: 'cancelReplaceMode', type: 'ENUM', required: true, enumValues: ['STOP_ON_FAILURE', 'ALLOW_FAILURE'] },
                { name: 'timeInForce', type: 'ENUM', required: false, enumValues: ['GTC', 'IOC', 'FOK'] },
                { name: 'quantity', type: 'DECIMAL', required: false },
                { name: 'quoteOrderQty', type: 'DECIMAL', required: false },
                { name: 'price', type: 'DECIMAL', required: false },
                { name: 'cancelNewClientOrderId', type: 'STRING', required: false },
                { name: 'cancelOrigClientOrderId', type: 'STRING', required: false },
                { name: 'cancelOrderId', type: 'LONG', required: false },
                { name: 'newClientOrderId', type: 'STRING', required: false },
                { name: 'stopPrice', type: 'DECIMAL', required: false },
                { name: 'trailingDelta', type: 'LONG', required: false },
                { name: 'icebergQty', type: 'DECIMAL', required: false },
                { name: 'newOrderRespType', type: 'ENUM', required: false, enumValues: ['ACK', 'RESULT', 'FULL'] },
                { name: 'selfTradePreventionMode', type: 'ENUM', required: false },
                { name: 'recvWindow', type: 'LONG', required: false },
            ], notes: 'Cancel an existing order and send a new order on the same symbol.', docUrl: 'https://developers.binance.com/docs/binance-spot-api-docs/rest-api#cancel-an-existing-order-and-send-a-new-order-trade',
        },
        {
            id: 'spot:GET:/api/v3/openOrders',
            apiGroup: 'spot', category: 'Trading', method: 'GET', path: '/api/v3/openOrders',
            security: 'SIGNED', weight: 6, params: [
                { name: 'symbol', type: 'STRING', required: false },
                { name: 'recvWindow', type: 'LONG', required: false },
            ], notes: 'Get all open orders on a symbol.', docUrl: 'https://developers.binance.com/docs/binance-spot-api-docs/rest-api#current-open-orders-user_data',
        },
        {
            id: 'spot:GET:/api/v3/allOrders',
            apiGroup: 'spot', category: 'Trading', method: 'GET', path: '/api/v3/allOrders',
            security: 'SIGNED', weight: 20, params: [
                { name: 'symbol', type: 'STRING', required: true },
                { name: 'orderId', type: 'LONG', required: false },
                { name: 'startTime', type: 'LONG', required: false },
                { name: 'endTime', type: 'LONG', required: false },
                { name: 'limit', type: 'LONG', required: false, description: 'Default 500; max 1000' },
                { name: 'recvWindow', type: 'LONG', required: false },
            ], notes: 'Get all account orders; active, canceled, or filled.', docUrl: 'https://developers.binance.com/docs/binance-spot-api-docs/rest-api#all-orders-user_data',
        },
        {
            id: 'spot:POST:/api/v3/order/oco',
            apiGroup: 'spot', category: 'Trading', method: 'POST', path: '/api/v3/order/oco',
            security: 'SIGNED', weight: 1, params: [
                { name: 'symbol', type: 'STRING', required: true },
                { name: 'listClientOrderId', type: 'STRING', required: false },
                { name: 'side', type: 'ENUM', required: true, enumValues: ['BUY', 'SELL'] },
                { name: 'quantity', type: 'DECIMAL', required: true },
                { name: 'limitClientOrderId', type: 'STRING', required: false },
                { name: 'price', type: 'DECIMAL', required: true },
                { name: 'limitIcebergQty', type: 'DECIMAL', required: false },
                { name: 'trailingDelta', type: 'LONG', required: false },
                { name: 'stopClientOrderId', type: 'STRING', required: false },
                { name: 'stopPrice', type: 'DECIMAL', required: true },
                { name: 'stopLimitPrice', type: 'DECIMAL', required: false },
                { name: 'stopIcebergQty', type: 'DECIMAL', required: false },
                { name: 'stopLimitTimeInForce', type: 'ENUM', required: false, enumValues: ['GTC', 'FOK', 'IOC'] },
                { name: 'newOrderRespType', type: 'ENUM', required: false, enumValues: ['ACK', 'RESULT', 'FULL'] },
                { name: 'selfTradePreventionMode', type: 'ENUM', required: false },
                { name: 'recvWindow', type: 'LONG', required: false },
            ], notes: 'Send in a new OCO order.', docUrl: 'https://developers.binance.com/docs/binance-spot-api-docs/rest-api#new-oco-trade',
        },
        {
            id: 'spot:DELETE:/api/v3/orderList',
            apiGroup: 'spot', category: 'Trading', method: 'DELETE', path: '/api/v3/orderList',
            security: 'SIGNED', weight: 1, params: [
                { name: 'symbol', type: 'STRING', required: true },
                { name: 'orderListId', type: 'LONG', required: false },
                { name: 'listClientOrderId', type: 'STRING', required: false },
                { name: 'newClientOrderId', type: 'STRING', required: false },
                { name: 'recvWindow', type: 'LONG', required: false },
            ], notes: 'Cancel an entire Order List.', docUrl: 'https://developers.binance.com/docs/binance-spot-api-docs/rest-api#cancel-oco-trade',
        },
        {
            id: 'spot:GET:/api/v3/orderList',
            apiGroup: 'spot', category: 'Trading', method: 'GET', path: '/api/v3/orderList',
            security: 'SIGNED', weight: 4, params: [
                { name: 'orderListId', type: 'LONG', required: false },
                { name: 'origClientOrderId', type: 'STRING', required: false },
                { name: 'recvWindow', type: 'LONG', required: false },
            ], notes: 'Retrieves a specific OCO based on provided optional parameters.', docUrl: 'https://developers.binance.com/docs/binance-spot-api-docs/rest-api#query-oco-user_data',
        },
        {
            id: 'spot:GET:/api/v3/allOrderList',
            apiGroup: 'spot', category: 'Trading', method: 'GET', path: '/api/v3/allOrderList',
            security: 'SIGNED', weight: 20, params: [
                { name: 'fromId', type: 'LONG', required: false },
                { name: 'startTime', type: 'LONG', required: false },
                { name: 'endTime', type: 'LONG', required: false },
                { name: 'limit', type: 'LONG', required: false },
                { name: 'recvWindow', type: 'LONG', required: false },
            ], notes: 'Retrieves all OCO based on provided optional parameters.', docUrl: 'https://developers.binance.com/docs/binance-spot-api-docs/rest-api#query-all-oco-user_data',
        },
        {
            id: 'spot:GET:/api/v3/openOrderList',
            apiGroup: 'spot', category: 'Trading', method: 'GET', path: '/api/v3/openOrderList',
            security: 'SIGNED', weight: 6, params: [
                { name: 'recvWindow', type: 'LONG', required: false },
            ], notes: 'Query open OCO.', docUrl: 'https://developers.binance.com/docs/binance-spot-api-docs/rest-api#query-open-oco-user_data',
        },
        {
            id: 'spot:POST:/api/v3/order/oto',
            apiGroup: 'spot', category: 'Trading', method: 'POST', path: '/api/v3/order/oto',
            security: 'SIGNED', weight: 1, params: [
                { name: 'symbol', type: 'STRING', required: true },
                { name: 'listClientOrderId', type: 'STRING', required: false },
                { name: 'newOrderRespType', type: 'ENUM', required: false, enumValues: ['ACK', 'RESULT', 'FULL'] },
                { name: 'selfTradePreventionMode', type: 'ENUM', required: false },
                { name: 'workingType', type: 'ENUM', required: true, enumValues: ['LIMIT', 'LIMIT_MAKER'] },
                { name: 'workingSide', type: 'ENUM', required: true, enumValues: ['BUY', 'SELL'] },
                { name: 'workingClientOrderId', type: 'STRING', required: false },
                { name: 'workingPrice', type: 'DECIMAL', required: true },
                { name: 'workingQuantity', type: 'DECIMAL', required: true },
                { name: 'workingIcebergQty', type: 'DECIMAL', required: false },
                { name: 'workingTimeInForce', type: 'ENUM', required: false, enumValues: ['GTC', 'IOC', 'FOK'] },
                { name: 'workingStrategyId', type: 'LONG', required: false },
                { name: 'workingStrategyType', type: 'LONG', required: false },
                { name: 'pendingType', type: 'ENUM', required: true },
                { name: 'pendingSide', type: 'ENUM', required: true, enumValues: ['BUY', 'SELL'] },
                { name: 'pendingClientOrderId', type: 'STRING', required: false },
                { name: 'pendingPrice', type: 'DECIMAL', required: false },
                { name: 'pendingQuantity', type: 'DECIMAL', required: true },
                { name: 'pendingIcebergQty', type: 'DECIMAL', required: false },
                { name: 'pendingTimeInForce', type: 'ENUM', required: false },
                { name: 'pendingStrategyId', type: 'LONG', required: false },
                { name: 'pendingStrategyType', type: 'LONG', required: false },
                { name: 'recvWindow', type: 'LONG', required: false },
            ], notes: 'Place an OTO order.', docUrl: 'https://developers.binance.com/docs/binance-spot-api-docs/rest-api#new-order-using-oto-trade',
        },
        {
            id: 'spot:POST:/api/v3/order/otoco',
            apiGroup: 'spot', category: 'Trading', method: 'POST', path: '/api/v3/order/otoco',
            security: 'SIGNED', weight: 1, params: [
                { name: 'symbol', type: 'STRING', required: true },
                { name: 'listClientOrderId', type: 'STRING', required: false },
                { name: 'newOrderRespType', type: 'ENUM', required: false, enumValues: ['ACK', 'RESULT', 'FULL'] },
                { name: 'selfTradePreventionMode', type: 'ENUM', required: false },
                { name: 'workingType', type: 'ENUM', required: true, enumValues: ['LIMIT', 'LIMIT_MAKER'] },
                { name: 'workingSide', type: 'ENUM', required: true, enumValues: ['BUY', 'SELL'] },
                { name: 'workingClientOrderId', type: 'STRING', required: false },
                { name: 'workingPrice', type: 'DECIMAL', required: true },
                { name: 'workingQuantity', type: 'DECIMAL', required: true },
                { name: 'workingIcebergQty', type: 'DECIMAL', required: false },
                { name: 'workingTimeInForce', type: 'ENUM', required: false, enumValues: ['GTC', 'IOC', 'FOK'] },
                { name: 'workingStrategyId', type: 'LONG', required: false },
                { name: 'workingStrategyType', type: 'LONG', required: false },
                { name: 'pendingSide', type: 'ENUM', required: true, enumValues: ['BUY', 'SELL'] },
                { name: 'pendingQuantity', type: 'DECIMAL', required: true },
                { name: 'pendingAboveType', type: 'ENUM', required: true },
                { name: 'pendingAboveClientOrderId', type: 'STRING', required: false },
                { name: 'pendingAbovePrice', type: 'DECIMAL', required: false },
                { name: 'pendingAboveStopPrice', type: 'DECIMAL', required: false },
                { name: 'pendingAboveTrailingDelta', type: 'LONG', required: false },
                { name: 'pendingAboveIcebergQty', type: 'DECIMAL', required: false },
                { name: 'pendingAboveTimeInForce', type: 'ENUM', required: false },
                { name: 'pendingAboveStrategyId', type: 'LONG', required: false },
                { name: 'pendingAboveStrategyType', type: 'LONG', required: false },
                { name: 'pendingBelowType', type: 'ENUM', required: false },
                { name: 'pendingBelowClientOrderId', type: 'STRING', required: false },
                { name: 'pendingBelowPrice', type: 'DECIMAL', required: false },
                { name: 'pendingBelowStopPrice', type: 'DECIMAL', required: false },
                { name: 'pendingBelowTrailingDelta', type: 'LONG', required: false },
                { name: 'pendingBelowIcebergQty', type: 'DECIMAL', required: false },
                { name: 'pendingBelowTimeInForce', type: 'ENUM', required: false },
                { name: 'pendingBelowStrategyId', type: 'LONG', required: false },
                { name: 'pendingBelowStrategyType', type: 'LONG', required: false },
                { name: 'recvWindow', type: 'LONG', required: false },
            ], notes: 'Place an OTOCO order.', docUrl: 'https://developers.binance.com/docs/binance-spot-api-docs/rest-api#new-order-list---otoco-trade',
        },
        {
            id: 'spot:GET:/api/v3/myTrades',
            apiGroup: 'spot', category: 'Trading', method: 'GET', path: '/api/v3/myTrades',
            security: 'SIGNED', weight: 20, params: [
                { name: 'symbol', type: 'STRING', required: true },
                { name: 'orderId', type: 'LONG', required: false },
                { name: 'startTime', type: 'LONG', required: false },
                { name: 'endTime', type: 'LONG', required: false },
                { name: 'fromId', type: 'LONG', required: false },
                { name: 'limit', type: 'LONG', required: false, description: 'Default 500; max 1000' },
                { name: 'recvWindow', type: 'LONG', required: false },
            ], notes: 'Get trades for a specific account and symbol.', docUrl: 'https://developers.binance.com/docs/binance-spot-api-docs/rest-api#account-trade-list-user_data',
        },
        {
            id: 'spot:GET:/api/v3/rateLimit/order',
            apiGroup: 'spot', category: 'Trading', method: 'GET', path: '/api/v3/rateLimit/order',
            security: 'SIGNED', weight: 40, params: [
                { name: 'recvWindow', type: 'LONG', required: false },
            ], notes: "Displays the user's current order count usage for all intervals.", docUrl: 'https://developers.binance.com/docs/binance-spot-api-docs/rest-api#query-unfilled-order-count-user_data',
        },
        {
            id: 'spot:GET:/api/v3/myPreventedMatches',
            apiGroup: 'spot', category: 'Trading', method: 'GET', path: '/api/v3/myPreventedMatches',
            security: 'SIGNED', weight: 4, params: [
                { name: 'symbol', type: 'STRING', required: true },
                { name: 'preventedMatchId', type: 'LONG', required: false },
                { name: 'orderId', type: 'LONG', required: false },
                { name: 'fromPreventedMatchId', type: 'LONG', required: false },
                { name: 'limit', type: 'LONG', required: false },
                { name: 'recvWindow', type: 'LONG', required: false },
            ], notes: 'Displays the list of orders that were expired due to STP.', docUrl: 'https://developers.binance.com/docs/binance-spot-api-docs/rest-api#query-prevented-matches-user_data',
        },
        {
            id: 'spot:GET:/api/v3/myAllocations',
            apiGroup: 'spot', category: 'Trading', method: 'GET', path: '/api/v3/myAllocations',
            security: 'SIGNED', weight: 20, params: [
                { name: 'symbol', type: 'STRING', required: true },
                { name: 'startTime', type: 'LONG', required: false },
                { name: 'endTime', type: 'LONG', required: false },
                { name: 'fromAllocationId', type: 'LONG', required: false },
                { name: 'limit', type: 'LONG', required: false },
                { name: 'orderId', type: 'LONG', required: false },
                { name: 'recvWindow', type: 'LONG', required: false },
            ], notes: 'Retrieves allocations resulting from SOR order fills.', docUrl: 'https://developers.binance.com/docs/binance-spot-api-docs/rest-api#query-allocations-user_data',
        },
        {
            id: 'spot:GET:/api/v3/account/commission',
            apiGroup: 'spot', category: 'Trading', method: 'GET', path: '/api/v3/account/commission',
            security: 'SIGNED', weight: 20, params: [
                { name: 'symbol', type: 'STRING', required: true },
            ], notes: 'Get current account commission rates.', docUrl: 'https://developers.binance.com/docs/binance-spot-api-docs/rest-api#query-commission-rates-user_data',
        },
        {
            id: 'spot:POST:/api/v3/sor/order',
            apiGroup: 'spot', category: 'Trading', method: 'POST', path: '/api/v3/sor/order',
            security: 'SIGNED', weight: 1, params: [
                { name: 'symbol', type: 'STRING', required: true },
                { name: 'side', type: 'ENUM', required: true, enumValues: ['BUY', 'SELL'] },
                { name: 'type', type: 'ENUM', required: true, enumValues: ['LIMIT', 'MARKET'] },
                { name: 'timeInForce', type: 'ENUM', required: false, enumValues: ['GTC', 'IOC', 'FOK'] },
                { name: 'quantity', type: 'DECIMAL', required: true },
                { name: 'price', type: 'DECIMAL', required: false },
                { name: 'newClientOrderId', type: 'STRING', required: false },
                { name: 'newOrderRespType', type: 'ENUM', required: false, enumValues: ['ACK', 'RESULT', 'FULL'] },
                { name: 'icebergQty', type: 'DECIMAL', required: false },
                { name: 'strategyId', type: 'LONG', required: false },
                { name: 'strategyType', type: 'LONG', required: false },
                { name: 'selfTradePreventionMode', type: 'ENUM', required: false },
                { name: 'recvWindow', type: 'LONG', required: false },
            ], notes: 'Places an order with SOR.', docUrl: 'https://developers.binance.com/docs/binance-spot-api-docs/rest-api#new-order-using-sor-trade',
        },
        {
            id: 'spot:POST:/api/v3/sor/order/test',
            apiGroup: 'spot', category: 'Trading', method: 'POST', path: '/api/v3/sor/order/test',
            security: 'SIGNED', weight: 1, params: [
                { name: 'symbol', type: 'STRING', required: true },
                { name: 'side', type: 'ENUM', required: true, enumValues: ['BUY', 'SELL'] },
                { name: 'type', type: 'ENUM', required: true, enumValues: ['LIMIT', 'MARKET'] },
                { name: 'quantity', type: 'DECIMAL', required: true },
                { name: 'price', type: 'DECIMAL', required: false },
                { name: 'newClientOrderId', type: 'STRING', required: false },
                { name: 'recvWindow', type: 'LONG', required: false },
            ], notes: 'Test new order using SOR (does not create real order).', docUrl: 'https://developers.binance.com/docs/binance-spot-api-docs/rest-api#test-new-order-using-sor-trade',
        },

        // === Account ===
        {
            id: 'spot:GET:/api/v3/account',
            apiGroup: 'spot', category: 'Account', method: 'GET', path: '/api/v3/account',
            security: 'SIGNED', weight: 20, params: [
                { name: 'omitZeroBalances', type: 'BOOLEAN', required: false, description: 'If true, will hide all zero balances' },
                { name: 'recvWindow', type: 'LONG', required: false },
            ], notes: 'Get current account information.', docUrl: 'https://developers.binance.com/docs/binance-spot-api-docs/rest-api#account-information-user_data',
        },

        // === User Data Streams ===
        {
            id: 'spot:POST:/api/v3/userDataStream',
            apiGroup: 'spot', category: 'User Data Streams', method: 'POST', path: '/api/v3/userDataStream',
            security: 'API_KEY', weight: 2, params: [], notes: 'Start a new user data stream.', docUrl: 'https://developers.binance.com/docs/binance-spot-api-docs/rest-api#start-user-data-stream-user_stream',
        },
        {
            id: 'spot:PUT:/api/v3/userDataStream',
            apiGroup: 'spot', category: 'User Data Streams', method: 'PUT', path: '/api/v3/userDataStream',
            security: 'API_KEY', weight: 2, params: [
                { name: 'listenKey', type: 'STRING', required: true },
            ], notes: 'Keepalive a user data stream.', docUrl: 'https://developers.binance.com/docs/binance-spot-api-docs/rest-api#keepalive-user-data-stream-user_stream',
        },
        {
            id: 'spot:DELETE:/api/v3/userDataStream',
            apiGroup: 'spot', category: 'User Data Streams', method: 'DELETE', path: '/api/v3/userDataStream',
            security: 'API_KEY', weight: 2, params: [
                { name: 'listenKey', type: 'STRING', required: true },
            ], notes: 'Close a user data stream.', docUrl: 'https://developers.binance.com/docs/binance-spot-api-docs/rest-api#close-user-data-stream-user_stream',
        },

        // === Wallet (sapi) ===
        {
            id: 'spot:GET:/sapi/v1/system/status',
            apiGroup: 'spot', category: 'Wallet', method: 'GET', path: '/sapi/v1/system/status',
            security: 'NONE', weight: 1, params: [], notes: 'Fetch system status.', docUrl: 'https://developers.binance.com/docs/wallet/others/system-status',
        },
        {
            id: 'spot:GET:/sapi/v1/capital/config/getall',
            apiGroup: 'spot', category: 'Wallet', method: 'GET', path: '/sapi/v1/capital/config/getall',
            security: 'SIGNED', weight: 10, params: [
                { name: 'recvWindow', type: 'LONG', required: false },
            ], notes: 'Get information of coins (available for deposit and withdraw).', docUrl: 'https://developers.binance.com/docs/wallet/capital/all-coins-info',
        },
        {
            id: 'spot:GET:/sapi/v1/accountSnapshot',
            apiGroup: 'spot', category: 'Wallet', method: 'GET', path: '/sapi/v1/accountSnapshot',
            security: 'SIGNED', weight: 2400, params: [
                { name: 'type', type: 'ENUM', required: true, enumValues: ['SPOT', 'MARGIN', 'FUTURES'] },
                { name: 'startTime', type: 'LONG', required: false },
                { name: 'endTime', type: 'LONG', required: false },
                { name: 'limit', type: 'LONG', required: false, description: 'min 7, max 30, default 7' },
                { name: 'recvWindow', type: 'LONG', required: false },
            ], notes: 'Daily account snapshot.', docUrl: 'https://developers.binance.com/docs/wallet/account/daily-account-snapshot',
        },
        {
            id: 'spot:POST:/sapi/v1/account/disableFastWithdrawSwitch',
            apiGroup: 'spot', category: 'Wallet', method: 'POST', path: '/sapi/v1/account/disableFastWithdrawSwitch',
            security: 'SIGNED', weight: 1, params: [
                { name: 'recvWindow', type: 'LONG', required: false },
            ], notes: 'Disable fast withdraw switch.', docUrl: 'https://developers.binance.com/docs/wallet/account',
        },
        {
            id: 'spot:POST:/sapi/v1/account/enableFastWithdrawSwitch',
            apiGroup: 'spot', category: 'Wallet', method: 'POST', path: '/sapi/v1/account/enableFastWithdrawSwitch',
            security: 'SIGNED', weight: 1, params: [
                { name: 'recvWindow', type: 'LONG', required: false },
            ], notes: 'Enable fast withdraw switch.', docUrl: 'https://developers.binance.com/docs/wallet/account',
        },
        {
            id: 'spot:POST:/sapi/v1/capital/withdraw/apply',
            apiGroup: 'spot', category: 'Wallet', method: 'POST', path: '/sapi/v1/capital/withdraw/apply',
            security: 'SIGNED', weight: 600, params: [
                { name: 'coin', type: 'STRING', required: true },
                { name: 'withdrawOrderId', type: 'STRING', required: false },
                { name: 'network', type: 'STRING', required: false },
                { name: 'address', type: 'STRING', required: true },
                { name: 'addressTag', type: 'STRING', required: false },
                { name: 'amount', type: 'DECIMAL', required: true },
                { name: 'transactionFeeFlag', type: 'BOOLEAN', required: false },
                { name: 'name', type: 'STRING', required: false },
                { name: 'walletType', type: 'LONG', required: false },
                { name: 'recvWindow', type: 'LONG', required: false },
            ], notes: 'Submit a withdraw request.', docUrl: 'https://developers.binance.com/docs/wallet/capital/withdraw',
        },
        {
            id: 'spot:GET:/sapi/v1/capital/deposit/hisrec',
            apiGroup: 'spot', category: 'Wallet', method: 'GET', path: '/sapi/v1/capital/deposit/hisrec',
            security: 'SIGNED', weight: 1, params: [
                { name: 'coin', type: 'STRING', required: false },
                { name: 'status', type: 'LONG', required: false },
                { name: 'startTime', type: 'LONG', required: false },
                { name: 'endTime', type: 'LONG', required: false },
                { name: 'offset', type: 'LONG', required: false },
                { name: 'limit', type: 'LONG', required: false },
                { name: 'recvWindow', type: 'LONG', required: false },
                { name: 'txId', type: 'STRING', required: false },
            ], notes: 'Fetch deposit history.', docUrl: 'https://developers.binance.com/docs/wallet/capital/deposit-history',
        },
        {
            id: 'spot:GET:/sapi/v1/capital/withdraw/history',
            apiGroup: 'spot', category: 'Wallet', method: 'GET', path: '/sapi/v1/capital/withdraw/history',
            security: 'SIGNED', weight: 18000, params: [
                { name: 'coin', type: 'STRING', required: false },
                { name: 'withdrawOrderId', type: 'STRING', required: false },
                { name: 'status', type: 'LONG', required: false },
                { name: 'startTime', type: 'LONG', required: false },
                { name: 'endTime', type: 'LONG', required: false },
                { name: 'offset', type: 'LONG', required: false },
                { name: 'limit', type: 'LONG', required: false },
                { name: 'recvWindow', type: 'LONG', required: false },
            ], notes: 'Fetch withdraw history.', docUrl: 'https://developers.binance.com/docs/wallet/capital/withdraw-history',
        },
        {
            id: 'spot:GET:/sapi/v1/capital/deposit/address',
            apiGroup: 'spot', category: 'Wallet', method: 'GET', path: '/sapi/v1/capital/deposit/address',
            security: 'SIGNED', weight: 10, params: [
                { name: 'coin', type: 'STRING', required: true },
                { name: 'network', type: 'STRING', required: false },
                { name: 'recvWindow', type: 'LONG', required: false },
            ], notes: 'Fetch deposit address.', docUrl: 'https://developers.binance.com/docs/wallet/capital/deposit-address',
        },
        {
            id: 'spot:GET:/sapi/v1/account/status',
            apiGroup: 'spot', category: 'Wallet', method: 'GET', path: '/sapi/v1/account/status',
            security: 'SIGNED', weight: 1, params: [
                { name: 'recvWindow', type: 'LONG', required: false },
            ], notes: 'Fetch account status detail.', docUrl: 'https://developers.binance.com/docs/wallet/account/account-status',
        },
        {
            id: 'spot:GET:/sapi/v1/account/apiTradingStatus',
            apiGroup: 'spot', category: 'Wallet', method: 'GET', path: '/sapi/v1/account/apiTradingStatus',
            security: 'SIGNED', weight: 1, params: [
                { name: 'recvWindow', type: 'LONG', required: false },
            ], notes: 'Fetch account API trading status with details.', docUrl: 'https://developers.binance.com/docs/wallet/account/account-api-trading-status',
        },
        {
            id: 'spot:GET:/sapi/v1/asset/dribblet',
            apiGroup: 'spot', category: 'Wallet', method: 'GET', path: '/sapi/v1/asset/dribblet',
            security: 'SIGNED', weight: 1, params: [
                { name: 'startTime', type: 'LONG', required: false },
                { name: 'endTime', type: 'LONG', required: false },
                { name: 'recvWindow', type: 'LONG', required: false },
            ], notes: 'DustLog: query the historical records of dust conversion.', docUrl: 'https://developers.binance.com/docs/wallet/asset/dust-log',
        },
        {
            id: 'spot:POST:/sapi/v1/asset/dust',
            apiGroup: 'spot', category: 'Wallet', method: 'POST', path: '/sapi/v1/asset/dust',
            security: 'SIGNED', weight: 10, params: [
                { name: 'asset', type: 'STRING', required: true, description: 'Array of assets to convert, separated by comma' },
                { name: 'recvWindow', type: 'LONG', required: false },
            ], notes: 'Convert dust assets to BNB.', docUrl: 'https://developers.binance.com/docs/wallet/asset/dust-transfer',
        },
        {
            id: 'spot:GET:/sapi/v1/asset/assetDividend',
            apiGroup: 'spot', category: 'Wallet', method: 'GET', path: '/sapi/v1/asset/assetDividend',
            security: 'SIGNED', weight: 10, params: [
                { name: 'asset', type: 'STRING', required: false },
                { name: 'startTime', type: 'LONG', required: false },
                { name: 'endTime', type: 'LONG', required: false },
                { name: 'limit', type: 'LONG', required: false },
                { name: 'recvWindow', type: 'LONG', required: false },
            ], notes: 'Query asset dividend record.', docUrl: 'https://developers.binance.com/docs/wallet/asset/asset-dividend',
        },
        {
            id: 'spot:POST:/sapi/v1/asset/transfer',
            apiGroup: 'spot', category: 'Wallet', method: 'POST', path: '/sapi/v1/asset/transfer',
            security: 'SIGNED', weight: 900, params: [
                { name: 'type', type: 'ENUM', required: true, enumValues: ['MAIN_UMFUTURE', 'MAIN_CMFUTURE', 'MAIN_MARGIN', 'UMFUTURE_MAIN', 'UMFUTURE_MARGIN', 'CMFUTURE_MAIN', 'CMFUTURE_MARGIN', 'MARGIN_MAIN', 'MARGIN_UMFUTURE', 'MARGIN_CMFUTURE', 'MAIN_FUNDING', 'FUNDING_MAIN', 'FUNDING_UMFUTURE', 'FUNDING_CMFUTURE', 'UMFUTURE_FUNDING', 'CMFUTURE_FUNDING', 'MAIN_OPTION', 'OPTION_MAIN'] },
                { name: 'asset', type: 'STRING', required: true },
                { name: 'amount', type: 'DECIMAL', required: true },
                { name: 'fromSymbol', type: 'STRING', required: false },
                { name: 'toSymbol', type: 'STRING', required: false },
                { name: 'recvWindow', type: 'LONG', required: false },
            ], notes: 'User Universal Transfer.', docUrl: 'https://developers.binance.com/docs/wallet/asset/user-universal-transfer',
        },
        {
            id: 'spot:GET:/sapi/v1/asset/transfer',
            apiGroup: 'spot', category: 'Wallet', method: 'GET', path: '/sapi/v1/asset/transfer',
            security: 'SIGNED', weight: 1, params: [
                { name: 'type', type: 'ENUM', required: true },
                { name: 'startTime', type: 'LONG', required: false },
                { name: 'endTime', type: 'LONG', required: false },
                { name: 'current', type: 'LONG', required: false },
                { name: 'size', type: 'LONG', required: false },
                { name: 'fromSymbol', type: 'STRING', required: false },
                { name: 'toSymbol', type: 'STRING', required: false },
                { name: 'recvWindow', type: 'LONG', required: false },
            ], notes: 'Query User Universal Transfer History.', docUrl: 'https://developers.binance.com/docs/wallet/asset/query-user-universal-transfer',
        },
        {
            id: 'spot:POST:/sapi/v1/asset/get-funding-asset',
            apiGroup: 'spot', category: 'Wallet', method: 'POST', path: '/sapi/v1/asset/get-funding-asset',
            security: 'SIGNED', weight: 1, params: [
                { name: 'asset', type: 'STRING', required: false },
                { name: 'needBtcValuation', type: 'STRING', required: false },
                { name: 'recvWindow', type: 'LONG', required: false },
            ], notes: 'Funding Wallet.', docUrl: 'https://developers.binance.com/docs/wallet/asset/funding-wallet',
        },
        {
            id: 'spot:GET:/sapi/v1/asset/ledger-transfer/cloud-mining/queryByPage',
            apiGroup: 'spot', category: 'Wallet', method: 'GET', path: '/sapi/v1/asset/ledger-transfer/cloud-mining/queryByPage',
            security: 'SIGNED', weight: 600, params: [
                { name: 'tranId', type: 'LONG', required: false },
                { name: 'clientTranId', type: 'STRING', required: false },
                { name: 'asset', type: 'STRING', required: false },
                { name: 'startTime', type: 'LONG', required: true },
                { name: 'endTime', type: 'LONG', required: true },
                { name: 'current', type: 'LONG', required: false },
                { name: 'size', type: 'LONG', required: false },
            ], notes: 'Get Cloud-Mining payment and refund history.', docUrl: 'https://developers.binance.com/docs/wallet/asset/cloud-mining-history',
        },
        {
            id: 'spot:GET:/sapi/v1/account/apiRestrictions',
            apiGroup: 'spot', category: 'Wallet', method: 'GET', path: '/sapi/v1/account/apiRestrictions',
            security: 'SIGNED', weight: 1, params: [
                { name: 'recvWindow', type: 'LONG', required: false },
            ], notes: 'Get API Key Permission.', docUrl: 'https://developers.binance.com/docs/wallet/account/api-key-permission',
        },
        {
            id: 'spot:GET:/sapi/v1/asset/tradeFee',
            apiGroup: 'spot', category: 'Wallet', method: 'GET', path: '/sapi/v1/asset/tradeFee',
            security: 'SIGNED', weight: 1, params: [
                { name: 'symbol', type: 'STRING', required: false },
                { name: 'recvWindow', type: 'LONG', required: false },
            ], notes: 'Fetch trade fee.', docUrl: 'https://developers.binance.com/docs/wallet/asset/trade-fee',
        },
        {
            id: 'spot:GET:/sapi/v1/asset/assetDetail',
            apiGroup: 'spot', category: 'Wallet', method: 'GET', path: '/sapi/v1/asset/assetDetail',
            security: 'SIGNED', weight: 1, params: [
                { name: 'asset', type: 'STRING', required: false },
                { name: 'recvWindow', type: 'LONG', required: false },
            ], notes: 'Fetch details of assets supported on Binance.', docUrl: 'https://developers.binance.com/docs/wallet/asset/asset-detail',
        },

        // === Margin ===
        {
            id: 'spot:POST:/sapi/v1/margin/transfer',
            apiGroup: 'spot', category: 'Margin', method: 'POST', path: '/sapi/v1/margin/transfer',
            security: 'SIGNED', weight: 600, params: [
                { name: 'asset', type: 'STRING', required: true },
                { name: 'amount', type: 'DECIMAL', required: true },
                { name: 'type', type: 'LONG', required: true, description: '1: main to margin, 2: margin to main' },
                { name: 'recvWindow', type: 'LONG', required: false },
            ], notes: 'Execute transfer between spot account and cross margin account.', docUrl: 'https://developers.binance.com/docs/margin_trading/transfer',
        },
        {
            id: 'spot:POST:/sapi/v1/margin/loan',
            apiGroup: 'spot', category: 'Margin', method: 'POST', path: '/sapi/v1/margin/loan',
            security: 'SIGNED', weight: 3000, params: [
                { name: 'asset', type: 'STRING', required: true },
                { name: 'isIsolated', type: 'STRING', required: false },
                { name: 'symbol', type: 'STRING', required: false },
                { name: 'amount', type: 'DECIMAL', required: true },
                { name: 'recvWindow', type: 'LONG', required: false },
            ], notes: 'Apply for a loan.', docUrl: 'https://developers.binance.com/docs/margin_trading/borrow-and-repay/margin-account-borrow',
        },
        {
            id: 'spot:POST:/sapi/v1/margin/repay',
            apiGroup: 'spot', category: 'Margin', method: 'POST', path: '/sapi/v1/margin/repay',
            security: 'SIGNED', weight: 3000, params: [
                { name: 'asset', type: 'STRING', required: true },
                { name: 'isIsolated', type: 'STRING', required: false },
                { name: 'symbol', type: 'STRING', required: false },
                { name: 'amount', type: 'DECIMAL', required: true },
                { name: 'recvWindow', type: 'LONG', required: false },
            ], notes: 'Repay loan for margin account.', docUrl: 'https://developers.binance.com/docs/margin_trading/borrow-and-repay/margin-account-repay',
        },
        {
            id: 'spot:POST:/sapi/v1/margin/order',
            apiGroup: 'spot', category: 'Margin', method: 'POST', path: '/sapi/v1/margin/order',
            security: 'SIGNED', weight: 6, params: [
                { name: 'symbol', type: 'STRING', required: true },
                { name: 'isIsolated', type: 'STRING', required: false },
                { name: 'side', type: 'ENUM', required: true, enumValues: ['BUY', 'SELL'] },
                { name: 'type', type: 'ENUM', required: true, enumValues: ['LIMIT', 'MARKET', 'STOP_LOSS', 'STOP_LOSS_LIMIT', 'TAKE_PROFIT', 'TAKE_PROFIT_LIMIT', 'LIMIT_MAKER'] },
                { name: 'quantity', type: 'DECIMAL', required: false },
                { name: 'quoteOrderQty', type: 'DECIMAL', required: false },
                { name: 'price', type: 'DECIMAL', required: false },
                { name: 'stopPrice', type: 'DECIMAL', required: false },
                { name: 'newClientOrderId', type: 'STRING', required: false },
                { name: 'icebergQty', type: 'DECIMAL', required: false },
                { name: 'newOrderRespType', type: 'ENUM', required: false, enumValues: ['ACK', 'RESULT', 'FULL'] },
                { name: 'sideEffectType', type: 'ENUM', required: false, enumValues: ['NO_SIDE_EFFECT', 'MARGIN_BUY', 'AUTO_REPAY', 'AUTO_BORROW_REPAY'] },
                { name: 'timeInForce', type: 'ENUM', required: false, enumValues: ['GTC', 'IOC', 'FOK'] },
                { name: 'selfTradePreventionMode', type: 'ENUM', required: false },
                { name: 'recvWindow', type: 'LONG', required: false },
            ], notes: 'Post a new order for margin account.', docUrl: 'https://developers.binance.com/docs/margin_trading/trade/margin-account-new-order',
        },
        {
            id: 'spot:DELETE:/sapi/v1/margin/order',
            apiGroup: 'spot', category: 'Margin', method: 'DELETE', path: '/sapi/v1/margin/order',
            security: 'SIGNED', weight: 10, params: [
                { name: 'symbol', type: 'STRING', required: true },
                { name: 'isIsolated', type: 'STRING', required: false },
                { name: 'orderId', type: 'LONG', required: false },
                { name: 'origClientOrderId', type: 'STRING', required: false },
                { name: 'newClientOrderId', type: 'STRING', required: false },
                { name: 'recvWindow', type: 'LONG', required: false },
            ], notes: 'Cancel an active order for margin account.', docUrl: 'https://developers.binance.com/docs/margin_trading/trade/margin-account-cancel-order',
        },
        {
            id: 'spot:GET:/sapi/v1/margin/transfer',
            apiGroup: 'spot', category: 'Margin', method: 'GET', path: '/sapi/v1/margin/transfer',
            security: 'SIGNED', weight: 1, params: [
                { name: 'asset', type: 'STRING', required: false },
                { name: 'type', type: 'ENUM', required: false, enumValues: ['ROLL_IN', 'ROLL_OUT'] },
                { name: 'startTime', type: 'LONG', required: false },
                { name: 'endTime', type: 'LONG', required: false },
                { name: 'current', type: 'LONG', required: false },
                { name: 'size', type: 'LONG', required: false },
                { name: 'archived', type: 'STRING', required: false },
                { name: 'recvWindow', type: 'LONG', required: false },
            ], notes: 'Get Cross Margin Transfer History.', docUrl: 'https://developers.binance.com/docs/margin_trading/transfer/get-cross-margin-transfer-history',
        },
        {
            id: 'spot:GET:/sapi/v1/margin/account',
            apiGroup: 'spot', category: 'Margin', method: 'GET', path: '/sapi/v1/margin/account',
            security: 'SIGNED', weight: 10, params: [
                { name: 'recvWindow', type: 'LONG', required: false },
            ], notes: 'Get margin account details.', docUrl: 'https://developers.binance.com/docs/margin_trading/account/query-cross-margin-account-details',
        },
        {
            id: 'spot:GET:/sapi/v1/margin/order',
            apiGroup: 'spot', category: 'Margin', method: 'GET', path: '/sapi/v1/margin/order',
            security: 'SIGNED', weight: 10, params: [
                { name: 'symbol', type: 'STRING', required: true },
                { name: 'isIsolated', type: 'STRING', required: false },
                { name: 'orderId', type: 'LONG', required: false },
                { name: 'origClientOrderId', type: 'STRING', required: false },
                { name: 'recvWindow', type: 'LONG', required: false },
            ], notes: 'Query margin account order.', docUrl: 'https://developers.binance.com/docs/margin_trading/trade/query-margin-accounts-order',
        },
        {
            id: 'spot:GET:/sapi/v1/margin/openOrders',
            apiGroup: 'spot', category: 'Margin', method: 'GET', path: '/sapi/v1/margin/openOrders',
            security: 'SIGNED', weight: 10, params: [
                { name: 'symbol', type: 'STRING', required: false },
                { name: 'isIsolated', type: 'STRING', required: false },
                { name: 'recvWindow', type: 'LONG', required: false },
            ], notes: 'Query margin account open orders.', docUrl: 'https://developers.binance.com/docs/margin_trading/trade/query-margin-accounts-open-orders',
        },
        {
            id: 'spot:GET:/sapi/v1/margin/allOrders',
            apiGroup: 'spot', category: 'Margin', method: 'GET', path: '/sapi/v1/margin/allOrders',
            security: 'SIGNED', weight: 200, params: [
                { name: 'symbol', type: 'STRING', required: true },
                { name: 'isIsolated', type: 'STRING', required: false },
                { name: 'orderId', type: 'LONG', required: false },
                { name: 'startTime', type: 'LONG', required: false },
                { name: 'endTime', type: 'LONG', required: false },
                { name: 'limit', type: 'LONG', required: false },
                { name: 'recvWindow', type: 'LONG', required: false },
            ], notes: 'Query all margin account orders.', docUrl: 'https://developers.binance.com/docs/margin_trading/trade/query-margin-accounts-all-orders',
        },
        {
            id: 'spot:GET:/sapi/v1/margin/myTrades',
            apiGroup: 'spot', category: 'Margin', method: 'GET', path: '/sapi/v1/margin/myTrades',
            security: 'SIGNED', weight: 10, params: [
                { name: 'symbol', type: 'STRING', required: true },
                { name: 'isIsolated', type: 'STRING', required: false },
                { name: 'orderId', type: 'LONG', required: false },
                { name: 'startTime', type: 'LONG', required: false },
                { name: 'endTime', type: 'LONG', required: false },
                { name: 'fromId', type: 'LONG', required: false },
                { name: 'limit', type: 'LONG', required: false },
                { name: 'recvWindow', type: 'LONG', required: false },
            ], notes: 'Query margin account trade list.', docUrl: 'https://developers.binance.com/docs/margin_trading/trade/query-margin-accounts-trade-list',
        },
        {
            id: 'spot:GET:/sapi/v1/margin/maxBorrowable',
            apiGroup: 'spot', category: 'Margin', method: 'GET', path: '/sapi/v1/margin/maxBorrowable',
            security: 'SIGNED', weight: 50, params: [
                { name: 'asset', type: 'STRING', required: true },
                { name: 'isolatedSymbol', type: 'STRING', required: false },
                { name: 'recvWindow', type: 'LONG', required: false },
            ], notes: 'Query maximum borrow amount.', docUrl: 'https://developers.binance.com/docs/margin_trading/borrow-and-repay/query-max-borrow',
        },
        {
            id: 'spot:GET:/sapi/v1/margin/maxTransferable',
            apiGroup: 'spot', category: 'Margin', method: 'GET', path: '/sapi/v1/margin/maxTransferable',
            security: 'SIGNED', weight: 50, params: [
                { name: 'asset', type: 'STRING', required: true },
                { name: 'isolatedSymbol', type: 'STRING', required: false },
                { name: 'recvWindow', type: 'LONG', required: false },
            ], notes: 'Query max transfer-out amount.', docUrl: 'https://developers.binance.com/docs/margin_trading/transfer/query-max-transfer-out-amount',
        },

        // === Sub-Account ===
        {
            id: 'spot:GET:/sapi/v1/sub-account/list',
            apiGroup: 'spot', category: 'Sub-Account', method: 'GET', path: '/sapi/v1/sub-account/list',
            security: 'SIGNED', weight: 1, params: [
                { name: 'email', type: 'STRING', required: false },
                { name: 'isFreeze', type: 'STRING', required: false },
                { name: 'page', type: 'LONG', required: false },
                { name: 'limit', type: 'LONG', required: false },
                { name: 'recvWindow', type: 'LONG', required: false },
            ], notes: "Query Sub-account List (For Master Account).", docUrl: 'https://developers.binance.com/docs/sub_account/account-management/query-sub-account-list',
        },

        // === Convert ===
        {
            id: 'spot:GET:/sapi/v1/convert/exchangeInfo',
            apiGroup: 'spot', category: 'Convert', method: 'GET', path: '/sapi/v1/convert/exchangeInfo',
            security: 'SIGNED', weight: 50, params: [
                { name: 'fromAsset', type: 'STRING', required: false },
                { name: 'toAsset', type: 'STRING', required: false },
                { name: 'recvWindow', type: 'LONG', required: false },
            ], notes: 'Query for all convertible token pairs and the tokens available for conversion.', docUrl: 'https://developers.binance.com/docs/convert/market-data',
        },
    ];

    writeCatalog(catalog);
}

main().catch((err) => {
    console.error('Error generating spot catalog:', err);
    process.exit(1);
});
