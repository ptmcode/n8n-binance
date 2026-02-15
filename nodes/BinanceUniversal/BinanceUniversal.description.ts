/**
 * BinanceUniversal node description.
 *
 * Defines all UI parameters for the Binance Universal (REST) node.
 */

import type { INodeProperties } from 'n8n-workflow';

// ─── Catalog Loading ────────────────────────────────────────────────────────

import spotCatalogJson from '../../resources/catalogs/spot.json';
import usdmCatalogJson from '../../resources/catalogs/usdm.json';
import type { CatalogEntry } from './catalogTypes';

const spotCatalog: CatalogEntry[] = spotCatalogJson as unknown as CatalogEntry[];
const usdmCatalog: CatalogEntry[] = usdmCatalogJson as unknown as CatalogEntry[];

/** Get unique categories for a given API group */
function getCategories(catalog: CatalogEntry[]): Array<{ name: string; value: string }> {
    const cats = [...new Set(catalog.map((e) => e.category))];
    cats.sort();
    return cats.map((c) => ({ name: c, value: c }));
}

/** Get endpoint options for dropdown, optionally filtered by category */
function getEndpointOptions(
    catalog: CatalogEntry[],
): Array<{ name: string; value: string; description?: string }> {
    return catalog.map((e) => ({
        name: `${e.method} ${e.path}`,
        value: e.id,
        description: e.notes || undefined,
    }));
}

const spotCategories = getCategories(spotCatalog);
const usdmCategories = getCategories(usdmCatalog);
const spotEndpoints = getEndpointOptions(spotCatalog);
const usdmEndpoints = getEndpointOptions(usdmCatalog);

// Create index maps for security type lookups
const spotSecurityMap = new Map<string, string>();
for (const entry of spotCatalog) {
    spotSecurityMap.set(entry.id, entry.security);
}

const usdmSecurityMap = new Map<string, string>();
for (const entry of usdmCatalog) {
    usdmSecurityMap.set(entry.id, entry.security);
}

// Get endpoint IDs that require API_KEY or SIGNED security
const spotEndpointsRequiringApiKey = spotCatalog
    .filter((e) => e.security === 'API_KEY' || e.security === 'SIGNED')
    .map((e) => e.id);

const spotEndpointsRequiringSigned = spotCatalog
    .filter((e) => e.security === 'SIGNED')
    .map((e) => e.id);

const usdmEndpointsRequiringApiKey = usdmCatalog
    .filter((e) => e.security === 'API_KEY' || e.security === 'SIGNED')
    .map((e) => e.id);

const usdmEndpointsRequiringSigned = usdmCatalog
    .filter((e) => e.security === 'SIGNED')
    .map((e) => e.id);

// ─── Dynamic Parameter Generation ──────────────────────────────────────────

/**
 * Generate n8n properties for a single endpoint parameter
 */
function generateParamProperty(
    param: CatalogEntry['params'][0],
    endpointId: string,
    apiGroup: 'spot' | 'usdm',
): INodeProperties {
    const fieldName = `param_${endpointId}_${param.name}`;
    const endpointField = apiGroup === 'spot' ? 'endpointIdSpot' : 'endpointIdUsdm';

    // Determine the input type based on parameter type
    let inputType: 'string' | 'number' | 'boolean' = 'string';
    if (param.type === 'LONG' || param.type === 'INT' || param.type === 'DECIMAL') {
        inputType = 'number';
    } else if (param.type === 'BOOLEAN') {
        inputType = 'boolean';
    }

    const property: INodeProperties = {
        displayName: param.name,
        name: fieldName,
        type: inputType,
        displayOptions: {
            show: {
                mode: ['catalog'],
                apiGroup: [apiGroup],
                [endpointField]: [endpointId],
            },
        },
        default: inputType === 'number' ? 0 : inputType === 'boolean' ? false : '',
        description: param.description || `Parameter: ${param.name}`,
        required: param.required,
    };

    // Add enum options if available
    if (param.enumValues && param.enumValues.length > 0 && inputType === 'string') {
        (property as any).type = 'options';
        (property as any).options = param.enumValues.map((v) => ({ name: v, value: v }));
    }

    return property;
}

/**
 * Generate all parameter properties for all endpoints in both catalogs
 */
function generateAllParamProperties(): INodeProperties[] {
    const properties: INodeProperties[] = [];

    // Generate for spot endpoints
    for (const entry of spotCatalog) {
        for (const param of entry.params) {
            properties.push(generateParamProperty(param, entry.id, 'spot'));
        }
    }

    // Generate for usdm endpoints
    for (const entry of usdmCatalog) {
        for (const param of entry.params) {
            properties.push(generateParamProperty(param, entry.id, 'usdm'));
        }
    }

    return properties;
}

const dynamicParamProperties = generateAllParamProperties();

// ─── Node Properties ────────────────────────────────────────────────────────

export const nodeProperties: INodeProperties[] = [
    // === API Group ===
    {
        displayName: 'API Group',
        name: 'apiGroup',
        type: 'options',
        options: [
            { name: 'Spot', value: 'spot' },
            { name: 'USD-M Futures', value: 'usdm' },
        ],
        default: 'spot',
        description: 'Select the Binance API group to use',
    },

    // === Base URL ===
    {
        displayName: 'Base URL',
        name: 'baseUrl',
        type: 'options',
        displayOptions: {
            show: { apiGroup: ['spot'] },
        },
        options: [
            { name: 'api.binance.com (Primary)', value: 'https://api.binance.com' },
            { name: 'api1.binance.com', value: 'https://api1.binance.com' },
            { name: 'api2.binance.com', value: 'https://api2.binance.com' },
            { name: 'api3.binance.com', value: 'https://api3.binance.com' },
            { name: 'api4.binance.com', value: 'https://api4.binance.com' },
            { name: 'api-gcp.binance.com (GCP)', value: 'https://api-gcp.binance.com' },
            { name: 'Testnet (testnet.binance.vision)', value: 'https://testnet.binance.vision' },
        ],
        default: 'https://api.binance.com',
        description: 'Binance Spot API base URL',
    },
    {
        displayName: 'Base URL',
        name: 'baseUrlUsdm',
        type: 'options',
        displayOptions: {
            show: { apiGroup: ['usdm'] },
        },
        options: [
            { name: 'fapi.binance.com (Production)', value: 'https://fapi.binance.com' },
            { name: 'Testnet (demo-fapi.binance.com)', value: 'https://demo-fapi.binance.com' },
        ],
        default: 'https://fapi.binance.com',
        description: 'Binance USD-M Futures API base URL',
    },

    // === Mode ===
    {
        displayName: 'Mode',
        name: 'mode',
        type: 'options',
        options: [
            {
                name: 'Catalog Endpoint (Recommended)',
                value: 'catalog',
                description: 'Select from the catalog of known endpoints',
            },
            {
                name: 'Custom Request',
                value: 'custom',
                description: 'Manually specify HTTP method, path, and parameters',
            },
        ],
        default: 'catalog',
        description: 'Choose how to specify the API endpoint',
    },

    // ─── Catalog Mode ───────────────────────────────────────────────────────

    // Spot category
    {
        displayName: 'Category',
        name: 'categorySpot',
        type: 'options',
        displayOptions: {
            show: { mode: ['catalog'], apiGroup: ['spot'] },
        },
        options: spotCategories,
        default: spotCategories[0]?.value || '',
        description: 'Spot API endpoint category',
    },
    // USD-M category
    {
        displayName: 'Category',
        name: 'categoryUsdm',
        type: 'options',
        displayOptions: {
            show: { mode: ['catalog'], apiGroup: ['usdm'] },
        },
        options: usdmCategories,
        default: usdmCategories[0]?.value || '',
        description: 'USD-M Futures API endpoint category',
    },

    // Spot endpoint
    {
        displayName: 'Endpoint',
        name: 'endpointIdSpot',
        type: 'options',
        displayOptions: {
            show: { mode: ['catalog'], apiGroup: ['spot'] },
        },
        options: spotEndpoints,
        default: '',
        description: 'Select a Spot API endpoint from the catalog',
    },
    // USD-M endpoint
    {
        displayName: 'Endpoint',
        name: 'endpointIdUsdm',
        type: 'options',
        displayOptions: {
            show: { mode: ['catalog'], apiGroup: ['usdm'] },
        },
        options: usdmEndpoints,
        default: '',
        description: 'Select a USD-M Futures API endpoint from the catalog',
    },

    // === Authentication (Catalog Mode - Spot) ===
    {
        displayName: 'API Key',
        name: 'apiKey',
        type: 'string',
        typeOptions: { password: true },
        displayOptions: {
            show: {
                mode: ['catalog'],
                apiGroup: ['spot'],
                endpointIdSpot: spotEndpointsRequiringApiKey,
            },
        },
        default: '',
        description: 'Binance API Key. Use expressions like {{$json.binanceApiKey}} to pass dynamically.',
        placeholder: 'Your Binance API Key',
    },
    {
        displayName: 'API Secret',
        name: 'apiSecret',
        type: 'string',
        typeOptions: { password: true },
        displayOptions: {
            show: {
                mode: ['catalog'],
                apiGroup: ['spot'],
                endpointIdSpot: spotEndpointsRequiringSigned,
            },
        },
        default: '',
        description: 'Binance API Secret. Use expressions like {{$json.binanceApiSecret}} to pass dynamically.',
        placeholder: 'Your Binance API Secret',
    },

    // === Authentication (Catalog Mode - USD-M) ===
    {
        displayName: 'API Key',
        name: 'apiKey',
        type: 'string',
        typeOptions: { password: true },
        displayOptions: {
            show: {
                mode: ['catalog'],
                apiGroup: ['usdm'],
                endpointIdUsdm: usdmEndpointsRequiringApiKey,
            },
        },
        default: '',
        description: 'Binance API Key. Use expressions like {{$json.binanceApiKey}} to pass dynamically.',
        placeholder: 'Your Binance API Key',
    },
    {
        displayName: 'API Secret',
        name: 'apiSecret',
        type: 'string',
        typeOptions: { password: true },
        displayOptions: {
            show: {
                mode: ['catalog'],
                apiGroup: ['usdm'],
                endpointIdUsdm: usdmEndpointsRequiringSigned,
            },
        },
        default: '',
        description: 'Binance API Secret. Use expressions like {{$json.binanceApiSecret}} to pass dynamically.',
        placeholder: 'Your Binance API Secret',
    },

    // Endpoint info (read-only notice)
    {
        displayName: 'Endpoint Info',
        name: 'endpointInfo',
        type: 'notice',
        displayOptions: {
            show: { mode: ['catalog'] },
        },
        default: 'Select an endpoint above. Parameters specific to that endpoint will appear below.',
    },

    // ─── Dynamic Endpoint-Specific Parameters ──────────────────────────────
    // Insert all dynamically generated parameter fields here
    ...dynamicParamProperties,

    // ─── Legacy Generic Parameters (kept for backward compatibility) ───────
    {
        displayName: 'Additional Parameters',
        name: 'additionalParametersNotice',
        type: 'notice',
        displayOptions: {
            show: { mode: ['catalog'] },
        },
        default: 'You can also add extra parameters below if needed (e.g., for testing or edge cases).',
    },

    // Parameters input (key-value pairs)
    {
        displayName: 'Parameters',
        name: 'catalogParams',
        type: 'fixedCollection',
        displayOptions: {
            show: { mode: ['catalog'] },
        },
        typeOptions: {
            multipleValues: true,
        },
        default: {},
        options: [
            {
                name: 'param',
                displayName: 'Parameter',
                values: [
                    {
                        displayName: 'Name',
                        name: 'name',
                        type: 'string',
                        default: '',
                        description: 'Parameter name',
                    },
                    {
                        displayName: 'Value',
                        name: 'value',
                        type: 'string',
                        default: '',
                        description: 'Parameter value',
                    },
                ],
            },
        ],
        description: 'Provide endpoint parameters as key-value pairs',
    },

    // JSON parameters input (alternative)
    {
        displayName: 'Parameters (JSON)',
        name: 'catalogParamsJson',
        type: 'string',
        displayOptions: {
            show: { mode: ['catalog'] },
        },
        typeOptions: {
            rows: 5,
        },
        default: '',
        description: 'Alternatively, provide parameters as a JSON object. This is merged with key-value params above (JSON values take precedence).',
        placeholder: '{"symbol": "BTCUSDT", "interval": "1h"}',
    },

    // Body (JSON) for catalog mode
    {
        displayName: 'Request Body (JSON)',
        name: 'catalogBody',
        type: 'string',
        displayOptions: {
            show: { mode: ['catalog'] },
        },
        typeOptions: {
            rows: 5,
        },
        default: '',
        description: 'Optional JSON body for endpoints that require a request body (rare for Binance)',
        placeholder: '{}',
    },

    // ─── Custom Mode ────────────────────────────────────────────────────────

    {
        displayName: 'HTTP Method',
        name: 'customMethod',
        type: 'options',
        displayOptions: {
            show: { mode: ['custom'] },
        },
        options: [
            { name: 'GET', value: 'GET' },
            { name: 'POST', value: 'POST' },
            { name: 'PUT', value: 'PUT' },
            { name: 'DELETE', value: 'DELETE' },
        ],
        default: 'GET',
        description: 'HTTP method for the request',
    },
    {
        displayName: 'Path',
        name: 'customPath',
        type: 'string',
        displayOptions: {
            show: { mode: ['custom'] },
        },
        default: '',
        description: 'API path (e.g. /api/v3/klines, /fapi/v1/order). Must start with /api/, /sapi/, or /fapi/.',
        placeholder: '/api/v3/ticker/price',
    },
    {
        displayName: 'Security Type',
        name: 'customSecurity',
        type: 'options',
        displayOptions: {
            show: { mode: ['custom'] },
        },
        options: [
            { name: 'NONE (Public)', value: 'NONE' },
            { name: 'API_KEY (Key Required)', value: 'API_KEY' },
            { name: 'SIGNED (Key + Signature)', value: 'SIGNED' },
        ],
        default: 'NONE',
        description: 'Security type for the endpoint',
    },
    // === Authentication (Custom Mode) ===
    {
        displayName: 'API Key',
        name: 'apiKey',
        type: 'string',
        typeOptions: { password: true },
        displayOptions: {
            show: {
                mode: ['custom'],
                customSecurity: ['API_KEY', 'SIGNED'],
            },
        },
        default: '',
        description: 'Binance API Key. Use expressions like {{$json.binanceApiKey}} to pass dynamically.',
        placeholder: 'Your Binance API Key',
    },
    {
        displayName: 'API Secret',
        name: 'apiSecret',
        type: 'string',
        typeOptions: { password: true },
        displayOptions: {
            show: {
                mode: ['custom'],
                customSecurity: ['SIGNED'],
            },
        },
        default: '',
        description: 'Binance API Secret. Use expressions like {{$json.binanceApiSecret}} to pass dynamically.',
        placeholder: 'Your Binance API Secret',
    },
    {
        displayName: 'Parameters',
        name: 'customParams',
        type: 'fixedCollection',
        displayOptions: {
            show: { mode: ['custom'] },
        },
        typeOptions: {
            multipleValues: true,
        },
        default: {},
        options: [
            {
                name: 'param',
                displayName: 'Parameter',
                values: [
                    {
                        displayName: 'Name',
                        name: 'name',
                        type: 'string',
                        default: '',
                    },
                    {
                        displayName: 'Value',
                        name: 'value',
                        type: 'string',
                        default: '',
                    },
                ],
            },
        ],
        description: 'Query or form parameters',
    },
    {
        displayName: 'Parameters (JSON)',
        name: 'customParamsJson',
        type: 'string',
        displayOptions: {
            show: { mode: ['custom'] },
        },
        typeOptions: {
            rows: 5,
        },
        default: '',
        description: 'Parameters as a JSON object (merged with key-value params)',
        placeholder: '{"symbol": "BTCUSDT"}',
    },
    {
        displayName: 'Request Body (JSON)',
        name: 'customBody',
        type: 'string',
        displayOptions: {
            show: { mode: ['custom'] },
        },
        typeOptions: {
            rows: 5,
        },
        default: '',
        description: 'Optional JSON request body',
        placeholder: '{}',
    },

    // ─── Advanced Options ───────────────────────────────────────────────────

    {
        displayName: 'Options',
        name: 'options',
        type: 'collection',
        placeholder: 'Add Option',
        default: {},
        options: [
            {
                displayName: 'Send Body as JSON',
                name: 'sendAsJson',
                type: 'boolean',
                default: false,
                description: 'Whether to send the request body as JSON instead of form-encoded. Most Binance endpoints expect form-encoded.',
            },
            {
                displayName: 'Receive Window (ms)',
                name: 'recvWindow',
                type: 'number',
                default: 5000,
                description: 'The receive window for SIGNED requests (milliseconds). Binance default is 5000.',
            },
            {
                displayName: 'Skip Required Param Validation',
                name: 'skipValidation',
                type: 'boolean',
                default: false,
                description: 'Whether to skip the required parameter validation in catalog mode. Use if the catalog is outdated.',
            },
        ],
    },
];
