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
            tbody.innerHTML = '<tr><td colspan="7" class="py-8 text-center text-white">No memberships found</td></tr>';
            return;
        }
        
        tbody.innerHTML = filtered.map(m => {
            // Get member info from metadata or direct fields
            const metadata = typeof m.metadata === 'string' ? JSON.parse(m.metadata || '{}') : (m.metadata || {});
            const memberName = m.member_name || metadata.name || metadata.email || '';
            const memberEmail = m.member_email || metadata.email || '';
            const walletAddress = m.wallet_address || metadata.wallet_address || '';
            
            // Display: Name first, then email, then wallet as fallback
            let memberDisplay = '';
            if (memberName && memberName !== memberEmail) {
                memberDisplay = `
                    <div class="font-medium text-white">${Utils.escapeHtml(memberName)}</div>
                    ${memberEmail ? `<div class="text-xs text-white">${Utils.escapeHtml(memberEmail)}</div>` : ''}
                    <div class="text-xs text-white font-mono">${Utils.shortAddress(walletAddress)}</div>
                `;
            } else if (memberEmail) {
                memberDisplay = `
                    <div class="font-medium text-white">${Utils.escapeHtml(memberEmail)}</div>
                    <div class="text-xs text-white font-mono">${Utils.shortAddress(walletAddress)}</div>
                `;
            } else {
                memberDisplay = `
                    <div class="font-medium text-white">${Utils.shortAddress(walletAddress)}</div>
                `;
            }
            
            return `
                <tr class="border-t border-gray-800 hover:bg-gray-800/30">
                    <td class="py-4 px-4 font-medium">${m.order_number || m.id?.slice(0,8) || '-'}</td>
                    <td class="py-4 px-4">${memberDisplay}</td>
                    <td class="py-4 px-4">
                        <span class="capitalize font-medium">${m.package_name || m.package_type || '-'}</span>
                    </td>
                    <td class="py-4 px-4 font-medium">${Utils.formatCurrency(m.amount_paid)}</td>
                    <td class="py-4 px-4 text-primary font-medium">${Utils.formatCurrency(m.buying_power_granted || m.buying_power)}</td>
                    <td class="py-4 px-4"><span class="px-2 py-1 rounded-full text-xs status-${m.status}">${m.status}</span></td>
                    <td class="py-4 px-4 text-white">${Utils.formatDate(m.created_at)}</td>
                </tr>
            `;
        }).join('');
    },
    
    updateStats() {
        const completed = this.data.filter(m => m.status === 'completed');
        const revenue = completed.reduce((sum, m) => sum + parseFloat(m.amount_paid || 0), 0);
        
        const el = (id) => document.getElementById(id);
        if (el('membershipRevenue')) el('membershipRevenue').textContent = Utils.formatCurrency(revenue);
        if (el('membershipSilver')) el('membershipSilver').textContent = completed.filter(m => m.package_type === 'silver' || m.package?.includes('silver')).length;
        if (el('membershipGold')) el('membershipGold').textContent = completed.filter(m => m.package_type === 'gold' || m.package?.includes('gold')).length;
        if (el('membershipPlatinum')) el('membershipPlatinum').textContent = completed.filter(m => m.package_type === 'platinum' || m.package?.includes('platinum')).length;
    },
    
    filter() { this.render(); },
    export() { Utils.exportToCSV(this.data, 'memberships'); }
};
