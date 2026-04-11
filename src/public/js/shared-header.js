// public/js/shared-header.js
// VERSION: 2026-04-11 - Shared header functionality for all pages
// Handles different element IDs across pages

var HeaderManager = {
    CONFIG: {
        VIP_TOKEN_ADDRESS: '0x6860c34db140DB7B589DaDA38859a1d3736bbE3F',
        WALLETTWO_ORIGIN: 'https://wallet.wallettwo.com',
        WALLETTWO_COMPANY_ID: null,
        STORAGE_KEY: 'keavalley_profile',
        SESSION_DURATION: 24 * 60 * 60 * 1000
    },
    
    currentUser: null,
    userBalance: 0,
    initialized: false,
    
    async init() {
        if (this.initialized) return;
        this.initialized = true;
        
        console.log('🔧 HeaderManager initializing...');
        await this.loadConfig();
        this.checkSession();
        this.setupWalletListener();
        this.setupMobileMenu();
    },
    
    async loadConfig() {
        try {
            var response = await fetch('/api/config/public');
            var config = await response.json();
            if (config.walletTwoCompanyId) {
                this.CONFIG.WALLETTWO_COMPANY_ID = config.walletTwoCompanyId;
            }
            console.log('✅ Config loaded');
        } catch (e) {
            console.error('Failed to load config:', e);
        }
    },
    
    checkSession() {
        try {
            var stored = localStorage.getItem(this.CONFIG.STORAGE_KEY);
            if (stored) {
                var data = JSON.parse(stored);
                var age = Date.now() - (data.timestamp || 0);
                if (data.wallet && age < this.CONFIG.SESSION_DURATION) {
                    this.currentUser = data;
                    this.onUserConnected();
                    return;
                }
            }
        } catch (e) {
            console.error('Session check error:', e);
        }
        this.showDisconnectedState();
    },
    
    showDisconnectedState() {
        // Hide connected elements
        this.setElementDisplay('headerConnected', 'none');
        this.setElementDisplay('mobileUserSection', 'none');
        
        // Show disconnected elements
        this.setElementClass('headerDisconnected', 'remove', 'hidden');
        this.setElementDisplay('headerDisconnected', 'flex');
        this.setElementClass('mobileConnectSection', 'remove', 'hidden');
        
        // Update balance displays to 0
        this.updateBalanceDisplays(0);
    },
    
    onUserConnected() {
        var self = this;
        
        // Fetch balance
        if (this.currentUser && this.currentUser.wallet) {
            this.fetchUserBalance(this.currentUser.wallet);
        }
        
        // Hide disconnected elements
        this.setElementClass('headerDisconnected', 'add', 'hidden');
        this.setElementDisplay('headerDisconnected', 'none');
        this.setElementClass('mobileConnectSection', 'add', 'hidden');
        
        // Show connected elements
        this.setElementClass('headerConnected', 'remove', 'hidden');
        this.setElementDisplay('headerConnected', 'flex');
        this.setElementClass('mobileUserSection', 'remove', 'hidden');
        
        // Set user name
        var name = this.getUserDisplayName();
        this.setElementText('headerUserName', name);
        
        // Set initials
        var initials = this.getUserInitials(name);
        this.setElementText('headerAvatarInitials', initials);
        
        // Set email displays
        var email = this.currentUser.email || '';
        var walletShort = this.currentUser.wallet ? 
            this.currentUser.wallet.slice(0, 6) + '...' + this.currentUser.wallet.slice(-4) : '';
        
        this.setElementText('headerUserEmail', email);
        this.setElementText('dropdownEmail', email || walletShort);
        
        // Close any open login modal
        this.closeLoginModal();
        
        console.log('✅ User connected:', this.currentUser.wallet);
    },
    
    getUserDisplayName() {
        if (!this.currentUser) return 'Member';
        
        if (this.currentUser.firstName || this.currentUser.lastName) {
            return [this.currentUser.firstName, this.currentUser.lastName].filter(Boolean).join(' ');
        }
        if (this.currentUser.name) {
            return this.currentUser.name;
        }
        return 'Member';
    },
    
    getUserInitials(name) {
        if (!this.currentUser) return '--';
        
        if (this.currentUser.firstName && this.currentUser.lastName) {
            return (this.currentUser.firstName[0] + this.currentUser.lastName[0]).toUpperCase();
        }
        if (name && name !== 'Member') {
            var parts = name.trim().split(' ');
            if (parts.length > 1) {
                return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
            }
            return name.slice(0, 2).toUpperCase();
        }
        if (this.currentUser.wallet) {
            return this.currentUser.wallet.slice(2, 4).toUpperCase();
        }
        return '--';
    },
    
    async fetchUserBalance(wallet) {
        try {
            var response = await fetch('https://api.wallettwo.com/blockchain/balance/137/' + wallet + '/' + this.CONFIG.VIP_TOKEN_ADDRESS);
            if (response.ok) {
                var data = await response.json();
                this.userBalance = typeof data === 'number' ? data : (data.balance || 0);
            } else {
                this.userBalance = 0;
            }
        } catch (e) {
            console.error('Failed to fetch balance:', e);
            this.userBalance = 0;
        }
        
        this.updateBalanceDisplays(this.userBalance);
        console.log('💰 Balance fetched:', this.userBalance);
    },
    
    updateBalanceDisplays(balance) {
        var balanceFormatted = Math.floor(balance || 0).toLocaleString();
        
        // All possible balance element IDs across pages
        var balanceIds = [
            'dropdownBalance',      // index, profile
            'mobileBalance',        // index, profile
            'headerUserBalance',    // profile, package
            'userBalance'           // fallback
        ];
        
        balanceIds.forEach(function(id) {
            var el = document.getElementById(id);
            if (el) el.textContent = balanceFormatted;
        });
        
        // Marketplace uses data attribute
        var dataBalanceEls = document.querySelectorAll('[data-user-balance]');
        dataBalanceEls.forEach(function(el) {
            el.textContent = balanceFormatted;
        });
    },
    
    setupWalletListener() {
        var self = this;
        window.addEventListener('message', function(event) {
            if (!event.origin.includes('wallettwo.com')) return;
            
            var data = event.data;
            
            // Handle cancel/error events
            var isCancelEvent = data && (
                data.type === 'wallet_error' ||
                data.type === 'auth_error' ||
                data.type === 'auth_cancelled' ||
                data.type === 'wallet_cancelled' ||
                data.type === 'close' ||
                data.type === 'cancel' ||
                data.event === 'cancel' ||
                data.event === 'close'
            );
            
            if (isCancelEvent) {
                console.log('🚫 Login cancelled');
                return;
            }
            
            // Handle login events
            var isLoginEvent = data && (
                data.type === 'wallet_login' || 
                data.event === 'wallet_login' ||
                data.type === 'wallet_session' || 
                data.event === 'wallet_session'
            );
            
            if (isLoginEvent) {
                var wallet = data.wallet || data.wlt || data.address;
                var code = data.code || data.token;
                
                console.log('🔐 Login event received, wallet:', wallet);
                
                if (wallet) {
                    if (code) {
                        self.exchangeCode(code, wallet, data.user);
                    } else {
                        self.currentUser = { wallet: wallet.toLowerCase(), timestamp: Date.now() };
                        self.saveSession();
                        self.onUserConnected();
                    }
                }
            }
        });
    },
    
    async exchangeCode(code, wallet, userId) {
        var self = this;
        try {
            var response = await fetch('/api/wallettwo/exchange', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code: code })
            });
            
            var data = await response.json();
            
            this.currentUser = {
                wallet: wallet.toLowerCase(),
                userId: userId || (data.user && data.user.sub),
                email: data.email || (data.user && data.user.email),
                firstName: data.firstName || (data.user && data.user.given_name),
                lastName: data.lastName || (data.user && data.user.family_name),
                name: data.name || (data.user && data.user.name),
                timestamp: Date.now()
            };
            
            this.saveSession();
            this.onUserConnected();
        } catch (error) {
            console.error('Exchange failed:', error);
            this.currentUser = { wallet: wallet.toLowerCase(), timestamp: Date.now() };
            this.saveSession();
            this.onUserConnected();
        }
    },
    
    saveSession() {
        if (this.currentUser) {
            localStorage.setItem(this.CONFIG.STORAGE_KEY, JSON.stringify(this.currentUser));
        }
    },
    
    disconnect() {
        console.log('🔌 Disconnecting...');
        
        this.currentUser = null;
        this.userBalance = 0;
        localStorage.removeItem(this.CONFIG.STORAGE_KEY);
        
        // Logout from WalletTwo
        var iframe = document.getElementById('walletTwoLogoutIframe') || 
                     document.getElementById('logoutIframe') ||
                     document.getElementById('logout-iframe');
        
        if (iframe && this.CONFIG.WALLETTWO_COMPANY_ID) {
            iframe.src = this.CONFIG.WALLETTWO_ORIGIN + '/action/logout?iframe=true&auto_accept=true&companyId=' + this.CONFIG.WALLETTWO_COMPANY_ID;
        }
        
        this.showDisconnectedState();
    },
    
    buildWalletTwoUrl(action, extraParams) {
        extraParams = extraParams || {};
        var url;
        
        if (action === 'auth') {
            url = this.CONFIG.WALLETTWO_ORIGIN + '/auth/login?action=session&iframe=true';
        } else {
            url = this.CONFIG.WALLETTWO_ORIGIN + '/action/' + action + '?iframe=true';
        }
        
        if (this.CONFIG.WALLETTWO_COMPANY_ID) {
            url += '&companyId=' + this.CONFIG.WALLETTWO_COMPANY_ID;
        }
        
        for (var key in extraParams) {
            if (extraParams.hasOwnProperty(key)) {
                url += '&' + key + '=' + encodeURIComponent(extraParams[key]);
            }
        }
        
        url += '&_t=' + Date.now();
        return url;
    },
    
    showLoginModal() {
        var modal = document.getElementById('loginModal') || document.getElementById('login-modal');
        if (!modal) {
            // Redirect to profile if no modal
            window.location.href = '/profile';
            return;
        }
        
        // Find iframe
        var iframe = document.getElementById('loginWalletIframe') || 
                     document.getElementById('login-wallet-iframe') ||
                     modal.querySelector('iframe');
        
        if (iframe && this.CONFIG.WALLETTWO_COMPANY_ID) {
            iframe.src = this.buildWalletTwoUrl('auth');
        }
        
        modal.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
    },
    
    closeLoginModal() {
        var modal = document.getElementById('loginModal') || document.getElementById('login-modal');
        if (modal) {
            modal.classList.add('hidden');
            document.body.style.overflow = '';
        }
    },
    
    setupMobileMenu() {
        var btn = document.getElementById('mobileMenuBtn');
        var menu = document.getElementById('mobileMenu');
        
        if (btn && menu) {
            btn.addEventListener('click', function() {
                menu.classList.toggle('hidden');
            });
        }
    },
    
    // Helper functions
    setElementText(id, text) {
        var el = document.getElementById(id);
        if (el) el.textContent = text;
    },
    
    setElementDisplay(id, display) {
        var el = document.getElementById(id);
        if (el) el.style.display = display;
    },
    
    setElementClass(id, action, className) {
        var el = document.getElementById(id);
        if (el) {
            if (action === 'add') {
                el.classList.add(className);
            } else if (action === 'remove') {
                el.classList.remove(className);
            }
        }
    },
    
    // Expose current user and balance for pages that need it
    getUser() {
        return this.currentUser;
    },
    
    getBalance() {
        return this.userBalance;
    },
    
    getWallet() {
        return this.currentUser ? this.currentUser.wallet : null;
    },
    
    isConnected() {
        return !!(this.currentUser && this.currentUser.wallet);
    }
};

// Global functions for onclick handlers
function disconnect() {
    HeaderManager.disconnect();
}

function showLoginModal() {
    HeaderManager.showLoginModal();
}

function closeLoginModal() {
    HeaderManager.closeLoginModal();
}

// Auto-init when DOM ready
document.addEventListener('DOMContentLoaded', function() {
    HeaderManager.init();
});
