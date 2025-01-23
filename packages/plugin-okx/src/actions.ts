// src/actions.ts
import {
    generateText,
    type HandlerCallback,
    type IAgentRuntime,
    type Memory,
    ModelClass,
    type State,
    composeContext,
    type Action,
    type ActionExample,
} from "@elizaos/core";
import { OKXDexClient } from "../src/okx/core/client";
import {
    TokenInfo,
    APIResponse,
    FormattedSwapResponse,
    QuoteData,
    TokenListInfo,
    SwapExecutionData,
} from "./okx/types";

// Constants for native SOL
const NATIVE_SOL = {
    address: "11111111111111111111111111111111",
    decimals: 9,
};

async function extractSwapParams(message: Memory, client: OKXDexClient) {
    // Parse message content
    let messageContent = "";
    if (typeof message.content === "string") {
        messageContent = message.content;
    } else if (message.content && typeof message.content === "object") {
        messageContent =
            (message.content as any).text || JSON.stringify(message.content);
    }

    console.log("Processing message content:", messageContent);
    messageContent = messageContent.trim();

    // Extract amount and tokens with more flexible patterns
    const patterns = [
        // Match "1.5 SOL to USDC" or "1.5 <address> to <address>"
        /(?:quote|swap)?\s*(?:for)?\s*([+-]?\d*\.?\d+(?:e[+-]?\d+)?)\s*([\w.-]+)\s*(?:to|for|->|=>)\s*([\w.-]+)/i,
        // Match "from SOL to USDC amount 1.5"
        /from\s*([\w.-]+)\s*(?:to|for|->|=>)\s*([\w.-]+)\s*(?:amount|quantity)?\s*([+-]?\d*\.?\d+(?:e[+-]?\d+)?)/i,
        // Legacy format
        /from_token:\s*([\w.-]+)\s*to_token:\s*([\w.-]+)\s*amount:\s*([+-]?\d*\.?\d+(?:e[+-]?\d+)?)/i,
    ];

    let fromToken = "";
    let toToken = "";
    let amount = "";

    // Try each pattern
    for (const pattern of patterns) {
        const match = messageContent.match(pattern);
        if (match) {
            if (pattern.source.startsWith("from")) {
                [, fromToken, toToken, amount] = match;
            } else {
                [, amount, fromToken, toToken] = match;
            }
            console.log("Pattern matched:", {
                pattern: pattern.source,
                fromToken,
                toToken,
                amount,
            });
            break;
        }
    }

    // If not found in combined patterns, try individual patterns
    if (!amount || !fromToken || !toToken) {
        const amountMatch = messageContent.match(
            /([+-]?\d*\.?\d+(?:e[+-]?\d+)?)/
        );
        const fromMatch =
            messageContent.match(/from\s*([\w.-]+)/i) ||
            messageContent.match(/(?:^|\s)([\w.-]+)(?:\s|$)/);
        const toMatch = messageContent.match(/to\s*([\w.-]+)/i);

        amount = amount || amountMatch?.[1] || "";
        fromToken = fromToken || fromMatch?.[1] || "";
        toToken = toToken || toMatch?.[1] || "";
    }

    // Ensure values are strings and trimmed
    fromToken = String(fromToken || "").trim();
    toToken = String(toToken || "").trim();

    console.log("Processed tokens:", { fromToken, toToken });

    // Basic validation
    if (!fromToken) {
        throw new Error(
            "Could not determine the source token. " +
                "Please provide a valid token symbol or address. " +
                "Example: 'quote for 1.5 SOL to USDC'"
        );
    }

    if (!toToken) {
        throw new Error(
            "Could not determine the target token. " +
                "Please provide a valid token symbol or address. " +
                "Example: 'quote for 1.5 SOL to USDC'"
        );
    }

    if (!amount) {
        throw new Error(
            "Could not determine the amount to swap. " +
                "Please specify the amount. " +
                "Example: 'quote for 1.5 SOL to USDC'"
        );
    }

    try {
        // Get token list for address lookup and decimal information
        console.log("Fetching token information...");
        const tokenResponse = await client.dex.getTokens("501");
        const tokenListResponse =
            tokenResponse as unknown as APIResponse<TokenListInfo>;

        if (
            !tokenListResponse ||
            tokenListResponse.code !== "0" ||
            !Array.isArray(tokenListResponse.data)
        ) {
            console.error("Invalid token response:", tokenListResponse);
            throw new Error("Failed to fetch token information");
        }

        // console.log("First few tokens:", tokenListResponse.data.slice(0, 5));

        // Create token maps with proper typing
        const symbolToToken = new Map<string, TokenListInfo>();
        const addressToToken = new Map<string, TokenListInfo>();

        // Build token maps from API response
        tokenListResponse.data.forEach((token) => {
            if (
                token?.tokenSymbol &&
                token?.tokenContractAddress &&
                token?.decimals
            ) {
                const symbol = token.tokenSymbol.toUpperCase();
                const address = token.tokenContractAddress.toLowerCase();

                // Store token info
                symbolToToken.set(symbol, token);
                addressToToken.set(address, token);

                // Handle SOL/WSOL mapping
                if (symbol === "SOL") {
                    const wsolAddress =
                        "So11111111111111111111111111111111111111112";
                    const wsolToken = {
                        ...token,
                        tokenSymbol: "WSOL",
                        tokenContractAddress: wsolAddress,
                    };
                    symbolToToken.set("WSOL", wsolToken);
                    addressToToken.set(wsolAddress.toLowerCase(), wsolToken);
                }

                // console.log(
                //     `Mapped token: ${symbol} -> ${address} (decimals: ${token.decimals})`
                // );
            }
        });

        // Debug output
        // const availableSymbols = Array.from(symbolToToken.keys()).sort();
        // console.log("Available symbols:", availableSymbols);

        // Resolve token info using maps
        const fromTokenInfo =
            symbolToToken.get(fromToken.toUpperCase()) ||
            addressToToken.get(fromToken.toLowerCase());
        const toTokenInfo =
            symbolToToken.get(toToken.toUpperCase()) ||
            addressToToken.get(toToken.toLowerCase());

        if (!fromTokenInfo || !toTokenInfo) {
            const availableTokens = Array.from(symbolToToken.keys()).join(", ");
            throw new Error(
                `Could not resolve tokens. Available tokens: ${availableTokens}`
            );
        }

        // Use resolved addresses
        const fromTokenAddress = fromTokenInfo.tokenContractAddress;
        const toTokenAddress = toTokenInfo.tokenContractAddress;

        // Convert amount using the token's decimals from API
        let decimals: number;
        if (fromTokenAddress === NATIVE_SOL.address) {
            decimals = NATIVE_SOL.decimals;
        } else {
            const token =
                addressToToken.get(fromTokenAddress.toLowerCase()) ||
                symbolToToken.get(fromToken.toUpperCase());

            if (!token) {
                throw new Error(`Could not find token info for: ${fromToken}`);
            }

            decimals = parseInt(token.decimals);
            if (isNaN(decimals)) {
                throw new Error(
                    `Invalid decimal value for token: ${fromToken}`
                );
            }
        }

        // Convert amount
        const parsedAmount = parseFloat(amount);
        if (isNaN(parsedAmount)) {
            throw new Error(`Invalid amount value: ${amount}`);
        }
        const amountInSmallestUnit = (
            parsedAmount * Math.pow(10, decimals)
        ).toString();

        console.log("Final parameters:", {
            fromTokenAddress,
            toTokenAddress,
            amount: amountInSmallestUnit,
            originalAmount: amount,
            decimals,
        });

        return {
            fromTokenAddress,
            toTokenAddress,
            amount: amountInSmallestUnit,
        };
    } catch (error) {
        console.error("Error in extractSwapParams:", error);
        throw new Error(
            `Failed to process swap parameters: ${
                error instanceof Error ? error.message : String(error)
            }`
        );
    }
}

function formatQuoteResponse(
    data: QuoteData | SwapExecutionData
): FormattedSwapResponse {
    // Extract the relevant data whether it's a quote or swap response
    const quote = "routerResult" in data ? data.routerResult : data;

    const fromDecimals = parseInt(quote.fromToken.decimal);
    const toDecimals = parseInt(quote.toToken.decimal);

    const displayFromAmount = (
        Number(quote.fromTokenAmount) / Math.pow(10, fromDecimals)
    ).toString();

    const displayToAmount = (
        Number(quote.toTokenAmount) / Math.pow(10, toDecimals)
    ).toString();

    return {
        success: true,
        quote: {
            fromToken: {
                symbol: quote.fromToken.tokenSymbol,
                amount: displayFromAmount,
                decimal: quote.fromToken.decimal,
                unitPrice: quote.fromToken.tokenUnitPrice,
            },
            toToken: {
                symbol: quote.toToken.tokenSymbol,
                amount: displayToAmount,
                decimal: quote.toToken.decimal,
                unitPrice: quote.toToken.tokenUnitPrice,
            },
            priceImpact: quote.priceImpactPercentage + "%",
            dexRoutes: quote.quoteCompareList.map((route) => ({
                dex: route.dexName,
                amountOut: route.amountOut,
                fee: route.tradeFee,
            })),
        },
        summary:
            `Quote for ${displayFromAmount} ${quote.fromToken.tokenSymbol} to ${quote.toToken.tokenSymbol}:\n` +
            `Expected output: ${displayToAmount} ${quote.toToken.tokenSymbol}\n` +
            `Price impact: ${quote.priceImpactPercentage}%`,
    };
}

function getActionHandler(
    actionName: string,
    actionDescription: string,
    client: OKXDexClient
) {
    return async (
        runtime: IAgentRuntime,
        message: Memory,
        state: State | undefined,
        options?: Record<string, unknown>,
        callback?: HandlerCallback
    ): Promise<boolean> => {
        let currentState = state ?? (await runtime.composeState(message));
        currentState = await runtime.updateRecentMessageState(currentState);

        try {
            let result;

            switch (actionName) {
                case "GET_CHAIN_DATA":
                    const chainData = await client.dex.getSupportedChains(
                        "501"
                    );
                    result = {
                        chains: chainData.data.map((chain) => ({
                            id: chain.chainId,
                            name: chain.chainName,
                            dexApprovalAddress:
                                chain.dexTokenApproveAddress || null,
                        })),
                    };
                    break;

                case "GET_LIQUIDITY_PROVIDERS":
                    result = await client.dex.getLiquidity("501");
                    break;

                case "GET_SWAP_QUOTE": {
                    const params = await extractSwapParams(message, client);
                    console.log("Sending quote request with params:", params);

                    const quoteResult = await client.dex.getQuote({
                        chainId: "501",
                        fromTokenAddress: params.fromTokenAddress,
                        toTokenAddress: params.toTokenAddress,
                        amount: params.amount,
                        slippage: "0.1",
                        userWalletAddress: process.env.WALLET_ADDRESS,
                    });

                    console.log(
                        "Received quote result:",
                        JSON.stringify(quoteResult, null, 2)
                    );

                    if (quoteResult.code === "0" && quoteResult.data?.[0]) {
                        result = formatQuoteResponse(quoteResult.data[0]);
                    } else {
                        throw new Error(
                            quoteResult.msg || "Failed to get quote"
                        );
                    }
                    break;
                }

                case "GET_SWAP_TRANSACTION_DATA": {
                    const params = await extractSwapParams(message, client);

                    const swapResponse = await client.dex.getSwapData({
                        chainId: "501",
                        fromTokenAddress: params.fromTokenAddress,
                        toTokenAddress: params.toTokenAddress,
                        amount: params.amount,
                        autoSlippage: true,
                        maxAutoSlippage: "1000",
                        userWalletAddress: process.env.WALLET_ADDRESS,
                    });

                    if (swapResponse.code !== "0" || !swapResponse.data?.[0]) {
                        throw new Error(
                            swapResponse.msg ||
                                "Failed to get swap transaction data"
                        );
                    }

                    result = formatQuoteResponse(swapResponse.data[0]);
                    break;
                }

                case "GET_AVAILABLE_TOKENS":
                    result = await client.dex.getTokens("501");
                    break;

                case "EXECUTE_SWAP": {
                    const params = await extractSwapParams(message, client);
                    console.log("Getting swap data with params:", params);

                    // First get the swap data with proper parameters
                    const swapResponse = await client.dex.getSwapData({
                        chainId: "501",
                        fromTokenAddress: params.fromTokenAddress,
                        toTokenAddress: params.toTokenAddress,
                        amount: params.amount,
                        slippage: "0.5",
                        userWalletAddress: process.env.WALLET_ADDRESS,
                    });

                    console.log(
                        "Received swap data response:",
                        JSON.stringify(swapResponse, null, 2)
                    );

                    if (swapResponse.code !== "0" || !swapResponse.data?.[0]) {
                        throw new Error(
                            swapResponse?.msg || "Failed to get swap data"
                        );
                    }

                    // Get the router result which contains our token data
                    const routerResult = swapResponse.data[0];
                    const txData = swapResponse.data[0].tx;

                    if (
                        !routerResult.routerResult?.fromToken?.decimal ||
                        !routerResult.routerResult?.toToken?.decimal
                    ) {
                        console.error(
                            "Missing decimal information in token data:",
                            routerResult
                        );
                        throw new Error("Invalid token decimal information");
                    }

                    // Format the amounts for display using actual token decimal data
                    const { routerResult: swapResult } = routerResult;
                    const fromDecimals = parseInt(swapResult.fromToken.decimal);
                    const toDecimals = parseInt(swapResult.toToken.decimal);

                    const displayFromAmount = (
                        parseFloat(swapResult.fromTokenAmount) /
                        Math.pow(10, fromDecimals)
                    ).toFixed(6);

                    const displayToAmount = (
                        parseFloat(swapResult.toTokenAmount) /
                        Math.pow(10, toDecimals)
                    ).toFixed(6);

                    console.log("Executing swap with data:", {
                        fromToken: swapResult.fromToken.tokenSymbol,
                        toToken: swapResult.toToken.tokenSymbol,
                        fromAmount: displayFromAmount,
                        expectedOutput: displayToAmount,
                        priceImpact: swapResult.priceImpactPercentage,
                    });

                    // Execute the swap with the same parameters
                    const executeResult = await client.dex.executeSwap({
                        chainId: "501",
                        fromTokenAddress: params.fromTokenAddress,
                        toTokenAddress: params.toTokenAddress,
                        amount: params.amount,
                        slippage: "0.5",
                        userWalletAddress: process.env.WALLET_ADDRESS,
                    });

                    // Format the result for display
                    const formattedResult = {
                        success: executeResult.success,
                        transaction: {
                            id: executeResult.transactionId,
                            explorerUrl: executeResult.explorerUrl,
                        },
                        swapDetails: {
                            fromToken: {
                                symbol: swapResult.fromToken.tokenSymbol,
                                amount: displayFromAmount,
                                decimal: swapResult.fromToken.decimal,
                            },
                            toToken: {
                                symbol: swapResult.toToken.tokenSymbol,
                                amount: displayToAmount,
                                decimal: swapResult.toToken.decimal,
                            },
                            priceImpact: swapResult.priceImpactPercentage + "%",
                            route:
                                swapResult.quoteCompareList[0]?.dexName ||
                                "Unknown",
                            txData: txData?.data,
                        },
                        summary:
                            `Swap executed successfully!\n` +
                            `Swapped ${displayFromAmount} ${swapResult.fromToken.tokenSymbol} for approximately ${displayToAmount} ${swapResult.toToken.tokenSymbol}\n` +
                            `Price Impact: ${swapResult.priceImpactPercentage}%\n` +
                            `Transaction ID: ${executeResult.transactionId}\n` +
                            `View on Explorer: ${executeResult.explorerUrl}`,
                    };

                    result = formattedResult;
                    break;
                }

                default:
                    throw new Error(`Unknown action: ${actionName}`);
            }

            const response = await generateText({
                runtime,
                context: composeContext({
                    state: currentState,
                    template: JSON.stringify(result),
                }),
                modelClass: ModelClass.SMALL,
            });

            callback?.({
                text: response,
                content: result,
            });
            return true;
        } catch (error) {
            const errorMessage =
                error instanceof Error ? error.message : String(error);
            const errorResponse = await generateText({
                runtime,
                context: composeContext({
                    state: currentState,
                    template: `Error: ${errorMessage}`,
                }),
                modelClass: ModelClass.SMALL,
            });

            callback?.({
                text: errorResponse,
                content: { error: errorMessage },
            });
            return false;
        }
    };
}

export async function getOKXActions(
    getSetting: (key: string) => string | undefined
) {
    const actionsWithoutHandler: Omit<Action, "handler">[] = [
        {
            name: "GET_CHAIN_DATA",
            description: "Get Solana chain data from OKX DEX",
            similes: [],
            validate: async () => true,
            examples: [],
        },
        {
            name: "GET_LIQUIDITY_PROVIDERS",
            description: "Get liquidity providers on Solana from OKX DEX",
            similes: [],
            validate: async () => true,
            examples: [],
        },
        {
            name: "GET_SWAP_QUOTE",
            description: "Get a swap quote for tokens on Solana",
            similes: [],
            validate: async () => true,
            examples: [
                [
                    {
                        user: "user",
                        content: {
                            text: "Get quote from_token: SOL123 to_token: USDC456 amount: 1.5",
                        },
                    },
                    {
                        user: "assistant",
                        content: {
                            text: "Getting quote for swapping 1.5 SOL123 to USDC456...",
                        },
                    },
                ],
                [
                    {
                        user: "user",
                        content: {
                            text: "Get quote from SOL123 to USDC456 amount 1.5",
                        },
                    },
                    {
                        user: "assistant",
                        content: {
                            text: "Fetching quote for 1.5 tokens from SOL123 to USDC456...",
                        },
                    },
                ],
            ],
        },
        {
            name: "GET_SWAP_TRANSACTION_DATA",
            description: "Get swap transaction data for tokens on Solana",
            similes: [],
            validate: async () => true,
            examples: [
                [
                    {
                        user: "user",
                        content: {
                            text: "Get swap transaction data from_token: SOL123 to_token: USDC456 amount: 1.5",
                        },
                    },
                    {
                        user: "assistant",
                        content: {
                            text: "Getting swap transaction data for 1.5 SOL123 to USDC456...",
                        },
                    },
                ],
            ],
        },
        {
            name: "GET_AVAILABLE_TOKENS",
            description: "Get available tokens for swapping on Solana",
            similes: [],
            validate: async () => true,
            examples: [],
        },
        {
            name: "EXECUTE_SWAP",
            description: "Execute a token swap on Solana using OKX DEX",
            similes: [],
            validate: async () => true,
            examples: [
                [
                    {
                        user: "user",
                        content: {
                            text: "Swap from_token: SOL123 to_token: USDC456 amount: 1.5",
                        },
                    },
                    {
                        user: "assistant",
                        content: {
                            text: "Executing swap of 1.5 tokens from SOL123 to USDC456...",
                        },
                    },
                ],
                [
                    {
                        user: "user",
                        content: { text: "Swap 1.5 from SOL123 to USDC456" },
                    },
                    {
                        user: "assistant",
                        content: {
                            text: "Processing swap of 1.5 tokens from SOL123 to USDC456...",
                        },
                    },
                ],
            ],
        },
    ];

    const client = new OKXDexClient({
        apiKey: getSetting("OKX_API_KEY")!,
        secretKey: getSetting("OKX_SECRET_KEY")!,
        apiPassphrase: getSetting("OKX_API_PASSPHRASE")!,
        projectId: getSetting("OKX_PROJECT_ID")!,
        solana: {
            connection: {
                rpcUrl: getSetting("SOLANA_RPC_URL")!,
                wsEndpoint: getSetting("SOLANA_WS_URL"),
            },
            privateKey: getSetting("PRIVATE_KEY")!,
        },
    });

    return actionsWithoutHandler.map((action) => ({
        ...action,
        handler: getActionHandler(action.name, action.description, client),
    }));
}
