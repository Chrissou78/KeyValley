// /js/header-component.js - Reusable Header with Profile Widget

const HeaderComponent = {
    CONFIG: {
        WALLETTWO_ORIGIN: 'https://wallet.wallettwo.com',
        WALLETTWO_COMPANY_ID: null,
        VIP_TOKEN_ADDRESS: '0x6860c34db140DB7B589DaDA38859a1d3736bbE3F',
        STORAGE_KEY: 'keavalley_profile',
        SESSION_DURATION: 24 * 60 * 60 * 1000
    },

    user: null,
    balance: 0,
    initialized: false,
    onConnectCallback: null,
    onDisconnectCallback: null,

    async init(options) {
        if (this.initialized) return;
        
        options = options || {};
        this.onConnectCallback = options.onConnect || null;
        this.onDisconnectCallback = options.onDisconnect || null;

        // Load config
        try {
            const response = await fetch('/api/config/public');
            const config = await response.json();
            if (config.walletTwoCompanyId) {
                this.CONFIG.WALLETTWO_COMPANY_ID = config.walletTwoCompanyId;
            }
        } catch (e) {
            console.error('Failed to load config:', e);
        }

        // Check existing session
        this.checkSession();
        
        // Listen for WalletTwo messages
        window.addEventListener('message', (e) => this.handleMessage(e));
        
        this.initialized = true;
    },

    checkSession() {
        try {
            const stored = localStorage.getItem(this.CONFIG.STORAGE_KEY);
            if (stored) {
                const data = JSON.parse(stored);
                const age = Date.now() - (data.timestamp || 0);
                if (data.wallet && age < this.CONFIG.SESSION_DURATION) {
                    this.user = data;
                    this.onConnected();
                    return true;
                }
            }
        } catch (e) {
            console.error('Session check error:', e);
        }
        
        this.updateUI();
        return false;
    },

    handleMessage(event) {
        if (!event.origin.includes('wallettwo.com')) return;

        const data = event.data;
        
        if (data && (data.type === 'wallet_login' || data.event === 'wallet_login')) {
            const wallet = data.wallet || data.wlt || data.address;
            if (wallet) {
                if (data.code) {
                    this.exchangeCode(data.code, wallet, data.user);
                } else {
                    this.user = { wallet: wallet, timestamp: Date.now() };
                    this.saveSession();
                    this.onConnected();
                }
            }
        }
    },

    async exchangeCode(code, wallet, userId) {
        try {
            const response = await fetch('/api/wallettwo/exchange', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code: code })
            });
            
            const data = await response.json();
            
            this.user = {
                wallet: wallet,
                userId: userId || (data.user && data.user.sub),
                email: data.email || (data.user && data.user.email),
                firstName: data.firstName || (data.user && data.user.given_name),
                lastName: data.lastName || (data.user && data.user.family_name),
                name: data.name || (data.user && data.user.name),
                accessToken: data.access_token,
                timestamp: Date.now()
            };
            
            this.saveSession();
            this.onConnected();
        } catch (error) {
            console.error('Exchange failed:', error);
            this.user = { wallet: wallet, timestamp: Date.now() };
            this.saveSession();
            this.onConnected();
        }
    },

    saveSession() {
        if (this.user) {
            localStorage.setItem(this.CONFIG.STORAGE_KEY, JSON.stringify(this.user));
        }
    },

    async onConnected() {
        if (this.user && this.user.wallet) {
            await this.fetchBalance();
        }
        
        this.updateUI();
        
        // Close login modal if exists
        const loginModal = document.getElementById('loginModal');
        if (loginModal) loginModal.classList.add('hidden');
        
        // Dispatch event
        window.dispatchEvent(new CustomEvent('userConnected', { detail: this.user }));
        
        // Callback
        if (this.onConnectCallback) {
            this.onConnectCallback(this.user);
        }
    },

    async fetchBalance() {
        if (!this.user || !this.user.wallet) return;
        
        try {
            const response = await fetch(
                'https://api.wallettwo.com/blockchain/balance/137/' + 
                this.user.wallet + '/' + this.CONFIG.VIP_TOKEN_ADDRESS
            );
            if (response.ok) {
                const data = await response.json();
                this.balance = typeof data === 'number' ? data : (data.balance || 0);
            } else {
                this.balance = 0;
            }
        } catch (e) {
            this.balance = 0;
        }
        
        // Update balance displays
        const balanceEls = document.querySelectorAll('[data-user-balance]');
        balanceEls.forEach(function(el) {
            el.textContent = Math.floor(this.balance).toLocaleString();
        }.bind(this));
    },

    connect() {
        if (!this.CONFIG.WALLETTWO_COMPANY_ID) {
            console.error('WalletTwo company ID not configured');
            return;
        }

        // Check if login modal exists, if so use iframe
        const loginModal = document.getElementById('loginModal');
        const iframe = document.getElementById('loginWalletIframe');
        
        if (loginModal && iframe) {
            iframe.src = this.CONFIG.WALLETTWO_ORIGIN + '/auth/login?action=auth&iframe=true&auto_accept=true&companyId=' + this.CONFIG.WALLETTWO_COMPANY_ID;
            loginModal.classList.remove('hidden');
        } else {
            // Open popup
            const width = 450;
            const height = 700;
            const left = (window.innerWidth - width) / 2 + window.screenX;
            const top = (window.innerHeight - height) / 2 + window.screenY;
            
            window.open(
                this.CONFIG.WALLETTWO_ORIGIN + '/auth/login?action=auth&auto_accept=true&companyId=' + this.CONFIG.WALLETTWO_COMPANY_ID,
                'WalletTwo',
                'width=' + width + ',height=' + height + ',left=' + left + ',top=' + top + ',resizable=yes,scrollbars=yes'
            );
        }
    },

    disconnect() {
        this.user = null;
        this.balance = 0;
        localStorage.removeItem(this.CONFIG.STORAGE_KEY);
        
        // Logout from WalletTwo via iframe
        const iframe = document.getElementById('walletTwoLogoutIframe');
        if (iframe && this.CONFIG.WALLETTWO_COMPANY_ID) {
            iframe.src = this.CONFIG.WALLETTWO_ORIGIN + '/auth/logout?auto_accept=true&companyId=' + this.CONFIG.WALLETTWO_COMPANY_ID;
        }
        
        this.updateUI();
        
        // Dispatch event
        window.dispatchEvent(new CustomEvent('userDisconnected'));
        
        // Callback
        if (this.onDisconnectCallback) {
            this.onDisconnectCallback();
        }
    },

    updateUI() {
        const connectedEl = document.getElementById('headerConnected');
        const disconnectedEl = document.getElementById('headerDisconnected');
        const userNameEl = document.getElementById('headerUserName');
        const userEmailEl = document.getElementById('headerUserEmail');
        const buyingPowerBanner = document.getElementById('buyingPowerBanner');
        
        if (this.user) {
            // Show connected state
            if (connectedEl) {
                connectedEl.classList.remove('hidden');
                connectedEl.style.display = 'flex';
            }
            if (disconnectedEl) {
                disconnectedEl.classList.add('hidden');
            }
            if (buyingPowerBanner) {
                buyingPowerBanner.classList.remove('hidden');
            }
            
            // Set user info
            if (userNameEl) {
                const name = [this.user.firstName, this.user.lastName].filter(Boolean).join(' ') || 
                             this.user.name || 
                             'Member';
                userNameEl.textContent = name;
            }
            if (userEmailEl) {
                userEmailEl.textContent = this.user.email || '';
            }
            
            // Update balance displays
            const balanceEls = document.querySelectorAll('[data-user-balance]');
            balanceEls.forEach(function(el) {
                el.textContent = Math.floor(this.balance).toLocaleString();
            }.bind(this));
            
        } else {
            // Show disconnected state
            if (connectedEl) {
                connectedEl.classList.add('hidden');
                connectedEl.style.display = '';
            }
            if (disconnectedEl) {
                disconnectedEl.classList.remove('hidden');
            }
            if (buyingPowerBanner) {
                buyingPowerBanner.classList.add('hidden');
            }
        }
    },

    isConnected() {
        return !!this.user;
    },

    getUser() {
        return this.user;
    },

    getWallet() {
        return this.user ? this.user.wallet : null;
    },

    getBalance() {
        return this.balance;
    }
};

// Global functions for onclick handlers
function showLoginModal(callback) {
    HeaderComponent.onConnectCallback = callback || null;
    HeaderComponent.connect();
}

function disconnect() {
    HeaderComponent.disconnect();
}

// Auto-initialize when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    HeaderComponent.init();
});
