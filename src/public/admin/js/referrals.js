// referrals.js - Referral management

const Referrals = {
    stats: {},
    codes: [],
    allCodes: [],
    activity: [],
    settings: {},
    currentFilter: 'all',

    async load() {
        try {
            const [statsData, codesData, activityData, settingsData] = await Promise.all([
                API.getReferralStats(),
                API.getReferralCodes(),
                API.getReferralActivity(),
                API.getReferralSettings()
            ]);
            
            this.stats = statsData || {};
            this.allCodes = codesData || [];
            this.codes = this.allCodes;
            this.activity = activityData || [];
            this.settings = settingsData || {};
            
            this.updateStats();
            this.renderCodes();
            this.renderActivity();
            this.renderSettings();
        } catch (error) {
            console.error('Failed to load referrals:', error);
        }
    },

    updateStats() {
        const setEl = (id, value) => {
            const el = document.getElementById(id);
            if (el) el.textContent = value;
        };
        
        setEl('refTotalCodes', this.stats.total_codes || 0);
        setEl('refActiveCodes', this.stats.active_codes || 0);
        setEl('refTotalReferrals', this.stats.total_referrals || 0);
        setEl('refTotalBonus', Utils.formatNumber(this.stats.total_bonus_earned || 0) + ' VIP');
    },

    renderSettings() {
        const setVal = (id, value) => {
            const el = document.getElementById(id);
            if (el) {
                if (el.type === 'checkbox') el.checked = value;
                else el.value = value;
            }
        };
        
        setVal('refEnabled', this.settings.enabled);
        setVal('refBonusType', this.settings.bonusType || 'fixed');
        setVal('refBonusAmount', this.settings.bonusAmount || 5);
        setVal('refPresaleBonusType', this.settings.presaleBonusType || 'percentage');
        setVal('refPresaleBonusAmount', this.settings.presaleBonusAmount || 5);
        setVal('refMinPurchase', this.settings.minPurchaseForBonus || 10);
        
        this.updateExplanations();
    },

    updateExplanations() {
        const bonusType = document.getElementById('refBonusType')?.value || 'fixed';
        const bonusAmount = document.getElementById('refBonusAmount')?.value || 5;
        const presaleBonusType = document.getElementById('refPresaleBonusType')?.value || 'percentage';
        const presaleBonusAmount = document.getElementById('refPresaleBonusAmount')?.value || 5;
        
        const bonusExpl = document.getElementById('refBonusExplanation');
        const presaleExpl = document.getElementById('refPresaleBonusExplanation');
        
        if (bonusExpl) {
            bonusExpl.textContent = bonusType === 'percentage'
                ? `Referrer receives ${bonusAmount}% of referee's claim amount in VIP tokens`
                : `Referrer receives ${bonusAmount} VIP tokens when referee claims`;
        }
        
        if (presaleExpl) {
            presaleExpl.textContent = presaleBonusType === 'percentage'
                ? `Referrer receives ${presaleBonusAmount}% of referee's purchase in VIP tokens`
                : `Referrer receives ${presaleBonusAmount} VIP tokens per presale purchase`;
        }
    },

    filterCodes(filter) {
        this.currentFilter = filter;
        
        // Update filter buttons
        document.querySelectorAll('[data-code-filter]').forEach(btn => {
            if (btn.dataset.codeFilter === filter) {
                btn.className = 'px-3 py-1 rounded text-sm bg-blue-600';
            } else {
                btn.className = 'px-3 py-1 rounded text-sm bg-gray-700 hover:bg-gray-600';
            }
        });
        
        // Filter codes
        if (filter === 'active') {
            this.codes = this.allCodes.filter(c => c.enabled);
        } else if (filter === 'disabled') {
            this.codes = this.allCodes.filter(c => !c.enabled);
        } else {
            this.codes = this.allCodes;
        }
        
        this.renderCodes();
    },

    renderCodes() {
        const tbody = document.getElementById('referralCodesBody');
        if (!tbody) return;
        
        if (this.codes.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" class="text-center py-8 text-gray-400">No referral codes</td></tr>';
            return;
        }
        
        tbody.innerHTML = this.codes.map(code => `
            <tr class="border-b border-gray-700/50 hover:bg-white/5">
                <td class="py-3 px-4">
                    <code class="bg-primary/20 text-primary px-2 py-1 rounded cursor-pointer font-mono"
                          onclick="Utils.copyToClipboard('${code.code}')" title="Click to copy">
                        ${code.code}
                    </code>
                </td>
                <td class="py-3 px-4">
                    <code class="text-xs text-gray-400">${Utils.formatAddress(code.wallet_address)}</code>
                </td>
                <td class="py-3 px-4 text-sm">${code.total_referrals || 0}</td>
                <td class="py-3 px-4 text-sm text-green-400">${Utils.formatNumber(code.total_bonus_earned || 0)} VIP</td>
                <td class="py-3 px-4">
                    <span class="px-2 py-1 rounded text-xs ${code.enabled ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}">
                        ${code.enabled ? 'Active' : 'Disabled'}
                    </span>
                </td>
                <td class="py-3 px-4 text-sm text-gray-400">${Utils.formatDate(code.created_at)}</td>
                <td class="py-3 px-4">
                    <button onclick="Referrals.toggleCode('${code.code}', ${!code.enabled})"
                            class="text-xs px-3 py-1 rounded transition-colors ${code.enabled ? 'bg-red-600 hover:bg-red-700' : 'bg-green-600 hover:bg-green-700'}">
                        ${code.enabled ? 'Disable' : 'Enable'}
                    </button>
                </td>
            </tr>
        `).join('');
    },

    renderActivity() {
        const tbody = document.getElementById('referralActivityBody');
        if (!tbody) return;
        
        if (this.activity.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="text-center py-8 text-gray-400">No referral activity yet</td></tr>';
            return;
        }
        
        tbody.innerHTML = this.activity.slice(0, 50).map(ref => `
            <tr class="border-b border-gray-700/50 hover:bg-white/5">
                <td class="py-3 px-4 text-sm">
                    <code class="text-xs text-gray-400">${Utils.formatAddress(ref.referrer_wallet)}</code>
                </td>
                <td class="py-3 px-4">
                    <code class="text-xs bg-gray-800 px-2 py-1 rounded text-primary">${ref.referrer_code}</code>
                </td>
                <td class="py-3 px-4 text-sm">
                    <code class="text-xs text-gray-400">${Utils.formatAddress(ref.referee_wallet)}</code>
                </td>
                <td class="py-3 px-4 text-sm">${Utils.formatNumber(ref.bonus_amount || 0)} VIP</td>
                <td class="py-3 px-4">
                    <span class="px-2 py-1 rounded text-xs ${ref.bonus_paid ? 'bg-green-500/20 text-green-400' : 'bg-yellow-500/20 text-yellow-400'}">
                        ${ref.bonus_paid ? 'Paid' : 'Pending'}
                    </span>
                </td>
                <td class="py-3 px-4 text-sm text-gray-400">${Utils.formatDate(ref.created_at)}</td>
            </tr>
        `).join('');
    },

    async toggleCode(code, enabled) {
        try {
            await API.toggleReferralCode(code, enabled);
            Utils.showToast(`Code ${code} ${enabled ? 'enabled' : 'disabled'}`);
            this.load();
        } catch (error) {
            Utils.showToast('Failed to toggle code: ' + error.message, 'error');
        }
    },

    async saveSettings() {
        const statusEl = document.getElementById('refSettingsStatus');
        if (statusEl) statusEl.innerHTML = '<span class="text-gray-400">Saving...</span>';
        
        const getVal = (id) => {
            const el = document.getElementById(id);
            if (!el) return null;
            if (el.type === 'checkbox') return el.checked;
            if (el.type === 'number') return parseFloat(el.value) || 0;
            return el.value;
        };
        
        const settings = {
            enabled: getVal('refEnabled'),
            bonusType: getVal('refBonusType'),
            bonusAmount: getVal('refBonusAmount'),
            presaleBonusType: getVal('refPresaleBonusType'),
            presaleBonusAmount: getVal('refPresaleBonusAmount'),
            minPurchaseForBonus: getVal('refMinPurchase')
        };
        
        try {
            await API.saveReferralSettings(settings);
            if (statusEl) statusEl.innerHTML = '<span class="text-green-400">✓ Settings saved!</span>';
            setTimeout(() => { if (statusEl) statusEl.innerHTML = ''; }, 3000);
        } catch (error) {
            if (statusEl) statusEl.innerHTML = `<span class="text-red-400">Error: ${error.message}</span>`;
        }
    },

    settingsChanged() {
        // Called when settings are changed to update UI
        this.updateExplanations();
    },

    exportCodesCSV() {
        if (!this.allCodes.length) {
            Utils.showToast('No data to export', 'error');
            return;
        }
        Utils.exportToCSV(this.allCodes, 'referral_codes');
    },

    exportActivityCSV() {
        if (!this.activity.length) {
            Utils.showToast('No data to export', 'error');
            return;
        }
        Utils.exportToCSV(this.activity, 'referral_activity');
    }
};

window.Referrals = Referrals;
