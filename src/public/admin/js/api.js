// api.js - Centralized API calls for admin dashboard

const API = {
    // Base fetch wrapper with error handling
    async fetch(url, options = {}) {
        try {
            const response = await fetch(url, {
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json',
                    ...options.headers
                },
                ...options
            });
            
            if (!response.ok) {
                const error = await response.json().catch(() => ({ error: response.statusText }));
                throw new Error(error.error || error.message || 'Request failed');
            }
            
            return await response.json();
        } catch (error) {
            console.error(`API Error (${url}):`, error);
            throw error;
        }
    },

    // Auth
    async checkSession() {
        return this.fetch('/api/admin/session');
    },
    
    async login(email, walletAddress, name) {
        return this.fetch('/api/admin/auth', {
            method: 'POST',
            body: JSON.stringify({ email, walletAddress, name })
        });
    },
    
    async logout() {
        return this.fetch('/api/admin/logout', { method: 'POST' });
    },

    // Registrants/Claims
    async getRegistrants() {
        return this.fetch('/api/registrants');
    },
    
    async getStats() {
        return this.fetch('/api/stats');
    },

    // Transactions
    async getTransactions() {
        return this.fetch('/api/admin/transactions');
    },
    
    async checkAllTransactions() {
        return this.fetch('/api/admin/check-all-transactions', { method: 'POST' });
    },
    
    async retryFailedMints() {
        return this.fetch('/api/admin/retry-failed-mints', { method: 'POST' });
    },
    
    async retrySingleMint(walletAddress) {
        return this.fetch('/api/admin/retry-single-mint', {
            method: 'POST',
            body: JSON.stringify({ wallet_address: walletAddress })
        });
    },

    // Presale
    async getPresaleStats() {
        return this.fetch('/api/admin/presale/stats');
    },
    
    async getPresalePurchases() {
        return this.fetch('/api/admin/presale/purchases');
    },
    
    async savePresaleSettings(settings) {
        return this.fetch('/api/admin/presale/settings', {
            method: 'POST',
            body: JSON.stringify(settings)
        });
    },
    
    async getBonusTiers() {
        return this.fetch('/api/admin/presale/bonus-tiers');
    },
    
    async saveBonusTiers(tiers) {
        return this.fetch('/api/admin/presale/bonus-tiers', {
            method: 'POST',
            body: JSON.stringify({ tiers })
        });
    },
    
    async fulfillAllOrders() {
        return this.fetch('/api/admin/presale/fulfill-all', { method: 'POST' });
    },
    
    async mintPurchase(purchaseId) {
        return this.fetch(`/api/admin/presale/mint/${purchaseId}`, { method: 'POST' });
    },

    // Referrals
    async getReferralStats() {
        const data = await this.fetch('/api/admin/referral/stats');
        // Handle nested stats object
        const stats = data.stats || data;
        return {
            total_codes: stats.totalCodes || stats.total_codes || 0,
            active_codes: stats.activeCodes || stats.active_codes || 0,
            total_referrals: stats.totalReferrals || stats.total_referrals || 0,
            total_bonus_earned: stats.totalBonus || stats.total_bonus_earned || 0
        };
    },

    async getReferralCodes() {
        const data = await this.fetch('/api/admin/referral/codes');
        return data.codes || data;
    },

    async getReferralActivity() {
        const data = await this.fetch('/api/admin/referral/list');
        return data.referrals || data;
    },

    async toggleReferralCode(code, enabled) {
        return this.fetch(`/api/admin/referral/code/${code}/toggle`, { 
            method: 'POST',
            body: JSON.stringify({ enabled })
        });
    },

    async getReferralSettings() {
        return this.fetch('/api/referral/settings');
    },

    async saveReferralSettings(settings) {
        return this.fetch('/api/referral/settings', {
            method: 'POST',
            body: JSON.stringify(settings)
        });
    },

    // Questionnaire
    async getQuestionnaireExport() {
        return this.fetch('/api/admin/questionnaire/export');
    },
    
    async getQuestionnaireStats() {
        return this.fetch('/api/admin/questionnaire/stats');
    },

    // Admins
    async getAdmins() {
        return this.fetch('/api/admin/whitelist');
    },
    
    async addAdmin(email, name, role) {
        return this.fetch('/api/admin/whitelist', {
            method: 'POST',
            body: JSON.stringify({ email, name, role })
        });
    },
    
    async removeAdmin(email) {
        return this.fetch(`/api/admin/whitelist/${encodeURIComponent(email)}`, {
            method: 'DELETE'
        });
    },

    // Manual Mint
    async manualMint(address) {
        return this.fetch('/api/mint-manual', {
            method: 'POST',
            body: JSON.stringify({ address })
        });
    },
    
    async presaleManualMint(walletAddress, eurAmount) {
        return this.fetch('/api/presale/admin/manual-mint', {
            method: 'POST',
            body: JSON.stringify({ walletAddress, eurAmount })
        });
    },

    // Settings
    async getClaimSettings() {
        return this.fetch('/api/admin/claim/settings');
    },
    
    async saveClaimSettings(settings) {
        return this.fetch('/api/admin/claim/settings', {
            method: 'POST',
            body: JSON.stringify(settings)
        });
    },

    // Sync
    async fullSync() {
        return this.fetch('/api/full-sync', { method: 'POST' });
    },
    
    async syncMembers() {
        return this.fetch('/api/members/sync', { credentials: 'include' });
    },

    // Check single transaction
    async checkSingleTransaction(wallet) {
        return this.fetch(`/api/claim/check-status/${wallet}`);
    },

    // Get presale config (public)
    async getPresaleConfig() {
        return this.fetch('/api/presale/config');
    },

    // Get manual mints list
    async getManualMints() {
        return this.fetch('/api/presale/admin/manual-mints', { credentials: 'include' });
    },

    // Health
    async getHealth() {
        return this.fetch('/api/health');
    }
};

// Export for modules or attach to window
if (typeof module !== 'undefined' && module.exports) {
    module.exports = API;
} else {
    window.API = API;
    window.Api = API;
}
