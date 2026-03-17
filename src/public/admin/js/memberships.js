// Memberships Panel
const Memberships = {
    data: [],
    
    async load() {
        console.log('Loading memberships...');
        const result = await API.get('/memberships');
        this.data = result.success ? (result.memberships || []) : [];
        this.render();
        this.updateStats();
    },
    
    render() {
        const filter = document.getElementById('membershipStatusFilter')?.value || 'all';
        const filtered = filter === 'all' ? this.data : this.data.filter(m => m.status === filter);
        
        const tbody = document.getElementById('membershipsTableBody');
        if (!tbody) return;
        
        if (!filtered.length) {
            tbody.innerHTML = '<tr><td colspan="7" class="py-8 text-center text-gray-500">No memberships found</td></tr>';
            return;
        }
        
        tbody.innerHTML = filtered.map(m => `
            <tr class="border-t border-gray-800 hover:bg-gray-800/30">
                <td class="py-4 px-4 font-medium">${m.order_number || m.id?.slice(0,8) || '-'}</td>
                <td class="py-4 px-4">${Utils.shortAddress(m.wallet_address)}</td>
                <td class="py-4 px-4 capitalize">${m.package_type || '-'}</td>
                <td class="py-4 px-4 font-medium">${Utils.formatCurrency(m.amount_paid)}</td>
                <td class="py-4 px-4 text-primary font-medium">${Utils.formatCurrency(m.buying_power)}</td>
                <td class="py-4 px-4"><span class="px-2 py-1 rounded-full text-xs status-${m.status}">${m.status}</span></td>
                <td class="py-4 px-4 text-gray-400">${Utils.formatDate(m.created_at)}</td>
            </tr>
        `).join('');
    },
    
    updateStats() {
        const completed = this.data.filter(m => m.status === 'completed');
        const revenue = completed.reduce((sum, m) => sum + parseFloat(m.amount_paid || 0), 0);
        
        const el = (id) => document.getElementById(id);
        if (el('membershipRevenue')) el('membershipRevenue').textContent = Utils.formatCurrency(revenue);
        if (el('membershipSilver')) el('membershipSilver').textContent = completed.filter(m => m.package_type === 'silver').length;
        if (el('membershipGold')) el('membershipGold').textContent = completed.filter(m => m.package_type === 'gold').length;
        if (el('membershipPlatinum')) el('membershipPlatinum').textContent = completed.filter(m => m.package_type === 'platinum').length;
    },
    
    filter() { this.render(); },
    export() { Utils.exportToCSV(this.data, 'memberships'); }
};
