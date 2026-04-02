// src/public/admin/js/auth.js
// VERSION: 2026-04-02 - Fixed WalletTwo logout
const Auth = {
    admin: null,
    STORAGE_KEY: 'keavalley_admin',
    WALLETTWO_ORIGIN: 'https://wallet.wallettwo.com',
    WALLETTWO_COMPANY_ID: null,
    isLoggingOut: false,

    async init() {
        console.log('Auth.init() called');
        
        // Load company ID from server config
        try {
            const configRes = await fetch('/api/config/public');
            const configData = await configRes.json();
            if (configData.walletTwoCompanyId) {
                this.WALLETTWO_COMPANY_ID = configData.walletTwoCompanyId;
                console.log('✅ WalletTwo Company ID loaded:', this.WALLETTWO_COMPANY_ID);
            }
        } catch (e) {
            console.error('Failed to load config:', e);
            this.WALLETTWO_COMPANY_ID = '6a27c2f8-894c-46c7-bf9f-f5af11d4e092';
        }
        
        try {
            const response = await fetch('/api/admin/session', { credentials: 'include' });
            const data = await response.json();
            
            if (data.authenticated && data.admin) {
                this.admin = data.admin;
                localStorage.setItem(this.STORAGE_KEY, JSON.stringify(data.admin));
                this.showDashboard();
                return true;
            } else {
                window.location.href = '/admin/login.html';
                return false;
            }
        } catch (error) {
            console.error('Session check failed:', error);
            window.location.href = '/admin/login.html';
            return false;
        }
    },

    showDashboard() {
        const loadingSection = document.getElementById('loadingSection');
        const dashboardSection = document.getElementById('dashboardSection');
        
        if (loadingSection) loadingSection.classList.add('hidden');
        if (dashboardSection) dashboardSection.classList.remove('hidden');
        
        const adminName = document.getElementById('adminName');
        const adminRole = document.getElementById('adminRole');
        
        if (adminName) adminName.textContent = this.admin?.name || this.admin?.email || 'Admin';
        if (adminRole) adminRole.textContent = this.admin?.role || 'admin';
        
        this.attachLogoutHandler();
    },

    attachLogoutHandler() {
        const logoutBtn = document.getElementById('logoutBtn');
        if (logoutBtn && !logoutBtn.dataset.listenerAttached) {
            logoutBtn.dataset.listenerAttached = 'true';
            logoutBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.logout();
            });
        }
    },

    logout() {
        if (this.isLoggingOut) return;
        this.isLoggingOut = true;
        
        console.log('🚪 Logging out...');
        
        // Update button
        const logoutBtn = document.getElementById('logoutBtn');
        if (logoutBtn) {
            logoutBtn.disabled = true;
            logoutBtn.textContent = 'Logging out...';
        }
        
        // Clear all storage
        localStorage.removeItem(this.STORAGE_KEY);
        localStorage.removeItem('keavalley_profile');
        localStorage.removeItem('userEmail');
        sessionStorage.clear();
        this.admin = null;
        
        // Clear server session
        fetch('/api/admin/logout', { 
            method: 'POST', 
            credentials: 'include' 
        }).catch(e => console.error('Logout error:', e));
        
        // Full page redirect to WalletTwo logout, then back to MAIN PAGE
        const logoutUrl = `${this.WALLETTWO_ORIGIN}/action/logout?auto_accept=true&companyId=${this.WALLETTWO_COMPANY_ID}&redirect_uri=${encodeURIComponent(window.location.origin + '/')}`;
        console.log('🚪 Redirecting to WalletTwo logout:', logoutUrl);
        window.location.href = logoutUrl;
    },

    isSuper() {
        return this.admin?.role === 'super_admin';
    },
    
    getAdmin() {
        return this.admin;
    }
};
