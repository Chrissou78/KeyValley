// Referrals Panel
const Referrals = {
    codes: [],
    activity: [],
    codeFilter: 'all',
    
    async load() {
        console.log('Loading referrals...');
        const result = await API.get('/referrals');
        if (result.success) {
            this.codes = result.codes || [];
            this.activity = result.activity || [];
            if (result.settings) {
                const enabled = document.getElementById('refEnabled');
                const bonusType = document.getElementById('refBonusType');
                const bonusAmount = document.getElementById('refBonusAmount');
                if (enabled) enabled.checked = result.settings.enabled;
                if (bonusType) bonusType.value = result.settings.bonus_type || 'percentage';
                if (bonusAmount) bonusAmount.value = result.settings.bonus_amount || 5;
                this.updateExplanations();
            }
        }
        this.renderCodes();
        this.renderActivity();
        this.updateStats();
    },
    
    renderCodes() {
        let filtered = this.codes;
        if (this.codeFilter === 'active') filtered = filtered.filter(c => c.is_active);
        if (this.codeFilter === 'disabled') filtered = filtered.filter(c => !c.is_active);
        
        const tbody = document.getElementById('referralCodesBody');
        if (!tbody) return;
        
        if (!filtered.length) {
            tbody.innerHTML = '<tr><td colspan="7" class="py-8 text-center text-gray-500">No referral codes</td></tr>';
            return;
        }
        
        tbody.innerHTML = filtered.map(c => `
            <tr class="border-t border-gray-800 hover:bg-gray-800/30">
                <td class="py-4 px-4 font-mono font-medium">${c.code}</td>
                <td class="py-4 px-4">${Utils.shortAddress(c.owner_wallet)}</td>
                <td class="py-4 px-4">${c.referral_count || 0}</td>
                <td class="py-4 px-4 text-primary">${Utils.formatCurrency(c.total_bonus || 0)}</td>
                <td class="py-4 px-4"><span class="px-2 py-1 rounded-full text-xs ${c.is_active ? 'bg-green-500/20 text-green-400' : 'bg-gray-500/20 text-gray-400'}">${c.is_active ? 'Active' : 'Disabled'}</span></td>
                <td class="py-4 px-4 text-gray-400">${Utils.formatDate(c.created_at)}</td>
                <td class="py-4 px-4"><button onclick="Referrals.toggleCode('${c.id}', ${!c.is_active})" class="text-sm ${c.is_active ? 'text-red-400' : 'text-green-400'}">${c.is_active ? 'Disable' : 'Enable'}</button></td>
            </tr>
        `).join('');
    },
    
    renderActivity() {
        const tbody = document.getElementById('referralActivityBody');
        if (!tbody) return;
        
        if (!this.activity.length) {
            tbody.innerHTML = '<tr><td colspan="6" class="py-8 text-center text-gray-500">No activity</td></tr>';
            return;
        }
        
        tbody.innerHTML = this.activity.map(a => `
            <tr class="border-t border-gray-800 hover:bg-gray-800/30">
                <td class="py-4 px-4">${Utils.shortAddress(a.referrer_wallet)}</td>
                <td class="py-4 px-4 font-mono">${a.code}</td>
                <td class="py-4 px-4">${Utils.shortAddress(a.referee_wallet)}</td>
                <td class="py-4 px-4 text-primary">${Utils.formatCurrency(a.bonus_amount)}</td>
                <td class="py-4 px-4"><span class="px-2 py-1 rounded-full text-xs ${a.bonus_paid ? 'bg-green-500/20 text-green-400' : 'bg-yellow-500/20 text-yellow-400'}">${a.bonus_paid ? 'Paid' : 'Pending'}</span></td>
                <td class="py-4 px-4 text-gray-400">${Utils.formatDate(a.created_at)}</td>
            </tr>
        `).join('');
    },
    
    updateStats() {
        const el = (id) => document.getElementById(id);
        if (el('refTotalCodes')) el('refTotalCodes').textContent = this.codes.length;
        if (el('refActiveCodes')) el('refActiveCodes').textContent = this.codes.filter(c => c.is_active).length;
        if (el('refTotalReferrals')) el('refTotalReferrals').textContent = this.activity.length;
        if (el('refTotalBonus')) el('refTotalBonus').textContent = Utils.formatCurrency(
            this.activity.filter(a => a.bonus_paid).reduce((s, a) => s + parseFloat(a.bonus_amount || 0), 0)
        );
    },
    
    filterCodes(filter) {
        this.codeFilter = filter;
        document.querySelectorAll('[data-code-filter]').forEach(b => {
            if (b.dataset.codeFilter === filter) {
                b.classList.remove('bg-gray-700');
                b.classList.add('bg-primary', 'text-black');
            } else {
                b.classList.remove('bg-primary', 'text-black');
                b.classList.add('bg-gray-700');
            }
        });
        this.renderCodes();
    },
    
    updateExplanations() {
        const type = document.getElementById('refBonusType')?.value;
        const amount = document.getElementById('refBonusAmount')?.value;
        const el = document.getElementById('refBonusExplanation');
        if (el) {
            el.textContent = type === 'percentage' 
                ? `Referrer receives ${amount}% of referee's membership purchase as buying power`
                : `Referrer receives €${amount} for each successful referral`;
        }
    },
    
    settingsChanged() { this.updateExplanations(); },
    
    async saveSettings() {
        const res = await API.put('/referrals/settings', {
            enabled: document.getElementById('refEnabled')?.checked,
            bonus_type: document.getElementById('refBonusType')?.value,
            bonus_amount: parseFloat(document.getElementById('refBonusAmount')?.value)
        });
        const el = document.getElementById('refSettingsStatus');
        if (el) {
            el.textContent = res.success ? 'Settings saved!' : (res.error || 'Failed');
            el.className = `text-sm text-center mt-2 ${res.success ? 'text-green-400' : 'text-red-400'}`;
            setTimeout(() => { el.textContent = ''; }, 3000);
        }
    },
    
    async toggleCode(id, active) {
        const res = await API.put(`/referrals/codes/${id}`, { is_active: active });
        if (res.success) { Utils.showToast(active ? 'Enabled' : 'Disabled'); this.load(); }
        else { Utils.showToast(res.error || 'Failed', 'error'); }
    },
    
    exportCodesCSV() { Utils.exportToCSV(this.codes, 'referral_codes'); }
};
