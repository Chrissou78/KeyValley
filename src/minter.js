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

    // Load network config
    this.networkConfig = getNetworkConfig();

    console.log(`\n🔗 Connecting to ${this.networkConfig.name}...`);
    console.log(`   Chain ID: ${this.networkConfig.chainId}`);
    console.log(`   RPC: ${this.networkConfig.rpcUrl}`);
    console.log(`   Token: ${this.networkConfig.tokenAddress}`);

    // Setup provider and wallet
    this.provider = new ethers.JsonRpcProvider(this.networkConfig.rpcUrl);

    if (!process.env.PRIVATE_KEY) {
      throw new Error('PRIVATE_KEY not set in .env');
    }

    this.wallet = new ethers.Wallet(process.env.PRIVATE_KEY, this.provider);

    // Setup contract
    this.contract = new ethers.Contract(
      this.networkConfig.tokenAddress,
      TOKEN_ABI,
      this.wallet
    );

    // Fetch token info
    this.decimals = await this.contract.decimals();
    this.tokenName = await this.contract.name();
    this.tokenSymbol = await this.contract.symbol();

    // Verify ownership
    const contractOwner = await this.contract.owner();
    if (contractOwner.toLowerCase() !== this.wallet.address.toLowerCase()) {
      throw new Error(
        `Wallet ${this.wallet.address} is not the contract owner. Owner is ${contractOwner}`
      );
    }

    // Check balance
    const balance = await this.provider.getBalance(this.wallet.address);

    console.log(`\n✅ Minter initialized!`);
    console.log(`   Token: ${this.tokenName} (${this.tokenSymbol})`);
    console.log(`   Decimals: ${this.decimals}`);
    console.log(`   Minter wallet: ${this.wallet.address}`);
    console.log(`   ${this.networkConfig.currency} balance: ${ethers.formatEther(balance)}`);

    if (parseFloat(ethers.formatEther(balance)) < 0.01) {
      console.warn(`\n⚠️  WARNING: Low ${this.networkConfig.currency} balance! Fund your wallet.`);
    }

    this.initialized = true;
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
      withTokens: [],
      withoutTokens: [],
    };

    for (const address of addresses) {
      try {
        const balance = await this.contract.balanceOf(address);
        if (balance > 0n) {
          results.withTokens.push({
            address,
            balance: ethers.formatUnits(balance, this.decimals),
          });
        } else {
          results.withoutTokens.push(address);
        }
      } catch (err) {
        console.error(`Error checking balance for ${address}:`, err.message);
        // Assume no tokens if we can't check
        results.withoutTokens.push(address);
      }
    }

    return results;
  }

  // Validate and deduplicate addresses before minting
  validateAddresses(addresses) {
    // Normalize all addresses
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

    // Remove duplicates (case-insensitive)
    const unique = [...new Set(normalized.map(a => a.toLowerCase()))];

    // Convert back to checksum format
    const checksummed = unique.map(addr => ethers.getAddress(addr));

    const duplicatesRemoved = normalized.length - unique.length;
    if (duplicatesRemoved > 0) {
      console.warn(`⚠️  Removed ${duplicatesRemoved} duplicate address(es) from batch`);
    }

    return checksummed;
  }

  // Mint to a single address (with balance check)
  async mintToAddress(recipientAddress, amount, skipBalanceCheck = false) {
    await this.initialize();

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

    const amountWithDecimals = ethers.parseUnits(
      amount.toString(),
      this.decimals
    );

    console.log(`\n🪙 Minting ${amount} ${this.tokenSymbol} to ${recipient}...`);

    const tx = await this.contract.mint(recipient, amountWithDecimals);
    console.log(`   TX submitted: ${tx.hash}`);

    const receipt = await tx.wait();
    console.log(`   ✅ Confirmed in block ${receipt.blockNumber}`);
    console.log(`   🔗 ${this.networkConfig.explorer}/tx/${receipt.hash}`);

    return { receipt, skipped: false };
  }

  // Batch mint to multiple addresses (with balance check)
  async batchMintToAddresses(recipientAddresses, amountEach, skipBalanceCheck = false) {
    await this.initialize();

    // Validate and deduplicate addresses
    const validAddresses = this.validateAddresses(recipientAddresses);

    if (validAddresses.length === 0) {
      console.log('No valid addresses to mint to.');
      return null;
    }

    let addressesToMint = validAddresses;
    let alreadyHaveTokens = [];

    // Check on-chain balances
    if (!skipBalanceCheck) {
      console.log(`\n🔍 Checking on-chain balances for ${validAddresses.length} address(es)...`);
      const balanceCheck = await this.checkBalances(validAddresses);
      
      alreadyHaveTokens = balanceCheck.withTokens;
      addressesToMint = balanceCheck.withoutTokens;

      if (alreadyHaveTokens.length > 0) {
        console.log(`   ℹ️  ${alreadyHaveTokens.length} address(es) already have tokens:`);
        alreadyHaveTokens.forEach(w => {
          console.log(`      - ${w.address}: ${w.balance} ${this.tokenSymbol}`);
        });
      }
    }

    if (addressesToMint.length === 0) {
      console.log('   All addresses already have tokens. Nothing to mint.');
      return {
        receipt: null,
        mintedAddresses: [],
        skippedAddresses: alreadyHaveTokens.map(w => w.address),
        originalCount: recipientAddresses.length,
        mintedCount: 0,
        skippedCount: alreadyHaveTokens.length,
      };
    }

    const amountWithDecimals = ethers.parseUnits(
      amountEach.toString(),
      this.decimals
    );

    // Your contract takes address[] and uint256[] (amounts array)
    const amounts = addressesToMint.map(() => amountWithDecimals);

    console.log(`\n🪙 Batch minting ${amountEach} ${this.tokenSymbol} each to ${addressesToMint.length} address(es)...`);

    const tx = await this.contract.batchMint(addressesToMint, amounts);
    console.log(`   TX submitted: ${tx.hash}`);

    const receipt = await tx.wait();
    console.log(`   ✅ Confirmed in block ${receipt.blockNumber}`);
    console.log(`   🔗 ${this.networkConfig.explorer}/tx/${receipt.hash}`);

    return {
      receipt,
      mintedAddresses: addressesToMint,
      skippedAddresses: alreadyHaveTokens.map(w => w.address),
      originalCount: recipientAddresses.length,
      mintedCount: addressesToMint.length,
      skippedCount: alreadyHaveTokens.length,
    };
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

  getExplorerTxUrl(txHash) {
    return `${this.networkConfig.explorer}/tx/${txHash}`;
  }

  getNetworkName() {
    return this.networkConfig?.name || 'Not initialized';
  }
}

module.exports = new MinterService();
