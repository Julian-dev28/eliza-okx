// src/index.ts
import type { Plugin } from "@elizaos/core";
import { getOKXActions } from "./actions";

export const createOKXPlugin = async (
    getSetting: (key: string) => string | undefined
): Promise<Plugin> => {
    // Validate required settings
    const requiredSettings = [
        "OKX_API_KEY",
        "OKX_SECRET_KEY",
        "OKX_API_PASSPHRASE",
        "OKX_PROJECT_ID",
        "SOLANA_RPC_URL",
        "PRIVATE_KEY",
    ];

    const missingSettings = requiredSettings.filter(
        (setting) => !getSetting(setting)
    );
    if (missingSettings.length > 0) {
        console.warn(
            `Missing required settings for OKX plugin: ${missingSettings.join(
                ", "
            )}`
        );
        return {
            name: "OKX DEX Plugin",
            description: "OKX DEX integration for Solana swaps",
            providers: [],
            evaluators: [],
            services: [],
            actions: [], // Return empty actions if settings are missing
        };
    }

    try {
        const actions = await getOKXActions(getSetting);
        return {
            name: "OKX DEX Plugin",
            description: "OKX DEX integration for Solana swaps",
            providers: [],
            evaluators: [],
            services: [],
            actions,
        };
    } catch (error) {
        console.error("Error initializing OKX plugin:", error);
        throw error;
    }
};

export default createOKXPlugin;
