const { ethers } = require('ethers');
const { getNetworkConfig } = require('./config/networks');
const TOKEN_ABI = require('./abi/token.json');
require('dotenv').config();

class MinterService {
    constructor() {
        this.initialized = false;
        this.networkConfig = null;
        this.provider = null;
        this.wallet = null;
        this.contract = null;
        this.decimals = null;
        this.tokenName = null;
        this.tokenSymbol = null;
    }

    async initialize() {
        if (this.initialized) return;

        try {
            // Load network config
            this.networkConfig = getNetworkConfig();

            console.log(`\n🔗 Connecting to ${this.networkConfig.name}...`);
            console.log(`   Chain ID: ${this.networkConfig.chainId}`);
            console.log(`   RPC: ${this.networkConfig.rpcUrl}`);
            console.log(`   Token: ${this.networkConfig.tokenAddress}`);

            // Setup provider and wallet
            this.provider = new ethers.JsonRpcProvider(this.networkConfig.rpcUrl);

            if (!process.env.PRIVATE_KEY) {
                throw new Error('PRIVATE_KEY not set in environment');
            }

            this.wallet = new ethers.Wallet(process.env.PRIVATE_KEY, this.provider);
            console.log(`   Wallet: ${this.wallet.address}`);

            // Setup contract
            this.contract = new ethers.Contract(
                this.networkConfig.tokenAddress,
                TOKEN_ABI,
                this.wallet
            );

            // Fetch token info
            console.log(`   Fetching token info...`);
            this.decimals = await this.contract.decimals();
            this.tokenName = await this.contract.name();
            this.tokenSymbol = await this.contract.symbol();

            console.log(`   Token: ${this.tokenName} (${this.tokenSymbol})`);
            console.log(`   Decimals: ${this.decimals}`);

            // Check ownership (but don't fail if not owner - might have MINTER_ROLE)
            try {
                const contractOwner = await this.contract.owner();
                console.log(`   Contract owner: ${contractOwner}`);
                
                if (contractOwner.toLowerCase() !== this.wallet.address.toLowerCase()) {
                    console.warn(`   ⚠️  Wallet is not the contract owner.`);
                    console.warn(`      Wallet: ${this.wallet.address}`);
                    console.warn(`      Owner: ${contractOwner}`);
                    console.warn(`      Will try to mint anyway (might have MINTER_ROLE)...`);
                } else {
                    console.log(`   ✅ Wallet is contract owner`);
                }
            } catch (ownerError) {
                console.log(`   ⚠️  Could not check owner (contract might not have owner()): ${ownerError.message}`);
            }

            // Check balance
            const balance = await this.provider.getBalance(this.wallet.address);
            console.log(`   ${this.networkConfig.currency} balance: ${ethers.formatEther(balance)}`);

            if (parseFloat(ethers.formatEther(balance)) < 0.01) {
                console.warn(`   ⚠️  WARNING: Low ${this.networkConfig.currency} balance! Fund your wallet.`);
            }

            this.initialized = true;
            console.log(`\n✅ Minter initialized successfully!`);

        } catch (error) {
            console.error(`\n❌ Minter initialization failed:`, error.message);
            throw error;
        }
    }

    // Check if wallet already has tokens
    async hasTokens(address) {
        await this.initialize();
        try {
            const balance = await this.contract.balanceOf(address);
            return balance > 0n;
        } catch (err) {
            console.error(`Error checking balance for ${address}:`, err.message);
            return false;
        }
    }

    // Check multiple wallets for existing balances
    async checkBalances(addresses) {
        await this.initialize();
        const results = {
            alreadyHasTokens: [],
            needsMinting: [],
        };

        for (const address of addresses) {
            try {
                const balance = await this.contract.balanceOf(address);
                if (balance > 0n) {
                    results.alreadyHasTokens.push(address);
                } else {
                    results.needsMinting.push(address);
                }
            } catch (err) {
                console.error(`Error checking balance for ${address}:`, err.message);
                results.needsMinting.push(address);
            }
        }

        return results;
    }

    // Validate and deduplicate addresses before minting
    validateAddresses(addresses) {
        const normalized = addresses
            .map(addr => {
                try {
                    return ethers.getAddress(addr.toLowerCase());
                } catch {
                    console.warn(`Invalid address skipped: ${addr}`);
                    return null;
                }
            })
            .filter(Boolean);

        const unique = [...new Set(normalized.map(a => a.toLowerCase()))];
        const checksummed = unique.map(addr => ethers.getAddress(addr));

        const duplicatesRemoved = normalized.length - unique.length;
        if (duplicatesRemoved > 0) {
            console.warn(`⚠️  Removed ${duplicatesRemoved} duplicate address(es) from batch`);
        }

        return checksummed;
    }

    // Mint to a single address
    async mintToAddress(recipientAddress, amount, skipBalanceCheck = false) {
        await this.initialize();

        console.log(`\n🪙 mintToAddress called:`);
        console.log(`   Recipient: ${recipientAddress}`);
        console.log(`   Amount: ${amount}`);

        // Validate address
        const validAddresses = this.validateAddresses([recipientAddress]);
        if (validAddresses.length === 0) {
            throw new Error('Invalid recipient address');
        }

        const recipient = validAddresses[0];

        // Check if already has tokens
        if (!skipBalanceCheck) {
            const hasTokens = await this.hasTokens(recipient);
            if (hasTokens) {
                console.log(`   ℹ️  ${recipient} already has tokens. Skipping mint.`);
                return { skipped: true, reason: 'already_has_tokens', address: recipient };
            }
        }

        const amountWithDecimals = ethers.parseUnits(amount.toString(), this.decimals);
        console.log(`   Amount with decimals: ${amountWithDecimals.toString()}`);

        try {
            console.log(`   Calling contract.mint(${recipient}, ${amountWithDecimals})...`);
            
            const tx = await this.contract.mint(recipient, amountWithDecimals);
            console.log(`   TX submitted: ${tx.hash}`);

            const receipt = await tx.wait();
            console.log(`   ✅ Confirmed in block ${receipt.blockNumber}`);
            console.log(`   🔗 ${this.networkConfig.explorer}/tx/${receipt.hash}`);

            return receipt;

        } catch (mintError) {
            console.error(`\n❌ Mint transaction failed:`);
            console.error(`   Error: ${mintError.message}`);
            
            if (mintError.reason) {
                console.error(`   Reason: ${mintError.reason}`);
            }
            if (mintError.code) {
                console.error(`   Code: ${mintError.code}`);
            }
            if (mintError.data) {
                console.error(`   Data: ${mintError.data}`);
            }
            
            throw mintError;
        }
    }

    // Batch mint to multiple addresses
    async batchMintToAddresses(recipientAddresses, amountEach, skipBalanceCheck = false) {
        await this.initialize();

        const validAddresses = this.validateAddresses(recipientAddresses);

        if (validAddresses.length === 0) {
            console.log('No valid addresses to mint to.');
            return null;
        }

        let addressesToMint = validAddresses;
        let alreadyHaveTokens = [];

        if (!skipBalanceCheck) {
            console.log(`\n🔍 Checking on-chain balances for ${validAddresses.length} address(es)...`);
            const balanceCheck = await this.checkBalances(validAddresses);
            
            alreadyHaveTokens = balanceCheck.alreadyHasTokens;
            addressesToMint = balanceCheck.needsMinting;

            if (alreadyHaveTokens.length > 0) {
                console.log(`   ℹ️  ${alreadyHaveTokens.length} address(es) already have tokens`);
            }
        }

        if (addressesToMint.length === 0) {
            console.log('   All addresses already have tokens. Nothing to mint.');
            return {
                receipt: null,
                mintedAddresses: [],
                skippedAddresses: alreadyHaveTokens,
                originalCount: recipientAddresses.length,
                mintedCount: 0,
                skippedCount: alreadyHaveTokens.length,
            };
        }

        const amountWithDecimals = ethers.parseUnits(amountEach.toString(), this.decimals);
        const amounts = addressesToMint.map(() => amountWithDecimals);

        console.log(`\n🪙 Batch minting ${amountEach} ${this.tokenSymbol} each to ${addressesToMint.length} address(es)...`);

        try {
            const tx = await this.contract.batchMint(addressesToMint, amounts);
            console.log(`   TX submitted: ${tx.hash}`);

            const receipt = await tx.wait();
            console.log(`   ✅ Confirmed in block ${receipt.blockNumber}`);
            console.log(`   🔗 ${this.networkConfig.explorer}/tx/${receipt.hash}`);

            return {
                receipt,
                mintedAddresses: addressesToMint,
                skippedAddresses: alreadyHaveTokens,
                originalCount: recipientAddresses.length,
                mintedCount: addressesToMint.length,
                skippedCount: alreadyHaveTokens.length,
            };

        } catch (batchError) {
            console.error(`\n❌ Batch mint failed:`, batchError.message);
            throw batchError;
        }
    }

    async getBalance(address) {
        await this.initialize();
        const balance = await this.contract.balanceOf(address);
        return ethers.formatUnits(balance, this.decimals);
    }

    async getTotalSupply() {
        await this.initialize();
        const supply = await this.contract.totalSupply();
        return ethers.formatUnits(supply, this.decimals);
    }

    getExplorerTxUrl(txHash) {
        return `${this.networkConfig.explorer}/tx/${txHash}`;
    }

    getNetworkName() {
        return this.networkConfig?.name || 'Not initialized';
    }
}

module.exports = new MinterService();
