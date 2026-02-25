/**
 * BinanceUniversal.node.ts
 *
 * n8n community node: Binance Universal (REST)
 *
 * Supports all Binance REST endpoints for Spot, USDⓈ-M Futures, Wallet, and Sub Account
 * via a catalog-driven UI or custom request mode.
 */

import type {
    IExecuteFunctions,
    INodeExecutionData,
    INodeType,
    INodeTypeDescription,
    IHttpRequestMethods,
} from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';
import { nodeProperties } from './BinanceUniversal.description';
import {
    executeBinanceRequest,
    validateRequiredParams,
    validateRequiredWhen,
    SecurityType,
} from './binanceHttp';
import type { CatalogEntry, CatalogParam } from './catalogTypes';

// Load catalogs
import spotCatalogJson from '../../resources/catalogs/spot.json';
import usdmCatalogJson from '../../resources/catalogs/usdm.json';
import walletCatalogJson from '../../resources/catalogs/wallet.json';
import subAccountCatalogJson from '../../resources/catalogs/sub-account.json';

const spotCatalog: CatalogEntry[] = spotCatalogJson as unknown as CatalogEntry[];
const usdmCatalog: CatalogEntry[] = usdmCatalogJson as unknown as CatalogEntry[];
const walletCatalog: CatalogEntry[] = walletCatalogJson as unknown as CatalogEntry[];
const subAccountCatalog: CatalogEntry[] = subAccountCatalogJson as unknown as CatalogEntry[];

// Index catalogs by ID for fast lookup
const catalogIndex = new Map<string, CatalogEntry>();
for (const entry of spotCatalog) catalogIndex.set(entry.id, entry);
for (const entry of usdmCatalog) catalogIndex.set(entry.id, entry);
for (const entry of walletCatalog) catalogIndex.set(entry.id, entry);
for (const entry of subAccountCatalog) catalogIndex.set(entry.id, entry);

export class BinanceUniversal implements INodeType {
    description: INodeTypeDescription = {
        displayName: 'Binance Universal (REST)',
        name: 'binanceUniversal',
        icon: 'file:binance.svg',
        group: ['transform'],
        version: 1,
        subtitle: '={{$parameter["mode"] === "catalog" ? $parameter["apiGroup"] === "spot" ? $parameter["endpointIdSpot"] : $parameter["apiGroup"] === "usdm" ? $parameter["endpointIdUsdm"] : $parameter["apiGroup"] === "wallet" ? $parameter["endpointIdWallet"] : $parameter["endpointIdSubAccount"] : $parameter["customMethod"] + " " + $parameter["customPath"]}}',
        description: 'Call any Binance REST endpoint (Spot, USDⓈ-M Futures, Wallet, Sub Account) with automatic signing',
        defaults: {
            name: 'Binance Universal',
        },
        inputs: ['main'],
        outputs: ['main'],
        properties: nodeProperties,
    };

    async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
        const items = this.getInputData();
        const returnData: INodeExecutionData[] = [];

        for (let i = 0; i < items.length; i++) {
            try {
                const apiGroup = this.getNodeParameter('apiGroup', i) as string;
                const mode = this.getNodeParameter('mode', i) as string;
                const apiKey = this.getNodeParameter('apiKey', i, '') as string;
                const apiSecret = this.getNodeParameter('apiSecret', i, '') as string;

                // Determine base URL
                let baseUrl: string;
                if (apiGroup === 'usdm') {
                    baseUrl = this.getNodeParameter('baseUrlUsdm', i, 'https://fapi.binance.com') as string;
                } else if (apiGroup === 'wallet') {
                    baseUrl = this.getNodeParameter('baseUrlWallet', i, 'https://api.binance.com') as string;
                } else if (apiGroup === 'sub-account') {
                    baseUrl = this.getNodeParameter('baseUrlSubAccount', i, 'https://api.binance.com') as string;
                } else {
                    baseUrl = this.getNodeParameter('baseUrl', i, 'https://api.binance.com') as string;
                }

                let method: IHttpRequestMethods;
                let path: string;
                let security: SecurityType;
                let params: Record<string, any> = {};
                let body: Record<string, any> | undefined;
                let catalogCategory: string | undefined;

                if (mode === 'catalog') {
                    // ─── Catalog Mode ───────────────────────────────────────────────
                    let endpointId: string;
                    if (apiGroup === 'spot') {
                        endpointId = this.getNodeParameter('endpointIdSpot', i) as string;
                    } else if (apiGroup === 'usdm') {
                        endpointId = this.getNodeParameter('endpointIdUsdm', i) as string;
                    } else if (apiGroup === 'wallet') {
                        endpointId = this.getNodeParameter('endpointIdWallet', i) as string;
                    } else if (apiGroup === 'sub-account') {
                        endpointId = this.getNodeParameter('endpointIdSubAccount', i) as string;
                    } else {
                        throw new NodeOperationError(
                            this.getNode(),
                            `Unknown API group: ${apiGroup}`,
                            { itemIndex: i },
                        );
                    }

                    const entry = catalogIndex.get(endpointId);
                    if (!entry) {
                        throw new NodeOperationError(
                            this.getNode(),
                            `Endpoint "${endpointId}" not found in catalog. Try using Custom Request mode.`,
                            { itemIndex: i },
                        );
                    }

                    method = entry.method as IHttpRequestMethods;
                    path = entry.path;
                    security = entry.security;
                    catalogCategory = entry.category;

                    // Collect parameters from dynamic endpoint-specific fields
                    for (const param of entry.params) {
                        // Skip timestamp and signature - these are auto-added during signing
                        if (param.name === 'timestamp' || param.name === 'signature') continue;
                        const fieldName = `param_${endpointId}_${param.name}`;
                        try {
                            const value = this.getNodeParameter(fieldName, i, undefined);
                            // Only add the parameter if it has a value (not empty string, undefined, or 0 for optional params)
                            if (value !== undefined && value !== '' && !(value === 0 && !param.required)) {
                                // For ARRAY type, split comma-separated string into array for repeated params
                                if (param.type === 'ARRAY' && typeof value === 'string') {
                                    params[param.name] = value.split(',').map((v: string) => v.trim()).filter((v: string) => v !== '');
                                } else {
                                    params[param.name] = value;
                                }
                            }
                        } catch (error) {
                            // Field might not exist if it's a legacy workflow, skip silently
                        }
                    }

                    // Validate required parameters
                    const requiredNames = entry.params
                        .filter((p: CatalogParam) => p.required)
                        .map((p: CatalogParam) => p.name);

                    // Don't require timestamp/signature - those are auto-added
                    const filteredRequired = requiredNames.filter(
                        (n: string) => n !== 'timestamp' && n !== 'signature',
                    );

                    const missing = validateRequiredParams(params, filteredRequired);
                    if (missing.length > 0) {
                        throw new NodeOperationError(
                            this.getNode(),
                            `Missing required parameters: ${missing.join(', ')}\n\nEndpoint: ${entry.method} ${entry.path}\nRequired: ${filteredRequired.join(', ')}`,
                            { itemIndex: i },
                        );
                    }

                    // Validate conditional requiredWhen rules
                    const conditionalRules = entry.params
                        .filter((p: CatalogParam) => p.requiredWhen)
                        .map((p: CatalogParam) => ({
                            paramName: p.name,
                            requiredWhen: p.requiredWhen!,
                        }));

                    if (conditionalRules.length > 0) {
                        const errors = validateRequiredWhen(params, conditionalRules);
                        if (errors.length > 0) {
                            throw new NodeOperationError(
                                this.getNode(),
                                `Parameter validation errors:\n${errors.join('\n')}`,
                                { itemIndex: i },
                            );
                        }
                    }
                } else {
                    // ─── Custom Mode ────────────────────────────────────────────────
                    method = this.getNodeParameter('customMethod', i) as IHttpRequestMethods;
                    path = this.getNodeParameter('customPath', i) as string;
                    security = this.getNodeParameter('customSecurity', i) as SecurityType;

                    // Validate path prefix
                    if (apiGroup === 'spot' && !path.startsWith('/api/') && !path.startsWith('/sapi/')) {
                        throw new NodeOperationError(
                            this.getNode(),
                            'For Spot API group, path must start with /api/ or /sapi/',
                            { itemIndex: i },
                        );
                    }
                    if (apiGroup === 'usdm' && !path.startsWith('/fapi/') && !path.startsWith('/futures/')) {
                        throw new NodeOperationError(
                            this.getNode(),
                            'For USD-M Futures API group, path must start with /fapi/ or /futures/',
                            { itemIndex: i },
                        );
                    }
                    if (apiGroup === 'wallet' && !path.startsWith('/sapi/')) {
                        throw new NodeOperationError(
                            this.getNode(),
                            'For Wallet API group, path must start with /sapi/',
                            { itemIndex: i },
                        );
                    }
                    if (apiGroup === 'sub-account' && !path.startsWith('/sapi/')) {
                        throw new NodeOperationError(
                            this.getNode(),
                            'For Sub Account API group, path must start with /sapi/',
                            { itemIndex: i },
                        );
                    }

                    // Collect parameters
                    const customParamsKV = this.getNodeParameter('customParams', i, {}) as {
                        param?: Array<{ name: string; value: string }>;
                    };
                    if (customParamsKV.param) {
                        for (const p of customParamsKV.param) {
                            if (p.name) params[p.name] = p.value;
                        }
                    }

                    // Merge JSON parameters
                    const customParamsJsonStr = this.getNodeParameter('customParamsJson', i, '') as string;
                    if (customParamsJsonStr.trim()) {
                        try {
                            const jsonParams = JSON.parse(customParamsJsonStr);
                            if (typeof jsonParams === 'object' && jsonParams !== null) {
                                Object.assign(params, jsonParams);
                            }
                        } catch {
                            throw new NodeOperationError(
                                this.getNode(),
                                'Invalid JSON in Parameters (JSON) field.',
                                { itemIndex: i },
                            );
                        }
                    }

                    // Parse body
                    const customBodyStr = this.getNodeParameter('customBody', i, '') as string;
                    if (customBodyStr.trim()) {
                        try {
                            body = JSON.parse(customBodyStr);
                        } catch {
                            throw new NodeOperationError(
                                this.getNode(),
                                'Invalid JSON in Request Body field.',
                                { itemIndex: i },
                            );
                        }
                    }
                }

                // Execute the request
                const result = await executeBinanceRequest(this, {
                    baseUrl,
                    method,
                    path,
                    security,
                    params,
                    body,
                    sendAsJson: false,
                    apiKey,
                    apiSecret,
                    recvWindow: 5000,
                    apiGroup,
                    category: catalogCategory,
                });

                returnData.push({
                    json: {
                        data: result.data,
                        meta: result.meta,
                    },
                    pairedItem: { item: i },
                });
            } catch (error: any) {
                if (this.continueOnFail()) {
                    returnData.push({
                        json: {
                            error: error.message,
                        },
                        pairedItem: { item: i },
                    });
                    continue;
                }
                throw error;
            }
        }

        return [returnData];
    }
}
