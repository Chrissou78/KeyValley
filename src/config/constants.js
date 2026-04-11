// src/config/constants.js
// Core configuration constants

require('dotenv').config();

// Wallet addresses
const DEFAULT_REFERRER_WALLET = '0xdd4104a780142efb9566659f26d3317714a81510';
const MINTER_ADDRESS = process.env.MINTER_ADDRESS || '0xdD4104A780142EfB9566659f26d3317714a81510';
const VIP_TOKEN_ADDRESS = '0x6860c34db140DB7B589DaDA38859a1d3736bbE3F';
const USDC_ADDRESS = process.env.USDC_ADDRESS || '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359';

// Blockchain config
const POLYGON_RPC = process.env.POLYGON_RPC || 'https://polygon-mainnet.g.alchemy.com/v2/IoufBRdGO6MKWC6pxqbZW';
const EXPLORER_URL = 'https://polygonscan.com';
const CHAIN_ID = 137;

// WalletTwo config
const WALLETTWO_ORIGIN = 'https://wallet.wallettwo.com';
const WALLETTWO_COMPANY_ID = process.env.WALLETTWO_COMPANY_ID;

// Stripe config (public key only - secret stays in env)
const STRIPE_PUBLIC_KEY = process.env.STRIPE_PUBLIC_KEY;

// Session duration
const SESSION_DURATION = 24 * 60 * 60 * 1000; // 24 hours in ms

// Membership config (replaces presale)
const MEMBERSHIP_CONFIG = {
  tokenAddress: VIP_TOKEN_ADDRESS,
  tokenDecimals: 18,
  chainId: CHAIN_ID,
  platformFeePercent: 10 // 10% of net amount
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

// Transaction checking
const TX_CHECK_INTERVAL = 60000; // 60 seconds
const TX_TIMEOUT_MINUTES = 30;

module.exports = {
  // Addresses
  DEFAULT_REFERRER_WALLET,
  MINTER_ADDRESS,
  VIP_TOKEN_ADDRESS,
  USDC_ADDRESS,
  
  // Blockchain
  POLYGON_RPC,
  EXPLORER_URL,
  CHAIN_ID,
  
  // WalletTwo
  WALLETTWO_ORIGIN,
  WALLETTWO_COMPANY_ID,
  
  // Stripe
  STRIPE_PUBLIC_KEY,
  
  // Session
  SESSION_DURATION,
  
  // Membership
  MEMBERSHIP_CONFIG,
  
  // ABIs
  VIP_TOKEN_ABI,
  ERC20_ABI,
  
  // Transaction
  TX_CHECK_INTERVAL,
  TX_TIMEOUT_MINUTES
};
