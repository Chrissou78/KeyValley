// src/public/admin/js/settings.js
// Settings management

const Settings = {
    presaleEnabled: false,
    bonusTiers: [],

    async load() {
        await Promise.all([
            this.loadPresaleSettings(),
            this.loadBonusTiers(),
            this.loadClaimSettings(),
            this.loadHealth()
        ]);
    },

    async loadPresaleSettings() {
        try {
            const data = await API.fetch('/api/admin/presale/settings');
            if (data.settings) {
                const s = data.settings;
                this.presaleEnabled = s.presaleEnabled || false;
                
                document.getElementById('setting-sale-target').value = s.saleTargetEUR || 500000;
                document.getElementById('setting-token-price').value = s.tokenPrice || 1;
                document.getElementById('setting-min-purchase').value = s.minPurchase || 10;
                document.getElementById('setting-presale-wallet').value = s.presaleWallet || '';
                
                this.updatePresaleToggle();
            }
        } catch (error) {
            console.error('Failed to load presale settings:', error);
        }
    },

    updatePresaleToggle() {
        const toggle = document.getElementById('presale-enabled-toggle');
        if (!toggle) return;
        
        if (this.presaleEnabled) {
            toggle.classList.remove('bg-gray-700');
            toggle.classList.add('bg-green-600');
            toggle.querySelector('span').style.transform = 'translateX(24px)';
        } else {
            toggle.classList.remove('bg-green-600');
            toggle.classList.add('bg-gray-700');
            toggle.querySelector('span').style.transform = 'translateX(0)';
        }
    },

    togglePresale() {
        this.presaleEnabled = !this.presaleEnabled;
        this.updatePresaleToggle();
    },

    async savePresale() {
        const statusEl = document.getElementById('presale-settings-status');
        try {
            const settings = {
                presaleEnabled: this.presaleEnabled,
                saleTargetEUR: parseFloat(document.getElementById('setting-sale-target').value),
                tokenPrice: parseFloat(document.getElementById('setting-token-price').value),
                minPurchase: parseFloat(document.getElementById('setting-min-purchase').value),
                presaleWallet: document.getElementById('setting-presale-wallet').value
            };
            
            await API.fetch('/api/admin/presale/settings', {
                method: 'POST',
                body: JSON.stringify(settings)
            });
            
            statusEl.innerHTML = '<span class="text-green-400">✓ Saved</span>';
            setTimeout(() => statusEl.innerHTML = '', 3000);
        } catch (error) {
            statusEl.innerHTML = '<span class="text-red-400">Failed to save</span>';
        }
    },

    async loadBonusTiers() {
        try {
            const data = await API.fetch('/api/admin/presale/bonus-tiers');
            this.bonusTiers = data.tiers || [];
            this.renderBonusTiers();
        } catch (error) {
            console.error('Failed to load bonus tiers:', error);
        }
    },

    renderBonusTiers() {
        const container = document.getElementById('bonus-tiers-container');
        if (!container) return;

        if (this.bonusTiers.length === 0) {
            container.innerHTML = '<p class="text-gray-500 text-sm">No bonus tiers configured</p>';
            return;
        }

        container.innerHTML = this.bonusTiers.map((tier, i) => `
            <div class="flex items-center gap-2 p-2 bg-gray-800/50 rounded">
                <input type="number" value="${tier.min_eur || 0}" 
                       onchange="Settings.updateTier(${i}, 'min_eur', this.value)"
                       class="w-24 bg-gray-700 rounded px-2 py-1 text-sm" placeholder="Min EUR">
                <span class="text-gray-500">→</span>
                <input type="number" value="${tier.bonus_percent || 0}" 
                       onchange="Settings.updateTier(${i}, 'bonus_percent', this.value)"
                       class="w-20 bg-gray-700 rounded px-2 py-1 text-sm" placeholder="%">
                <span class="text-gray-500">%</span>
                <button onclick="Settings.removeTier(${i})" class="text-red-400 hover:text-red-300 ml-auto">
                    <span class="material-symbols-outlined text-sm">delete</span>
                </button>
            </div>
        `).join('');

        this.updateBonusPreview();
    },

    updateTier(index, field, value) {
        this.bonusTiers[index][field] = parseFloat(value);
        this.updateBonusPreview();
    },

    addBonusTier() {
        this.bonusTiers.push({ min_eur: 0, bonus_percent: 0 });
        this.renderBonusTiers();
    },

    removeTier(index) {
        this.bonusTiers.splice(index, 1);
        this.renderBonusTiers();
    },

    updateBonusPreview() {
        const preview = document.getElementById('bonus-preview');
        if (!preview) return;

        const sorted = [...this.bonusTiers].sort((a, b) => a.min_eur - b.min_eur);
        
        if (sorted.length === 0) {
            preview.innerHTML = '<p class="text-gray-500">No tiers configured</p>';
            return;
        }

        preview.innerHTML = sorted.map(tier => 
            `<p>€${tier.min_eur}+ → ${tier.bonus_percent}% bonus</p>`
        ).join('');
    },

    async saveBonusTiers() {
        const statusEl = document.getElementById('bonus-tiers-status');
        try {
            await API.fetch('/api/admin/presale/bonus-tiers', {
                method: 'POST',
                body: JSON.stringify({ tiers: this.bonusTiers })
            });
            
            statusEl.innerHTML = '<span class="text-green-400">✓ Saved</span>';
            setTimeout(() => statusEl.innerHTML = '', 3000);
        } catch (error) {
            statusEl.innerHTML = '<span class="text-red-400">Failed to save</span>';
        }
    },

    async loadClaimSettings() {
        try {
            const data = await API.fetch('/api/admin/claim/settings');
            document.getElementById('setting-mint-amount').value = data.mintAmount || 2;
        } catch (error) {
            console.error('Failed to load claim settings:', error);
        }
    },

    async saveClaim() {
        const statusEl = document.getElementById('claim-settings-status');
        try {
            const mintAmount = parseInt(document.getElementById('setting-mint-amount').value);
            
            await API.fetch('/api/admin/claim/settings', {
                method: 'POST',
                body: JSON.stringify({ mintAmount })
            });
            
            statusEl.innerHTML = '<span class="text-green-400">✓ Saved</span>';
            setTimeout(() => statusEl.innerHTML = '', 3000);
        } catch (error) {
            statusEl.innerHTML = '<span class="text-red-400">Failed to save</span>';
        }
    },

    async loadHealth() {
        try {
            const data = await API.fetch('/api/health');
            
            // Update DB status
            const dbStatus = document.getElementById('db-status');
            if (dbStatus) {
                if (data.database) {
                    dbStatus.className = 'px-3 py-1 rounded-full text-xs font-medium bg-green-500/20 text-green-400';
                    dbStatus.textContent = 'Connected';
                } else {
                    dbStatus.className = 'px-3 py-1 rounded-full text-xs font-medium bg-red-500/20 text-red-400';
                    dbStatus.textContent = 'Disconnected';
                }
            }
            
            // Update counts
            if (data.stats) {
                const dbRegistrants = document.getElementById('db-registrants');
                const dbPurchases = document.getElementById('db-purchases');
                if (dbRegistrants) dbRegistrants.textContent = data.stats.registrants || 0;
                if (dbPurchases) dbPurchases.textContent = data.stats.purchases || 0;
            }
            
            // Update health status panel
            const healthStatus = document.getElementById('healthStatus');
            if (healthStatus) {
                healthStatus.innerHTML = `
                    <div class="flex justify-between items-center p-3 bg-gray-800/50 rounded-lg">
                        <span class="text-gray-300">Database</span>
                        <span class="${data.database ? 'text-green-400' : 'text-red-400'}">${data.database ? '✓ Connected' : '✗ Error'}</span>
                    </div>
                    <div class="flex justify-between items-center p-3 bg-gray-800/50 rounded-lg">
                        <span class="text-gray-300">Stripe</span>
                        <span class="${data.stripe ? 'text-green-400' : 'text-yellow-400'}">${data.stripe ? '✓ Configured' : '⚠ Not configured'}</span>
                    </div>
                    <div class="flex justify-between items-center p-3 bg-gray-800/50 rounded-lg">
                        <span class="text-gray-300">Minter</span>
                        <span class="${data.minter ? 'text-green-400' : 'text-red-400'}">${data.minter ? '✓ Ready' : '✗ Error'}</span>
                    </div>
                    <div class="flex justify-between items-center p-3 bg-gray-800/50 rounded-lg">
                        <span class="text-gray-300">Network</span>
                        <span class="text-blue-400">${data.network || 'Polygon Mainnet'}</span>
                    </div>
                `;
            }
        } catch (error) {
            console.error('Failed to load health:', error);
        }
    }
};
