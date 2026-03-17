// Members Panel
const Members = {
    data: [],
    
    async load() {
        console.log('Loading members...');
        const result = await API.get('/members');
        this.data = result.success ? (result.members || []) : [];
        this.render();
        this.updateStats();
    },
    
    render() {
        const search = document.getElementById('memberSearch')?.value?.toLowerCase() || '';
        const filtered = search 
            ? this.data.filter(m => 
                (m.email && m.email.toLowerCase().includes(search)) || 
                (m.wallet_address && m.wallet_address.toLowerCase().includes(search)) ||
                (m.name && m.name.toLowerCase().includes(search)))
            : this.data;
        
        const tbody = document.getElementById('membersTableBody');
        if (!tbody) return;
        
        if (!filtered.length) {
            tbody.innerHTML = '<tr><td colspan="7" class="py-8 text-center text-gray-500">No members found</td></tr>';
            return;
        }
        
        tbody.innerHTML = filtered.map(m => `
            <tr class="border-t border-gray-800 hover:bg-gray-800/30">
                <td class="py-4 px-4">
                    <div class="flex items-center gap-3">
                        <div class="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold">
                            ${(m.name || m.email || m.wallet_address || '?')[0].toUpperCase()}
                        </div>
                        <div>
                            <div class="font-medium">${m.name || Utils.shortAddress(m.wallet_address)}</div>
                            <div class="text-xs text-gray-500 font-mono">${Utils.shortAddress(m.wallet_address)}</div>
                        </div>
                    </div>
                </td>
                <td class="py-4 px-4 text-gray-400">${m.email || '-'}</td>
                <td class="py-4 px-4 font-medium text-primary">${Utils.formatCurrency(m.balance)}</td>
                <td class="py-4 px-4">${Utils.formatCurrency(m.total_spent)}</td>
                <td class="py-4 px-4">${m.order_count || 0}</td>
                <td class="py-4 px-4 text-gray-400">${Utils.formatDate(m.created_at)}</td>
                <td class="py-4 px-4">
                    <button onclick="Members.view('${m.wallet_address}')" class="text-primary hover:text-primary-light text-sm">View</button>
                </td>
            </tr>
        `).join('');
    },
    
    updateStats() {
        const withBalance = this.data.filter(m => parseFloat(m.balance || 0) > 0);
        const totalBP = this.data.reduce((sum, m) => sum + parseFloat(m.balance || 0), 0);
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const newThisMonth = this.data.filter(m => new Date(m.created_at) >= monthStart).length;
        
        const el = (id) => document.getElementById(id);
        if (el('membersTotal')) el('membersTotal').textContent = this.data.length;
        if (el('membersWithBalance')) el('membersWithBalance').textContent = withBalance.length;
        if (el('totalBuyingPower')) el('totalBuyingPower').textContent = Utils.formatCurrency(totalBP);
        if (el('membersThisMonth')) el('membersThisMonth').textContent = newThisMonth;
    },
    
    search() { this.render(); },
    
    async view(wallet) {
        const member = this.data.find(m => m.wallet_address === wallet);
        if (!member) return;
        
        const content = document.getElementById('memberModalContent');
        if (!content) return;
        
        content.innerHTML = `
            <div class="space-y-6">
                <div class="flex items-center gap-4">
                    <div class="w-16 h-16 rounded-full bg-primary/20 flex items-center justify-center text-primary text-2xl font-bold">
                        ${(member.name || member.email || '?')[0].toUpperCase()}
                    </div>
                    <div>
                        <h3 class="text-xl font-bold">${member.name || 'Member'}</h3>
                        <p class="text-gray-400 font-mono text-sm">${member.wallet_address}</p>
                    </div>
                </div>
                <div class="grid grid-cols-2 gap-4">
                    <div class="p-4 bg-gray-800/50 rounded-lg">
                        <p class="text-gray-400 text-sm">Buying Power</p>
                        <p class="text-2xl font-bold text-primary">${Utils.formatCurrency(member.balance)}</p>
                    </div>
                    <div class="p-4 bg-gray-800/50 rounded-lg">
                        <p class="text-gray-400 text-sm">Total Spent</p>
                        <p class="text-2xl font-bold">${Utils.formatCurrency(member.total_spent)}</p>
                    </div>
                </div>
                <div>
                    <h4 class="font-semibold mb-3">Adjust Buying Power</h4>
                    <div class="flex gap-2">
                        <input type="number" id="adjustAmount" class="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-4 py-2" placeholder="Amount (+ or -)">
                        <button onclick="Members.adjustBalance('${wallet}')" class="bg-primary hover:bg-primary-light text-black px-4 py-2 rounded-lg font-medium">Adjust</button>
                    </div>
                </div>
            </div>
        `;
        document.getElementById('memberModal')?.classList.remove('hidden');
    },
    
    async adjustBalance(wallet) {
        const amount = parseFloat(document.getElementById('adjustAmount')?.value);
        if (isNaN(amount)) { Utils.showToast('Enter valid amount', 'error'); return; }
        
        const res = await API.post('/members/adjust-balance', { wallet_address: wallet, amount });
        if (res.success) {
            Utils.showToast('Balance adjusted');
            this.closeModal();
            this.load();
        } else {
            Utils.showToast(res.error || 'Failed', 'error');
        }
    },
    
    closeModal() { document.getElementById('memberModal')?.classList.add('hidden'); },
    export() { Utils.exportToCSV(this.data, 'members'); }
};
