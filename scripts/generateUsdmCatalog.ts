#!/usr/bin/env ts-node
/**
 * Generate the USD-M Futures catalog (usdm.json) by crawling the Binance
 * Developer docs for USDⓈ-Margined Futures REST API.
 *
 * Usage:
 *   npx ts-node scripts/generateUsdmCatalog.ts
 *
 * The script uses the Binance developer docs sitemap to discover all
 * USD-M Futures REST API pages, then parses each page to extract
 * endpoint details.
 */

import axios from 'axios';
import * as cheerio from 'cheerio';
import * as fs from 'fs';
import * as path from 'path';
import { CatalogEntry, CatalogParam } from './catalogTypes';

const SITEMAP_URL = 'https://developers.binance.com/sitemap.xml';
const _DOCS_BASE = 'https://developers.binance.com/docs/derivatives/usds-margined-futures';
const REST_API_PATH_PATTERN = /\/docs\/derivatives\/usds-margined-futures\/.*rest-api/i;

// Rate limit: wait between fetches
function sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

/** Map Binance doc security label to catalog security type */
function mapSecurity(label: string): 'NONE' | 'API_KEY' | 'SIGNED' {
    const upper = label.toUpperCase();
    if (upper.includes('TRADE') || upper.includes('USER_DATA') || upper.includes('MARGIN')) {
        return 'SIGNED';
    }
    if (upper.includes('USER_STREAM') || upper.includes('MARKET_DATA')) {
        return 'API_KEY';
    }
    return 'NONE';
}

/** Parse a parameter type string */
function parseParamType(typeStr: string): string {
    const upper = typeStr.toUpperCase().trim();
    if (upper === 'INT' || upper === 'INTEGER' || upper === 'LONG') return 'LONG';
    if (upper === 'FLOAT' || upper === 'DOUBLE' || upper === 'DECIMAL') return 'DECIMAL';
    if (upper === 'BOOLEAN' || upper === 'BOOL') return 'BOOLEAN';
    if (upper === 'ENUM') return 'ENUM';
    return 'STRING';
}

/** Map URL path to category */
function urlToCategory(url: string): string {
    const lower = url.toLowerCase();
    if (lower.includes('market-data')) return 'Market Data';
    if (lower.includes('convert')) return 'Convert';
    if (lower.includes('portfolio-margin')) return 'Portfolio Margin Endpoints';
    if (lower.includes('trade') && !lower.includes('user-data') && !lower.includes('account')) return 'Trade';
    if (lower.includes('account')) return 'Account';
    return 'General';
}

async function fetchSitemapUrls(): Promise<string[]> {
    try {
        console.log('Fetching sitemap...');
        const resp = await axios.get(SITEMAP_URL, { timeout: 30000 });
        const $ = cheerio.load(resp.data, { xmlMode: true });
        const urls: string[] = [];
        $('url loc').each((_, el) => {
            const loc = $(el).text().trim();
            if (REST_API_PATH_PATTERN.test(loc)) {
                urls.push(loc);
            }
        });
        console.log(`Found ${urls.length} USD-M REST API pages in sitemap.`);
        return urls;
    } catch (err: any) {
        console.warn(`Failed to fetch sitemap: ${err.message}`);
        return [];
    }
}

async function parseEndpointPage(url: string): Promise<CatalogEntry | null> {
    try {
        const resp = await axios.get(url, { timeout: 30000 });
        const $ = cheerio.load(resp.data);

        // Find endpoint title and security label
        const title = $('h1').first().text().trim();
        if (!title) return null;

        // Extract security from title or page content (e.g., "(TRADE)")
        const secMatch = title.match(/\((TRADE|USER_DATA|USER_STREAM|MARKET_DATA|MARGIN|NONE)\)/i);
        const security = secMatch ? mapSecurity(secMatch[1]) : 'NONE';

        // Find HTTP method and path
        let method = '';
        let apiPath = '';
        const _httpRequestSection = $('*').filter((_, el) => {
            return $(el).text().includes('HTTP Request') || $(el).text().includes('API Description');
        });

        // Look for method + path pattern
        const fullText = $.html();
        const methodPathMatch = fullText.match(/(GET|POST|PUT|DELETE)\s+(\/fapi\/v\d+\/[^\s<"]+)/i);
        if (methodPathMatch) {
            method = methodPathMatch[1].toUpperCase();
            apiPath = methodPathMatch[2];
        }

        if (!method || !apiPath) return null;

        // Extract parameters from table
        const params: CatalogParam[] = [];
        $('table').each((_, table) => {
            const headers = $(table).find('th').map((__, th) => $(th).text().toLowerCase().trim()).get();
            const nameIdx = headers.findIndex(h => h === 'name' || h === 'parameter');
            const typeIdx = headers.findIndex(h => h === 'type');
            const mandatoryIdx = headers.findIndex(h => h.includes('mandatory') || h.includes('required'));
            const descIdx = headers.findIndex(h => h.includes('description'));

            if (nameIdx === -1 || typeIdx === -1) return;

            $(table).find('tbody tr, tr').each((__, row) => {
                const cells = $(row).find('td').map((___, td) => $(td).text().trim()).get();
                if (cells.length <= Math.max(nameIdx, typeIdx)) return;

                const name = cells[nameIdx];
                if (!name || name.toLowerCase() === 'name' || name.toLowerCase() === 'parameter') return;

                const type = parseParamType(cells[typeIdx] || 'STRING');
                let required = false;
                if (mandatoryIdx !== -1 && cells[mandatoryIdx]) {
                    required = cells[mandatoryIdx].toUpperCase() === 'YES' || cells[mandatoryIdx].toUpperCase() === 'TRUE';
                }
                const description = descIdx !== -1 ? cells[descIdx] || '' : '';

                params.push({ name, type, required, description });
            });
        });

        // Extract weight
        let weight = 1;
        const weightMatch2 = fullText.match(/weight[:\s]*(\d+)/i);
        if (weightMatch2) weight = parseInt(weightMatch2[1], 10);

        const category = urlToCategory(url);
        const id = `usdm:${method}:${apiPath}`;

        return {
            id,
            apiGroup: 'usdm',
            category,
            method,
            path: apiPath,
            security,
            weight,
            params,
            notes: title.replace(/\s*\(.*?\)\s*$/, '').trim(),
            docUrl: url,
        };
    } catch (err: any) {
        console.warn(`Failed to parse page ${url}: ${err.message}`);
        return null;
    }
}

function writeCatalog(catalog: CatalogEntry[]) {
    const outDir = path.resolve(__dirname, '..', 'resources', 'catalogs');
    fs.mkdirSync(outDir, { recursive: true });
    const outFile = path.join(outDir, 'usdm.json');
    fs.writeFileSync(outFile, JSON.stringify(catalog, null, 2), 'utf-8');
    console.log(`Wrote ${catalog.length} entries to ${outFile}`);
}

/**
 * Fallback: generate catalog with commonly used USD-M endpoints
 * when live crawling is not possible.
 */
function generateFallbackCatalog() {
    const catalog: CatalogEntry[] = [
        // === Market Data ===
        {
            id: 'usdm:GET:/fapi/v1/depth', apiGroup: 'usdm', category: 'Market Data', method: 'GET', path: '/fapi/v1/depth',
            security: 'NONE', weight: 5, params: [
                { name: 'symbol', type: 'STRING', required: true },
                { name: 'limit', type: 'LONG', required: false, description: 'Default 500; max 1000' },
            ], notes: 'Order book.', docUrl: 'https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Order-Book',
        },
        {
            id: 'usdm:GET:/fapi/v1/trades', apiGroup: 'usdm', category: 'Market Data', method: 'GET', path: '/fapi/v1/trades',
            security: 'NONE', weight: 5, params: [
                { name: 'symbol', type: 'STRING', required: true },
                { name: 'limit', type: 'LONG', required: false, description: 'Default 500; max 1000' },
            ], notes: 'Recent trades list.', docUrl: 'https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Recent-Trades-List',
        },
        {
            id: 'usdm:GET:/fapi/v1/historicalTrades', apiGroup: 'usdm', category: 'Market Data', method: 'GET', path: '/fapi/v1/historicalTrades',
            security: 'API_KEY', weight: 20, params: [
                { name: 'symbol', type: 'STRING', required: true },
                { name: 'limit', type: 'LONG', required: false },
                { name: 'fromId', type: 'LONG', required: false },
            ], notes: 'Old trades lookup.', docUrl: 'https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Old-Trades-Lookup',
        },
        {
            id: 'usdm:GET:/fapi/v1/aggTrades', apiGroup: 'usdm', category: 'Market Data', method: 'GET', path: '/fapi/v1/aggTrades',
            security: 'NONE', weight: 20, params: [
                { name: 'symbol', type: 'STRING', required: true },
                { name: 'fromId', type: 'LONG', required: false },
                { name: 'startTime', type: 'LONG', required: false },
                { name: 'endTime', type: 'LONG', required: false },
                { name: 'limit', type: 'LONG', required: false },
            ], notes: 'Compressed/aggregate trades list.', docUrl: 'https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Compressed-Aggregate-Trades-List',
        },
        {
            id: 'usdm:GET:/fapi/v1/klines', apiGroup: 'usdm', category: 'Market Data', method: 'GET', path: '/fapi/v1/klines',
            security: 'NONE', weight: 5, params: [
                { name: 'symbol', type: 'STRING', required: true },
                { name: 'interval', type: 'ENUM', required: true, enumValues: ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w', '1M'] },
                { name: 'startTime', type: 'LONG', required: false },
                { name: 'endTime', type: 'LONG', required: false },
                { name: 'limit', type: 'LONG', required: false, description: 'Default 500; max 1500' },
            ], notes: 'Kline/candlestick data.', docUrl: 'https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Kline-Candlestick-Data',
        },
        {
            id: 'usdm:GET:/fapi/v1/continuousKlines', apiGroup: 'usdm', category: 'Market Data', method: 'GET', path: '/fapi/v1/continuousKlines',
            security: 'NONE', weight: 5, params: [
                { name: 'pair', type: 'STRING', required: true },
                { name: 'contractType', type: 'ENUM', required: true, enumValues: ['PERPETUAL', 'CURRENT_MONTH', 'NEXT_MONTH', 'CURRENT_QUARTER', 'NEXT_QUARTER'] },
                { name: 'interval', type: 'ENUM', required: true, enumValues: ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w', '1M'] },
                { name: 'startTime', type: 'LONG', required: false },
                { name: 'endTime', type: 'LONG', required: false },
                { name: 'limit', type: 'LONG', required: false },
            ], notes: 'Continuous klines.', docUrl: 'https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Continuous-Contract-Kline-Candlestick-Data',
        },
        {
            id: 'usdm:GET:/fapi/v1/indexPriceKlines', apiGroup: 'usdm', category: 'Market Data', method: 'GET', path: '/fapi/v1/indexPriceKlines',
            security: 'NONE', weight: 5, params: [
                { name: 'pair', type: 'STRING', required: true },
                { name: 'interval', type: 'ENUM', required: true, enumValues: ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w', '1M'] },
                { name: 'startTime', type: 'LONG', required: false },
                { name: 'endTime', type: 'LONG', required: false },
                { name: 'limit', type: 'LONG', required: false },
            ], notes: 'Index price klines.', docUrl: 'https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Index-Price-Kline-Candlestick-Data',
        },
        {
            id: 'usdm:GET:/fapi/v1/markPriceKlines', apiGroup: 'usdm', category: 'Market Data', method: 'GET', path: '/fapi/v1/markPriceKlines',
            security: 'NONE', weight: 5, params: [
                { name: 'symbol', type: 'STRING', required: true },
                { name: 'interval', type: 'ENUM', required: true, enumValues: ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w', '1M'] },
                { name: 'startTime', type: 'LONG', required: false },
                { name: 'endTime', type: 'LONG', required: false },
                { name: 'limit', type: 'LONG', required: false },
            ], notes: 'Mark price klines.', docUrl: 'https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Mark-Price-Kline-Candlestick-Data',
        },
        {
            id: 'usdm:GET:/fapi/v1/premiumIndexKlines', apiGroup: 'usdm', category: 'Market Data', method: 'GET', path: '/fapi/v1/premiumIndexKlines',
            security: 'NONE', weight: 5, params: [
                { name: 'symbol', type: 'STRING', required: true },
                { name: 'interval', type: 'ENUM', required: true, enumValues: ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w', '1M'] },
                { name: 'startTime', type: 'LONG', required: false },
                { name: 'endTime', type: 'LONG', required: false },
                { name: 'limit', type: 'LONG', required: false },
            ], notes: 'Premium index klines.', docUrl: 'https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Premium-Index-Kline-Data',
        },
        {
            id: 'usdm:GET:/fapi/v1/premiumIndex', apiGroup: 'usdm', category: 'Market Data', method: 'GET', path: '/fapi/v1/premiumIndex',
            security: 'NONE', weight: 1, params: [
                { name: 'symbol', type: 'STRING', required: false },
            ], notes: 'Mark price and funding rate.', docUrl: 'https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Mark-Price',
        },
        {
            id: 'usdm:GET:/fapi/v1/fundingRate', apiGroup: 'usdm', category: 'Market Data', method: 'GET', path: '/fapi/v1/fundingRate',
            security: 'NONE', weight: 1, params: [
                { name: 'symbol', type: 'STRING', required: false },
                { name: 'startTime', type: 'LONG', required: false },
                { name: 'endTime', type: 'LONG', required: false },
                { name: 'limit', type: 'LONG', required: false, description: 'Default 100; max 1000' },
            ], notes: 'Funding rate history.', docUrl: 'https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Get-Funding-Rate-History',
        },
        {
            id: 'usdm:GET:/fapi/v1/fundingInfo', apiGroup: 'usdm', category: 'Market Data', method: 'GET', path: '/fapi/v1/fundingInfo',
            security: 'NONE', weight: 1, params: [], notes: 'Funding rate info.', docUrl: 'https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Get-Funding-Rate-Info',
        },
        {
            id: 'usdm:GET:/fapi/v1/ticker/24hr', apiGroup: 'usdm', category: 'Market Data', method: 'GET', path: '/fapi/v1/ticker/24hr',
            security: 'NONE', weight: 1, params: [
                { name: 'symbol', type: 'STRING', required: false },
            ], notes: '24hr ticker price change statistics.', docUrl: 'https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/24hr-Ticker-Price-Change-Statistics',
        },
        {
            id: 'usdm:GET:/fapi/v1/ticker/price', apiGroup: 'usdm', category: 'Market Data', method: 'GET', path: '/fapi/v1/ticker/price',
            security: 'NONE', weight: 1, params: [
                { name: 'symbol', type: 'STRING', required: false },
            ], notes: 'Symbol price ticker.', docUrl: 'https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Symbol-Price-Ticker',
        },
        {
            id: 'usdm:GET:/fapi/v1/ticker/bookTicker', apiGroup: 'usdm', category: 'Market Data', method: 'GET', path: '/fapi/v1/ticker/bookTicker',
            security: 'NONE', weight: 1, params: [
                { name: 'symbol', type: 'STRING', required: false },
            ], notes: 'Symbol order book ticker.', docUrl: 'https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Symbol-Order-Book-Ticker',
        },
        {
            id: 'usdm:GET:/fapi/v1/openInterest', apiGroup: 'usdm', category: 'Market Data', method: 'GET', path: '/fapi/v1/openInterest',
            security: 'NONE', weight: 1, params: [
                { name: 'symbol', type: 'STRING', required: true },
            ], notes: 'Open interest.', docUrl: 'https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Open-Interest',
        },
        {
            id: 'usdm:GET:/futures/data/openInterestHist', apiGroup: 'usdm', category: 'Market Data', method: 'GET', path: '/futures/data/openInterestHist',
            security: 'NONE', weight: 1, params: [
                { name: 'symbol', type: 'STRING', required: true },
                { name: 'period', type: 'ENUM', required: true, enumValues: ['5m', '15m', '30m', '1h', '2h', '4h', '6h', '12h', '1d'] },
                { name: 'limit', type: 'LONG', required: false },
                { name: 'startTime', type: 'LONG', required: false },
                { name: 'endTime', type: 'LONG', required: false },
            ], notes: 'Open interest statistics.', docUrl: 'https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Open-Interest-Statistics',
        },
        {
            id: 'usdm:GET:/futures/data/topLongShortAccountRatio', apiGroup: 'usdm', category: 'Market Data', method: 'GET', path: '/futures/data/topLongShortAccountRatio',
            security: 'NONE', weight: 1, params: [
                { name: 'symbol', type: 'STRING', required: true },
                { name: 'period', type: 'ENUM', required: true, enumValues: ['5m', '15m', '30m', '1h', '2h', '4h', '6h', '12h', '1d'] },
                { name: 'limit', type: 'LONG', required: false },
                { name: 'startTime', type: 'LONG', required: false },
                { name: 'endTime', type: 'LONG', required: false },
            ], notes: 'Top trader long/short ratio (accounts).', docUrl: 'https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Top-Trader-Long-Short-Ratio',
        },
        {
            id: 'usdm:GET:/futures/data/topLongShortPositionRatio', apiGroup: 'usdm', category: 'Market Data', method: 'GET', path: '/futures/data/topLongShortPositionRatio',
            security: 'NONE', weight: 1, params: [
                { name: 'symbol', type: 'STRING', required: true },
                { name: 'period', type: 'ENUM', required: true, enumValues: ['5m', '15m', '30m', '1h', '2h', '4h', '6h', '12h', '1d'] },
                { name: 'limit', type: 'LONG', required: false },
                { name: 'startTime', type: 'LONG', required: false },
                { name: 'endTime', type: 'LONG', required: false },
            ], notes: 'Top trader long/short ratio (positions).', docUrl: 'https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Top-Trader-Long-Short-Ratio-Positions',
        },
        {
            id: 'usdm:GET:/futures/data/globalLongShortAccountRatio', apiGroup: 'usdm', category: 'Market Data', method: 'GET', path: '/futures/data/globalLongShortAccountRatio',
            security: 'NONE', weight: 1, params: [
                { name: 'symbol', type: 'STRING', required: true },
                { name: 'period', type: 'ENUM', required: true, enumValues: ['5m', '15m', '30m', '1h', '2h', '4h', '6h', '12h', '1d'] },
                { name: 'limit', type: 'LONG', required: false },
                { name: 'startTime', type: 'LONG', required: false },
                { name: 'endTime', type: 'LONG', required: false },
            ], notes: 'Long/short ratio (global).', docUrl: 'https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Long-Short-Ratio',
        },
        {
            id: 'usdm:GET:/futures/data/takerlongshortRatio', apiGroup: 'usdm', category: 'Market Data', method: 'GET', path: '/futures/data/takerlongshortRatio',
            security: 'NONE', weight: 1, params: [
                { name: 'symbol', type: 'STRING', required: true },
                { name: 'period', type: 'ENUM', required: true, enumValues: ['5m', '15m', '30m', '1h', '2h', '4h', '6h', '12h', '1d'] },
                { name: 'limit', type: 'LONG', required: false },
                { name: 'startTime', type: 'LONG', required: false },
                { name: 'endTime', type: 'LONG', required: false },
            ], notes: 'Taker buy/sell volume.', docUrl: 'https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Taker-BuySell-Volume',
        },
        {
            id: 'usdm:GET:/fapi/v1/lvtKlines', apiGroup: 'usdm', category: 'Market Data', method: 'GET', path: '/fapi/v1/lvtKlines',
            security: 'NONE', weight: 1, params: [
                { name: 'symbol', type: 'STRING', required: true },
                { name: 'interval', type: 'ENUM', required: true, enumValues: ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w', '1M'] },
                { name: 'startTime', type: 'LONG', required: false },
                { name: 'endTime', type: 'LONG', required: false },
                { name: 'limit', type: 'LONG', required: false },
            ], notes: 'Historical BLVT NAV klines.', docUrl: 'https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Historical-BLVT-NAV-Kline-Candlestick',
        },
        {
            id: 'usdm:GET:/fapi/v1/indexInfo', apiGroup: 'usdm', category: 'Market Data', method: 'GET', path: '/fapi/v1/indexInfo',
            security: 'NONE', weight: 1, params: [
                { name: 'symbol', type: 'STRING', required: false },
            ], notes: 'Composite index symbol information.', docUrl: 'https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Composite-Index-Symbol-Information',
        },
        {
            id: 'usdm:GET:/fapi/v1/assetIndex', apiGroup: 'usdm', category: 'Market Data', method: 'GET', path: '/fapi/v1/assetIndex',
            security: 'NONE', weight: 1, params: [
                { name: 'symbol', type: 'STRING', required: false },
            ], notes: 'Multi-assets mode asset index.', docUrl: 'https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Multi-Assets-Mode-Asset-Index',
        },
        {
            id: 'usdm:GET:/fapi/v1/constituents', apiGroup: 'usdm', category: 'Market Data', method: 'GET', path: '/fapi/v1/constituents',
            security: 'NONE', weight: 2, params: [
                { name: 'symbol', type: 'STRING', required: true },
            ], notes: 'Query index price constituents.', docUrl: 'https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Index-Price-Constituents',
        },

        // === Trade ===
        {
            id: 'usdm:POST:/fapi/v1/order', apiGroup: 'usdm', category: 'Trade', method: 'POST', path: '/fapi/v1/order',
            security: 'SIGNED', weight: 1, params: [
                { name: 'symbol', type: 'STRING', required: true },
                { name: 'side', type: 'ENUM', required: true, enumValues: ['BUY', 'SELL'] },
                { name: 'positionSide', type: 'ENUM', required: false, enumValues: ['BOTH', 'LONG', 'SHORT'] },
                { name: 'type', type: 'ENUM', required: true, enumValues: ['LIMIT', 'MARKET', 'STOP', 'STOP_MARKET', 'TAKE_PROFIT', 'TAKE_PROFIT_MARKET', 'TRAILING_STOP_MARKET'] },
                { name: 'reduceOnly', type: 'STRING', required: false },
                { name: 'quantity', type: 'DECIMAL', required: false },
                { name: 'price', type: 'DECIMAL', required: false },
                { name: 'newClientOrderId', type: 'STRING', required: false },
                { name: 'stopPrice', type: 'DECIMAL', required: false },
                { name: 'closePosition', type: 'STRING', required: false },
                { name: 'activationPrice', type: 'DECIMAL', required: false },
                { name: 'callbackRate', type: 'DECIMAL', required: false },
                { name: 'timeInForce', type: 'ENUM', required: false, enumValues: ['GTC', 'IOC', 'FOK', 'GTX', 'GTD'], default: 'GTC' },
                { name: 'workingType', type: 'ENUM', required: false, enumValues: ['MARK_PRICE', 'CONTRACT_PRICE'] },
                { name: 'priceProtect', type: 'STRING', required: false },
                { name: 'newOrderRespType', type: 'ENUM', required: false, enumValues: ['ACK', 'RESULT'] },
                { name: 'priceMatch', type: 'ENUM', required: false, enumValues: ['NONE', 'OPPONENT', 'OPPONENT_5', 'OPPONENT_10', 'OPPONENT_20', 'QUEUE', 'QUEUE_5', 'QUEUE_10', 'QUEUE_20'] },
                { name: 'selfTradePreventionMode', type: 'ENUM', required: false, enumValues: ['NONE', 'EXPIRE_TAKER', 'EXPIRE_MAKER', 'EXPIRE_BOTH'] },
                { name: 'goodTillDate', type: 'LONG', required: false },
                { name: 'recvWindow', type: 'LONG', required: false },
            ], notes: 'New order.', docUrl: 'https://developers.binance.com/docs/derivatives/usds-margined-futures/trade/rest-api/New-Order',
        },
        {
            id: 'usdm:POST:/fapi/v1/order/test', apiGroup: 'usdm', category: 'Trade', method: 'POST', path: '/fapi/v1/order/test',
            security: 'SIGNED', weight: 1, params: [
                { name: 'symbol', type: 'STRING', required: true },
                { name: 'side', type: 'ENUM', required: true, enumValues: ['BUY', 'SELL'] },
                { name: 'positionSide', type: 'ENUM', required: false, enumValues: ['BOTH', 'LONG', 'SHORT'] },
                { name: 'type', type: 'ENUM', required: true, enumValues: ['LIMIT', 'MARKET', 'STOP', 'STOP_MARKET', 'TAKE_PROFIT', 'TAKE_PROFIT_MARKET', 'TRAILING_STOP_MARKET'] },
                { name: 'reduceOnly', type: 'STRING', required: false },
                { name: 'quantity', type: 'DECIMAL', required: false },
                { name: 'price', type: 'DECIMAL', required: false },
                { name: 'newClientOrderId', type: 'STRING', required: false },
                { name: 'stopPrice', type: 'DECIMAL', required: false },
                { name: 'closePosition', type: 'STRING', required: false },
                { name: 'activationPrice', type: 'DECIMAL', required: false },
                { name: 'callbackRate', type: 'DECIMAL', required: false },
                { name: 'timeInForce', type: 'ENUM', required: false, enumValues: ['GTC', 'IOC', 'FOK', 'GTX', 'GTD'], default: 'GTC' },
                { name: 'workingType', type: 'ENUM', required: false, enumValues: ['MARK_PRICE', 'CONTRACT_PRICE'] },
                { name: 'priceProtect', type: 'STRING', required: false },
                { name: 'newOrderRespType', type: 'ENUM', required: false, enumValues: ['ACK', 'RESULT'] },
                { name: 'recvWindow', type: 'LONG', required: false },
            ], notes: 'Test new order (does not send to matching engine).', docUrl: 'https://developers.binance.com/docs/derivatives/usds-margined-futures/trade/rest-api/New-Order-Test',
        },
        {
            id: 'usdm:PUT:/fapi/v1/order', apiGroup: 'usdm', category: 'Trade', method: 'PUT', path: '/fapi/v1/order',
            security: 'SIGNED', weight: 1, params: [
                { name: 'orderId', type: 'LONG', required: false },
                { name: 'origClientOrderId', type: 'STRING', required: false },
                { name: 'symbol', type: 'STRING', required: true },
                { name: 'side', type: 'ENUM', required: true, enumValues: ['BUY', 'SELL'] },
                { name: 'quantity', type: 'DECIMAL', required: true },
                { name: 'price', type: 'DECIMAL', required: true },
                { name: 'priceMatch', type: 'ENUM', required: false },
                { name: 'recvWindow', type: 'LONG', required: false },
            ], notes: 'Modify order.', docUrl: 'https://developers.binance.com/docs/derivatives/usds-margined-futures/trade/rest-api/Modify-Order',
        },
        {
            id: 'usdm:POST:/fapi/v1/batchOrders', apiGroup: 'usdm', category: 'Trade', method: 'POST', path: '/fapi/v1/batchOrders',
            security: 'SIGNED', weight: 5, params: [
                { name: 'batchOrders', type: 'STRING', required: true, description: 'JSON array of order objects, max 5 orders' },
                { name: 'recvWindow', type: 'LONG', required: false },
            ], notes: 'Place multiple orders.', docUrl: 'https://developers.binance.com/docs/derivatives/usds-margined-futures/trade/rest-api/Place-Multiple-Orders',
        },
        {
            id: 'usdm:PUT:/fapi/v1/batchOrders', apiGroup: 'usdm', category: 'Trade', method: 'PUT', path: '/fapi/v1/batchOrders',
            security: 'SIGNED', weight: 5, params: [
                { name: 'batchOrders', type: 'STRING', required: true, description: 'JSON array of order objects, max 5 orders' },
                { name: 'recvWindow', type: 'LONG', required: false },
            ], notes: 'Modify multiple orders.', docUrl: 'https://developers.binance.com/docs/derivatives/usds-margined-futures/trade/rest-api/Modify-Multiple-Orders',
        },
        {
            id: 'usdm:GET:/fapi/v1/orderAmendment', apiGroup: 'usdm', category: 'Trade', method: 'GET', path: '/fapi/v1/orderAmendment',
            security: 'SIGNED', weight: 1, params: [
                { name: 'symbol', type: 'STRING', required: true },
                { name: 'orderId', type: 'LONG', required: false },
                { name: 'origClientOrderId', type: 'STRING', required: false },
                { name: 'startTime', type: 'LONG', required: false },
                { name: 'endTime', type: 'LONG', required: false },
                { name: 'limit', type: 'LONG', required: false },
                { name: 'recvWindow', type: 'LONG', required: false },
            ], notes: 'Get order modify history.', docUrl: 'https://developers.binance.com/docs/derivatives/usds-margined-futures/trade/rest-api/Get-Order-Modify-History',
        },
        {
            id: 'usdm:GET:/fapi/v1/order', apiGroup: 'usdm', category: 'Trade', method: 'GET', path: '/fapi/v1/order',
            security: 'SIGNED', weight: 1, params: [
                { name: 'symbol', type: 'STRING', required: true },
                { name: 'orderId', type: 'LONG', required: false },
                { name: 'origClientOrderId', type: 'STRING', required: false },
                { name: 'recvWindow', type: 'LONG', required: false },
            ], notes: 'Query order.', docUrl: 'https://developers.binance.com/docs/derivatives/usds-margined-futures/trade/rest-api/Query-Order',
        },
        {
            id: 'usdm:DELETE:/fapi/v1/order', apiGroup: 'usdm', category: 'Trade', method: 'DELETE', path: '/fapi/v1/order',
            security: 'SIGNED', weight: 1, params: [
                { name: 'symbol', type: 'STRING', required: true },
                { name: 'orderId', type: 'LONG', required: false },
                { name: 'origClientOrderId', type: 'STRING', required: false },
                { name: 'recvWindow', type: 'LONG', required: false },
            ], notes: 'Cancel order.', docUrl: 'https://developers.binance.com/docs/derivatives/usds-margined-futures/trade/rest-api/Cancel-Order',
        },
        {
            id: 'usdm:DELETE:/fapi/v1/allOpenOrders', apiGroup: 'usdm', category: 'Trade', method: 'DELETE', path: '/fapi/v1/allOpenOrders',
            security: 'SIGNED', weight: 1, params: [
                { name: 'symbol', type: 'STRING', required: true },
                { name: 'recvWindow', type: 'LONG', required: false },
            ], notes: 'Cancel all open orders.', docUrl: 'https://developers.binance.com/docs/derivatives/usds-margined-futures/trade/rest-api/Cancel-All-Open-Orders',
        },
        {
            id: 'usdm:DELETE:/fapi/v1/batchOrders', apiGroup: 'usdm', category: 'Trade', method: 'DELETE', path: '/fapi/v1/batchOrders',
            security: 'SIGNED', weight: 1, params: [
                { name: 'symbol', type: 'STRING', required: true },
                { name: 'orderIdList', type: 'STRING', required: false, description: 'JSON array of orderIds, max 10' },
                { name: 'origClientOrderIdList', type: 'STRING', required: false, description: 'JSON array of client order IDs, max 10' },
                { name: 'recvWindow', type: 'LONG', required: false },
            ], notes: 'Cancel multiple orders.', docUrl: 'https://developers.binance.com/docs/derivatives/usds-margined-futures/trade/rest-api/Cancel-Multiple-Orders',
        },
        {
            id: 'usdm:POST:/fapi/v1/countdownCancelAll', apiGroup: 'usdm', category: 'Trade', method: 'POST', path: '/fapi/v1/countdownCancelAll',
            security: 'SIGNED', weight: 10, params: [
                { name: 'symbol', type: 'STRING', required: true },
                { name: 'countdownTime', type: 'LONG', required: true, description: 'Countdown time in ms. 0 to cancel timer.' },
                { name: 'recvWindow', type: 'LONG', required: false },
            ], notes: 'Auto-cancel all open orders (countdown).', docUrl: 'https://developers.binance.com/docs/derivatives/usds-margined-futures/trade/rest-api/Auto-Cancel-All-Open-Orders',
        },
        {
            id: 'usdm:GET:/fapi/v1/openOrder', apiGroup: 'usdm', category: 'Trade', method: 'GET', path: '/fapi/v1/openOrder',
            security: 'SIGNED', weight: 1, params: [
                { name: 'symbol', type: 'STRING', required: true },
                { name: 'orderId', type: 'LONG', required: false },
                { name: 'origClientOrderId', type: 'STRING', required: false },
                { name: 'recvWindow', type: 'LONG', required: false },
            ], notes: 'Query current open order.', docUrl: 'https://developers.binance.com/docs/derivatives/usds-margined-futures/trade/rest-api/Query-Current-Open-Order',
        },
        {
            id: 'usdm:GET:/fapi/v1/openOrders', apiGroup: 'usdm', category: 'Trade', method: 'GET', path: '/fapi/v1/openOrders',
            security: 'SIGNED', weight: 1, params: [
                { name: 'symbol', type: 'STRING', required: false },
                { name: 'recvWindow', type: 'LONG', required: false },
            ], notes: 'Current all open orders.', docUrl: 'https://developers.binance.com/docs/derivatives/usds-margined-futures/trade/rest-api/Current-All-Open-Orders',
        },
        {
            id: 'usdm:GET:/fapi/v1/allOrders', apiGroup: 'usdm', category: 'Trade', method: 'GET', path: '/fapi/v1/allOrders',
            security: 'SIGNED', weight: 5, params: [
                { name: 'symbol', type: 'STRING', required: true },
                { name: 'orderId', type: 'LONG', required: false },
                { name: 'startTime', type: 'LONG', required: false },
                { name: 'endTime', type: 'LONG', required: false },
                { name: 'limit', type: 'LONG', required: false },
                { name: 'recvWindow', type: 'LONG', required: false },
            ], notes: 'All orders.', docUrl: 'https://developers.binance.com/docs/derivatives/usds-margined-futures/trade/rest-api/All-Orders',
        },
        {
            id: 'usdm:GET:/fapi/v1/userTrades', apiGroup: 'usdm', category: 'Trade', method: 'GET', path: '/fapi/v1/userTrades',
            security: 'SIGNED', weight: 5, params: [
                { name: 'symbol', type: 'STRING', required: true },
                { name: 'orderId', type: 'LONG', required: false },
                { name: 'startTime', type: 'LONG', required: false },
                { name: 'endTime', type: 'LONG', required: false },
                { name: 'fromId', type: 'LONG', required: false },
                { name: 'limit', type: 'LONG', required: false },
                { name: 'recvWindow', type: 'LONG', required: false },
            ], notes: 'Account trade list.', docUrl: 'https://developers.binance.com/docs/derivatives/usds-margined-futures/trade/rest-api/Account-Trade-List',
        },
        {
            id: 'usdm:GET:/fapi/v1/forceOrders', apiGroup: 'usdm', category: 'Trade', method: 'GET', path: '/fapi/v1/forceOrders',
            security: 'SIGNED', weight: 20, params: [
                { name: 'symbol', type: 'STRING', required: false },
                { name: 'autoCloseType', type: 'ENUM', required: false, enumValues: ['LIQUIDATION', 'ADL'] },
                { name: 'startTime', type: 'LONG', required: false },
                { name: 'endTime', type: 'LONG', required: false },
                { name: 'limit', type: 'LONG', required: false },
                { name: 'recvWindow', type: 'LONG', required: false },
            ], notes: "User's force orders.", docUrl: 'https://developers.binance.com/docs/derivatives/usds-margined-futures/trade/rest-api/Users-Force-Orders',
        },

        // === Account ===
        {
            id: 'usdm:POST:/fapi/v1/positionSide/dual', apiGroup: 'usdm', category: 'Account', method: 'POST', path: '/fapi/v1/positionSide/dual',
            security: 'SIGNED', weight: 1, params: [
                { name: 'dualSidePosition', type: 'STRING', required: true, description: '"true": Hedge Mode; "false": One-way Mode' },
                { name: 'recvWindow', type: 'LONG', required: false },
            ], notes: 'Change position mode.', docUrl: 'https://developers.binance.com/docs/derivatives/usds-margined-futures/trade/rest-api/Change-Position-Mode',
        },
        {
            id: 'usdm:GET:/fapi/v1/positionSide/dual', apiGroup: 'usdm', category: 'Account', method: 'GET', path: '/fapi/v1/positionSide/dual',
            security: 'SIGNED', weight: 30, params: [
                { name: 'recvWindow', type: 'LONG', required: false },
            ], notes: 'Get current position mode.', docUrl: 'https://developers.binance.com/docs/derivatives/usds-margined-futures/trade/rest-api/Get-Current-Position-Mode',
        },
        {
            id: 'usdm:POST:/fapi/v1/multiAssetsMargin', apiGroup: 'usdm', category: 'Account', method: 'POST', path: '/fapi/v1/multiAssetsMargin',
            security: 'SIGNED', weight: 1, params: [
                { name: 'multiAssetsMargin', type: 'STRING', required: true, description: '"true": Multi-Assets Mode; "false": Single-Asset Mode' },
                { name: 'recvWindow', type: 'LONG', required: false },
            ], notes: 'Change multi-assets mode.', docUrl: 'https://developers.binance.com/docs/derivatives/usds-margined-futures/trade/rest-api/Change-Multi-Assets-Mode',
        },
        {
            id: 'usdm:GET:/fapi/v1/multiAssetsMargin', apiGroup: 'usdm', category: 'Account', method: 'GET', path: '/fapi/v1/multiAssetsMargin',
            security: 'SIGNED', weight: 30, params: [
                { name: 'recvWindow', type: 'LONG', required: false },
            ], notes: 'Get current multi-assets mode.', docUrl: 'https://developers.binance.com/docs/derivatives/usds-margined-futures/trade/rest-api/Get-Current-Multi-Assets-Mode',
        },
        {
            id: 'usdm:POST:/fapi/v1/marginType', apiGroup: 'usdm', category: 'Account', method: 'POST', path: '/fapi/v1/marginType',
            security: 'SIGNED', weight: 1, params: [
                { name: 'symbol', type: 'STRING', required: true },
                { name: 'marginType', type: 'ENUM', required: true, enumValues: ['ISOLATED', 'CROSSED'] },
                { name: 'recvWindow', type: 'LONG', required: false },
            ], notes: 'Change margin type.', docUrl: 'https://developers.binance.com/docs/derivatives/usds-margined-futures/trade/rest-api/Change-Margin-Type',
        },
        {
            id: 'usdm:POST:/fapi/v1/positionMargin', apiGroup: 'usdm', category: 'Account', method: 'POST', path: '/fapi/v1/positionMargin',
            security: 'SIGNED', weight: 1, params: [
                { name: 'symbol', type: 'STRING', required: true },
                { name: 'positionSide', type: 'ENUM', required: false, enumValues: ['BOTH', 'LONG', 'SHORT'] },
                { name: 'amount', type: 'DECIMAL', required: true },
                { name: 'type', type: 'LONG', required: true, description: '1: Add; 2: Reduce' },
                { name: 'recvWindow', type: 'LONG', required: false },
            ], notes: 'Modify isolated position margin.', docUrl: 'https://developers.binance.com/docs/derivatives/usds-margined-futures/trade/rest-api/Modify-Isolated-Position-Margin',
        },
        {
            id: 'usdm:GET:/fapi/v1/positionMargin/history', apiGroup: 'usdm', category: 'Account', method: 'GET', path: '/fapi/v1/positionMargin/history',
            security: 'SIGNED', weight: 1, params: [
                { name: 'symbol', type: 'STRING', required: true },
                { name: 'type', type: 'LONG', required: false },
                { name: 'startTime', type: 'LONG', required: false },
                { name: 'endTime', type: 'LONG', required: false },
                { name: 'limit', type: 'LONG', required: false },
                { name: 'recvWindow', type: 'LONG', required: false },
            ], notes: 'Get position margin change history.', docUrl: 'https://developers.binance.com/docs/derivatives/usds-margined-futures/trade/rest-api/Get-Position-Margin-Change-History',
        },
        {
            id: 'usdm:GET:/fapi/v2/positionRisk', apiGroup: 'usdm', category: 'Account', method: 'GET', path: '/fapi/v2/positionRisk',
            security: 'SIGNED', weight: 5, params: [
                { name: 'symbol', type: 'STRING', required: false },
                { name: 'recvWindow', type: 'LONG', required: false },
            ], notes: 'Position information V2.', docUrl: 'https://developers.binance.com/docs/derivatives/usds-margined-futures/trade/rest-api/Position-Information-V2',
        },
        {
            id: 'usdm:GET:/fapi/v3/positionRisk', apiGroup: 'usdm', category: 'Account', method: 'GET', path: '/fapi/v3/positionRisk',
            security: 'SIGNED', weight: 5, params: [
                { name: 'symbol', type: 'STRING', required: false },
                { name: 'recvWindow', type: 'LONG', required: false },
            ], notes: 'Position information V3.', docUrl: 'https://developers.binance.com/docs/derivatives/usds-margined-futures/trade/rest-api/Position-Information-V3',
        },
        {
            id: 'usdm:GET:/fapi/v2/account', apiGroup: 'usdm', category: 'Account', method: 'GET', path: '/fapi/v2/account',
            security: 'SIGNED', weight: 5, params: [
                { name: 'recvWindow', type: 'LONG', required: false },
            ], notes: 'Account information V2.', docUrl: 'https://developers.binance.com/docs/derivatives/usds-margined-futures/account/rest-api/Account-Information-V2',
        },
        {
            id: 'usdm:GET:/fapi/v3/account', apiGroup: 'usdm', category: 'Account', method: 'GET', path: '/fapi/v3/account',
            security: 'SIGNED', weight: 5, params: [
                { name: 'recvWindow', type: 'LONG', required: false },
            ], notes: 'Account information V3.', docUrl: 'https://developers.binance.com/docs/derivatives/usds-margined-futures/account/rest-api/Account-Information-V3',
        },
        {
            id: 'usdm:GET:/fapi/v2/balance', apiGroup: 'usdm', category: 'Account', method: 'GET', path: '/fapi/v2/balance',
            security: 'SIGNED', weight: 5, params: [
                { name: 'recvWindow', type: 'LONG', required: false },
            ], notes: 'Futures account balance V2.', docUrl: 'https://developers.binance.com/docs/derivatives/usds-margined-futures/account/rest-api/Futures-Account-Balance-V2',
        },
        {
            id: 'usdm:GET:/fapi/v3/balance', apiGroup: 'usdm', category: 'Account', method: 'GET', path: '/fapi/v3/balance',
            security: 'SIGNED', weight: 5, params: [
                { name: 'recvWindow', type: 'LONG', required: false },
            ], notes: 'Futures account balance V3.', docUrl: 'https://developers.binance.com/docs/derivatives/usds-margined-futures/account/rest-api/Futures-Account-Balance-V3',
        },
        {
            id: 'usdm:POST:/fapi/v1/leverage', apiGroup: 'usdm', category: 'Account', method: 'POST', path: '/fapi/v1/leverage',
            security: 'SIGNED', weight: 1, params: [
                { name: 'symbol', type: 'STRING', required: true },
                { name: 'leverage', type: 'LONG', required: true, description: 'target initial leverage: int from 1 to 125' },
                { name: 'recvWindow', type: 'LONG', required: false },
            ], notes: 'Change initial leverage.', docUrl: 'https://developers.binance.com/docs/derivatives/usds-margined-futures/trade/rest-api/Change-Initial-Leverage',
        },
        {
            id: 'usdm:GET:/fapi/v1/leverageBracket', apiGroup: 'usdm', category: 'Account', method: 'GET', path: '/fapi/v1/leverageBracket',
            security: 'SIGNED', weight: 1, params: [
                { name: 'symbol', type: 'STRING', required: false },
                { name: 'recvWindow', type: 'LONG', required: false },
            ], notes: 'Notional and leverage brackets.', docUrl: 'https://developers.binance.com/docs/derivatives/usds-margined-futures/account/rest-api/Notional-and-Leverage-Brackets',
        },
        {
            id: 'usdm:GET:/fapi/v1/adlQuantile', apiGroup: 'usdm', category: 'Account', method: 'GET', path: '/fapi/v1/adlQuantile',
            security: 'SIGNED', weight: 5, params: [
                { name: 'symbol', type: 'STRING', required: false },
                { name: 'recvWindow', type: 'LONG', required: false },
            ], notes: 'Position ADL quantile estimation.', docUrl: 'https://developers.binance.com/docs/derivatives/usds-margined-futures/account/rest-api/Position-ADL-Quantile-Estimation',
        },
        {
            id: 'usdm:GET:/fapi/v1/income', apiGroup: 'usdm', category: 'Account', method: 'GET', path: '/fapi/v1/income',
            security: 'SIGNED', weight: 30, params: [
                { name: 'symbol', type: 'STRING', required: false },
                { name: 'incomeType', type: 'ENUM', required: false, enumValues: ['TRANSFER', 'WELCOME_BONUS', 'REALIZED_PNL', 'FUNDING_FEE', 'COMMISSION', 'INSURANCE_CLEAR', 'REFERRAL_KICKBACK', 'COMMISSION_REBATE', 'API_REBATE', 'CONTEST_REWARD', 'CROSS_COLLATERAL_TRANSFER', 'OPTIONS_PREMIUM_FEE', 'OPTIONS_SETTLE_PROFIT', 'INTERNAL_TRANSFER', 'AUTO_EXCHANGE', 'DELIVERED_SETTELMENT', 'COIN_SWAP_DEPOSIT', 'COIN_SWAP_WITHDRAW', 'POSITION_LIMIT_INCREASE_FEE'] },
                { name: 'startTime', type: 'LONG', required: false },
                { name: 'endTime', type: 'LONG', required: false },
                { name: 'page', type: 'LONG', required: false },
                { name: 'limit', type: 'LONG', required: false },
                { name: 'recvWindow', type: 'LONG', required: false },
            ], notes: 'Get income history.', docUrl: 'https://developers.binance.com/docs/derivatives/usds-margined-futures/account/rest-api/Get-Income-History',
        },
        {
            id: 'usdm:GET:/fapi/v1/commissionRate', apiGroup: 'usdm', category: 'Account', method: 'GET', path: '/fapi/v1/commissionRate',
            security: 'SIGNED', weight: 20, params: [
                { name: 'symbol', type: 'STRING', required: true },
                { name: 'recvWindow', type: 'LONG', required: false },
            ], notes: 'User commission rate.', docUrl: 'https://developers.binance.com/docs/derivatives/usds-margined-futures/account/rest-api/User-Commission-Rate',
        },
        {
            id: 'usdm:GET:/fapi/v1/apiTradingStatus', apiGroup: 'usdm', category: 'Account', method: 'GET', path: '/fapi/v1/apiTradingStatus',
            security: 'SIGNED', weight: 1, params: [
                { name: 'symbol', type: 'STRING', required: false },
                { name: 'recvWindow', type: 'LONG', required: false },
            ], notes: 'Account API trading status.', docUrl: 'https://developers.binance.com/docs/derivatives/usds-margined-futures/account/rest-api/Futures-Trading-Quantitative-Rules-Indicators',
        },
        {
            id: 'usdm:GET:/fapi/v1/income/asyn', apiGroup: 'usdm', category: 'Account', method: 'GET', path: '/fapi/v1/income/asyn',
            security: 'SIGNED', weight: 5, params: [
                { name: 'startTime', type: 'LONG', required: true },
                { name: 'endTime', type: 'LONG', required: true },
                { name: 'recvWindow', type: 'LONG', required: false },
            ], notes: 'Get download ID for futures transaction history.', docUrl: 'https://developers.binance.com/docs/derivatives/usds-margined-futures/account/rest-api/Get-Download-Id-For-Futures-Transaction-History',
        },
        {
            id: 'usdm:GET:/fapi/v1/income/asyn/id', apiGroup: 'usdm', category: 'Account', method: 'GET', path: '/fapi/v1/income/asyn/id',
            security: 'SIGNED', weight: 5, params: [
                { name: 'downloadId', type: 'STRING', required: true },
                { name: 'recvWindow', type: 'LONG', required: false },
            ], notes: 'Get futures transaction history download link by ID.', docUrl: 'https://developers.binance.com/docs/derivatives/usds-margined-futures/account/rest-api/Get-Futures-Transaction-History-Download-Link-by-Id',
        },

        // === Convert ===
        {
            id: 'usdm:GET:/fapi/v1/convert/exchangeInfo', apiGroup: 'usdm', category: 'Convert', method: 'GET', path: '/fapi/v1/convert/exchangeInfo',
            security: 'NONE', weight: 20, params: [
                { name: 'fromAsset', type: 'STRING', required: false, description: 'User spends coin' },
                { name: 'toAsset', type: 'STRING', required: false, description: 'User receives coin' },
            ], notes: 'List all convert pairs.', docUrl: 'https://developers.binance.com/docs/derivatives/usds-margined-futures/convert',
        },
        {
            id: 'usdm:POST:/fapi/v1/convert/getQuote', apiGroup: 'usdm', category: 'Convert', method: 'POST', path: '/fapi/v1/convert/getQuote',
            security: 'SIGNED', weight: 50, params: [
                { name: 'fromAsset', type: 'STRING', required: true },
                { name: 'toAsset', type: 'STRING', required: true },
                { name: 'fromAmount', type: 'DECIMAL', required: false, description: 'Either fromAmount or toAmount must be sent', exclusiveGroup: 'convertAmount' },
                { name: 'toAmount', type: 'DECIMAL', required: false, description: 'Either fromAmount or toAmount must be sent', exclusiveGroup: 'convertAmount' },
                { name: 'validTime', type: 'ENUM', required: false, enumValues: ['10s'], description: 'Default 10s' },
                { name: 'recvWindow', type: 'LONG', required: false },
            ], notes: 'Send quote request.', docUrl: 'https://developers.binance.com/docs/derivatives/usds-margined-futures/convert/Send-quote-request',
        },
        {
            id: 'usdm:POST:/fapi/v1/convert/acceptQuote', apiGroup: 'usdm', category: 'Convert', method: 'POST', path: '/fapi/v1/convert/acceptQuote',
            security: 'SIGNED', weight: 200, params: [
                { name: 'quoteId', type: 'STRING', required: true },
                { name: 'recvWindow', type: 'LONG', required: false },
            ], notes: 'Accept the offered quote.', docUrl: 'https://developers.binance.com/docs/derivatives/usds-margined-futures/convert/Accept-Quote',
        },
        {
            id: 'usdm:GET:/fapi/v1/convert/orderStatus', apiGroup: 'usdm', category: 'Convert', method: 'GET', path: '/fapi/v1/convert/orderStatus',
            security: 'SIGNED', weight: 50, params: [
                { name: 'orderId', type: 'STRING', required: false, description: 'Either orderId or quoteId is required' },
                { name: 'quoteId', type: 'STRING', required: false, description: 'Either orderId or quoteId is required' },
            ], notes: 'Order status.', docUrl: 'https://developers.binance.com/docs/derivatives/usds-margined-futures/convert/Order-Status',
        },

        // === Portfolio Margin Endpoints ===
        {
            id: 'usdm:GET:/fapi/v1/pmAccountInfo', apiGroup: 'usdm', category: 'Portfolio Margin Endpoints', method: 'GET', path: '/fapi/v1/pmAccountInfo',
            security: 'SIGNED', weight: 5, params: [
                { name: 'asset', type: 'STRING', required: true },
                { name: 'recvWindow', type: 'LONG', required: false },
            ], notes: 'Classic portfolio margin account information.', docUrl: 'https://developers.binance.com/docs/derivatives/usds-margined-futures/portfolio-margin-endpoints',
        },
    ];

    writeCatalog(catalog);
}

async function main() {
    const urls = await fetchSitemapUrls();

    if (urls.length === 0) {
        console.log('No sitemap URLs found or sitemap unavailable. Using fallback catalog.');
        generateFallbackCatalog();
        return;
    }

    const catalog: CatalogEntry[] = [];
    const seen = new Set<string>();
    const allowedCategories = new Set(['Market Data', 'Trade', 'Account', 'Convert', 'Portfolio Margin Endpoints']);

    for (const url of urls) {
        console.log(`Parsing: ${url}`);
        const entry = await parseEndpointPage(url);
        if (entry && !seen.has(entry.id) && allowedCategories.has(entry.category)) {
            seen.add(entry.id);
            catalog.push(entry);
        }
        await sleep(500); // Be polite
    }

    if (catalog.length === 0) {
        console.log('No endpoints parsed from live docs. Using fallback catalog.');
        generateFallbackCatalog();
        return;
    }

    writeCatalog(catalog);
}

main().catch((err) => {
    console.error('Error generating USD-M catalog:', err);
    // Fall back to built-in definitions on error
    generateFallbackCatalog();
});
