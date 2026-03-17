// Vouchers Panel
const Vouchers = {
    data: [],
    
    async load() {
        console.log('Loading vouchers...');
        const result = await API.get('/vouchers');
        this.data = result.success ? (result.vouchers || []) : [];
        this.render();
        this.updateStats();
    },
    
    render() {
        const filter = document.getElementById('voucherStatusFilter')?.value || 'all';
        const filtered = filter === 'all' ? this.data : this.data.filter(v => v.status === filter);
        
        const tbody = document.getElementById('vouchersTableBody');
        if (!tbody) return;
        
        if (!filtered.length) {
            tbody.innerHTML = '<tr><td colspan="7" class="py-8 text-center text-gray-500">No vouchers found</td></tr>';
            return;
        }
        
        tbody.innerHTML = filtered.map(v => `
            <tr class="border-t border-gray-800 hover:bg-gray-800/30">
                <td class="py-4 px-4 font-mono font-medium">${v.code}</td>
                <td class="py-4 px-4">${v.service_name || '-'}</td>
                <td class="py-4 px-4">${Utils.shortAddress(v.wallet_address)}</td>
                <td class="py-4 px-4 font-medium">${Utils.formatCurrency(v.value)}</td>
                <td class="py-4 px-4"><span class="px-2 py-1 rounded-full text-xs status-${v.status}">${v.status}</span></td>
                <td class="py-4 px-4 text-gray-400">${Utils.formatDate(v.valid_until)}</td>
                <td class="py-4 px-4">${v.status === 'active' ? `<button onclick="Vouchers.redeem('${v.id}')" class="text-primary hover:text-primary-light text-sm">Redeem</button>` : '-'}</td>
            </tr>
        `).join('');
    },
    
    updateStats() {
        const totalValue = this.data.reduce((sum, v) => sum + parseFloat(v.value || 0), 0);
        const el = (id) => document.getElementById(id);
        if (el('vouchersTotal')) el('vouchersTotal').textContent = this.data.length;
        if (el('vouchersActive')) el('vouchersActive').textContent = this.data.filter(v => v.status === 'active').length;
        if (el('vouchersRedeemed')) el('vouchersRedeemed').textContent = this.data.filter(v => v.status === 'redeemed').length;
        if (el('vouchersValue')) el('vouchersValue').textContent = Utils.formatCurrency(totalValue);
    },
    
    filter() { this.render(); },
    
    async redeem(id) {
        if (!confirm('Mark as redeemed?')) return;
        const res = await API.post(`/vouchers/${id}/redeem`);
        if (res.success) { Utils.showToast('Voucher redeemed'); this.load(); }
        else { Utils.showToast(res.error || 'Failed', 'error'); }
    },
    
    export() { Utils.exportToCSV(this.data, 'vouchers'); }
};
