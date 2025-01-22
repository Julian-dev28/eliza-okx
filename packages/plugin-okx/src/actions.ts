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
import { TokenInfo, APIResponse, FormattedSwapResponse } from "./okx/types";
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
        const rawResponse = await client.dex.getTokens("501");
        const tokenResponse = rawResponse as unknown as APIResponse<TokenInfo>;

        if (
            !tokenResponse ||
            tokenResponse.code !== "0" ||
            !Array.isArray(tokenResponse.data)
        ) {
            console.error("Invalid token response:", tokenResponse);
            throw new Error("Failed to fetch token information");
        }

        console.log("First few tokens:", tokenResponse.data.slice(0, 5));

        // Create token maps
        const symbolToToken = new Map();
        const addressToToken = new Map();

        // Build token maps
        tokenResponse.data.forEach((token) => {
            if (
                token &&
                token.tokenSymbol &&
                token.tokenContractAddress &&
                token.decimals
            ) {
                const symbol = token.tokenSymbol.toUpperCase();
                const address = token.tokenContractAddress.toLowerCase();

                symbolToToken.set(symbol, token);
                addressToToken.set(address, token);
                console.log(`Mapped token: ${symbol} -> ${address}`);
            }
        });

        console.log("Available symbols:", Array.from(symbolToToken.keys()));

        // Resolve from token
        let fromTokenAddress: string | undefined;
        if (
            fromToken.toUpperCase() === "SOL" ||
            fromToken === NATIVE_SOL.address
        ) {
            fromTokenAddress = NATIVE_SOL.address;
        } else {
            const token =
                addressToToken.get(fromToken.toLowerCase()) ||
                symbolToToken.get(fromToken.toUpperCase());
            fromTokenAddress = token?.tokenContractAddress;
        }

        // Resolve to token
        let toTokenAddress: string | undefined;
        if (toToken.toUpperCase() === "SOL" || toToken === NATIVE_SOL.address) {
            toTokenAddress = NATIVE_SOL.address;
        } else {
            const token =
                addressToToken.get(toToken.toLowerCase()) ||
                symbolToToken.get(toToken.toUpperCase());
            toTokenAddress = token?.tokenContractAddress;
        }

        console.log("Resolved addresses:", {
            fromTokenAddress,
            toTokenAddress,
        });

        if (!fromTokenAddress) {
            throw new Error(
                `Could not resolve token address for: ${fromToken}`
            );
        }

        if (!toTokenAddress) {
            throw new Error(`Could not resolve token address for: ${toToken}`);
        }

        // Get decimals for amount conversion
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
                    result = await client.dex.getSupportedChains("501");
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
                    });

                    console.log(
                        "Received quote result:",
                        JSON.stringify(quoteResult, null, 2)
                    );

                    if (quoteResult.code === "0" && quoteResult.data?.[0]) {
                        const quote = quoteResult.data[0];

                        // Get decimals from quote response
                        const fromDecimals = parseInt(quote.fromToken.decimals);
                        const toDecimals = parseInt(quote.toToken.decimals);

                        console.log("Processing amounts with decimals:", {
                            fromDecimals,
                            toDecimals,
                            fromAmount: params.amount,
                            toAmount: quote.toTokenAmount,
                        });

                        // Convert amounts considering decimals
                        const displayFromAmount = (
                            parseFloat(params.amount) /
                            Math.pow(10, fromDecimals)
                        ).toString();
                        const displayToAmount = (
                            parseFloat(quote.toTokenAmount) /
                            Math.pow(10, toDecimals)
                        ).toString();

                        console.log("Converted amounts:", {
                            displayFromAmount,
                            displayToAmount,
                        });

                        // Format response
                        const formattedResponse = {
                            success: true,
                            quote: {
                                fromToken: {
                                    symbol: quote.fromToken.tokenSymbol,
                                    amount: displayFromAmount,
                                    decimals: quote.fromToken.decimals,
                                    unitPrice: quote.fromToken.tokenUnitPrice,
                                },
                                toToken: {
                                    symbol: quote.toToken.tokenSymbol,
                                    amount: displayToAmount,
                                    decimals: quote.toToken.decimals,
                                    unitPrice: quote.toToken.tokenUnitPrice,
                                },
                                priceImpact: quote.priceImpactPercentage + "%",
                                dexRoutes: quote.quoteCompareList.map(
                                    (route) => ({
                                        dex: route.dexName,
                                        amountOut: route.amountOut,
                                        fee: route.tradeFee,
                                    })
                                ),
                            },
                            summary:
                                `Quote for ${displayFromAmount} ${quote.fromToken.tokenSymbol} to ${quote.toToken.tokenSymbol}:\n` +
                                `Expected output: ${displayToAmount} ${quote.toToken.tokenSymbol}\n` +
                                `Price impact: ${quote.priceImpactPercentage}%\n` +
                                `Best route via: ${
                                    quote.quoteCompareList[0]?.dexName ||
                                    "Unknown"
                                }`,
                        };

                        result = formattedResponse;
                    } else {
                        throw new Error(
                            quoteResult.msg || "Failed to get quote"
                        );
                    }
                    break;
                }
                case "GET_SWAP_TRANSACTION_DATA": {
                    const params = await extractSwapParams(message, client);

                    // Get swap data
                    const swapResponse = await client.dex.getSwapData({
                        chainId: "501",
                        fromTokenAddress: params.fromTokenAddress,
                        toTokenAddress: params.toTokenAddress,
                        amount: params.amount,
                        autoSlippage: true,
                        maxAutoSlippage: "1000", // 10% in basis points
                    });

                    if (swapResponse.code !== "0" || !swapResponse.data?.[0]) {
                        throw new Error(
                            swapResponse.msg ||
                                "Failed to get swap transaction data"
                        );
                    }

                    const swapData = swapResponse.data[0];
                    // Calculate display amounts using decimals from the response
                    const fromDecimals = parseInt(swapData.fromToken.decimals);
                    const toDecimals = parseInt(swapData.toToken.decimals);
                    const displayFromAmount = (
                        parseFloat(swapData.fromTokenAmount) /
                        Math.pow(10, fromDecimals)
                    ).toString();
                    const displayToAmount = (
                        parseFloat(swapData.toTokenAmount) /
                        Math.pow(10, toDecimals)
                    ).toString();

                    // Format the response
                    const formattedResponse: FormattedSwapResponse = {
                        success: true,
                        quote: {
                            fromToken: {
                                symbol: swapData.fromToken.tokenSymbol,
                                amount: displayFromAmount,
                                decimal: swapData.fromToken.decimals,
                                unitPrice: swapData.fromToken.tokenUnitPrice,
                            },
                            toToken: {
                                symbol: swapData.toToken.tokenSymbol,
                                amount: displayToAmount,
                                decimal: swapData.toToken.decimals,
                                unitPrice: swapData.toToken.tokenUnitPrice,
                            },
                            priceImpact: swapData.priceImpactPercentage + "%",
                            dexRoutes: swapData.quoteCompareList.map(
                                (route) => ({
                                    dex: route.dexName,
                                    amountOut: route.amountOut,
                                    fee: route.tradeFee,
                                })
                            ),
                        },
                        summary: [
                            `Swap Transaction Data:`,
                            `From: ${displayFromAmount} ${swapData.fromToken.tokenSymbol}`,
                            `To: ${displayToAmount} ${swapData.toToken.tokenSymbol}`,
                            `Price Impact: ${swapData.priceImpactPercentage}%`,
                            `Estimated Gas Fee: ${swapData.estimateGasFee}`,
                            `Best Route: ${
                                swapData.quoteCompareList[0]?.dexName ||
                                "Unknown"
                            }`,
                            swapData.tx?.data
                                ? `Transaction Data Available`
                                : "No Transaction Data",
                        ].join("\n"),
                        // Include the transaction data if available
                        tx: swapData.tx,
                    };

                    result = formattedResponse;
                    break;
                }

                case "GET_AVAILABLE_TOKENS":
                    result = await client.dex.getTokens("501");
                    break;

                case "EXECUTE_SWAP": {
                    const params = await extractSwapParams(message, client);
                    result = await client.dex.executeSwap({
                        chainId: "501",
                        ...params,
                        slippage: "0.1",
                    });
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
            examples: [], // Empty array is fine if no examples
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
