import { Keypair, PublicKey, Connection } from "@solana/web3.js";
import bs58 from "bs58";
import { IAgentRuntime } from "@elizaos/core";
import { TEEMode } from "./TEE/types"
import { DeriveKeyProvider } from "./TEE/deriveKeyProvider";

export interface WalletResult {
    signer?: Keypair;
    address?: PublicKey;
}

/**
 * Gets either a keypair or public key based on TEE mode and runtime settings
 * @param runtime The agent runtime
 * @param requirePrivateKey Whether to return a full keypair (true) or just public key (false)
 * @returns KeypairResult containing either keypair or public key
 */
export async function loadWallet(
    runtime: IAgentRuntime,
    requirePrivateKey: boolean = true
): Promise<WalletResult> {
    const teeMode = runtime.getSetting("TEE_MODE") || TEEMode.OFF;

    if (teeMode !== TEEMode.OFF) {
        const walletSecretSalt = runtime.getSetting("WALLET_SECRET_SALT");
        if (!walletSecretSalt) {
            throw new Error(
                "WALLET_SECRET_SALT required when TEE_MODE is enabled"
            );
        }

        const deriveKeyProvider = new DeriveKeyProvider(teeMode);
        const deriveKeyResult = await deriveKeyProvider.deriveEd25519Keypair(
            "/",
            walletSecretSalt,
            runtime.agentId
        );

        const keypair = Keypair.fromSecretKey(deriveKeyResult.keypair);
        return requirePrivateKey
            ? { signer: keypair }
            : { address: keypair.publicKey };
    }

    // TEE mode is OFF
    if (requirePrivateKey) {
        const privateKeyString =
            runtime.getSetting("SOLANA_PRIVATE_KEY") ??
            runtime.getSetting("WALLET_PRIVATE_KEY");

        if (!privateKeyString) {
            throw new Error("Private key not found in settings");
        }

        try {
            // First try base58
            const secretKey = bs58.decode(privateKeyString);
            const keypair = Keypair.fromSecretKey(secretKey);
            return { signer: keypair }
        } catch (e) {
            console.log("Error decoding base58 private key:", e);
            try {
                // Then try base64
                console.log("Try decoding base64 instead");
                const secretKey = Uint8Array.from(
                    Buffer.from(privateKeyString, "base64")
                );
                const keypair = Keypair.fromSecretKey(secretKey);
                return { signer: keypair };
            } catch (e2) {
                console.error("Error decoding private key: ", e2);
                throw new Error("Invalid private key format");
            }
        }
    } else {
        const publicKeyString =
            runtime.getSetting("SOLANA_PUBLIC_KEY") ??
            runtime.getSetting("WALLET_PUBLIC_KEY");

        if (!publicKeyString) {
            throw new Error("Public key not found in settings");
        }

        return { address: new PublicKey(publicKeyString) };
    }
}
