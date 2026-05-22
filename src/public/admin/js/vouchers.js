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
        const search = document.getElementById('voucherSearch')?.value?.toLowerCase() || '';
        
        let filtered = filter === 'all' ? this.data : this.data.filter(v => v.status === filter);
        
        // Apply search filter
        if (search) {
            filtered = filtered.filter(v => 
                v.code?.toLowerCase().includes(search) ||
                v.service_name?.toLowerCase().includes(search) ||
                v.member_name?.toLowerCase().includes(search) ||
                v.member_email?.toLowerCase().includes(search) ||
                v.wallet_address?.toLowerCase().includes(search)
            );
        }
        
        const tbody = document.getElementById('vouchersTableBody');
        if (!tbody) return;
        
        if (!filtered.length) {
            tbody.innerHTML = '<tr><td colspan="8" class="py-8 text-center text-gray-500">No vouchers found</td></tr>';
            return;
        }
        
        tbody.innerHTML = filtered.map(v => {
            // Get member display name
            const memberName = v.member_name || '';
            const memberEmail = v.member_email || '';
            const walletShort = Utils.shortAddress(v.wallet_address);
            
            // Display: Name first, then email, then wallet
            let memberDisplay = '';
            if (memberName && memberName !== memberEmail) {
                memberDisplay = `
                    <div class="font-medium">${this.escapeHtml(memberName)}</div>
                    <div class="text-xs text-gray-500">${memberEmail || walletShort}</div>
                `;
            } else if (memberEmail) {
                memberDisplay = `
                    <div class="font-medium">${memberEmail}</div>
                    <div class="text-xs text-gray-500">${walletShort}</div>
                `;
            } else {
                memberDisplay = `<div class="font-medium">${walletShort}</div>`;
            }
            
            // Status badge colors
            const statusColors = {
                'active': 'bg-green-500/20 text-green-400',
                'pending_validation': 'bg-yellow-500/20 text-yellow-400',
                'redeemed': 'bg-blue-500/20 text-blue-400',
                'used': 'bg-gray-500/20 text-gray-400',
                'expired': 'bg-red-500/20 text-red-400'
            };
            const statusClass = statusColors[v.status] || 'bg-gray-500/20 text-gray-400';
            const statusLabel = v.status?.replace('_', ' ') || 'unknown';
            
            // Check if expired
            const isExpired = v.valid_until && new Date(v.valid_until) < new Date();
            const expiryDisplay = v.valid_until 
                ? `<span class="${isExpired ? 'text-red-400' : 'text-gray-400'}">${Utils.formatDate(v.valid_until)}</span>`
                : '-';
            
            return `
                <tr class="border-t border-gray-800 hover:bg-gray-800/30">
                    <td class="py-4 px-4 font-mono font-medium text-sm">${v.code}</td>
                    <td class="py-4 px-4">${v.service_name || '-'}</td>
                    <td class="py-4 px-4">${memberDisplay}</td>
                    <td class="py-4 px-4 font-medium text-primary">${Utils.formatCurrency(v.value)}</td>
                    <td class="py-4 px-4">
                        <span class="px-2 py-1 rounded-full text-xs capitalize ${statusClass}">${statusLabel}</span>
                    </td>
                    <td class="py-4 px-4">${expiryDisplay}</td>
                    <td class="py-4 px-4 text-gray-400 text-sm">${Utils.formatDate(v.created_at)}</td>
                    <td class="py-4 px-4">
                        ${v.status === 'active' ? `
                            <button onclick="Vouchers.redeem('${v.id}')" class="text-primary hover:text-primary-light text-sm font-medium">
                                Redeem
                            </button>
                        ` : '-'}
                    </td>
                </tr>
            `;
        }).join('');
    },
    
    updateStats() {
        const active = this.data.filter(v => v.status === 'active');
        const redeemed = this.data.filter(v => v.status === 'redeemed' || v.status === 'used');
        const pending = this.data.filter(v => v.status === 'pending_validation');
        const totalValue = active.reduce((sum, v) => sum + parseFloat(v.value || 0), 0);
        
        const el = (id) => document.getElementById(id);
        if (el('vouchersTotal')) el('vouchersTotal').textContent = this.data.length;
        if (el('vouchersActive')) el('vouchersActive').textContent = active.length;
        if (el('vouchersRedeemed')) el('vouchersRedeemed').textContent = redeemed.length;
        if (el('vouchersPending')) el('vouchersPending').textContent = pending.length;
        if (el('vouchersValue')) el('vouchersValue').textContent = Utils.formatCurrency(totalValue);
    },
    
    filter() { this.render(); },
    
    search() { this.render(); },
    
    async redeem(id) {
        if (!confirm('Mark this voucher as redeemed?')) return;
        
        const res = await API.post(`/vouchers/${id}/redeem`);
        if (res.success) { 
            Utils.showToast('Voucher marked as redeemed', 'success'); 
            this.load(); 
        } else { 
            Utils.showToast(res.error || 'Failed to redeem voucher', 'error'); 
        }
    },
    
    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },
    
    export() { 
        // Include member info in export
        const exportData = this.data.map(v => ({
            code: v.code,
            service_name: v.service_name,
            member_name: v.member_name || '',
            member_email: v.member_email || '',
            wallet_address: v.wallet_address,
            value: v.value,
            status: v.status,
            valid_until: v.valid_until,
            created_at: v.created_at
        }));
        Utils.exportToCSV(exportData, 'vouchers'); 
    }
};
