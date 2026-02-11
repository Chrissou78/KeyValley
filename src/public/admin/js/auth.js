// src/public/admin/js/auth.js
const Auth = {
    admin: null,
    STORAGE_KEY: 'keavalley_admin',
    WALLETTWO_ORIGIN: 'https://wallet.wallettwo.com',
    WALLETTWO_COMPANY_ID: '6a27c2f8-894c-46c7-bf9f-f5af11d4e092',
    isLoggingOut: false,

    async init() {
        console.log('Auth.init() called');
        
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
        
        console.log('Logging out...');
        
        // Update button
        const logoutBtn = document.getElementById('logoutBtn');
        if (logoutBtn) {
            logoutBtn.disabled = true;
            logoutBtn.textContent = 'Logging out...';
        }
        
        // Clear local storage
        localStorage.removeItem(this.STORAGE_KEY);
        this.admin = null;
        
        // Clear server session
        fetch('/api/admin/logout', { 
            method: 'POST', 
            credentials: 'include' 
        }).catch(e => console.error('Logout error:', e));
        
        // Trigger WalletTwo logout (same as profile)
        const logoutIframe = document.getElementById('walletTwoLogoutIframe');
        if (logoutIframe) {
            logoutIframe.src = `${this.WALLETTWO_ORIGIN}/action/logout?iframe=true&companyId=${this.WALLETTWO_COMPANY_ID}`;
            console.log('WalletTwo logout triggered');
        }
        
        // Wait 2 seconds then redirect (same as profile)
        setTimeout(() => {
            window.location.href = '/';
        }, 2000);
    },

    isSuper() {
        return this.admin?.role === 'super_admin';
    },
    
    getAdmin() {
        return this.admin;
    }
};
