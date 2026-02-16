#!/usr/bin/env ts-node
/**
 * Generate the Wallet catalog (wallet.json) from Binance Wallet API documentation.
 *
 * Usage:
 *   npx ts-node scripts/generateWalletCatalog.ts
 *
 * The script generates resources/catalogs/wallet.json with all endpoints across:
 * - System Status
 * - Account Management
 * - Capital/Deposit/Withdraw
 * - Asset Management
 * - Transfers
 */

import * as fs from 'fs';
import * as path from 'path';
import { CatalogEntry, CatalogParam } from './catalogTypes';

// Base documentation URL
const BASE_DOC_URL = 'https://developers.binance.com/docs/wallet';

// Wallet endpoint definitions
// Based on Binance Wallet API documentation structure
const walletEndpoints: Partial<CatalogEntry>[] = [
    // ===== SYSTEM & STATUS =====
    {
        id: 'wallet_system_status',
        category: 'System',
        method: 'GET',
        path: '/sapi/v1/system/status',
        security: 'NONE',
        weight: 1,
        params: [],
        notes: 'Fetch system status.',
        docUrl: `${BASE_DOC_URL}/others/system-status`,
    },

    // ===== CAPITAL =====
    {
        id: 'wallet_capital_config_getall',
        category: 'Capital',
        method: 'GET',
        path: '/sapi/v1/capital/config/getall',
        security: 'SIGNED',
        weight: 10,
        params: [
            { name: 'recvWindow', type: 'LONG', required: false, description: 'The value cannot be greater than 60000' },
            { name: 'timestamp', type: 'LONG', required: true, description: 'Current timestamp in milliseconds' },
        ],
        notes: 'Get information of coins (available for deposit and withdraw).',
        docUrl: `${BASE_DOC_URL}/capital/all-coins-info`,
    },
    {
        id: 'wallet_capital_withdraw_apply',
        category: 'Capital',
        method: 'POST',
        path: '/sapi/v1/capital/withdraw/apply',
        security: 'SIGNED',
        weight: 600,
        params: [
            { name: 'coin', type: 'STRING', required: true, description: 'Coin name' },
            { name: 'withdrawOrderId', type: 'STRING', required: false, description: 'Client id for withdraw' },
            { name: 'network', type: 'STRING', required: false, description: 'Network for withdraw' },
            { name: 'address', type: 'STRING', required: true, description: 'Withdraw address' },
            { name: 'addressTag', type: 'STRING', required: false, description: 'Secondary address identifier for coins like XRP, XMR etc.' },
            { name: 'amount', type: 'DECIMAL', required: true, description: 'Amount to withdraw' },
            { name: 'transactionFeeFlag', type: 'BOOLEAN', required: false, description: 'When making internal transfer, true for returning the fee to the destination account; false for returning the fee back to the departure account. Default false.' },
            { name: 'name', type: 'STRING', required: false, description: 'Description of the address. Space in name should be encoded into %20.' },
            { name: 'walletType', type: 'LONG', required: false, description: 'The wallet type for withdraw, 0-spot wallet, 1-funding wallet. Default is spot wallet' },
            { name: 'recvWindow', type: 'LONG', required: false, description: 'The value cannot be greater than 60000' },
            { name: 'timestamp', type: 'LONG', required: true, description: 'Current timestamp in milliseconds' },
        ],
        notes: 'Submit a withdraw request.',
        docUrl: `${BASE_DOC_URL}/capital/withdraw`,
    },
    {
        id: 'wallet_capital_deposit_hisrec',
        category: 'Capital',
        method: 'GET',
        path: '/sapi/v1/capital/deposit/hisrec',
        security: 'SIGNED',
        weight: 1,
        params: [
            { name: 'coin', type: 'STRING', required: false, description: 'Coin name' },
            { name: 'status', type: 'INT', required: false, description: 'Deposit status: 0(pending), 6(credited but cannot withdraw), 7(Wrong Deposit), 8(Waiting User confirm), 1(success)' },
            { name: 'startTime', type: 'LONG', required: false, description: 'Start time in milliseconds' },
            { name: 'endTime', type: 'LONG', required: false, description: 'End time in milliseconds' },
            { name: 'offset', type: 'INT', required: false, description: 'Offset for pagination' },
            { name: 'limit', type: 'INT', required: false, description: 'Number of records to return (default 1000, max 1000)' },
            { name: 'recvWindow', type: 'LONG', required: false, description: 'The value cannot be greater than 60000' },
            { name: 'timestamp', type: 'LONG', required: true, description: 'Current timestamp in milliseconds' },
            { name: 'txId', type: 'STRING', required: false, description: 'Transaction ID' },
        ],
        notes: 'Fetch deposit history.',
        docUrl: `${BASE_DOC_URL}/capital/deposit-history`,
    },
    {
        id: 'wallet_capital_withdraw_history',
        category: 'Capital',
        method: 'GET',
        path: '/sapi/v1/capital/withdraw/history',
        security: 'SIGNED',
        weight: 18000,
        params: [
            { name: 'coin', type: 'STRING', required: false, description: 'Coin name' },
            { name: 'withdrawOrderId', type: 'STRING', required: false, description: 'Client id for withdraw' },
            { name: 'status', type: 'INT', required: false, description: 'Withdraw status: 0(Email Sent), 1(Cancelled), 2(Awaiting Approval), 3(Rejected), 4(Processing), 5(Failure), 6(Completed)' },
            { name: 'startTime', type: 'LONG', required: false, description: 'Start time in milliseconds' },
            { name: 'endTime', type: 'LONG', required: false, description: 'End time in milliseconds' },
            { name: 'offset', type: 'INT', required: false, description: 'Offset for pagination' },
            { name: 'limit', type: 'INT', required: false, description: 'Number of records to return (default 1000, max 1000)' },
            { name: 'recvWindow', type: 'LONG', required: false, description: 'The value cannot be greater than 60000' },
            { name: 'timestamp', type: 'LONG', required: true, description: 'Current timestamp in milliseconds' },
        ],
        notes: 'Fetch withdraw history.',
        docUrl: `${BASE_DOC_URL}/capital/withdraw-history`,
    },
    {
        id: 'wallet_capital_deposit_address',
        category: 'Capital',
        method: 'GET',
        path: '/sapi/v1/capital/deposit/address',
        security: 'SIGNED',
        weight: 10,
        params: [
            { name: 'coin', type: 'STRING', required: true, description: 'Coin name' },
            { name: 'network', type: 'STRING', required: false, description: 'Network' },
            { name: 'recvWindow', type: 'LONG', required: false, description: 'The value cannot be greater than 60000' },
            { name: 'timestamp', type: 'LONG', required: true, description: 'Current timestamp in milliseconds' },
        ],
        notes: 'Fetch deposit address with network.',
        docUrl: `${BASE_DOC_URL}/capital/deposit-address`,
    },

    // ===== ACCOUNT =====
    {
        id: 'wallet_account_snapshot',
        category: 'Account',
        method: 'GET',
        path: '/sapi/v1/accountSnapshot',
        security: 'SIGNED',
        weight: 2400,
        params: [
            { name: 'type', type: 'STRING', required: true, description: 'Account type: SPOT, MARGIN, or FUTURES', enumValues: ['SPOT', 'MARGIN', 'FUTURES'] },
            { name: 'startTime', type: 'LONG', required: false, description: 'Start time in milliseconds' },
            { name: 'endTime', type: 'LONG', required: false, description: 'End time in milliseconds' },
            { name: 'limit', type: 'INT', required: false, description: 'Number of records to return (min 7, max 30, default 7)' },
            { name: 'recvWindow', type: 'LONG', required: false, description: 'The value cannot be greater than 60000' },
            { name: 'timestamp', type: 'LONG', required: true, description: 'Current timestamp in milliseconds' },
        ],
        notes: 'Daily account snapshot. Query time period must be less than 30 days. Supports query within the last one month only.',
        docUrl: `${BASE_DOC_URL}/account/daily-account-snapshoot`,
    },
    {
        id: 'wallet_account_disable_fast_withdraw',
        category: 'Account',
        method: 'POST',
        path: '/sapi/v1/account/disableFastWithdrawSwitch',
        security: 'SIGNED',
        weight: 1,
        params: [
            { name: 'recvWindow', type: 'LONG', required: false, description: 'The value cannot be greater than 60000' },
            { name: 'timestamp', type: 'LONG', required: true, description: 'Current timestamp in milliseconds' },
        ],
        notes: 'Disable fast withdraw switch under your account.',
        docUrl: `${BASE_DOC_URL}/account`,
    },
    {
        id: 'wallet_account_enable_fast_withdraw',
        category: 'Account',
        method: 'POST',
        path: '/sapi/v1/account/enableFastWithdrawSwitch',
        security: 'SIGNED',
        weight: 1,
        params: [
            { name: 'recvWindow', type: 'LONG', required: false, description: 'The value cannot be greater than 60000' },
            { name: 'timestamp', type: 'LONG', required: true, description: 'Current timestamp in milliseconds' },
        ],
        notes: 'Enable fast withdraw switch under your account.',
        docUrl: `${BASE_DOC_URL}/account`,
    },
    {
        id: 'wallet_account_status',
        category: 'Account',
        method: 'GET',
        path: '/sapi/v1/account/status',
        security: 'SIGNED',
        weight: 1,
        params: [
            { name: 'recvWindow', type: 'LONG', required: false, description: 'The value cannot be greater than 60000' },
            { name: 'timestamp', type: 'LONG', required: true, description: 'Current timestamp in milliseconds' },
        ],
        notes: 'Fetch account status detail.',
        docUrl: `${BASE_DOC_URL}/account/account-status`,
    },
    {
        id: 'wallet_account_api_trading_status',
        category: 'Account',
        method: 'GET',
        path: '/sapi/v1/account/apiTradingStatus',
        security: 'SIGNED',
        weight: 1,
        params: [
            { name: 'recvWindow', type: 'LONG', required: false, description: 'The value cannot be greater than 60000' },
            { name: 'timestamp', type: 'LONG', required: true, description: 'Current timestamp in milliseconds' },
        ],
        notes: 'Fetch account API trading status with details.',
        docUrl: `${BASE_DOC_URL}/account/account-api-trading-status`,
    },
    {
        id: 'wallet_account_api_restrictions',
        category: 'Account',
        method: 'GET',
        path: '/sapi/v1/account/apiRestrictions',
        security: 'SIGNED',
        weight: 1,
        params: [
            { name: 'recvWindow', type: 'LONG', required: false, description: 'The value cannot be greater than 60000' },
            { name: 'timestamp', type: 'LONG', required: true, description: 'Current timestamp in milliseconds' },
        ],
        notes: 'Get API Key Permission.',
        docUrl: `${BASE_DOC_URL}/account/api-key-permission`,
    },

    // ===== ASSET =====
    {
        id: 'wallet_asset_dribblet',
        category: 'Asset',
        method: 'GET',
        path: '/sapi/v1/asset/dribblet',
        security: 'SIGNED',
        weight: 1,
        params: [
            { name: 'startTime', type: 'LONG', required: false, description: 'Start time in milliseconds' },
            { name: 'endTime', type: 'LONG', required: false, description: 'End time in milliseconds' },
            { name: 'recvWindow', type: 'LONG', required: false, description: 'The value cannot be greater than 60000' },
            { name: 'timestamp', type: 'LONG', required: true, description: 'Current timestamp in milliseconds' },
        ],
        notes: 'DustLog: query the historical records of dust conversion.',
        docUrl: `${BASE_DOC_URL}/asset/dust-log`,
    },
    {
        id: 'wallet_asset_dust',
        category: 'Asset',
        method: 'POST',
        path: '/sapi/v1/asset/dust',
        security: 'SIGNED',
        weight: 10,
        params: [
            { name: 'asset', type: 'STRING', required: true, description: 'Array of assets to convert, separated by comma' },
            { name: 'recvWindow', type: 'LONG', required: false, description: 'The value cannot be greater than 60000' },
            { name: 'timestamp', type: 'LONG', required: true, description: 'Current timestamp in milliseconds' },
        ],
        notes: 'Convert dust assets to BNB.',
        docUrl: `${BASE_DOC_URL}/asset/dust-transfer`,
    },
    {
        id: 'wallet_asset_dividend',
        category: 'Asset',
        method: 'GET',
        path: '/sapi/v1/asset/assetDividend',
        security: 'SIGNED',
        weight: 10,
        params: [
            { name: 'asset', type: 'STRING', required: false, description: 'Asset name' },
            { name: 'startTime', type: 'LONG', required: false, description: 'Start time in milliseconds' },
            { name: 'endTime', type: 'LONG', required: false, description: 'End time in milliseconds' },
            { name: 'limit', type: 'INT', required: false, description: 'Number of records to return (default 20, max 500)' },
            { name: 'recvWindow', type: 'LONG', required: false, description: 'The value cannot be greater than 60000' },
            { name: 'timestamp', type: 'LONG', required: true, description: 'Current timestamp in milliseconds' },
        ],
        notes: 'Query asset dividend record.',
        docUrl: `${BASE_DOC_URL}/asset/asset-dividend`,
    },
    {
        id: 'wallet_asset_detail',
        category: 'Asset',
        method: 'GET',
        path: '/sapi/v1/asset/assetDetail',
        security: 'SIGNED',
        weight: 1,
        params: [
            { name: 'asset', type: 'STRING', required: false, description: 'Asset name' },
            { name: 'recvWindow', type: 'LONG', required: false, description: 'The value cannot be greater than 60000' },
            { name: 'timestamp', type: 'LONG', required: true, description: 'Current timestamp in milliseconds' },
        ],
        notes: 'Fetch details of assets supported on Binance.',
        docUrl: `${BASE_DOC_URL}/asset/asset-detail`,
    },
    {
        id: 'wallet_asset_trade_fee',
        category: 'Asset',
        method: 'GET',
        path: '/sapi/v1/asset/tradeFee',
        security: 'SIGNED',
        weight: 1,
        params: [
            { name: 'symbol', type: 'STRING', required: false, description: 'Trading symbol, e.g. BNBUSDT' },
            { name: 'recvWindow', type: 'LONG', required: false, description: 'The value cannot be greater than 60000' },
            { name: 'timestamp', type: 'LONG', required: true, description: 'Current timestamp in milliseconds' },
        ],
        notes: 'Fetch trade fee.',
        docUrl: `${BASE_DOC_URL}/asset/trade-fee`,
    },
    {
        id: 'wallet_asset_funding_wallet',
        category: 'Asset',
        method: 'POST',
        path: '/sapi/v1/asset/get-funding-asset',
        security: 'SIGNED',
        weight: 1,
        params: [
            { name: 'asset', type: 'STRING', required: false, description: 'Asset name' },
            { name: 'needBtcValuation', type: 'STRING', required: false, description: 'true or false' },
            { name: 'recvWindow', type: 'LONG', required: false, description: 'The value cannot be greater than 60000' },
            { name: 'timestamp', type: 'LONG', required: true, description: 'Current timestamp in milliseconds' },
        ],
        notes: 'Get Funding Wallet balance.',
        docUrl: `${BASE_DOC_URL}/asset/funding-wallet`,
    },
    {
        id: 'wallet_asset_cloud_mining_history',
        category: 'Asset',
        method: 'GET',
        path: '/sapi/v1/asset/ledger-transfer/cloud-mining/queryByPage',
        security: 'SIGNED',
        weight: 600,
        params: [
            { name: 'tranId', type: 'LONG', required: false, description: 'Transaction ID' },
            { name: 'clientTranId', type: 'STRING', required: false, description: 'Client transaction ID' },
            { name: 'asset', type: 'STRING', required: false, description: 'Asset name' },
            { name: 'startTime', type: 'LONG', required: true, description: 'Start time in milliseconds' },
            { name: 'endTime', type: 'LONG', required: true, description: 'End time in milliseconds' },
            { name: 'current', type: 'INT', required: false, description: 'Current page number (default 1)' },
            { name: 'size', type: 'INT', required: false, description: 'Number of records per page (default 10, max 100)' },
            { name: 'recvWindow', type: 'LONG', required: false, description: 'The value cannot be greater than 60000' },
            { name: 'timestamp', type: 'LONG', required: true, description: 'Current timestamp in milliseconds' },
        ],
        notes: 'Get Cloud-Mining payment and refund history.',
        docUrl: `${BASE_DOC_URL}/asset/cloud-mining-history`,
    },

    // ===== TRANSFER =====
    {
        id: 'wallet_transfer_universal',
        category: 'Transfer',
        method: 'POST',
        path: '/sapi/v1/asset/transfer',
        security: 'SIGNED',
        weight: 900,
        params: [
            {
                name: 'type',
                type: 'STRING',
                required: true,
                description: 'Transfer type',
                enumValues: [
                    'MAIN_UMFUTURE',
                    'MAIN_CMFUTURE',
                    'MAIN_MARGIN',
                    'UMFUTURE_MAIN',
                    'UMFUTURE_MARGIN',
                    'CMFUTURE_MAIN',
                    'CMFUTURE_MARGIN',
                    'MARGIN_MAIN',
                    'MARGIN_UMFUTURE',
                    'MARGIN_CMFUTURE',
                    'MAIN_FUNDING',
                    'FUNDING_MAIN',
                    'FUNDING_UMFUTURE',
                    'FUNDING_CMFUTURE',
                    'UMFUTURE_FUNDING',
                    'CMFUTURE_FUNDING',
                    'MAIN_OPTION',
                    'OPTION_MAIN',
                ],
            },
            { name: 'asset', type: 'STRING', required: true, description: 'Asset name' },
            { name: 'amount', type: 'DECIMAL', required: true, description: 'Amount to transfer' },
            { name: 'fromSymbol', type: 'STRING', required: false, description: 'Must be sent when type are ISOLATEDMARGIN_MARGIN and ISOLATEDMARGIN_ISOLATEDMARGIN' },
            { name: 'toSymbol', type: 'STRING', required: false, description: 'Must be sent when type are MARGIN_ISOLATEDMARGIN and ISOLATEDMARGIN_ISOLATEDMARGIN' },
            { name: 'recvWindow', type: 'LONG', required: false, description: 'The value cannot be greater than 60000' },
            { name: 'timestamp', type: 'LONG', required: true, description: 'Current timestamp in milliseconds' },
        ],
        notes: 'User Universal Transfer. You need to enable Permits Universal Transfer option for the API Key which requests this endpoint.',
        docUrl: `${BASE_DOC_URL}/asset/user-universal-transfer`,
    },
    {
        id: 'wallet_transfer_query',
        category: 'Transfer',
        method: 'GET',
        path: '/sapi/v1/asset/transfer',
        security: 'SIGNED',
        weight: 1,
        params: [
            { name: 'type', type: 'STRING', required: true, description: 'Transfer type' },
            { name: 'startTime', type: 'LONG', required: false, description: 'Start time in milliseconds' },
            { name: 'endTime', type: 'LONG', required: false, description: 'End time in milliseconds' },
            { name: 'current', type: 'INT', required: false, description: 'Current page number (default 1)' },
            { name: 'size', type: 'INT', required: false, description: 'Number of records per page (default 10, max 100)' },
            { name: 'fromSymbol', type: 'STRING', required: false, description: 'Must be sent when type are ISOLATEDMARGIN_MARGIN and ISOLATEDMARGIN_ISOLATEDMARGIN' },
            { name: 'toSymbol', type: 'STRING', required: false, description: 'Must be sent when type are MARGIN_ISOLATEDMARGIN and ISOLATEDMARGIN_ISOLATEDMARGIN' },
            { name: 'recvWindow', type: 'LONG', required: false, description: 'The value cannot be greater than 60000' },
            { name: 'timestamp', type: 'LONG', required: true, description: 'Current timestamp in milliseconds' },
        ],
        notes: 'Query User Universal Transfer History.',
        docUrl: `${BASE_DOC_URL}/asset/query-user-universal-transfer`,
    },
];

/**
 * Main generation logic
 */
function generateWalletCatalog() {
    // Build full entries with apiGroup
    const fullEntries: CatalogEntry[] = walletEndpoints.map((partial) => ({
        id: partial.id!,
        apiGroup: 'wallet',
        category: partial.category!,
        method: partial.method as any,
        path: partial.path!,
        security: partial.security as any,
        weight: partial.weight!,
        params: partial.params || [],
        notes: partial.notes || '',
        docUrl: partial.docUrl || '',
    }));

    // Write to resources/catalogs/wallet.json
    const outputPath = path.resolve(__dirname, '../resources/catalogs/wallet.json');
    fs.writeFileSync(outputPath, JSON.stringify(fullEntries, null, 4), 'utf-8');

    console.log(`✅ Generated wallet.json with ${fullEntries.length} endpoints`);
    console.log(`   Output: ${outputPath}`);
}

// Run the script
generateWalletCatalog();
