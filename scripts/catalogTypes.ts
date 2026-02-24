/**
 * Shared types for Binance endpoint catalogs.
 */

export interface CatalogParam {
    name: string;
    type: string;
    required: boolean;
    description?: string;
    enumValues?: string[];
    default?: string;
    /** Conditional requirement: param is required when another param has certain values */
    requiredWhen?: { param: string; values: string[] };
}

export interface CatalogEntry {
    id: string;
    apiGroup: 'spot' | 'usdm' | 'sub-account' | 'wallet';
    category: string;
    method: string;
    path: string;
    security: 'NONE' | 'API_KEY' | 'SIGNED';
    weight: number;
    params: CatalogParam[];
    notes: string;
    docUrl: string;
}

export type Catalog = CatalogEntry[];
