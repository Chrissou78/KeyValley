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

// Save wallet and email to database
async function saveWalletToDatabase(walletAddress, email = null, name = null) {
  try {
    const response = await fetch('/api/wallet/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        walletAddress: walletAddress,
        email: email,
        name: name,
        source: 'wallettwo-sdk'
      })
    });
    const result = await response.json();
    console.log('✅ Wallet saved to database:', result);
    return result;
  } catch (error) {
    console.error('Error saving wallet to database:', error);
    return null;
  }
}

// Store wallet data in localStorage
function storeWalletLocally(user) {
  try {
    const profileData = {
      address: user.address,
      wallet: user.address,
      walletAddress: user.address,
      email: user.email || null,
      name: user.name || null,
      timestamp: Date.now(),
      connectedAt: new Date().toISOString()
    };
    localStorage.setItem('walletTwoSession', JSON.stringify(profileData));
    localStorage.setItem('walletAddress', user.address);
    localStorage.setItem('keavalley_profile', JSON.stringify(profileData));
    console.log('✅ Wallet stored in localStorage');
  } catch (e) {
    console.error('Error storing in localStorage:', e);
  }
}

// Presale Banner Component
function PresaleBanner({ userAddress }) {
  return (
    <div style={styles.presaleBanner}>
      <div style={styles.presaleContent}>
        <div style={styles.presaleLeft}>
          <div style={styles.presaleHeader}>
            <span style={styles.presaleIcon}>🚀</span>
            <h3 style={styles.presaleTitle}>VIP Token Presale Now Live!</h3>
          </div>
          <p style={styles.presaleSubtitle}>Get VIP tokens at the best price. Pay with Card, POL, or USDC.</p>
          
          <div style={styles.presaleFeatures}>
            <span style={styles.presaleFeature}>💳 Card</span>
            <span style={styles.presaleFeature}>🪙 POL</span>
            <span style={styles.presaleFeature}>💵 USDC</span>
          </div>
          
          <div style={styles.presaleDetails}>
            <p><strong style={styles.goldText}>$0.10</strong> per VIP token</p>
            <p style={styles.smallText}>Min: 10 tokens • Max: 10,000 tokens</p>
          </div>
          
          {userAddress && (
            <p style={styles.presaleWalletInfo}>
              Delivery to: <code style={styles.walletCode}>{userAddress.slice(0, 6)}...{userAddress.slice(-4)}</code>
            </p>
          )}
        </div>
        
        <div style={styles.presaleRight}>
          <a href="/presale" style={styles.presaleButton}>
            🎯 Join Presale →
          </a>
          <span style={styles.limitedText}>Limited time offer</span>
        </div>
      </div>
    </div>
  );
}

// Profile Content Component
function ProfileContent() {
  const { user } = useWalletTwo();
  const [vipBalance, setVipBalance] = useState(null);
  const [loading, setLoading] = useState(false);
  const [savedToDb, setSavedToDb] = useState(false);

  // Save user to database when they connect
  useEffect(() => {
    if (user?.address && !savedToDb) {
      console.log('🔄 User connected:', user.address, user.email);
      
      // Save to database
      saveWalletToDatabase(user.address, user.email || null, user.name || null)
        .then(() => setSavedToDb(true));
      
      // Store in localStorage
      storeWalletLocally(user);
    }
  }, [user?.address, user?.email, savedToDb]);

  // Fetch VIP balance
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
        {/* Presale Banner - Show even when not logged in */}
        <PresaleBanner />
        
        <div className="profile-card login-card">
          <div className="card-icon">🔐</div>
          <h2>Connect Your Wallet</h2>
          <p>Sign in with WalletTwo to view your profile and VIP token balance.</p>
          <AuthAction className="auth-button" />
          <div className="login-footer">
            <p>Don't have a wallet? <a href="https://wallet.wallettwo.com/auth/register?companyId=6a27c2f8-894c-46c7-bf9f-f5af11d4e092" target="_blank" rel="noopener noreferrer">Create one here</a></p>
          </div>
        </div>
      </div>
    );
  }

  // Logged in
  return (
    <div className="profile-container">
      {/* Presale Banner - Always at top */}
      <PresaleBanner userAddress={user.address} />

      {/* User Info Card */}
      <div className="profile-card user-card">
        <div className="card-header">
          <span className="card-label">PROFILE</span>
          <LogoutAction className="logout-icon" />
        </div>
        <div className="user-header">
          <div className="user-avatar">
            {user.name ? user.name.charAt(0).toUpperCase() : user.email?.charAt(0).toUpperCase() || '?'}
          </div>
          <div className="user-info">
            {user.name && <h2 className="user-name">{user.name}</h2>}
            {user.email && <p className="user-email">{user.email}</p>}
          </div>
        </div>
      </div>

      {/* Wallet Card */}
      <div className="profile-card wallet-card">
        <h3>WALLET ADDRESS</h3>
        <div className="wallet-address-container">
          <code className="wallet-address">{user.address}</code>
          <button 
            className="copy-button"
            onClick={() => {
              navigator.clipboard.writeText(user.address);
            }}
            title="Copy address"
          >
            📋
          </button>
        </div>
      </div>

      {/* VIP Balance Card */}
      <div className="profile-card balance-card">
        <h3>VIP TOKEN BALANCE</h3>
        {loading ? (
          <div className="loading-spinner"></div>
        ) : (
          <div className="balance-display">
            <span className="balance-amount">{parseFloat(vipBalance || 0).toFixed(2)}</span>
            <span className="balance-symbol">VIP</span>
          </div>
        )}
        <a 
          href={`${POLYGON_EXPLORER}/token/${VIP_TOKEN.address}?a=${user.address}`}
          target="_blank" 
          rel="noopener noreferrer"
          className="explorer-link"
        >
          View on Polygonscan ↗
        </a>
      </div>

      {/* Quick Actions Card */}
      <div className="profile-card actions-card">
        <h3>QUICK ACTIONS</h3>
        <div className="action-buttons">
          <a href="/presale" className="action-button presale-action">
            🚀 Join Presale
          </a>
          <a href="/claim" className="action-button primary">
            🎁 Claim Free Tokens
          </a>
          <a href="https://wallet.wallettwo.com/wallet/dashboard?tab=Tokens&companyId=6a27c2f8-894c-46c7-bf9f-f5af11d4e092" target="_blank" rel="noopener noreferrer" className="action-button secondary">
            💼 Open WalletTwo
          </a>
        </div>
      </div>

      {/* Disconnect */}
      <div className="profile-card disconnect-card">
        <LogoutAction className="disconnect-button" />
      </div>
    </div>
  );
}

// Inline styles for Presale Banner (to ensure they work)
const styles = {
  presaleBanner: {
    background: 'linear-gradient(135deg, rgba(238, 157, 43, 0.2) 0%, rgba(212, 165, 67, 0.15) 100%)',
    border: '2px solid rgba(238, 157, 43, 0.6)',
    borderRadius: '12px',
    padding: '20px',
    marginBottom: '20px',
    animation: 'pulse-border 2s infinite'
  },
  presaleContent: {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '20px',
    flexWrap: 'wrap'
  },
  presaleLeft: {
    flex: 1,
    minWidth: '250px'
  },
  presaleRight: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '8px'
  },
  presaleHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    marginBottom: '8px'
  },
  presaleIcon: {
    fontSize: '1.5rem'
  },
  presaleTitle: {
    color: '#ee9d2b',
    fontSize: '1.25rem',
    fontWeight: '700',
    margin: 0
  },
  presaleSubtitle: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: '0.875rem',
    margin: '0 0 12px 0'
  },
  presaleFeatures: {
    display: 'flex',
    gap: '10px',
    flexWrap: 'wrap',
    marginBottom: '12px'
  },
  presaleFeature: {
    background: 'rgba(255, 255, 255, 0.1)',
    padding: '4px 10px',
    borderRadius: '20px',
    fontSize: '0.75rem',
    color: 'rgba(255, 255, 255, 0.8)'
  },
  presaleDetails: {
    marginBottom: '8px'
  },
  goldText: {
    color: '#ee9d2b',
    fontSize: '1.1rem'
  },
  smallText: {
    color: 'rgba(255, 255, 255, 0.5)',
    fontSize: '0.75rem',
    margin: '4px 0 0 0'
  },
  presaleWalletInfo: {
    color: 'rgba(255, 255, 255, 0.5)',
    fontSize: '0.75rem',
    margin: 0
  },
  walletCode: {
    color: '#22c55e',
    background: 'rgba(34, 197, 94, 0.15)',
    padding: '2px 6px',
    borderRadius: '4px',
    fontFamily: 'monospace'
  },
  presaleButton: {
    display: 'inline-block',
    background: 'linear-gradient(135deg, #ee9d2b 0%, #d4a543 100%)',
    color: '#000',
    padding: '14px 28px',
    borderRadius: '8px',
    fontWeight: '700',
    fontSize: '1rem',
    textDecoration: 'none',
    textAlign: 'center',
    transition: 'all 0.3s ease',
    boxShadow: '0 4px 15px rgba(238, 157, 43, 0.3)'
  },
  limitedText: {
    color: 'rgba(255, 255, 255, 0.4)',
    fontSize: '0.7rem'
  }
};

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

// Add keyframe animation via style tag
const styleSheet = document.createElement('style');
styleSheet.textContent = `
  @keyframes pulse-border {
    0%, 100% { border-color: rgba(238, 157, 43, 0.5); }
    50% { border-color: rgba(238, 157, 43, 1); }
  }
  
  .action-button.presale-action {
    background: linear-gradient(135deg, #ee9d2b 0%, #d4a543 100%) !important;
    color: #000 !important;
    font-weight: 700 !important;
  }
  
  .action-button.presale-action:hover {
    box-shadow: 0 4px 20px rgba(238, 157, 43, 0.4) !important;
    transform: translateY(-2px);
  }
`;
document.head.appendChild(styleSheet);

// Mount the app
const container = document.getElementById('profile-root');
if (container) {
  const root = createRoot(container);
  root.render(<ProfileApp />);
}
