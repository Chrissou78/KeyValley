// src/public/admin/js/auth.js
// Authentication module - session already validated by server

const Auth = {
    admin: null,

    async init() {
        try {
            const response = await fetch('/api/admin/session', { credentials: 'include' });
            const data = await response.json();
            
            if (data.authenticated) {
                this.admin = data.admin;
                this.showDashboard();
                return true;
            } else {
                window.location.href = '/login';
                return false;
            }
        } catch (error) {
            console.error('Session check failed:', error);
            window.location.href = '/login';
            return false;
        }
    },

    showDashboard() {
        // Hide loading section
        const loadingSection = document.getElementById('loadingSection');
        if (loadingSection) {
            loadingSection.classList.add('hidden');
        }
        
        // Hide login section if it exists
        const loginSection = document.getElementById('loginSection');
        if (loginSection) {
            loginSection.classList.add('hidden');
        }
        
        // Show dashboard section
        const dashboardSection = document.getElementById('dashboardSection');
        if (dashboardSection) {
            dashboardSection.classList.remove('hidden');
        }
        
        // Update header with admin info
        const adminName = document.getElementById('adminName');
        const adminRole = document.getElementById('adminRole');
        
        if (adminName) adminName.textContent = this.admin?.name || this.admin?.email || '';
        if (adminRole) adminRole.textContent = this.admin?.role || '';
    },

    showLogin() {
        // Redirect to login page instead of showing inline form
        window.location.href = '/login';
    },

    async logout() {
        try {
            await fetch('/api/admin/logout', { 
                method: 'POST', 
                credentials: 'include' 
            });
        } catch (e) {
            console.error('Logout error:', e);
        }
        window.location.href = '/login';
    },

    isSuper() {
        return this.admin?.role === 'super_admin';
    },
    
    getAdmin() {
        return this.admin;
    }
};
