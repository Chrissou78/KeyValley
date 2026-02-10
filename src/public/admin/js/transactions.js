// transactions.js - Transaction management

const Transactions = {
    transactions: [],
    stats: {},
    filter: 'all',

    async load() {
        Utils.showLoading('transactionsTableBody', 'Loading transactions...');
        
        try {
            const data = await API.getTransactions();
            this.transactions = data.transactions || [];
            this.stats = data.stats || {};
            this.updateStats();
            this.render();
        } catch (error) {
            Utils.showError('transactionsTableBody', 'Failed to load transactions');
        }
    },

    updateStats() {
        const setEl = (id, value) => {
            const el = document.getElementById(id);
            if (el) el.textContent = value;
        };
        
        setEl('txTotal', this.stats.total || 0);
        setEl('txConfirmed', this.stats.confirmed || 0);
        setEl('txPending', this.stats.pending || 0);
        setEl('txFailed', this.stats.failed || 0);
        setEl('txTimeout', this.stats.timeout || 0);
    },

    setFilter(status) {
        this.filter = status;
        
        // Update filter buttons
        document.querySelectorAll('[data-tx-filter]').forEach(btn => {
            btn.classList.toggle('bg-blue-600', btn.dataset.txFilter === status);
            btn.classList.toggle('bg-gray-700', btn.dataset.txFilter !== status);
        });
        
        this.render();
    },

    render() {
        const tbody = document.getElementById('transactionsTableBody');
        if (!tbody) return;
        
        let filtered = this.transactions;
        if (this.filter !== 'all') {
            filtered = filtered.filter(t => t.tx_status === this.filter);
        }
        
        if (filtered.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" class="text-center py-8 text-gray-400">No transactions found</td></tr>';
            return;
        }
        
        tbody.innerHTML = filtered.map(t => {
            const age = t.minted_at ? this.getAge(t.minted_at) : '-';
            
            return `
                <tr class="border-b border-gray-700/50 hover:bg-white/5">
                    <td class="py-3 px-4">
                        <code class="text-xs bg-gray-800 px-2 py-1 rounded cursor-pointer"
                              onclick="Utils.copyToClipboard('${t.wallet_address}')">
                            ${Utils.formatAddress(t.wallet_address)}
                        </code>
                    </td>
                    <td class="py-3 px-4 text-sm">${t.email || '-'}</td>
                    <td class="py-3 px-4">
                        ${t.tx_hash ? `
                            <a href="https://polygonscan.com/tx/${t.tx_hash}" target="_blank"
                               class="text-blue-400 hover:text-blue-300 text-xs">
                                ${Utils.formatAddress(t.tx_hash, 8)}
                            </a>
                        ` : '-'}
                    </td>
                    <td class="py-3 px-4">${Utils.getStatusBadge(t.tx_status)}</td>
                    <td class="py-3 px-4 text-sm text-gray-400">${Utils.formatDate(t.minted_at)}</td>
                    <td class="py-3 px-4 text-sm text-gray-400">${age}</td>
                    <td class="py-3 px-4">
                        ${['failed', 'timeout'].includes(t.tx_status) ? `
                            <button onclick="Transactions.retrySingle('${t.wallet_address}')"
                                    class="text-xs bg-orange-600 hover:bg-orange-700 px-2 py-1 rounded">
                                Retry
                            </button>
                        ` : ''}
                        ${t.tx_status === 'pending' && t.tx_hash ? `
                            <button onclick="Transactions.checkSingle('${t.wallet_address}')"
                                    class="text-xs bg-blue-600 hover:bg-blue-700 px-2 py-1 rounded">
                                Check
                            </button>
                        ` : ''}
                    </td>
                </tr>
            `;
        }).join('');
    },

    getAge(dateStr) {
        const mins = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000);
        if (mins < 60) return `${mins}m`;
        if (mins < 1440) return `${Math.floor(mins / 60)}h`;
        return `${Math.floor(mins / 1440)}d`;
    },

    async checkAll() {
        try {
            Utils.showToast('Checking all pending transactions...');
            const result = await API.checkAllTransactions();
            Utils.showToast(`Done! Confirmed: ${result.results?.confirmed || 0}, Failed: ${result.results?.failed || 0}`);
            this.load();
        } catch (error) {
            Utils.showToast('Check failed: ' + error.message, 'error');
        }
    },

    async retryAll() {
        if (!await Utils.confirm('Retry all failed/timeout mints?')) return;
        
        try {
            Utils.showToast('Retrying failed mints...');
            const result = await API.retryFailedMints();
            Utils.showToast(`Retried: ${result.retried || 0}`);
            this.load();
        } catch (error) {
            Utils.showToast('Retry failed: ' + error.message, 'error');
        }
    },

    async retrySingle(wallet) {
        try {
            const result = await API.retrySingleMint(wallet);
            if (result.success) {
                Utils.showToast(`Retry initiated! TX: ${Utils.formatAddress(result.tx_hash, 8)}`);
                this.load();
            }
        } catch (error) {
            Utils.showToast('Retry failed: ' + error.message, 'error');
        }
    },

    async checkSingle(wallet) {
        Utils.showToast('Checking transaction status...');
        // This will be handled by the load refresh
        this.load();
    }
};

window.Transactions = Transactions;
