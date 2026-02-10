// src/config/constants.js
// Core configuration constants - preserved exactly from old server.js

require('dotenv').config();

// Wallet addresses
const DEFAULT_REFERRER_WALLET = '0xdd4104a780142efb9566659f26d3317714a81510';
const MINTER_ADDRESS = process.env.MINTER_ADDRESS || '0xdD4104A780142EfB9566659f26d3317714a81510';
const VIP_TOKEN_ADDRESS = '0x6860c34db140DB7B589DaDA38859a1d3736bbE3F';
const USDC_ADDRESS = process.env.USDC_ADDRESS || '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359';
const POLYGON_RPC = process.env.POLYGON_RPC || 'https://polygon-rpc.com';
const EXPLORER_URL = 'https://polygonscan.com';

// Presale default configuration
const PRESALE_CONFIG = {
  presaleEnabled: true,
  saleTargetEUR: 500000,
  totalTokens: 1000000,
  tokenPrice: 1.00,
  minPurchase: 10,
  maxPurchase: 10000,
  presaleWallet: process.env.PRESALE_WALLET || '0xdd4104a780142efb9566659f26d3317714a81510',
  tokenAddress: VIP_TOKEN_ADDRESS,
  tokenDecimals: 18,
  chainId: 137,
  usdcAddress: USDC_ADDRESS,
  cryptoFeePercent: 0.015,
  cardFeePercent: 0.04
};

// ABIs
const VIP_TOKEN_ABI = [
  'function mint(address to, uint256 amount) external',
  'function balanceOf(address account) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function transfer(address to, uint256 amount) returns (bool)'
];

const ERC20_ABI = [
  'function balanceOf(address account) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'event Transfer(address indexed from, address indexed to, uint256 value)'
];

// Session duration
const SESSION_DURATION = 24 * 60 * 60 * 1000; // 24 hours in ms

// Transaction checking
const TX_CHECK_INTERVAL = 60000; // 60 seconds
const TX_TIMEOUT_MINUTES = 30;

module.exports = {
  DEFAULT_REFERRER_WALLET,
  MINTER_ADDRESS,
  VIP_TOKEN_ADDRESS,
  USDC_ADDRESS,
  POLYGON_RPC,
  EXPLORER_URL,
  PRESALE_CONFIG,
  VIP_TOKEN_ABI,
  ERC20_ABI,
  SESSION_DURATION,
  TX_CHECK_INTERVAL,
  TX_TIMEOUT_MINUTES
};
