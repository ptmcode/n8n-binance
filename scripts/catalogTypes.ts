/**
 * Shared types for Binance endpoint catalogs.
 */

export interface EnumOption {
    name: string;
    value: string;
}

export interface CatalogParam {
    name: string;
    type: string;
    required: boolean;
    description?: string;
    enumValues?: (string | EnumOption)[];
    default?: string;
    /** Conditional requirement: param is required when another param has certain values */
    requiredWhen?: { param: string; values: string[] };
    /** Number of rows for multi-line text input */
    rows?: number;
    /** Mutually exclusive group: only the first filled param from this group will be sent */
    exclusiveGroup?: string;
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
