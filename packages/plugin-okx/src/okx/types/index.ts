export interface TokenInfo {
    decimal: string;
    isHoneyPot: boolean;
    taxRate: string;
    tokenContractAddress: string;
    tokenSymbol: string;
    tokenUnitPrice: string;
}

export interface DexProtocol {
    dexName: string;
    percent: string;
}

export interface SubRouter {
    dexProtocol: DexProtocol[];
    fromToken: TokenInfo;
    toToken: TokenInfo;
}

export interface DexRouter {
    router: string;
    routerPercent: string;
    subRouterList: SubRouter[];
}

export interface QuoteCompareItem {
    amountOut: string;
    dexLogo: string;
    dexName: string;
    tradeFee: string;
}

export interface QuoteData {
    chainId: string;
    dexRouterList: DexRouter[];
    estimateGasFee: string;
    fromToken: TokenInfo;
    fromTokenAmount: string;
    priceImpactPercentage: string;
    quoteCompareList: QuoteCompareItem[];
    toToken: TokenInfo;
    toTokenAmount: string;
    tradeFee: string;
    tx?: {
        data: string;
    };
    data?: string;
}

export interface APIResponse<T> {
    code: string;
    msg: string;
    data: T[];
}

// Keep existing config interfaces
export interface OKXConfig {
    apiKey: string;
    secretKey: string;
    apiPassphrase: string;
    projectId: string;
    baseUrl?: string;
    maxRetries?: number;
    timeout?: number;
    solana?: SolanaConfig;
}

export interface SolanaConfig {
    connection: {
        rpcUrl: string;
        wsEndpoint?: string;
        confirmTransactionInitialTimeout?: number;
    };
    privateKey: string;
    computeUnits?: number;
    maxRetries?: number;
}

// Request params interfaces
export interface BaseParams {
    chainId: string;
    fromTokenAddress: string;
    toTokenAddress: string;
    amount: string;
    userWalletAddress?: string;
}

export interface APIRequestParams {
    [key: string]: string | undefined;
}

export interface SlippageOptions {
    slippage?: string;
    autoSlippage?: boolean;
    maxAutoSlippage?: string;
}

export type SwapParams = BaseParams & Partial<SlippageOptions>;

export interface QuoteParams extends BaseParams {
    slippage: string;
}

// Results interfaces
export interface SwapResult {
    success: boolean;
    transactionId: string;
    explorerUrl: string;
}

// Formatted response for frontend
export interface FormattedSwapResponse {
    success: boolean;
    quote: {
        fromToken: {
            symbol: string;
            amount: string;
            decimal: string;
            unitPrice: string;
        };
        toToken: {
            symbol: string;
            amount: string;
            decimal: string;
            unitPrice: string;
        };
        priceImpact: string;
        dexRoutes: {
            dex: string;
            amountOut: string;
            fee: string;
        }[];
    };
    summary: string;
    tx?: {
        data: string;
    };
}