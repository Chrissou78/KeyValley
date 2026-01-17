// src/minter.js
import { ethers } from 'ethers';
import { getNetworkConfig } from './config/networks.js';
import TOKEN_ABI from './abi/token.json' with { type: 'json' };
import dotenv from 'dotenv';

dotenv.config();

class MinterService {
    constructor() {
        this.initialized = false;
        this.networkConfig = null;
        this.provider = null;
        this.wallet = null;
        this.contract = null;
        this.decimals = 18;
        this.tokenName = '';
        this.tokenSymbol = '';
    }

    async initialize() {
        if (this.initialized) {
            return;
        }

        try {
            console.log('🔧 Initializing minter...');
            
            this.networkConfig = getNetworkConfig();
            console.log(`📡 Network: ${this.networkConfig.name}`);
            console.log(`🔗 Chain ID: ${this.networkConfig.chainId}`);
            console.log(`🌐 RPC: ${this.networkConfig.rpcUrl}`);
            console.log(`🪙 Token: ${this.networkConfig.tokenAddress}`);

            this.provider = new ethers.JsonRpcProvider(this.networkConfig.rpcUrl);
            
            const privateKey = process.env.PRIVATE_KEY;
            if (!privateKey) {
                throw new Error('PRIVATE_KEY not set in environment variables');
            }

            this.wallet = new ethers.Wallet(privateKey, this.provider);
            console.log(`👛 Minter wallet: ${this.wallet.address}`);

            this.contract = new ethers.Contract(
                this.networkConfig.tokenAddress,
                TOKEN_ABI,
                this.wallet
            );

            // Get token info
            this.decimals = await this.contract.decimals();
            this.tokenName = await this.contract.name();
            this.tokenSymbol = await this.contract.symbol();
            
            console.log(`📛 Token Name: ${this.tokenName}`);
            console.log(`🏷️ Token Symbol: ${this.tokenSymbol}`);
            console.log(`🔢 Decimals: ${this.decimals}`);

            // Verify ownership
            const owner = await this.contract.owner();
            console.log(`👑 Contract owner: ${owner}`);
            console.log(`👛 Wallet: ${this.wallet.address}`);
            
            if (owner.toLowerCase() !== this.wallet.address.toLowerCase()) {
                throw new Error(`Wallet is not the contract owner. Owner: ${owner}, Wallet: ${this.wallet.address}`);
            }
            console.log('✅ Wallet is contract owner');

            // Check wallet balance
            const balance = await this.provider.getBalance(this.wallet.address);
            const balanceFormatted = ethers.formatEther(balance);
            console.log(`💰 Balance (${this.networkConfig.currency}): ${balanceFormatted}`);

            if (parseFloat(balanceFormatted) < 0.01) {
                console.warn(`⚠️ Low ${this.networkConfig.currency} balance! May not have enough for gas.`);
            }

            this.initialized = true;
            console.log('✅ Minter initialized successfully');

        } catch (error) {
            console.error('❌ Minter initialization failed:', error.message);
            throw error;
        }
    }

    async hasTokens(address) {
        await this.initialize();
        const balance = await this.contract.balanceOf(address);
        return balance > 0n;
    }

    async getBalance(address) {
        await this.initialize();
        const balance = await this.contract.balanceOf(address);
        return ethers.formatUnits(balance, this.decimals);
    }

    async getBalanceRaw(address) {
        await this.initialize();
        return await this.contract.balanceOf(address);
    }

    async getTotalSupply() {
        await this.initialize();
        const supply = await this.contract.totalSupply();
        return ethers.formatUnits(supply, this.decimals);
    }

    validateAddresses(addresses) {
        const validated = [];
        const seen = new Set();
        
        for (const addr of addresses) {
            if (!ethers.isAddress(addr)) {
                console.warn(`⚠️ Invalid address skipped: ${addr}`);
                continue;
            }
            const checksummed = ethers.getAddress(addr);
            if (seen.has(checksummed.toLowerCase())) {
                console.warn(`⚠️ Duplicate address skipped: ${checksummed}`);
                continue;
            }
            seen.add(checksummed.toLowerCase());
            validated.push(checksummed);
        }
        
        return validated;
    }

    async mintToAddress(recipientAddress, amount, skipBalanceCheck = false) {
        await this.initialize();
        
        console.log(`\n🎯 Minting to: ${recipientAddress}`);
        console.log(`💰 Amount: ${amount} ${this.tokenSymbol}`);

        if (!ethers.isAddress(recipientAddress)) {
            throw new Error(`Invalid address: ${recipientAddress}`);
        }

        const checksummedAddress = ethers.getAddress(recipientAddress);

        if (!skipBalanceCheck) {
            const hasTokens = await this.hasTokens(checksummedAddress);
            if (hasTokens) {
                const balance = await this.getBalance(checksummedAddress);
                console.log(`⏭️ Skipping ${checksummedAddress} - already has ${balance} ${this.tokenSymbol}`);
                return { skipped: true, reason: 'already_has_tokens', balance };
            }
        }

        try {
            const amountWei = ethers.parseUnits(amount.toString(), this.decimals);
            console.log(`📤 Sending mint transaction...`);
            
            const tx = await this.contract.mint(checksummedAddress, amountWei);
            console.log(`📋 TX Hash: ${tx.hash}`);
            console.log(`🔗 Explorer: ${this.networkConfig.explorer}/tx/${tx.hash}`);
            
            console.log(`⏳ Waiting for confirmation...`);
            const receipt = await tx.wait();
            
            console.log(`✅ Minted ${amount} ${this.tokenSymbol} to ${checksummedAddress}`);
            console.log(`⛽ Gas used: ${receipt.gasUsed.toString()}`);
            
            return { receipt, skipped: false };

        } catch (error) {
            console.error(`❌ Mint transaction failed:`, error.message);
            if (error.reason) console.error(`Reason: ${error.reason}`);
            throw error;
        }
    }

    async batchMintToAddresses(recipientAddresses, amountEach, skipBalanceCheck = false) {
        await this.initialize();
        
        const validAddresses = this.validateAddresses(recipientAddresses);
        console.log(`\n📦 Batch mint: ${validAddresses.length} addresses, ${amountEach} ${this.tokenSymbol} each`);

        if (validAddresses.length === 0) {
            return { 
                mintedAddresses: [], 
                skippedAddresses: [], 
                originalCount: recipientAddresses.length,
                mintedCount: 0,
                skippedCount: 0
            };
        }

        let addressesToMint = validAddresses;
        let skippedAddresses = [];

        if (!skipBalanceCheck) {
            const balanceCheck = await this.checkBalances(validAddresses);
            addressesToMint = balanceCheck.withoutTokens;
            skippedAddresses = balanceCheck.withTokens.map(h => h.address);
            
            if (skippedAddresses.length > 0) {
                console.log(`⏭️ Skipping ${skippedAddresses.length} addresses that already have tokens`);
            }
        }

        if (addressesToMint.length === 0) {
            console.log('✅ All addresses already have tokens, nothing to mint');
            return {
                mintedAddresses: [],
                skippedAddresses,
                originalCount: recipientAddresses.length,
                mintedCount: 0,
                skippedCount: skippedAddresses.length
            };
        }

        try {
            const amounts = addressesToMint.map(() => 
                ethers.parseUnits(amountEach.toString(), this.decimals)
            );

            console.log(`📤 Sending batch mint transaction for ${addressesToMint.length} addresses...`);
            
            const tx = await this.contract.batchMint(addressesToMint, amounts);
            console.log(`📋 TX Hash: ${tx.hash}`);
            console.log(`🔗 Explorer: ${this.networkConfig.explorer}/tx/${tx.hash}`);
            
            console.log(`⏳ Waiting for confirmation...`);
            const receipt = await tx.wait();
            
            console.log(`✅ Batch minted to ${addressesToMint.length} addresses`);
            console.log(`⛽ Gas used: ${receipt.gasUsed.toString()}`);

            return {
                receipt,
                mintedAddresses: addressesToMint,
                skippedAddresses,
                originalCount: recipientAddresses.length,
                mintedCount: addressesToMint.length,
                skippedCount: skippedAddresses.length
            };

        } catch (error) {
            console.error(`❌ Batch mint failed:`, error.message);
            throw error;
        }
    }

    async checkBalances(addresses) {
        await this.initialize();
        
        const withTokens = [];
        const withoutTokens = [];

        for (const address of addresses) {
            const balance = await this.contract.balanceOf(address);
            if (balance > 0n) {
                withTokens.push({
                    address,
                    balance: ethers.formatUnits(balance, this.decimals)
                });
            } else {
                withoutTokens.push(address);
            }
        }

        return { withTokens, withoutTokens };
    }

    /**
     * Get all token holders by reading Transfer events from the blockchain
     * This scans for mint events (from zero address) and tracks current balances
     */
    async getTokenHolders() {
        await this.initialize();
        
        console.log('📊 Fetching token holders from blockchain...');
        
        try {
            // Get Transfer events where from is zero address (mints)
            const filter = this.contract.filters.Transfer(ethers.ZeroAddress, null);
            
            // Get events from block 0 to latest
            // Note: For mainnet with many events, you'd want to paginate this
            const events = await this.contract.queryFilter(filter, 0, 'latest');
            
            console.log(`📝 Found ${events.length} mint events`);
            
            // Track unique addresses
            const holdersMap = new Map();
            
            for (const event of events) {
                const toAddress = event.args[1]; // 'to' address
                const amount = event.args[2]; // amount
                
                if (!holdersMap.has(toAddress.toLowerCase())) {
                    // Get the block for timestamp
                    const block = await event.getBlock();
                    
                    holdersMap.set(toAddress.toLowerCase(), {
                        wallet_address: toAddress,
                        first_mint_tx: event.transactionHash,
                        first_mint_block: event.blockNumber,
                        first_mint_timestamp: block ? new Date(block.timestamp * 1000).toISOString() : null,
                        mint_amount: ethers.formatUnits(amount, this.decimals)
                    });
                }
            }
            
            // Now get current balances for all holders
            const holders = [];
            let id = 1;
            
            for (const [address, data] of holdersMap) {
                const currentBalance = await this.contract.balanceOf(data.wallet_address);
                const formattedBalance = ethers.formatUnits(currentBalance, this.decimals);
                
                // Only include if balance > 0
                if (parseFloat(formattedBalance) > 0) {
                    holders.push({
                        id: id++,
                        wallet_address: data.wallet_address,
                        balance: formattedBalance,
                        minted: true,
                        registered_at: data.first_mint_timestamp,
                        minted_at: data.first_mint_timestamp,
                        tx_hash: data.first_mint_tx,
                        network: this.networkConfig.name
                    });
                }
            }
            
            console.log(`✅ Found ${holders.length} current token holders`);
            
            return holders;
            
        } catch (error) {
            console.error('❌ Error fetching token holders:', error.message);
            throw error;
        }
    }

    /**
     * Get count of unique token holders
     */
    async getHolderCount() {
        const holders = await this.getTokenHolders();
        return holders.length;
    }

    getExplorerTxUrl(txHash) {
        if (!this.networkConfig) {
            return `https://amoy.polygonscan.com/tx/${txHash}`;
        }
        return `${this.networkConfig.explorer}/tx/${txHash}`;
    }

    getNetworkName() {
        return this.networkConfig?.name || 'Not initialized';
    }

    getTokenSymbol() {
        return this.tokenSymbol || 'VIP';
    }
}

// Singleton instance
const minter = new MinterService();

export default minter;
