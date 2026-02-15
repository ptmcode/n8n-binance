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
2. Set **API Group** to `Spot` or `USD-M Futures`.
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

The seed catalogs in `resources/catalogs/` can be regenerated from live Binance documentation:

```bash
# Generate Spot catalog from OpenAPI spec
npm run generate:spot

# Generate USD-M Futures catalog from developer docs
npm run generate:usdm

# Generate both
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
│       ├── spot.json                      # ~48 Spot API endpoints
│       └── usdm.json                      # ~52 USD-M Futures endpoints
├── scripts/
│   ├── catalogTypes.ts                    # Shared types for generators
│   ├── generateSpotCatalog.ts             # Spot catalog generator
│   └── generateUsdmCatalog.ts             # USD-M catalog generator
├── tests/
│   └── binanceHttp.test.ts                # Unit tests for HTTP helpers
├── package.json
├── tsconfig.json
├── tsconfig.scripts.json
└── jest.config.js
```

## Supported Endpoint Categories

### Spot (`/api/*`, `/sapi/*`)

| Category | Examples |
|----------|----------|
| General | Ping, Server Time, Exchange Info |
| Market Data | Depth, Trades, Klines, Ticker, Avg Price |
| Trading | New Order, Cancel, Query, OCO, SOR |
| Account | Account Info, Trade List |
| User Data Streams | Create/Keepalive/Close listen key |
| Wallet | System Status, Coins, Deposit/Withdraw History, Dust Transfer |
| Margin | Cross Margin Transfer, Borrow, Repay |
| Convert | Accept Quote |

### USD-M Futures (`/fapi/*`)

| Category | Examples |
|----------|----------|
| General | Ping, Server Time, Exchange Info |
| Market Data | Depth, Trades, Klines, Funding Rate, Open Interest, Ticker |
| Trading | New Order, Batch Orders, Cancel, Modify, Force Orders |
| Account | Position Risk, Balance, Leverage, Margin Type, Income, Commission |
| User Data Streams | Create/Keepalive/Close listen key |

## License

MIT

## Disclaimer

This project is not affiliated with, endorsed by, or sponsored by Binance. Use at your own risk. Always test with Binance Testnet before using real funds.
