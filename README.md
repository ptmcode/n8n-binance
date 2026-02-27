# n8n-nodes-binance-universal

A comprehensive **n8n community node** for calling **all Binance REST API endpoints** — both **Spot** (`/api/*`, `/sapi/*`) and **USDⓈ-M Futures** (`/fapi/*`).

## Features

- **Catalog Mode** – browse categorized endpoints (Market Data, Trading, Account, etc.) via dropdowns; parameters are displayed with descriptions and validation.
- **Custom Request Mode** – call any Binance REST path manually with full control over method, security type, and parameters.
- **HMAC SHA256 Signing** – automatic `timestamp` + `signature` injection for `SIGNED` endpoints.
- **API-Key-only endpoints** – `X-MBX-APIKEY` header set automatically for `API_KEY` security.
- **Multiple base URLs** – choose from `api.binance.com`, `api1–api4`, testnet, and USD-M Futures endpoints.
- **Rate-limit metadata** – every response includes extracted `x-mbx-used-weight`, `x-mbx-order-count`, and `x-sapi-used` headers.
- **Catalog generators** – scripts to re-generate the endpoint catalog from live Binance OpenAPI / docs.

## Installation

### Via n8n Community Nodes UI

1. Open **Settings → Community Nodes** in your n8n instance.
2. Enter `n8n-nodes-binance-universal` and click **Install**.

### Manual / Self-hosted

```bash
cd ~/.n8n/custom
npm install n8n-nodes-binance-universal
# restart n8n
```

### From Source

```bash
git clone https://github.com/your-org/n8n-nodes-binance-universal.git
cd n8n-nodes-binance-universal
npm install
npm run build
npm link

# In your n8n custom directory:
cd ~/.n8n/custom
npm link n8n-nodes-binance-universal
```

## Configuration

This node does **not** use n8n credential types. Instead, the API Key and Secret are provided directly as node parameters (password-masked fields). This allows you to store them in n8n variables or expressions.

| Parameter   | Description |
|-------------|-------------|
| `apiKey`    | Your Binance API key. Can use expressions like `{{ $vars.BINANCE_API_KEY }}` |
| `apiSecret` | Your Binance API secret. Can use expressions like `{{ $vars.BINANCE_SECRET }}` |

> **Tip:** Store your keys in n8n Variables (`Settings → Variables`) and reference them via expressions to keep them out of workflow JSON.

## Usage

### Catalog Mode (recommended)

1. Add the **Binance Universal (REST)** node to your workflow.
2. Set **API Group** to one of: `Spot`, `USD-M Futures`, `Wallet`, or `Sub-Account`.
3. Set **Mode** to `Catalog Endpoint`.
4. Select a **Category** (e.g. Market Data, Trading, Account).
5. Select an **Endpoint** from the dropdown.
6. Fill in the required parameters shown below.
7. Execute.

### Custom Request Mode

1. Set **Mode** to `Custom Request`.
2. Enter the HTTP **Method** (`GET`, `POST`, `PUT`, `DELETE`).
3. Enter the **Path** (e.g. `/api/v3/account`).
4. Set **Security** (`NONE`, `API_KEY`, or `SIGNED`).
5. Add parameters as key-value pairs or raw JSON.

## Examples

### Get Server Time (no auth)

- **API Group:** Spot
- **Mode:** Catalog Endpoint
- **Category:** General
- **Endpoint:** GET /api/v3/time

### Get Account Info (signed)

- **API Group:** Spot
- **Mode:** Catalog Endpoint
- **Category:** Account
- **Endpoint:** GET /api/v3/account
- **apiKey:** `{{ $vars.BINANCE_API_KEY }}`
- **apiSecret:** `{{ $vars.BINANCE_SECRET }}`

### Place a Test Order on USD-M Futures

- **API Group:** USD-M Futures
- **Mode:** Catalog Endpoint
- **Category:** Trading
- **Endpoint:** POST /fapi/v1/order/test
- **Parameters:**
  - `symbol` = `BTCUSDT`
  - `side` = `BUY`
  - `type` = `MARKET`
  - `quantity` = `0.001`

### Get Klines via Custom Request

- **Mode:** Custom Request
- **Method:** GET
- **Path:** `/api/v3/klines`
- **Security:** NONE
- **Parameters:**
  - `symbol` = `ETHUSDT`
  - `interval` = `1h`
  - `limit` = `24`

## Output Format

Every execution returns an n8n item with the following structure:

```json
{
  "data": { /* Binance API response */ },
  "meta": {
    "apiGroup": "spot",
    "method": "GET",
    "path": "/api/v3/time",
    "baseUrl": "https://api.binance.com",
    "requestId": "a1b2c3d4e5f6g7h8",
    "rateLimits": {
      "x-mbx-used-weight-1m": "3"
    }
  }
}
```

## Regenerating Catalogs

The seed catalogs in `resources/catalogs/` can be regenerated from Binance API documentation:

```bash
# Generate individual catalogs
npm run generate:catalog:spot           # Spot API endpoints
npm run generate:catalog:usdm           # USD-M Futures endpoints
npm run generate:catalog:wallet         # Wallet API endpoints
npm run generate:catalog:sub-account    # Sub-Account endpoints

# Generate all catalogs at once
npm run generate:catalogs
```

After regeneration, rebuild the node:

```bash
npm run build
```

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test

# Lint
npm run lint

# Watch mode (rebuild on changes)
npm run dev
```

## Project Structure

```
├── nodes/
│   └── BinanceUniversal/
│       ├── BinanceUniversal.node.ts      # Main node class
│       ├── BinanceUniversal.description.ts # UI description & parameter definitions
│       ├── binanceHttp.ts                 # HTTP client, HMAC signing, validation
│       ├── catalogTypes.ts                # TypeScript types for catalog entries
│       └── binance.svg                    # Node icon
├── resources/
│   └── catalogs/
│       ├── spot.json                      # Spot API endpoints
│       ├── usdm.json                      # USD-M Futures endpoints
│       ├── wallet.json                    # Wallet API endpoints (21 endpoints)
│       └── sub-account.json               # Sub-Account endpoints
├── scripts/
│   ├── catalogTypes.ts                    # Shared types for generators
│   ├── generateSpotCatalog.ts             # Spot catalog generator
│   ├── generateUsdmCatalog.ts             # USD-M catalog generator
│   ├── generateWalletCatalog.ts           # Wallet catalog generator
│   └── generateSubAccountCatalog.ts       # Sub-Account catalog generator
├── tests/
│   └── binanceHttp.test.ts                # Unit tests for HTTP helpers
├── package.json
├── tsconfig.json
├── tsconfig.scripts.json
└── jest.config.js
```

## API Reference

This node covers **4 API Groups** and **227 endpoints** total. Select the API Group in the node's **API Group** dropdown to access the relevant categories.

| API Group | Base Path | Endpoints | Description |
|-----------|-----------|-----------|-------------|
| [Spot](#spot-apiv3-sapiv1) | `/api/v3`, `/sapi/*` | 44 | Spot trading, market data, and account management |
| [USD-M Futures](#usd-m-futures-fapiv1) | `/fapi/v1–v3`, `/futures/data/*` | 92 | Perpetual and delivery futures trading |
| [Wallet](#wallet-sapiv1) | `/sapi/v1–v4` | 46 | Deposits, withdrawals, assets, and travel-rule compliance |
| [Sub-Account](#sub-account-sapiv1) | `/sapi/v1–v4` | 45 | Sub-account creation, transfers, and managed accounts |

---

### Spot (`/api/v3`, `/sapi/*`)

The Spot API group covers all standard spot market operations on Binance.

| Category | Endpoints | Auth Required | Description |
|----------|-----------|---------------|-------------|
| **General** | 3 | None | Connectivity check (`/ping`), server time, and full exchange trading rules & symbol info (`/exchangeInfo`) |
| **Market Data** | 12 | None | Public market data: order book depth, recent & historical trades, aggregated trades, candlestick/kline data, UI klines, average price, 24 h rolling tickers, trading-day tickers, price tickers, and best bid/ask |
| **Trading** | 15 | Signed | Place, cancel, replace, and amend orders; supports standard orders, OCO (One-Cancels-the-Other), OTO, OTOCO, OPO, OPOCO, and Smart Order Routing (SOR) orders; includes test-order endpoints for validation without execution |
| **Account** | 14 | Signed | Query open orders, all orders, trade history, prevented matches, allocations, order amendments, account balances, commission rates, and current rate-limit usage |

**Key use-cases:** Live price feeds, automated spot trading bots, order history auditing, commission analysis.

---

### USD-M Futures (`/fapi/v1–v3`, `/futures/data/*`)

The USD-M Futures group covers perpetual and delivery futures contracts settled in USDT/USDC.

| Category | Endpoints | Auth Required | Description |
|----------|-----------|---------------|-------------|
| **Market Data** | 34 | None (most) | Order book, trades, klines (standard, index, mark-price, premium-index, continuous-contract), funding rates & history, open interest (snapshot + historical), long/short ratios (accounts & positions), taker buy/sell volume, delivery prices, composite index, asset index, insurance fund balance, ADL risk, and trading schedule |
| **Trade** | 32 | Signed | Place, modify, cancel, and batch-manage futures orders; query open/all orders, user trades, force-liquidation orders, and order amendments; manage position side (hedge/one-way), margin type (isolated/cross), leverage, position margin; algo orders; stock contract placement; and async data-download initiation |
| **Account** | 21 | Signed | Account & balance snapshots (v2/v3), leverage bracket info, income history (with async download), commission rates, account/symbol config, multi-assets margin mode, API trading status, fee-burn toggle, and rate-limit order count |
| **Convert** | 4 | Signed | Query available convert pairs and rates, request a conversion quote, accept a quote, and check conversion order status |
| **Portfolio Margin Endpoints** | 1 | Signed | Query Portfolio Margin account information (`/fapi/v1/pmAccountInfo`) |

**Key use-cases:** Algorithmic futures trading, funding-rate arbitrage, open-interest analysis, long/short sentiment monitoring.

---

### Wallet (`/sapi/v1–v4`)

The Wallet group provides management of funds across all wallet types, coin configs, deposit/withdrawal flows, and regulatory travel-rule tooling.

| Category | Endpoints | Auth Required | Description |
|----------|-----------|---------------|-------------|
| **Capital** | 9 | Signed | List all supported coins and their networks, submit withdrawals, query deposit and withdrawal history, list withdrawal addresses, check withdrawal quotas, generate deposit addresses (single or list), and submit credit-apply for deposits |
| **Asset** | 18 | Signed | Query dust conversion log, convert small balances to BNB, asset-dividend history, asset detail (min withdraw, deposit status), wallet balances, trading fees, funding-wallet balances, universal asset transfer & history, toggle BNB burn for spot/margin fees, cloud-mining transfer history, custody transfer history, spot delist schedules, open symbol list, and dust-convert utilities |
| **Account** | 7 | Signed | Account daily snapshots (spot, margin, futures), enable/disable fast-withdraw switch, account status, account API trading status, and API key restriction details |
| **Travel Rule** | 12 | Signed | Regulatory compliance endpoints: local-entity withdrawals, deposit info submission (v1/v2), deposit/withdrawal history (v1/v2), VASP list lookup, address verification list, broker-specific withdrawal and deposit info, and questionnaire-requirement queries |

**Key use-cases:** Automated withdrawal pipelines, multi-coin deposit monitoring, regulatory compliance workflows, fee optimization.

---

### Sub-Account (`/sapi/v1–v4`)

The Sub-Account group enables master-account holders to create and manage child accounts, control their API keys, move assets, and use managed-sub-account features for fund management.

| Category | Endpoints | Auth Required | Description |
|----------|-----------|---------------|-------------|
| **Account Management** | 8 | Signed | Create virtual sub-accounts, list all sub-accounts, query sub-account status, enable futures or European Options trading for a sub-account, query futures position risk (v1/v2), and retrieve transaction statistics |
| **Asset Management** | 23 | Signed | Sub-to-sub and sub-to-master transfers, universal transfers & history, futures and margin wallet transfers, internal futures transfers, futures position move, deposit addresses and history for sub-accounts, futures/margin account details and summaries (v1/v2), sub-account asset queries (v3/v4), and spot summary |
| **API Management** | 3 | Signed | Query IP restrictions on a sub-account API key, add IP restrictions, and delete IP restriction entries |
| **Managed Sub Account** | 11 | Signed | Deposit and withdraw assets to/from managed sub-accounts, query managed sub-account snapshots and asset lists, transaction log queries for both investor and trade-parent sides, fetch future assets, query managed-account info, generate deposit addresses, query margin assets, and full transaction-log search |

**Key use-cases:** Fund-management platforms, broker/rebate programs, multi-user trading infrastructure, automated sub-account onboarding.

## License

MIT

## Disclaimer

This project is not affiliated with, endorsed by, or sponsored by Binance. Use at your own risk. Always test with Binance Testnet before using real funds.
