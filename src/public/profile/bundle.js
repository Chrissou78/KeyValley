// Profile App - Vanilla JS version using WalletTwo SDK from CDN
(function() {
    const { WalletTwoProvider, AuthAction, LogoutAction, useWalletTwo } = window.WalletTwoSDK || {};
    const { useState, useEffect, createElement: h } = React;
    const { createRoot } = ReactDOM;

    // Config
    const VIP_TOKEN = {
        address: '0x6860c34db140DB7B589DaDA38859a1d3736bbE3F',
        symbol: 'VIP',
        name: 'Kea Valley',
        decimals: 18
    };
    const POLYGON_RPC = 'https://polygon-bor-rpc.publicnode.com';
    const POLYGON_EXPLORER = 'https://polygonscan.com';

    // ERC20 ABI
    const ERC20_ABI = [
        'function balanceOf(address owner) view returns (uint256)'
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

    // Copy to clipboard
    function copyToClipboard(text) {
        navigator.clipboard.writeText(text).then(() => {
            alert('Address copied!');
        });
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
            return h('div', { className: 'profile-container' },
                h('div', { className: 'profile-card login-card' },
                    h('div', { className: 'card-icon' }, '🔐'),
                    h('h2', null, 'Connect Your Wallet'),
                    h('p', null, 'Sign in with WalletTwo to view your profile and VIP token balance.'),
                    h(AuthAction, { className: 'auth-button' }),
                    h('div', { className: 'login-footer' },
                        h('p', null,
                            "Don't have a wallet? ",
                            h('a', { 
                                href: 'https://wallet.wallettwo.com/auth/register', 
                                target: '_blank',
                                rel: 'noopener noreferrer'
                            }, 'Create one here')
                        )
                    )
                )
            );
        }

        // Logged in
        return h('div', { className: 'profile-container' },
            // User Info Card
            h('div', { className: 'profile-card user-card' },
                h('div', { className: 'user-header' },
                    h('div', { className: 'user-avatar' },
                        user.name ? user.name.charAt(0).toUpperCase() : 
                        user.email ? user.email.charAt(0).toUpperCase() : '?'
                    ),
                    h('div', { className: 'user-info' },
                        user.name && h('h2', null, user.name),
                        user.email && h('p', { className: 'user-email' }, user.email)
                    )
                ),
                h('div', { className: 'user-actions' },
                    h(LogoutAction, { className: 'logout-button' })
                )
            ),

            // Wallet Card
            h('div', { className: 'profile-card wallet-card' },
                h('h3', null, 'Wallet Address'),
                h('div', { className: 'wallet-address-container' },
                    h('code', { className: 'wallet-address' }, user.address),
                    h('button', { 
                        className: 'copy-button',
                        onClick: () => copyToClipboard(user.address)
                    }, '📋')
                ),
                h('a', {
                    href: `${POLYGON_EXPLORER}/address/${user.address}`,
                    target: '_blank',
                    rel: 'noopener noreferrer',
                    className: 'explorer-link'
                }, 'View on Polygonscan ↗')
            ),

            // VIP Balance Card
            h('div', { className: 'profile-card balance-card' },
                h('h3', null, 'VIP Token Balance'),
                loading ?
                    h('div', { className: 'loading-spinner' }) :
                    h('div', { className: 'balance-display' },
                        h('span', { className: 'balance-amount' }, 
                            parseFloat(vipBalance || 0).toFixed(2)
                        ),
                        h('span', { className: 'balance-symbol' }, 'VIP')
                    ),
                h('p', { className: 'token-name' }, VIP_TOKEN.name),
                h('a', {
                    href: `${POLYGON_EXPLORER}/token/${VIP_TOKEN.address}?a=${user.address}`,
                    target: '_blank',
                    rel: 'noopener noreferrer',
                    className: 'explorer-link'
                }, 'View Token Transactions ↗')
            ),

            // Actions Card
            h('div', { className: 'profile-card actions-card' },
                h('h3', null, 'Quick Actions'),
                h('div', { className: 'action-buttons' },
                    h('a', { 
                        href: '/claim', 
                        className: 'action-button primary' 
                    }, '🎁 Claim Free Tokens'),
                    h('a', { 
                        href: 'https://wallet.wallettwo.com/wallet/dashboard?tab=Tokens',
                        target: '_blank',
                        rel: 'noopener noreferrer',
                        className: 'action-button secondary'
                    }, '💼 Open WalletTwo')
                )
            )
        );
    }

    // Custom Loader
    function CustomLoader() {
        return h('div', { className: 'profile-container' },
            h('div', { className: 'profile-card loading-card' },
                h('div', { className: 'loading-spinner' }),
                h('p', null, 'Loading your profile...')
            )
        );
    }

    // Main App
    function ProfileApp() {
        // Check if SDK is loaded
        if (!WalletTwoProvider) {
            return h('div', { className: 'profile-container' },
                h('div', { className: 'profile-card login-card' },
                    h('div', { className: 'card-icon' }, '⚠️'),
                    h('h2', null, 'Loading SDK...'),
                    h('p', null, 'Please wait while we load the WalletTwo SDK.')
                )
            );
        }

        return h(WalletTwoProvider, { loader: h(CustomLoader) },
            h(ProfileContent)
        );
    }

    // Mount the app when DOM is ready
    function init() {
        const container = document.getElementById('profile-root');
        if (container) {
            const root = createRoot(container);
            root.render(h(ProfileApp));
        }
    }

    // Wait for SDK to load
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
