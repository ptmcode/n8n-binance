# Spot Trading Endpoints Updates

## Date: February 24, 2026

## Summary
Updated the Spot Trading endpoints in `resources/catalogs/spot.json` to match the latest Binance API documentation.

## Changes Made

### 1. Updated Existing Endpoints

#### POST /api/v3/order/test
- Changed `strategyType` from `LONG` to `INT`
- Added `trailingDelta` parameter (LONG)
- Added `pegPriceType` parameter (ENUM: PRIMARY_PEG, MARKET_PEG)
- Added `pegOffsetValue` parameter (INT)
- Added `pegOffsetType` parameter (ENUM: PRICE_LEVEL)
- Added `computeCommissionRates` parameter (BOOLEAN)
- Changed `recvWindow` from `LONG` to `DECIMAL` with precision support
- Added `timestamp` parameter (LONG, required)
- Updated notes to clarify it validates but doesn't send to matching engine

#### POST /api/v3/order
- Changed `strategyType` from `LONG` to `INT`
- Added `pegPriceType` parameter (ENUM: PRIMARY_PEG, MARKET_PEG)
- Added `pegOffsetValue` parameter (INT)
- Added `pegOffsetType` parameter (ENUM: PRICE_LEVEL)
- Changed `recvWindow` from `LONG` to `DECIMAL` with precision support
- Added `timestamp` parameter (LONG, required)
- Added descriptions for multiple parameters

#### POST /api/v3/order/cancelReplace
- Added `strategyId` parameter (LONG)
- Changed `strategyType` from `LONG` to `INT`
- Added `cancelRestrictions` parameter (ENUM: ONLY_NEW, ONLY_PARTIALLY_FILLED)
- Added `orderRateLimitExceededMode` parameter (ENUM: DO_NOTHING, CANCEL_ONLY)
- Added `pegPriceType` parameter (ENUM: PRIMARY_PEG, MARKET_PEG)
- Added `pegOffsetValue` parameter (INT)
- Added `pegOffsetType` parameter (ENUM: PRICE_LEVEL)
- Changed `recvWindow` from `LONG` to `DECIMAL` with precision support
- Added `timestamp` parameter (LONG, required)
- Added `selfTradePreventionMode` enum values
- Updated notes and parameter descriptions

#### POST /api/v3/order/oco (Deprecated)
- Added `limitStrategyId` parameter (LONG)
- Changed `limitStrategyType` to `INT`
- Added `stopStrategyId` parameter (LONG)
- Changed `stopStrategyType` to `INT`
- Changed `recvWindow` from `LONG` to `DECIMAL` with precision support
- Added `timestamp` parameter (LONG, required)
- Updated notes to indicate DEPRECATED status and suggest using POST /api/v3/orderList/oco

#### POST /api/v3/sor/order
- Added `strategyId` parameter (LONG)
- Added `strategyType` parameter (INT)
- Added `icebergQty` parameter (DECIMAL)
- Added `selfTradePreventionMode` parameter (ENUM)
- Changed `recvWindow` from `LONG` to `DECIMAL` with precision support
- Added `timestamp` parameter (LONG, required)
- Updated notes to clarify SOR functionality and LIMIT/MARKET only support

### 2. New Endpoints Added

#### PUT /api/v3/order/amend/keepPriority
**New endpoint** for reducing order quantity while maintaining queue priority.
- Weight: 4
- Parameters:
  - symbol (STRING, required)
  - orderId (LONG, optional)
  - origClientOrderId (STRING, optional)
  - newClientOrderId (STRING, optional)
  - newQty (DECIMAL, required)
  - recvWindow (DECIMAL, optional)
  - timestamp (LONG, required)

#### POST /api/v3/orderList/oco
**New OCO endpoint** replacing the deprecated /api/v3/order/oco.
- Weight: 1
- Comprehensive parameters for above and below orders:
  - aboveType, aboveClientOrderId, aboveIcebergQty, abovePrice, aboveStopPrice, aboveTrailingDelta, aboveTimeInForce
  - aboveStrategyId, aboveStrategyType, abovePegPriceType, abovePegOffsetType, abovePegOffsetValue
  - belowType, belowClientOrderId, belowIcebergQty, belowPrice, belowStopPrice, belowTrailingDelta, belowTimeInForce
  - belowStrategyId, belowStrategyType, belowPegPriceType, belowPegOffsetType, belowPegOffsetValue
  - Standard parameters: symbol, side, quantity, listClientOrderId, newOrderRespType, selfTradePreventionMode

### ✅ New Endpoints Added (8)
1. **PUT /api/v3/order/amend/keepPriority** - Reduce order quantity while keeping queue priority
2. **POST /api/v3/orderList/oco** - New OCO implementation (replaces deprecated endpoint)
3. **POST /api/v3/orderList/oto** - One-Triggers-the-Other order lists
4. **POST /api/v3/orderList/otoco** - One-Triggers-One-Cancels-the-Other order lists (working order triggers OCO pair)
5. **POST /api/v3/orderList/opo** - One-Party-Only order lists (pending order placed on partial fill)
6. **POST /api/v3/orderList/opoco** - One-Party-Only-One-Cancels-the-Other (OPO with OCO pending pair)
7. **DELETE /api/v3/orderList** - Cancel entire order lists
8. **POST /api/v3/sor/order/test** - Test SOR orders with commission calculation
**New endpoint** for canceling entire order lists.
- Weight: 1
- Parameters:
  - symbol (STRING, required)
  - orderListId (LONG, optional)
  - listClientOrderId (STRING, optional)
  - newClientOrderId (STRING, optional)
  - recvWindow (DECIMAL, optional)
  - timestamp (LONG, required)

#### POST /api/v3/sor/order/test
**New test endpoint** for SOR orders.
- Weight: 1
- All parameters from POST /api/v3/sor/order plus:
  - computeCommissionRates (BOOLEAN, optional)
- Validates order without sending to matching engine

## Key Parameter Type Changes

1. **strategyType**: Changed from `LONG` to `INT` across all endpoints
2. **recvWindow**: Changed from `LONG` to `DECIMAL` to support microsecond precision (up to 3 decimal places)

## New Parameter Categories

1. **Pegged Orders**: pegPriceType, pegOffsetType, pegOffsetValue
2. **Order Rate Limiting**: orderRateLimitExceededMode
3. **Cancel Restrictions**: cancelRestrictions
4. **Commission Calculation**: computeCommissionRates

## API Documentation References

All endpoints now reference the official Binance API documentation:
- https://developers.binance.com/docs/binance-spot-api-docs/rest-api/trading-endpoints

## Validation

✅ JSON syntax validated successfully
✅ All parameters documented with descriptions
✅ Enum values specified for all applicable parameters
✅ Required vs optional parameters properly marked

## Notes for Developers

1. The deprecated POST /api/v3/order/oco should still be supported for backward compatibility but users should migrate to POST /api/v3/orderList/oco
2. Pegged orders allow dynamic pricing based on market conditions
3. The Order Amend Keep Priority feature maintains queue position when reducing order size
4. SOR (Smart Order Routing) only supports LIMIT and MARKET order types
