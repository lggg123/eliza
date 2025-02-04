import {
    type IAgentRuntime,
    type Memory,
    type Provider,
    type State,
    elizaLogger,
} from "@elizaos/core";
import { generateKeyPair } from "@solana/keys";
import crypto from "crypto";
import { type DeriveKeyResponse, TappdClient } from "@phala/dstack-sdk";
import { privateKeyToAccount } from "viem/accounts";
import { type PrivateKeyAccount, keccak256 } from "viem";
import { RemoteAttestationProvider } from "./remoteAttestationProvider";
import { TEEMode, type RemoteAttestationQuote, type DeriveKeyAttestationData } from "../types/tee";

interface SolanaKeypair {
    publicKey: string;
    privateKey: CryptoKey;
}

interface EcdsaKeypair {
    address: `0x${string}`;
    sign: (parameters: { hash: `0x${string}` }) => Promise<`0x${string}`>;
    signMessage: (parameters: { message: string }) => Promise<`0x${string}`>;
    signTransaction: (parameters: { transaction: any }) => Promise<`0x${string}`>;
    signTypedData: (parameters: { typedData: any }) => Promise<`0x${string}`>;
    experimental_signAuthorization: (parameters: any) => Promise<`0x${string}`>;
    type: "local";
}

class DeriveKeyProvider {
    private client: TappdClient;
    private raProvider: RemoteAttestationProvider;

    constructor(teeMode?: string) {
        let endpoint: string | undefined;

        // Both LOCAL and DOCKER modes use the simulator, just with different endpoints
        switch (teeMode) {
            case TEEMode.LOCAL:
                endpoint = "http://localhost:8090";
                elizaLogger.log(
                    "TEE: Connecting to local simulator at localhost:8090"
                );
                break;
            case TEEMode.DOCKER:
                endpoint = "http://host.docker.internal:8090";
                elizaLogger.log(
                    "TEE: Connecting to simulator via Docker at host.docker.internal:8090"
                );
                break;
            case TEEMode.PRODUCTION:
                endpoint = undefined;
                elizaLogger.log(
                    "TEE: Running in production mode without simulator"
                );
                break;
            default:
                throw new Error(
                    `Invalid TEE_MODE: ${teeMode}. Must be one of: LOCAL, DOCKER, PRODUCTION`
                );
        }

        this.client = endpoint ? new TappdClient(endpoint) : new TappdClient();
        this.raProvider = new RemoteAttestationProvider(teeMode);
    }

    private async generateDeriveKeyAttestation(
        agentId: string,
        publicKey: string,
        subject?: string
    ): Promise<RemoteAttestationQuote> {
        const deriveKeyData: DeriveKeyAttestationData = {
            agentId,
            publicKey,
            subject,
        };
        const reportdata = JSON.stringify(deriveKeyData);
        elizaLogger.log(
            "Generating Remote Attestation Quote for Derive Key..."
        );
        const quote = await this.raProvider.generateAttestation(reportdata);
        elizaLogger.log("Remote Attestation Quote generated successfully!");
        return quote;
    }

    /**
     * Derives a raw key from the given path and subject.
     * @param path - The path to derive the key from. This is used to derive the key from the root of trust.
     * @param subject - The subject to derive the key from. This is used for the certificate chain.
     * @returns The derived key.
     */
    async rawDeriveKey(
        path: string,
        subject: string
    ): Promise<DeriveKeyResponse> {
        try {
            if (!path || !subject) {
                elizaLogger.error(
                    "Path and Subject are required for key derivation"
                );
            }

            elizaLogger.log("Deriving Raw Key in TEE...");
            const derivedKey = await this.client.deriveKey(path, subject);

            elizaLogger.log("Raw Key Derived Successfully!");
            return derivedKey;
        } catch (error) {
            elizaLogger.error("Error deriving raw key:", error);
            throw error;
        }
    }

    /**
     * Derives an Ed25519 keypair from the given path and subject.
     * @param path - The path to derive the key from. This is used to derive the key from the root of trust.
     * @param subject - The subject to derive the key from. This is used for the certificate chain.
     * @param agentId - The agent ID to generate an attestation for.
     * @returns An object containing the derived keypair and attestation.
     */
    async deriveEd25519Keypair(
        path: string,
        subject: string,
        agentId: string
    ): Promise<{ keypair: SolanaKeypair; attestation: RemoteAttestationQuote }> {
        try {
            if (!path || !subject) {
                elizaLogger.error(
                    "Path and Subject are required for key derivation"
                );
            }

            elizaLogger.log("Deriving Key in TEE...");
            const derivedKey = await this.client.deriveKey(path, subject);
            const uint8ArrayDerivedKey = derivedKey.asUint8Array();

            const hash = crypto.createHash("sha256");
            hash.update(uint8ArrayDerivedKey);
            const seed = hash.digest();
            const seedArray = new Uint8Array(seed);
            const keypairPromise = generateKeyPair();
            const generatedKeypair = await keypairPromise;
            const keypair: SolanaKeypair = {
                publicKey: generatedKeypair.publicKey.toString(),
                privateKey: generatedKeypair.privateKey
            };

            // Generate an attestation for the derived key data for public to verify
            const attestation = await this.generateDeriveKeyAttestation(
                agentId,
                (await keypairPromise).publicKey.toString()
            );
            elizaLogger.log("Key Derived Successfully!");

            return { keypair, attestation };
        } catch (error) {
            elizaLogger.error("Error deriving key:", error);
            throw error;
        }
    }

    /**
     * Derives an ECDSA keypair from the given path and subject.
     * @param path - The path to derive the key from. This is used to derive the key from the root of trust.
     * @param subject - The subject to derive the key from. This is used for the certificate chain.
     * @param agentId - The agent ID to generate an attestation for. This is used for the certificate chain.
     * @returns An object containing the derived keypair and attestation.
     */
    async deriveEcdsaKeypair(
        path: string,
        subject: string,
        agentId: string
    ): Promise<{ keypair: PrivateKeyAccount; attestation: RemoteAttestationQuote }> {
        try {
            if (!path || !subject) {
                elizaLogger.error(
                    "Path and Subject are required for key derivation"
                );
            }

            elizaLogger.log("Deriving ECDSA Key in TEE...");
            const deriveKeyResponse: DeriveKeyResponse =
                await this.client.deriveKey(path, subject);
            const hex = keccak256(deriveKeyResponse.asUint8Array());
            const keypair: PrivateKeyAccount = privateKeyToAccount(hex);

            // Generate an attestation for the derived key data for public to verify
            const attestation = await this.generateDeriveKeyAttestation(
                agentId,
                keypair.address
            );
            elizaLogger.log("ECDSA Key Derived Successfully!");

            return { keypair, attestation };
        } catch (error) {
            elizaLogger.error("Error deriving ecdsa key:", error);
            throw error;
        }
    }
}

const deriveKeyProvider: Provider = {
    get: async (runtime: IAgentRuntime, _message?: Memory, _state?: State) => {
        const teeMode = runtime.getSetting("TEE_MODE");
        const provider = new DeriveKeyProvider(teeMode);
        const agentId = runtime.agentId;
        try {
            // Validate wallet configuration
            if (!runtime.getSetting("WALLET_SECRET_SALT")) {
                elizaLogger.error(
                    "Wallet secret salt is not configured in settings"
                );
                return "";
            }

            try {
                const secretSalt =
                    runtime.getSetting("WALLET_SECRET_SALT") || "secret_salt";
                const solanaKeypair = await provider.deriveEd25519Keypair(
                    secretSalt,
                    "solana",
                    agentId
                );
                const evmKeypair = await provider.deriveEcdsaKeypair(
                    secretSalt,
                    "evm",
                    agentId
                );
                return JSON.stringify({
                    solana: solanaKeypair.keypair.publicKey,
                    evm: evmKeypair.keypair.address,
                });
            } catch (error) {
                elizaLogger.error("Error creating PublicKey:", error);
                return "";
            }
        } catch (error) {
            elizaLogger.error("Error in derive key provider:", error.message);
            return `Failed to fetch derive key information: ${error instanceof Error ? error.message : "Unknown error"}`;
        }
    },
};

export { deriveKeyProvider, DeriveKeyProvider };
