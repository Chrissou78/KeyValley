// Admins Panel
const Admins = {
    data: [],
    
    async load() {
        console.log('Loading admins...');
        const result = await API.get('/admins');
        this.data = result.success ? (result.admins || []) : [];
        this.render();
    },
    
    render() {
        const tbody = document.getElementById('adminsTableBody');
        if (!tbody) return;
        
        if (!this.data.length) {
            tbody.innerHTML = '<tr><td colspan="5" class="py-8 text-center text-white">No admins found</td></tr>';
            return;
        }
        
        const currentAdmin = Auth.getAdmin();
        tbody.innerHTML = this.data.map(a => `
            <tr class="border-t border-gray-800 hover:bg-gray-800/30">
                <td class="py-4 px-4">
                    <div class="font-mono text-sm">${a.wallet || a.email || '-'}</div>
                    ${a.name ? `<div class="text-xs text-white">${a.name}</div>` : ''}
                </td>
                <td class="py-4 px-4">
                    <span class="px-2 py-1 rounded-full text-xs ${a.role === 'super_admin' ? 'bg-purple-500/20 text-purple-400' : 'bg-blue-500/20 text-blue-400'}">
                        ${a.role}
                    </span>
                </td>
                <td class="py-4 px-4 text-white">${a.last_login ? Utils.formatDateTime(a.last_login) : 'Never'}</td>
                <td class="py-4 px-4 text-white">${Utils.formatDate(a.created_at)}</td>
                <td class="py-4 px-4">
                    ${(a.wallet !== currentAdmin?.wallet && a.id !== currentAdmin?.id) 
                        ? `<button onclick="Admins.remove('${a.id}')" class="text-red-400 hover:text-red-300 text-sm">Remove</button>` 
                        : '<span class="text-white text-sm">Current</span>'}
                </td>
            </tr>
        `).join('');
    },
    
    async add() {
        const wallet = document.getElementById('newAdminWallet')?.value;
        const role = document.getElementById('newAdminRole')?.value;
        
        if (!wallet || !wallet.startsWith('0x')) { 
            Utils.showToast('Valid wallet address required', 'error'); 
            return; 
        }
        
        const res = await API.post('/admins', { wallet, role });
        if (res.success) {
            Utils.showToast('Admin added');
            document.getElementById('newAdminWallet').value = '';
            this.load();
        } else {
            Utils.showToast(res.error || 'Failed', 'error');
        }
    },
    
    async remove(id) {
        if (!confirm('Remove this admin?')) return;
        const res = await API.delete(`/admins/${id}`);
        if (res.success) { Utils.showToast('Admin removed'); this.load(); }
        else { Utils.showToast(res.error || 'Failed', 'error'); }
    }
};
