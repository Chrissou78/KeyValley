// presale.js - Presale management

const Presale = {
    purchases: [],
    stats: {},
    bonusTiers: [],

    async load() {
        Utils.showLoading('presaleTableBody', 'Loading presale data...');
        
        try {
            const [statsData, purchasesData, tiersData] = await Promise.all([
                API.getPresaleStats(),
                API.getPresalePurchases(),
                API.getBonusTiers()
            ]);
            
            this.stats = statsData;
            this.purchases = purchasesData.purchases || [];
            this.bonusTiers = tiersData.tiers || [];
            
            this.updateStats();
            this.renderPurchases();
            this.renderBonusTiers();
        } catch (error) {
            Utils.showError('presaleTableBody', 'Failed to load presale data');
        }
    },

    updateStats() {
        const setEl = (id, value) => {
            const el = document.getElementById(id);
            if (el) el.textContent = value;
        };
        
        setEl('presaleEurRaised', Utils.formatEUR(this.stats.eurRaised));
        setEl('presaleTokensSold', Utils.formatNumber(this.stats.tokensSold));
        setEl('presaleTotalPurchases', this.stats.totalPurchases || 0);
        setEl('presaleUniqueBuyers', this.stats.uniqueBuyers || 0);
        setEl('presalePendingMint', this.stats.pendingMint || 0);
        
        // Update progress bar
        const progressBar = document.getElementById('presaleProgressBar');
        const progressText = document.getElementById('presaleProgressText');
        if (progressBar) progressBar.style.width = `${Math.min(this.stats.progressPct || 0, 100)}%`;
        if (progressText) progressText.textContent = `${(this.stats.progressPct || 0).toFixed(1)}%`;
    },

    renderPurchases() {
        const tbody = document.getElementById('presaleTableBody');
        if (!tbody) return;
        
        if (this.purchases.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" class="text-center py-8 text-gray-400">No purchases found</td></tr>';
            return;
        }
        
        tbody.innerHTML = this.purchases.slice(0, 50).map(p => `
            <tr class="border-b border-gray-700/50 hover:bg-white/5">
                <td class="py-3 px-4">
                    <code class="text-xs bg-gray-800 px-2 py-1 rounded cursor-pointer"
                          onclick="Utils.copyToClipboard('${p.wallet_address}')">
                        ${Utils.formatAddress(p.wallet_address)}
                    </code>
                </td>
                <td class="py-3 px-4 text-sm">${Utils.formatNumber(p.token_amount)} VIP</td>
                <td class="py-3 px-4 text-sm">${Utils.formatEUR(p.eur_amount)}</td>
                <td class="py-3 px-4 text-sm">${p.payment_method || '-'}</td>
                <td class="py-3 px-4">${Utils.getStatusBadge(p.status)}</td>
                <td class="py-3 px-4 text-sm text-gray-400">${Utils.formatDate(p.created_at)}</td>
                <td class="py-3 px-4">
                    ${['paid', 'pending_mint'].includes(p.status) ? `
                        <button onclick="Presale.mintPurchase(${p.id})"
                                class="text-xs bg-green-600 hover:bg-green-700 px-2 py-1 rounded">
                            Mint
                        </button>
                    ` : ''}
                    ${p.mint_tx_hash ? `
                        <a href="https://polygonscan.com/tx/${p.mint_tx_hash}" target="_blank"
                           class="text-xs text-blue-400 hover:text-blue-300">View TX</a>
                    ` : ''}
                </td>
            </tr>
        `).join('');
    },

    renderBonusTiers() {
        const container = document.getElementById('bonusTiersContainer');
        if (!container) return;
        
        if (this.bonusTiers.length === 0) {
            container.innerHTML = '<p class="text-gray-400 text-sm">No bonus tiers configured</p>';
            return;
        }
        
        container.innerHTML = this.bonusTiers.map((tier, i) => `
            <div class="flex items-center gap-4 p-3 bg-gray-800/50 rounded-lg" data-tier-index="${i}">
                <div class="flex-1">
                    <label class="text-xs text-gray-400">Min EUR</label>
                    <input type="number" value="${tier.min_eur}" 
                           class="w-full bg-gray-700 rounded px-3 py-2 text-white tier-min-eur">
                </div>
                <div class="flex-1">
                    <label class="text-xs text-gray-400">Bonus %</label>
                    <input type="number" value="${tier.bonus_percent}" 
                           class="w-full bg-gray-700 rounded px-3 py-2 text-white tier-bonus-percent">
                </div>
                <button onclick="Presale.removeTier(${i})" class="text-red-400 hover:text-red-300 mt-5">
                    <span class="material-symbols-outlined">delete</span>
                </button>
            </div>
        `).join('');
    },

    addTier() {
        this.bonusTiers.push({ min_eur: 0, bonus_percent: 0 });
        this.renderBonusTiers();
    },

    removeTier(index) {
        this.bonusTiers.splice(index, 1);
        this.renderBonusTiers();
    },

    async saveBonusTiers() {
        // Collect values from inputs
        const tiers = [];
        document.querySelectorAll('[data-tier-index]').forEach(el => {
            const minEur = parseFloat(el.querySelector('.tier-min-eur').value) || 0;
            const bonusPercent = parseFloat(el.querySelector('.tier-bonus-percent').value) || 0;
            if (minEur > 0) {
                tiers.push({ min_eur: minEur, bonus_percent: bonusPercent });
            }
        });
        
        try {
            await API.saveBonusTiers(tiers);
            Utils.showToast('Bonus tiers saved!');
            this.load();
        } catch (error) {
            Utils.showToast('Failed to save: ' + error.message, 'error');
        }
    },

    async mintPurchase(purchaseId) {
        try {
            const result = await API.mintPurchase(purchaseId);
            if (result.success) {
                Utils.showToast(`Minted! TX: ${Utils.formatAddress(result.txHash, 8)}`);
                this.load();
            }
        } catch (error) {
            Utils.showToast('Mint failed: ' + error.message, 'error');
        }
    },

    async fulfillAll() {
        if (!await Utils.confirm('Fulfill all pending orders?')) return;
        
        try {
            Utils.showToast('Fulfilling orders...');
            const result = await API.fulfillAllOrders();
            Utils.showToast(`Fulfilled: ${result.fulfilled || 0}, Failed: ${result.failed || 0}`);
            this.load();
        } catch (error) {
            Utils.showToast('Fulfill failed: ' + error.message, 'error');
        }
    },

    async fulfillOrders() {
        if (!await Utils.confirm('Fulfill all pending orders?')) return;
        
        try {
            Utils.showToast('Fulfilling orders...');
            const result = await API.fulfillAllOrders();
            Utils.showToast(`Fulfilled: ${result.fulfilled || 0}, Failed: ${result.failed || 0}`);
            this.load();
        } catch (error) {
            Utils.showToast('Fulfill failed: ' + error.message, 'error');
        }
    },

    async mintPurchase(purchaseId) {
        if (!await Utils.confirm('Mint tokens for this purchase?')) return;
        
        try {
            const result = await API.mintPurchase(purchaseId);
            if (result.success) {
                Utils.showToast(`Minted! TX: ${Utils.formatAddress(result.txHash, 8)}`);
                this.load();
            } else {
                Utils.showToast(result.error || 'Mint failed', 'error');
            }
        } catch (error) {
            Utils.showToast('Mint failed: ' + error.message, 'error');
        }
    },

    exportCSV() {
        Utils.exportToCSV(this.purchases, 'presale_purchases');
    }
};

window.Presale = Presale;
