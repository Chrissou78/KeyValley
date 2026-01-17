const networks = {
  amoy: {
    name: 'Polygon Amoy Testnet',
    chainId: 80002,
    rpcUrl: 'https://rpc-amoy.polygon.technology',
    explorer: 'https://amoy.polygonscan.com',
    currency: 'POL',
    tokenAddressEnvKey: 'TOKEN_ADDRESS_AMOY',
  },
  polygon: {
    name: 'Polygon Mainnet',
    chainId: 137,
    rpcUrl: 'https://polygon-rpc.com',
    explorer: 'https://polygonscan.com',
    currency: 'POL',
    tokenAddressEnvKey: 'TOKEN_ADDRESS_POLYGON',
  },
};

function getNetworkConfig() {
  const networkName = process.env.NETWORK || 'amoy';

  if (!networks[networkName]) {
    throw new Error(`Unknown network: ${networkName}. Use "amoy" or "polygon"`);
  }

  const config = networks[networkName];
  const tokenAddress = process.env[config.tokenAddressEnvKey];

  if (!tokenAddress || tokenAddress.startsWith('0x_YOUR')) {
    throw new Error(`Token address not set for ${networkName}. Set ${config.tokenAddressEnvKey} in .env`);
  }

  return {
    ...config,
    tokenAddress,
  };
}

module.exports = { networks, getNetworkConfig };
