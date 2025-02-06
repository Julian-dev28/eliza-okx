# @elizaos/plugin-okx

A plugin for integrating OKX DEX capabilities within the ElizaOS ecosystem, currently supporting Solana network trading.

## Description

OKX DEX is a trading aggregator that this plugin integrates with Eliza. Currently, this plugin only supports:

- Trading tokens on the Solana network
- Direct routing through single liquidity pools
- Price impact protection and slippage controls

## Installation

```bash
pnpm install @elizaos/plugin-okx
```

## Configuration

### Developer Portal Setup

1. **Create Developer Account**

    - Visit the [OKX Developer Portal](https://www.okx.com/developers)
    - Click "Connect Wallet" (OKX Wallet recommended)
    - Complete wallet signature verification

2. **Create Project**

    - Click "Create New Project"
    - Enter project name and description
    - Click "Confirm"

3. **Generate API Keys**
    - In your project, click "Manage"
    - Click "Create API Key"
    - Enter API key name and passphrase
    - Store the generated API key, secret key, and passphrase securely

### Environment Variables

```typescript
# OKX API Configuration
OKX_PROJECT_ID=<Your OKX project ID>
OKX_API_KEY=<Your OKX API key>
OKX_SECRET_KEY=<Your OKX secret key>
OKX_API_PASSPHRASE=<Your API passphrase>

# Wallet Configuration
OKX_WALLET_ADDRESS=<Your Solana wallet address>
OKX_WALLET_PRIVATE_KEY=<Your wallet private key>

# Network Configuration
OKX_SOLANA_RPC_URL=<Your Solana RPC endpoint>
OKX_WS_ENDPOINT=<Your WebSocket endpoint>
```

## Usage

### Basic Swap Example

```typescript
// Get a quote for Solana tokens
const quote = await okx.getQuote({
    chainId: "solana",
    amount: "1000000000", // Amount in lamports
    fromTokenAddress: "So11111111111111111111111111111111111111112", // SOL
    toTokenAddress: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
});

// Execute the swap
const swap = await okx.swap({
    ...quote,
    slippage: "0.005", // 0.5% slippage
    userWalletAddress: "your_solana_address",
    directRoute: true, // Use single pool routing
});
```

### Advanced Features

- **Price Impact Protection**: Set `priceImpactProtectionPercentage` to limit maximum price impact
- **Direct Routing**: Enable `directRoute` for single-pool routing (recommended for Solana)
- **Compute Units**: Control transaction priority with `computeUnitPrice` and `computeUnitLimit`

## Common Issues & Troubleshooting

1. **API Authentication Errors**

    - Verify API key and credentials are correct
    - Check timestamp synchronization
    - Ensure proper signature generation
    - Confirm passphrase matches the one used during API key creation

2. **Transaction Failures**

    - Verify sufficient SOL balance for fees
    - Check slippage settings
    - Confirm token account exists

## Security Best Practices

1. **API Security**

    - Store credentials securely
    - Use environment variables
    - Rotate keys regularly
    - Never share your secret key or passphrase

2. **Transaction Safety**
    - Set reasonable slippage limits
    - Use price impact protection
    - Validate all parameters

## License

This plugin is part of the Eliza project. See the main project repository for license information.

## Resources

- [OKX DEX Documentation](https://www.okx.com/web3/build/docs/waas/dex-introduction)
- [Developer Portal](https://www.okx.com/developers)
