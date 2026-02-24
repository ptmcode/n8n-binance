/**
 * BinanceUniversal node description.
 *
 * Defines all UI parameters for the Binance Universal (REST) node.
 */

import type { INodeProperties } from 'n8n-workflow';

// ─── Catalog Loading ────────────────────────────────────────────────────────

import spotCatalogJson from '../../resources/catalogs/spot.json';
import usdmCatalogJson from '../../resources/catalogs/usdm.json';
import walletCatalogJson from '../../resources/catalogs/wallet.json';
import subAccountCatalogJson from '../../resources/catalogs/sub-account.json';
import type { CatalogEntry } from './catalogTypes';

const spotCatalog: CatalogEntry[] = spotCatalogJson as unknown as CatalogEntry[];
const usdmCatalog: CatalogEntry[] = usdmCatalogJson as unknown as CatalogEntry[];
const walletCatalog: CatalogEntry[] = walletCatalogJson as unknown as CatalogEntry[];
const subAccountCatalog: CatalogEntry[] = subAccountCatalogJson as unknown as CatalogEntry[];

/** Get unique categories for a given API group */
function getCategories(catalog: CatalogEntry[]): Array<{ name: string; value: string }> {
    const cats = [...new Set(catalog.map((e) => e.category))];
    cats.sort();
    return cats.map((c) => ({ name: c, value: c }));
}

/** Get endpoint options for dropdown, optionally filtered by category */
function getEndpointOptions(
    catalog: CatalogEntry[],
    category?: string,
): Array<{ name: string; value: string; description?: string }> {
    const filtered = category ? catalog.filter((e) => e.category === category) : catalog;
    return filtered.map((e) => ({
        name: `${e.method} ${e.path}`,
        value: e.id,
        description: e.notes || undefined,
    }));
}

const spotCategories = getCategories(spotCatalog);
const usdmCategories = getCategories(usdmCatalog);
const walletCategories = getCategories(walletCatalog);
const subAccountCategories = getCategories(subAccountCatalog);

// Create endpoint options grouped by category
const spotEndpointsByCategory = new Map<string, Array<{ name: string; value: string; description?: string }>>();
for (const category of spotCategories) {
    spotEndpointsByCategory.set(category.value, getEndpointOptions(spotCatalog, category.value));
}

const usdmEndpointsByCategory = new Map<string, Array<{ name: string; value: string; description?: string }>>();
for (const category of usdmCategories) {
    usdmEndpointsByCategory.set(category.value, getEndpointOptions(usdmCatalog, category.value));
}

const walletEndpointsByCategory = new Map<string, Array<{ name: string; value: string; description?: string }>>();
for (const category of walletCategories) {
    walletEndpointsByCategory.set(category.value, getEndpointOptions(walletCatalog, category.value));
}

const subAccountEndpointsByCategory = new Map<string, Array<{ name: string; value: string; description?: string }>>();
for (const category of subAccountCategories) {
    subAccountEndpointsByCategory.set(category.value, getEndpointOptions(subAccountCatalog, category.value));
}

// Create index maps for security type lookups
const spotSecurityMap = new Map<string, string>();
for (const entry of spotCatalog) {
    spotSecurityMap.set(entry.id, entry.security);
}

const usdmSecurityMap = new Map<string, string>();
for (const entry of usdmCatalog) {
    usdmSecurityMap.set(entry.id, entry.security);
}

const walletSecurityMap = new Map<string, string>();
for (const entry of walletCatalog) {
    walletSecurityMap.set(entry.id, entry.security);
}

const subAccountSecurityMap = new Map<string, string>();
for (const entry of subAccountCatalog) {
    subAccountSecurityMap.set(entry.id, entry.security);
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

const walletEndpointsRequiringApiKey = walletCatalog
    .filter((e) => e.security === 'API_KEY' || e.security === 'SIGNED')
    .map((e) => e.id);

const walletEndpointsRequiringSigned = walletCatalog
    .filter((e) => e.security === 'SIGNED')
    .map((e) => e.id);

const subAccountEndpointsRequiringApiKey = subAccountCatalog
    .filter((e) => e.security === 'API_KEY' || e.security === 'SIGNED')
    .map((e) => e.id);

const subAccountEndpointsRequiringSigned = subAccountCatalog
    .filter((e) => e.security === 'SIGNED')
    .map((e) => e.id);

// ─── Dynamic Parameter Generation ──────────────────────────────────────────

/**
 * Generate n8n properties for a single endpoint parameter
 */
function generateParamProperty(
    param: CatalogEntry['params'][0],
    endpointId: string,
    apiGroup: 'spot' | 'usdm' | 'wallet' | 'sub-account',
): INodeProperties {
    const fieldName = `param_${endpointId}_${param.name}`;
    let endpointField: string;

    switch (apiGroup) {
        case 'spot':
            endpointField = 'endpointIdSpot';
            break;
        case 'usdm':
            endpointField = 'endpointIdUsdm';
            break;
        case 'wallet':
            endpointField = 'endpointIdWallet';
            break;
        case 'sub-account':
            endpointField = 'endpointIdSubAccount';
            break;
    }

    // Determine the input type based on parameter type
    // For optional numeric parameters, use 'string' type to allow empty values
    // For required numeric parameters, use 'number' type
    let inputType: 'string' | 'number' | 'boolean' = 'string';
    if (param.type === 'LONG' || param.type === 'INT' || param.type === 'DECIMAL') {
        // Only use 'number' type for required parameters, otherwise keep as 'string'
        inputType = param.required ? 'number' : 'string';
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
        default: inputType === 'boolean' ? false : '',
        description: param.description || `Parameter: ${param.name}`,
        required: param.required,
    };

    // Add enum options if available
    if (param.enumValues && param.enumValues.length > 0 && inputType === 'string') {
        (property as any).type = 'options';
        // For optional enums, add an empty option to allow clearing the selection
        if (!param.required) {
            (property as any).options = [
                { name: '(None)', value: '' },
                ...param.enumValues.map((v) => ({ name: v, value: v }))
            ];
        } else {
            (property as any).options = param.enumValues.map((v) => ({ name: v, value: v }));
        }
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

    // Generate for wallet endpoints
    for (const entry of walletCatalog) {
        for (const param of entry.params) {
            properties.push(generateParamProperty(param, entry.id, 'wallet'));
        }
    }

    // Generate for sub-account endpoints
    for (const entry of subAccountCatalog) {
        for (const param of entry.params) {
            properties.push(generateParamProperty(param, entry.id, 'sub-account'));
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
            { name: 'Wallet', value: 'wallet' },
            { name: 'Sub Account', value: 'sub-account' },
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
    {
        displayName: 'Base URL',
        name: 'baseUrlWallet',
        type: 'options',
        displayOptions: {
            show: { apiGroup: ['wallet'] },
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
        description: 'Binance Wallet API base URL',
    },
    {
        displayName: 'Base URL',
        name: 'baseUrlSubAccount',
        type: 'options',
        displayOptions: {
            show: { apiGroup: ['sub-account'] },
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
        description: 'Binance Sub Account API base URL',
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
    // Wallet category
    {
        displayName: 'Category',
        name: 'categoryWallet',
        type: 'options',
        displayOptions: {
            show: { mode: ['catalog'], apiGroup: ['wallet'] },
        },
        options: walletCategories,
        default: walletCategories[0]?.value || '',
        description: 'Wallet API endpoint category',
    },
    // Sub Account category
    {
        displayName: 'Category',
        name: 'categorySubAccount',
        type: 'options',
        displayOptions: {
            show: { mode: ['catalog'], apiGroup: ['sub-account'] },
        },
        options: subAccountCategories,
        default: subAccountCategories[0]?.value || '',
        description: 'Sub Account API endpoint category',
    },

    // Generate Spot endpoint fields for each category
    ...Array.from(spotEndpointsByCategory.entries()).map(([category, endpoints]) => ({
        displayName: 'Endpoint',
        name: 'endpointIdSpot',
        type: 'options' as const,
        displayOptions: {
            show: {
                mode: ['catalog'],
                apiGroup: ['spot'],
                categorySpot: [category],
            },
        },
        options: endpoints,
        default: '',
        description: 'Select a Spot API endpoint from the catalog',
    })),

    // Generate USD-M endpoint fields for each category
    ...Array.from(usdmEndpointsByCategory.entries()).map(([category, endpoints]) => ({
        displayName: 'Endpoint',
        name: 'endpointIdUsdm',
        type: 'options' as const,
        displayOptions: {
            show: {
                mode: ['catalog'],
                apiGroup: ['usdm'],
                categoryUsdm: [category],
            },
        },
        options: endpoints,
        default: '',
        description: 'Select a USD-M Futures API endpoint from the catalog',
    })),

    // Generate Wallet endpoint fields for each category
    ...Array.from(walletEndpointsByCategory.entries()).map(([category, endpoints]) => ({
        displayName: 'Endpoint',
        name: 'endpointIdWallet',
        type: 'options' as const,
        displayOptions: {
            show: {
                mode: ['catalog'],
                apiGroup: ['wallet'],
                categoryWallet: [category],
            },
        },
        options: endpoints,
        default: '',
        description: 'Select a Wallet API endpoint from the catalog',
    })),

    // Generate Sub Account endpoint fields for each category
    ...Array.from(subAccountEndpointsByCategory.entries()).map(([category, endpoints]) => ({
        displayName: 'Endpoint',
        name: 'endpointIdSubAccount',
        type: 'options' as const,
        displayOptions: {
            show: {
                mode: ['catalog'],
                apiGroup: ['sub-account'],
                categorySubAccount: [category],
            },
        },
        options: endpoints,
        default: '',
        description: 'Select a Sub Account API endpoint from the catalog',
    })),

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

    // === Authentication (Catalog Mode - Wallet) ===
    {
        displayName: 'API Key',
        name: 'apiKey',
        type: 'string',
        typeOptions: { password: true },
        displayOptions: {
            show: {
                mode: ['catalog'],
                apiGroup: ['wallet'],
                endpointIdWallet: walletEndpointsRequiringApiKey,
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
                apiGroup: ['wallet'],
                endpointIdWallet: walletEndpointsRequiringSigned,
            },
        },
        default: '',
        description: 'Binance API Secret. Use expressions like {{$json.binanceApiSecret}} to pass dynamically.',
        placeholder: 'Your Binance API Secret',
    },

    // === Authentication (Catalog Mode - Sub Account) ===
    {
        displayName: 'API Key',
        name: 'apiKey',
        type: 'string',
        typeOptions: { password: true },
        displayOptions: {
            show: {
                mode: ['catalog'],
                apiGroup: ['sub-account'],
                endpointIdSubAccount: subAccountEndpointsRequiringApiKey,
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
                apiGroup: ['sub-account'],
                endpointIdSubAccount: subAccountEndpointsRequiringSigned,
            },
        },
        default: '',
        description: 'Binance API Secret. Use expressions like {{$json.binanceApiSecret}} to pass dynamically.',
        placeholder: 'Your Binance API Secret',
    },

    // ─── Dynamic Endpoint-Specific Parameters ──────────────────────────────
    // Insert all dynamically generated parameter fields here
    ...dynamicParamProperties,

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
];
