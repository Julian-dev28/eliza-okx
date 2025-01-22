// src/actions.ts
import {
    generateText,
    type HandlerCallback,
    type IAgentRuntime,
    type Memory,
    ModelClass,
    type State,
    composeContext,
type Action, type ActionExample
} from "@elizaos/core";
import { OKXDexClient } from '../src/okx/core/client';
import { FormattedSwapResponse } from "./okx/types";

async function extractSwapParams(message: Memory, client: OKXDexClient) {
    let messageContent = '';
    if (typeof message.content === 'string') {
        messageContent = message.content;
    } else if (message.content && typeof message.content === 'object') {
        messageContent = (message.content as any).text || JSON.stringify(message.content);
    }

    // Normalize the message content
    messageContent = messageContent.toLowerCase().trim();

    // Common patterns for amounts - supporting both symbols and addresses
    const amountPatterns = [
        /(\d+\.?\d*)\s*([\w\d.-]+)\s*(?:to|for|=>|->)\s*([\w\d.-]+)/i,  // "1.5 tokenA to tokenB"
        /(?:swap|convert)\s*(\d+\.?\d*)\s*([\w\d.-]+)\s*(?:to|for|=>|->)\s*([\w\d.-]+)/i,  // "swap 1.5 tokenA to tokenB"
        /from\s*([\w\d.-]+)\s*(?:to|for|=>|->)\s*([\w\d.-]+)\s*(?:amount|quantity|sum|total)?\s*(\d+\.?\d*)/i,  // "from tokenA to tokenB amount 1.5"
        /(?:amount|quantity|sum|total)?\s*(\d+\.?\d*)\s*from\s*([\w\d.-]+)\s*(?:to|for|=>|->)\s*([\w\d.-]+)/i,  // "amount 1.5 from tokenA to tokenB"
        /from_token:\s*([\w\d.-]+)\s*to_token:\s*([\w\d.-]+)\s*amount:\s*(\d+\.?\d*)/i  // Legacy format support
    ];

    let fromTokenAddress = '';
    let toTokenAddress = '';
    let amount = '';

    // Try each pattern until we find a match
    for (const pattern of amountPatterns) {
        const match = messageContent.match(pattern);
        if (match) {
            // Different patterns have different group positions
            if (pattern.source.startsWith('from_token')) {
                // Legacy format
                [, fromTokenAddress, toTokenAddress, amount] = match;
            } else if (pattern.source.startsWith('from')) {
                // "from X to Y amount Z" format
                [, fromTokenAddress, toTokenAddress, amount] = match;
            } else {
                // Amount-first formats
                [, amount, fromTokenAddress, toTokenAddress] = match;
            }
            break;
        }
    }

    // Additional patterns to catch standalone declarations - supporting both symbols and addresses
    if (!fromTokenAddress) {
        const fromMatch = messageContent.match(/(?:from|source)\s*(?:token|currency|coin)?:?\s*([\w\d.-]+)/i);
        fromTokenAddress = fromMatch?.[1] || '';
    }

    if (!toTokenAddress) {
        const toMatch = messageContent.match(/(?:to|target|dest(?:ination)?)\s*(?:token|currency|coin)?:?\s*([\w\d.-]+)/i);
        toTokenAddress = toMatch?.[1] || '';
    }

    if (!amount) {
        const amountMatch = messageContent.match(/(?:amount|quantity|sum|total):?\s*(\d+\.?\d*)/i);
        amount = amountMatch?.[1] || '';
    }

    // Validation with helpful error messages
    if (!fromTokenAddress) {
        throw new Error(
            "Could not determine the source token. Please specify which token you want to swap from. " +
            "For example: 'swap 1.5 SOL to USDC' or 'from SOL to USDC amount 1.5'"
        );
    }

    if (!toTokenAddress) {
        throw new Error(
            "Could not determine the target token. Please specify which token you want to swap to. " +
            "For example: 'swap 1.5 SOL to USDC' or 'from SOL to USDC amount 1.5'"
        );
    }

    if (!amount) {
        throw new Error(
            "Could not determine the amount to swap. Please specify the amount. " +
            "For example: 'swap 1.5 SOL to USDC' or 'amount: 1.5 from SOL to USDC'"
        );
    }

    // Convert the raw amount to the smallest unit (lamports for SOL)
    const amountInSmallestUnit = (parseFloat(amount) * 1e9).toString();

    return {
        fromTokenAddress,
        toTokenAddress,
        amount: amountInSmallestUnit
    };
}

function getActionHandler(actionName: string, actionDescription: string, client: OKXDexClient) {
    return async (
        runtime: IAgentRuntime,
        message: Memory,
        state: State | undefined,
        options?: Record<string, unknown>,
        callback?: HandlerCallback
    ): Promise<boolean> => {
        let currentState = state ?? await runtime.composeState(message);
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
                    console.log('Sending quote request with params:', params);

                    const quoteResult = await client.dex.getQuote({
                        chainId: "501",
                        fromTokenAddress: params.fromTokenAddress,
                        toTokenAddress: params.toTokenAddress,
                        amount: params.amount,
                        slippage: "0.1"
                    });




                    if (quoteResult.code === "0" && quoteResult.data?.[0]) {
                        const quote = quoteResult.data[0];
                        const fromDecimals = parseInt(quote.fromToken.decimal);
                        const toDecimals = parseInt(quote.toToken.decimal);
                        const displayFromAmount = (parseFloat(params.amount) / fromDecimals).toString();
                        const displayToAmount = (parseFloat(quote.toTokenAmount) / toDecimals).toString();

                        // Format response similar to the example
                        const formattedResponse = {
                            success: true,
                            quote: {
                                fromToken: {
                                    symbol: quote.fromToken.tokenSymbol,
                                    amount: displayFromAmount,
                                    decimal: quote.fromToken.decimal,
                                    unitPrice: quote.fromToken.tokenUnitPrice
                                },
                                toToken: {
                                    symbol: quote.toToken.tokenSymbol,
                                    amount: displayToAmount,
                                    decimal: quote.toToken.decimal,
                                    unitPrice: quote.toToken.tokenUnitPrice
                                },
                                priceImpact: quote.priceImpactPercentage + "%",
                                dexRoutes: quote.quoteCompareList.map(route => ({
                                    dex: route.dexName,
                                    amountOut: route.amountOut,
                                    fee: route.tradeFee
                                }))
                            },
                            summary: `Quote for ${displayFromAmount} ${quote.fromToken.tokenSymbol} to USDC:\n` +
                                   `Expected output: ${displayToAmount} ${quote.toToken.tokenSymbol}\n` +
                                   `Price impact: ${quote.priceImpactPercentage}%\n` +
                                   `Best route via: ${quote.quoteCompareList[0]?.dexName || 'Unknown'}`
                        };


                        result = formattedResponse;
                    } else {
                        throw new Error(quoteResult.msg || 'Failed to get quote');
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
        maxAutoSlippage: "1000" // 10% in basis points
    });

    if (swapResponse.code !== "0" || !swapResponse.data?.[0]) {
        throw new Error(swapResponse.msg || 'Failed to get swap transaction data');
    }

    const swapData = swapResponse.data[0];

    // Calculate display amounts using decimals from the response
    const fromDecimals = parseInt(swapData.fromToken.decimal);
    const toDecimals = parseInt(swapData.toToken.decimal);
    const displayFromAmount = (parseFloat(swapData.fromTokenAmount) / Math.pow(10, fromDecimals)).toString();
    const displayToAmount = (parseFloat(swapData.toTokenAmount) / Math.pow(10, toDecimals)).toString();

    // Format the response
    const formattedResponse: FormattedSwapResponse = {
        success: true,
        quote: {
            fromToken: {
                symbol: swapData.fromToken.tokenSymbol,
                amount: displayFromAmount,
                decimal: swapData.fromToken.decimal,
                unitPrice: swapData.fromToken.tokenUnitPrice
            },
            toToken: {
                symbol: swapData.toToken.tokenSymbol,
                amount: displayToAmount,
                decimal: swapData.toToken.decimal,
                unitPrice: swapData.toToken.tokenUnitPrice
            },
            priceImpact: swapData.priceImpactPercentage + "%",
            dexRoutes: swapData.quoteCompareList.map(route => ({
                dex: route.dexName,
                amountOut: route.amountOut,
                fee: route.tradeFee
            }))
        },
        summary: [
            `Swap Transaction Data:`,
            `From: ${displayFromAmount} ${swapData.fromToken.tokenSymbol}`,
            `To: ${displayToAmount} ${swapData.toToken.tokenSymbol}`,
            `Price Impact: ${swapData.priceImpactPercentage}%`,
            `Estimated Gas Fee: ${swapData.estimateGasFee}`,
            `Best Route: ${swapData.quoteCompareList[0]?.dexName || 'Unknown'}`,
            swapData.tx?.data ? `Transaction Data Available` : 'No Transaction Data'
        ].join('\n'),
        // Include the transaction data if available
        tx: swapData.tx
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
                        slippage: "0.1"
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
                    template: JSON.stringify(result)
                }),
                modelClass: ModelClass.SMALL,
            });

            callback?.({
                text: response,
                content: result
            });
            return true;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            const errorResponse = await generateText({
                runtime,
                context: composeContext({
                    state: currentState,
                    template: `Error: ${errorMessage}`
                }),
                modelClass: ModelClass.SMALL,
            });

            callback?.({
                text: errorResponse,
                content: { error: errorMessage }
            });
            return false;
        }
    };
}


export async function getOKXActions(getSetting: (key: string) => string | undefined) {
   const actionsWithoutHandler: Omit<Action, 'handler'>[] = [
    {
        name: "GET_CHAIN_DATA",
        description: "Get Solana chain data from OKX DEX",
        similes: [],
        validate: async () => true,
        examples: []  // Empty array is fine if no examples
    },
    {
        name: "GET_LIQUIDITY_PROVIDERS",
        description: "Get liquidity providers on Solana from OKX DEX",
        similes: [],
        validate: async () => true,
        examples: []
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
                    content: { text: "Get quote from_token: SOL123 to_token: USDC456 amount: 1.5" }
                },
                {
                    user: "assistant",
                    content: { text: "Getting quote for swapping 1.5 SOL123 to USDC456..." }
                }
            ],
            [
                {
                    user: "user",
                    content: { text: "Get quote from SOL123 to USDC456 amount 1.5" }
                },
                {
                    user: "assistant",
                    content: { text: "Fetching quote for 1.5 tokens from SOL123 to USDC456..." }
                }
            ]
        ]
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
                    content: { text: "Get swap transaction data from_token: SOL123 to_token: USDC456 amount: 1.5" }
                },
                {
                    user: "assistant",
                    content: { text: "Getting swap transaction data for 1.5 SOL123 to USDC456..." }
                }
            ]
        ]
    },
    {
        name: "GET_AVAILABLE_TOKENS",
        description: "Get available tokens for swapping on Solana",
        similes: [],
        validate: async () => true,
        examples: []
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
                    content: { text: "Swap from_token: SOL123 to_token: USDC456 amount: 1.5" }
                },
                {
                    user: "assistant",
                    content: { text: "Executing swap of 1.5 tokens from SOL123 to USDC456..." }
                }
            ],
            [
                {
                    user: "user",
                    content: { text: "Swap 1.5 from SOL123 to USDC456" }
                },
                {
                    user: "assistant",
                    content: { text: "Processing swap of 1.5 tokens from SOL123 to USDC456..." }
                }
            ]
        ]
    }
];

    const client = new OKXDexClient({
        apiKey: getSetting('OKX_API_KEY')!,
        secretKey: getSetting('OKX_SECRET_KEY')!,
        apiPassphrase: getSetting('OKX_API_PASSPHRASE')!,
        projectId: getSetting('OKX_PROJECT_ID')!,
        solana: {
            connection: {
                rpcUrl: getSetting('SOLANA_RPC_URL')!,
                wsEndpoint: getSetting('SOLANA_WS_URL')
            },
            privateKey: getSetting('PRIVATE_KEY')!
        }
    });

    return actionsWithoutHandler.map((action) => ({
        ...action,
        handler: getActionHandler(action.name, action.description, client)
    }));
}