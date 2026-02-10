// claims.js - Claims/Registrants management

const Claims = {
    registrants: [],
    
    async load() {
        Utils.showLoading('claimsTableBody', 'Loading registrants...');
        
        try {
            const [registrantsData, statsData] = await Promise.all([
                API.getRegistrants(),
                API.getStats()
            ]);
            
            this.registrants = registrantsData.registrants || [];
            this.updateStats(statsData, this.registrants);
            this.render();
        } catch (error) {
            Utils.showError('claimsTableBody', 'Failed to load registrants');
        }
    },

    updateStats(stats, registrants) {
        const setEl = (id, value) => {
            const el = document.getElementById(id);
            if (el) el.textContent = value;
        };
        
        setEl('totalRegistrants', registrants.length);
        setEl('mintedCount', stats.minted || registrants.filter(r => r.minted).length);
        setEl('pendingCount', stats.pending || registrants.filter(r => !r.minted).length);
        
        const withBalance = registrants.filter(r => parseFloat(r.balance) > 0).length;
        setEl('withBalanceCount', withBalance);
    },

    render() {
        const tbody = document.getElementById('claimsTableBody');
        if (!tbody) return;
        
        if (this.registrants.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="text-center py-8 text-gray-400">No registrants found</td></tr>';
            return;
        }
        
        tbody.innerHTML = this.registrants.map(r => `
            <tr class="border-b border-gray-700/50 hover:bg-white/5">
                <td class="py-3 px-4">
                    <div class="text-sm">${r.email || '-'}</div>
                </td>
                <td class="py-3 px-4">
                    <code class="text-xs bg-gray-800 px-2 py-1 rounded cursor-pointer" 
                          onclick="Utils.copyToClipboard('${r.wallet_address || r.address}')"
                          title="Click to copy">
                        ${Utils.formatAddress(r.wallet_address || r.address)}
                    </code>
                </td>
                <td class="py-3 px-4">
                    ${Utils.getStatusBadge(r.minted ? 'minted' : 'pending')}
                </td>
                <td class="py-3 px-4">
                    ${r.tx_hash ? `
                        <a href="https://polygonscan.com/tx/${r.tx_hash}" target="_blank" 
                           class="text-blue-400 hover:text-blue-300 text-xs">
                            ${Utils.formatAddress(r.tx_hash, 8)}
                        </a>
                    ` : '-'}
                </td>
                <td class="py-3 px-4 text-sm text-gray-400">
                    ${Utils.formatDate(r.registered_at || r.created_at)}
                </td>
                <td class="py-3 px-4">
                    ${!r.minted ? `
                        <button onclick="Claims.mintSingle('${r.wallet_address || r.address}')"
                                class="text-xs bg-blue-600 hover:bg-blue-700 px-2 py-1 rounded">
                            Mint
                        </button>
                    ` : ''}
                </td>
            </tr>
        `).join('');
    },

    async mintSingle(address) {
        if (!await Utils.confirm(`Mint tokens to ${Utils.formatAddress(address)}?`)) return;
        
        try {
            const result = await API.manualMint(address);
            if (result.success) {
                Utils.showToast(`Minted! TX: ${Utils.formatAddress(result.tx_hash, 8)}`);
                this.load(); // Refresh
            } else {
                Utils.showToast(result.error || 'Mint failed', 'error');
            }
        } catch (error) {
            Utils.showToast(error.message, 'error');
        }
    },

    async fullSync() {
        const btn = document.getElementById('fullSyncBtn');
        if (btn) btn.disabled = true;
        
        try {
            Utils.showToast('Starting full sync...');
            const result = await API.fullSync();
            Utils.showToast(`Sync complete! Updated: ${result.results?.updated || 0}`);
            this.load();
        } catch (error) {
            Utils.showToast('Sync failed: ' + error.message, 'error');
        } finally {
            if (btn) btn.disabled = false;
        }
    },

    async syncMembers() {
        try {
            Utils.showToast('Syncing from WalletTwo...');
            const data = await API.syncMembers();
            
            if (data.success) {
                Utils.showToast(`Synced: ${data.synced} new, ${data.updated} updated`);
                this.load();
            } else {
                Utils.showToast('Sync failed: ' + data.error, 'error');
            }
        } catch (error) {
            Utils.showToast('Sync error: ' + error.message, 'error');
        }
    },

    openFullSyncModal() {
        const modal = document.getElementById('fullsync-modal');
        if (modal) modal.classList.add('active');
        this.performFullSync();
    },

    closeFullSyncModal() {
        const modal = document.getElementById('fullsync-modal');
        if (modal) modal.classList.remove('active');
    },

    async performFullSync() {
        const content = document.getElementById('fullsync-content');
        if (!content) return;
        
        content.innerHTML = `
            <div class="text-center text-white/40 py-8">
                <div class="animate-spin w-8 h-8 border-2 border-white/20 border-t-[#ee9d2b] rounded-full mx-auto mb-4"></div>
                Running sync...
            </div>
        `;
        
        try {
            const data = await API.fullSync();
            const results = data.results || data;
            const registrants = results.registrants || [];
            
            content.innerHTML = `
                <div class="grid grid-cols-3 gap-4 mb-6">
                    <div class="text-center p-4 bg-white/5 rounded-lg">
                        <div class="text-2xl font-bold">${results.total || registrants.length || 0}</div>
                        <div class="text-white/40 text-sm">Total</div>
                    </div>
                    <div class="text-center p-4 bg-white/5 rounded-lg">
                        <div class="text-2xl font-bold text-green-400">${results.withBalance || 0}</div>
                        <div class="text-white/40 text-sm">With Balance</div>
                    </div>
                    <div class="text-center p-4 bg-white/5 rounded-lg">
                        <div class="text-2xl font-bold text-yellow-400">${results.updated || 0}</div>
                        <div class="text-white/40 text-sm">Updated</div>
                    </div>
                </div>
                
                <div class="max-h-64 overflow-y-auto">
                    <table class="data-table">
                        <thead>
                            <tr>
                                <th>Email</th>
                                <th>Address</th>
                                <th>Balance</th>
                                <th>Status</th>
                                <th>TX Hash</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${registrants.map(r => {
                                const email = r.email || '--';
                                const addr = r.wallet_address || r.address || '--';
                                const txHash = r.tx_hash || '';
                                const balance = parseFloat(r.balance || 0);
                                const minted = r.minted || balance > 0;
                                
                                return `
                                    <tr>
                                        <td class="text-sm">${email !== '--' ? email.substring(0, 20) + (email.length > 20 ? '...' : '') : '--'}</td>
                                        <td>
                                            <a href="https://polygonscan.com/address/${addr}" target="_blank" class="text-blue-400 hover:underline font-mono text-xs">
                                                ${addr.substring(0, 6)}...${addr.substring(addr.length - 4)}
                                            </a>
                                        </td>
                                        <td class="${balance > 0 ? 'text-green-400' : 'text-white/40'}">${balance.toLocaleString()} VIP</td>
                                        <td><span class="badge ${minted ? 'badge-success' : 'badge-warning'}">${minted ? 'Minted' : 'Pending'}</span></td>
                                        <td>
                                            ${txHash ? `
                                                <a href="https://polygonscan.com/tx/${txHash}" target="_blank" class="text-blue-400 hover:underline font-mono text-xs">
                                                    ${txHash.substring(0, 8)}...
                                                </a>
                                            ` : '--'}
                                        </td>
                                    </tr>
                                `;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
            `;
            
            this.load(); // Refresh main data
            
        } catch (error) {
            console.error('Full sync error:', error);
            content.innerHTML = `
                <div class="text-center text-red-400 py-8">
                    <p class="mb-2">Error running sync</p>
                    <p class="text-sm text-white/40">${error.message}</p>
                </div>
            `;
        }
    },

    exportCSV() {
        Utils.exportToCSV(this.registrants.map(r => ({
            email: r.email || '',
            wallet: r.wallet_address || r.address,
            minted: r.minted ? 'Yes' : 'No',
            tx_hash: r.tx_hash || '',
            registered_at: r.registered_at || r.created_at
        })), 'registrants');
    }
};

window.Claims = Claims;
