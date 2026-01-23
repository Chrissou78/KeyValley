import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { WalletTwoProvider, AuthAction, LogoutAction, useWalletTwo } from '@oc-labs/wallettwo-sdk';
import { ethers } from 'ethers';

// VIP Token config
const VIP_TOKEN = {
  address: '0x6860c34db140DB7B589DaDA38859a1d3736bbE3F',
  symbol: 'VIP',
  name: 'Kea Valley',
  decimals: 18
};

const POLYGON_RPC = 'https://polygon-bor-rpc.publicnode.com';
const POLYGON_EXPLORER = 'https://polygonscan.com';

// ERC20 ABI for balanceOf
const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)'
];

// Fetch token balance
async function getTokenBalance(walletAddress) {
  try {
    const provider = new ethers.JsonRpcProvider(POLYGON_RPC);
    const contract = new ethers.Contract(VIP_TOKEN.address, ERC20_ABI, provider);
    const balance = await contract.balanceOf(walletAddress);
    return ethers.formatUnits(balance, VIP_TOKEN.decimals);
  } catch (error) {
    console.error('Error fetching balance:', error);
    return '0';
  }
}

// Profile Content Component
function ProfileContent() {
  const { user } = useWalletTwo();
  const [vipBalance, setVipBalance] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (user?.address) {
      setLoading(true);
      getTokenBalance(user.address)
        .then(balance => {
          setVipBalance(balance);
          setLoading(false);
        })
        .catch(() => setLoading(false));
    }
  }, [user?.address]);

  // Not logged in
  if (!user) {
    return (
      <div className="profile-container">
        <div className="profile-card login-card">
          <div className="card-icon">🔐</div>
          <h2>Connect Your Wallet</h2>
          <p>Sign in with WalletTwo to view your profile and VIP token balance.</p>
          <AuthAction className="auth-button" />
          <div className="login-footer">
            <p>Don't have a wallet? <a href="https://wallet.wallettwo.com/auth/register" target="_blank" rel="noopener noreferrer">Create one here</a></p>
          </div>
        </div>
      </div>
    );
  }

  // Logged in
  return (
    <div className="profile-container">
      {/* User Info Card */}
      <div className="profile-card user-card">
        <div className="user-header">
          <div className="user-avatar">
            {user.name ? user.name.charAt(0).toUpperCase() : user.email?.charAt(0).toUpperCase() || '?'}
          </div>
          <div className="user-info">
            {user.name && <h2>{user.name}</h2>}
            {user.email && <p className="user-email">{user.email}</p>}
          </div>
        </div>
        <div className="user-actions">
          <LogoutAction className="logout-button" />
        </div>
      </div>

      {/* Wallet Card */}
      <div className="profile-card wallet-card">
        <h3>Wallet Address</h3>
        <div className="wallet-address-container">
          <code className="wallet-address">{user.address}</code>
          <button 
            className="copy-button"
            onClick={() => {
              navigator.clipboard.writeText(user.address);
              alert('Address copied!');
            }}
          >
            📋
          </button>
        </div>
        <a 
          href={`${POLYGON_EXPLORER}/address/${user.address}`} 
          target="_blank" 
          rel="noopener noreferrer"
          className="explorer-link"
        >
          View on Polygonscan ↗
        </a>
      </div>

      {/* VIP Balance Card */}
      <div className="profile-card balance-card">
        <h3>VIP Token Balance</h3>
        {loading ? (
          <div className="loading-spinner"></div>
        ) : (
          <div className="balance-display">
            <span className="balance-amount">{parseFloat(vipBalance || 0).toFixed(2)}</span>
            <span className="balance-symbol">VIP</span>
          </div>
        )}
        <p className="token-name">{VIP_TOKEN.name}</p>
        <a 
          href={`${POLYGON_EXPLORER}/token/${VIP_TOKEN.address}?a=${user.address}`}
          target="_blank" 
          rel="noopener noreferrer"
          className="explorer-link"
        >
          View Token Transactions ↗
        </a>
      </div>

      {/* Actions Card */}
      <div className="profile-card actions-card">
        <h3>Quick Actions</h3>
        <div className="action-buttons">
          <a href="/claim" className="action-button primary">
            🎁 Claim Free Tokens
          </a>
          <a href="https://wallet.wallettwo.com/wallet/dashboard?tab=Tokens" target="_blank" rel="noopener noreferrer" className="action-button secondary">
            💼 Open WalletTwo
          </a>
        </div>
      </div>
    </div>
  );
}

// Custom Loader
function CustomLoader() {
  return (
    <div className="profile-container">
      <div className="profile-card loading-card">
        <div className="loading-spinner"></div>
        <p>Loading your profile...</p>
      </div>
    </div>
  );
}

// Main App
function ProfileApp() {
  return (
    <WalletTwoProvider loader={<CustomLoader />}>
      <ProfileContent />
    </WalletTwoProvider>
  );
}

// Mount the app
const container = document.getElementById('profile-root');
if (container) {
  const root = createRoot(container);
  root.render(<ProfileApp />);
}
