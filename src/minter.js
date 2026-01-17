// src/minter.js
const { ethers } = require('ethers');
const { getNetworkConfig } = require('./config/networks.js');
const TOKEN_ABI = require('./abi/token.json');
require('dotenv').config();

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
        if (this.initialized) return;

        try {
            console.log('🔧 Initializing minter...');
            this.networkConfig = getNetworkConfig();
            console.log(`📡 Network: ${this.networkConfig.name}`);
            console.log(`🪙 Token: ${this.networkConfig.tokenAddress}`);

            this.provider = new ethers.JsonRpcProvider(this.networkConfig.rpcUrl);
            
            const privateKey = process.env.PRIVATE_KEY;
            if (!privateKey) throw new Error('PRIVATE_KEY not set');

            this.wallet = new ethers.Wallet(privateKey, this.provider);
            console.log(`👛 Minter wallet: ${this.wallet.address}`);

            this.contract = new ethers.Contract(this.networkConfig.tokenAddress, TOKEN_ABI, this.wallet);

            this.decimals = await this.contract.decimals();
            this.tokenName = await this.contract.name();
            this.tokenSymbol = await this.contract.symbol();
            
            console.log(`📛 Token: ${this.tokenName} (${this.tokenSymbol})`);

            const owner = await this.contract.owner();
            if (owner.toLowerCase() !== this.wallet.address.toLowerCase()) {
                throw new Error(`Wallet is not contract owner`);
            }
            console.log('✅ Wallet is contract owner');

            const balance = await this.provider.getBalance(this.wallet.address);
            console.log(`💰 Balance: ${ethers.formatEther(balance)} ${this.networkConfig.currency}`);

            this.initialized = true;
            console.log('✅ Minter initialized');
        } catch (error) {
            console.error('❌ Minter init failed:', error.message);
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

    async mintToAddress(recipientAddress, amount, skipBalanceCheck = false) {
        await this.initialize();
        
        console.log(`🎯 Minting ${amount} ${this.tokenSymbol} to: ${recipientAddress}`);

        if (!ethers.isAddress(recipientAddress)) throw new Error(`Invalid address: ${recipientAddress}`);

        const checksummedAddress = ethers.getAddress(recipientAddress);

        if (!skipBalanceCheck) {
            const hasTokens = await this.hasTokens(checksummedAddress);
            if (hasTokens) {
                const balance = await this.getBalance(checksummedAddress);
                console.log(`⏭️ Skipping - already has ${balance} ${this.tokenSymbol}`);
                return { skipped: true, reason: 'already_has_tokens', balance };
            }
        }

        try {
            const amountWei = ethers.parseUnits(amount.toString(), this.decimals);
            const tx = await this.contract.mint(checksummedAddress, amountWei);
            console.log(`📋 TX: ${tx.hash}`);
            
            const receipt = await tx.wait();
            console.log(`✅ Minted! Gas: ${receipt.gasUsed.toString()}`);
            
            return { receipt, skipped: false };
        } catch (error) {
            console.error(`❌ Mint failed:`, error.message);
            throw error;
        }
    }

    getExplorerTxUrl(txHash) {
        return `${this.networkConfig?.explorer || 'https://amoy.polygonscan.com'}/tx/${txHash}`;
    }

    getNetworkName() {
        return this.networkConfig?.name || 'Not initialized';
    }

    getTokenSymbol() {
        return this.tokenSymbol || 'VIP';
    }
}

const minter = new MinterService();
module.exports = minter;
