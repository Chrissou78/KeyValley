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
            tbody.innerHTML = '<tr><td colspan="7" class="py-8 text-center text-white">No members found</td></tr>';
            return;
        }
        
        tbody.innerHTML = filtered.map(m => {
            // Name first, email second, wallet truncated under name
            const displayName = m.name || m.email || 'Unknown';
            const initial = (m.name || m.email || m.wallet_address || '?')[0].toUpperCase();
            
            return `
                <tr class="border-t border-gray-800 hover:bg-gray-800/30">
                    <td class="py-4 px-4">
                        <div class="flex items-center gap-3">
                            <div class="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold">
                                ${initial}
                            </div>
                            <div>
                                <div class="font-medium text-white">${Utils.escapeHtml(displayName)}</div>
                                <div class="text-xs text-white font-mono">${Utils.shortAddress(m.wallet_address)}</div>
                            </div>
                        </div>
                    </td>
                    <td class="py-4 px-4 text-white">${m.email || '-'}</td>
                    <td class="py-4 px-4 font-medium text-primary">${Utils.formatCurrency(m.balance)}</td>
                    <td class="py-4 px-4">${Utils.formatCurrency(m.total_spent)}</td>
                    <td class="py-4 px-4">${m.order_count || 0}</td>
                    <td class="py-4 px-4 text-white">${Utils.formatDate(m.created_at)}</td>
                    <td class="py-4 px-4">
                        <button onclick="Members.view('${m.wallet_address}')" class="text-primary hover:text-primary-light text-sm font-medium">View</button>
                    </td>
                </tr>
            `;
        }).join('');
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
        
        const displayName = member.name || member.email || 'Member';
        const initial = (member.name || member.email || '?')[0].toUpperCase();
        
        const content = document.getElementById('memberModalContent');
        if (!content) return;
        
        content.innerHTML = `
            <div class="space-y-6">
                <!-- Member Header -->
                <div class="flex items-center gap-4">
                    <div class="w-16 h-16 rounded-full bg-primary/20 flex items-center justify-center text-primary text-2xl font-bold">
                        ${initial}
                    </div>
                    <div>
                        <h3 class="text-xl font-bold">${Utils.escapeHtml(displayName)}</h3>
                        ${member.email ? `<p class="text-white">${Utils.escapeHtml(member.email)}</p>` : ''}
                        <p class="text-white font-mono text-sm">${member.wallet_address}</p>
                    </div>
                </div>
                
                <!-- Stats -->
                <div class="grid grid-cols-3 gap-4">
                    <div class="p-4 bg-gray-800/50 rounded-lg text-center">
                        <p class="text-white text-sm">Kea Euros</p>
                        <p class="text-2xl font-bold text-primary" id="modalBalance">${Utils.formatCurrency(member.balance)}</p>
                    </div>
                    <div class="p-4 bg-gray-800/50 rounded-lg text-center">
                        <p class="text-white text-sm">Total Credited</p>
                        <p class="text-2xl font-bold text-green-400">${Utils.formatCurrency(member.total_credited || 0)}</p>
                    </div>
                    <div class="p-4 bg-gray-800/50 rounded-lg text-center">
                        <p class="text-white text-sm">Total Spent</p>
                        <p class="text-2xl font-bold">${Utils.formatCurrency(member.total_spent || 0)}</p>
                    </div>
                </div>
                
                <!-- Add/Remove Kea Euros -->
                <div class="border-t border-gray-700 pt-6">
                    <h4 class="font-semibold mb-4 flex items-center gap-2">
                        <span class="material-symbols-outlined text-primary">account_balance_wallet</span>
                        Adjust Kea Euros
                    </h4>
                    
                    <div class="grid grid-cols-2 gap-4 mb-4">
                        <!-- Add Kea Euros (Mint) -->
                        <div class="p-4 bg-green-500/10 border border-green-500/30 rounded-lg">
                            <h5 class="text-green-400 font-medium mb-3 flex items-center gap-2">
                                <span class="material-symbols-outlined">add_circle</span>
                                Add Kea Euros
                            </h5>
                            <p class="text-white text-xs mb-3">Mints new tokens to member's wallet</p>
                            <div class="flex gap-2">
                                <input type="number" id="addAmount" min="1" step="1" 
                                       class="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm" 
                                       placeholder="Amount">
                                <button onclick="Members.addBalance('${wallet}')" 
                                        class="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg text-sm font-medium">
                                    Add
                                </button>
                            </div>
                        </div>
                        
                        <!-- Remove Kea Euros (DB only) -->
                        <div class="p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
                            <h5 class="text-red-400 font-medium mb-3 flex items-center gap-2">
                                <span class="material-symbols-outlined">remove_circle</span>
                                Remove Kea Euros
                            </h5>
                            <p class="text-white text-xs mb-3">Deducts from DB balance (tokens logged, not burned)</p>
                            <div class="flex gap-2">
                                <input type="number" id="removeAmount" min="1" step="1" 
                                       class="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm" 
                                       placeholder="Amount">
                                <button onclick="Members.removeBalance('${wallet}')" 
                                        class="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg text-sm font-medium">
                                    Remove
                                </button>
                            </div>
                        </div>
                    </div>
                    
                    <!-- Reason field -->
                    <div>
                        <label class="text-white text-sm block mb-2">Reason (optional)</label>
                        <input type="text" id="adjustReason" 
                               class="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-sm" 
                               placeholder="e.g., Refund, Manual correction, Bonus...">
                    </div>
                </div>
                
                <!-- Recent Activity -->
                <div class="border-t border-gray-700 pt-6">
                    <h4 class="font-semibold mb-3">Member Info</h4>
                    <div class="text-sm text-white space-y-2">
                        <p><span class="text-white">Orders:</span> ${member.order_count || 0}</p>
                        <p><span class="text-white">Vouchers:</span> ${member.voucher_count || 0}</p>
                        <p><span class="text-white">Joined:</span> ${Utils.formatDate(member.created_at)}</p>
                    </div>
                </div>
            </div>
        `;
        document.getElementById('memberModal')?.classList.remove('hidden');
    },
    
    // Add Kea Euros (mints tokens)
    async addBalance(wallet) {
        const amount = parseFloat(document.getElementById('addAmount')?.value);
        const reason = document.getElementById('adjustReason')?.value || 'Manual addition';
        
        if (!amount || amount <= 0) { 
            Utils.showToast('Enter a valid positive amount', 'error'); 
            return; 
        }
        
        const res = await API.post('/members/add-balance', { 
            wallet_address: wallet, 
            amount: amount,
            reason: reason
        });
        
        if (res.success) {
            Utils.showToast(`Added ${Utils.formatCurrency(amount)} Kea Euros`, 'success');
            document.getElementById('addAmount').value = '';
            document.getElementById('adjustReason').value = '';
            // Update the modal balance display
            const balanceEl = document.getElementById('modalBalance');
            if (balanceEl && res.new_balance !== undefined) {
                balanceEl.textContent = Utils.formatCurrency(res.new_balance);
            }
            // Reload data
            await this.load();
        } else {
            Utils.showToast(res.error || 'Failed to add balance', 'error');
        }
    },
    
    // Remove Kea Euros (DB only, logs consumed tokens)
    async removeBalance(wallet) {
        const amount = parseFloat(document.getElementById('removeAmount')?.value);
        const reason = document.getElementById('adjustReason')?.value || 'Manual deduction';
        
        if (!amount || amount <= 0) { 
            Utils.showToast('Enter a valid positive amount', 'error'); 
            return; 
        }
        
        const res = await API.post('/members/remove-balance', { 
            wallet_address: wallet, 
            amount: amount,
            reason: reason
        });
        
        if (res.success) {
            Utils.showToast(`Removed ${Utils.formatCurrency(amount)} Kea Euros`, 'success');
            document.getElementById('removeAmount').value = '';
            document.getElementById('adjustReason').value = '';
            // Update the modal balance display
            const balanceEl = document.getElementById('modalBalance');
            if (balanceEl && res.new_balance !== undefined) {
                balanceEl.textContent = Utils.formatCurrency(res.new_balance);
            }
            // Reload data
            await this.load();
        } else {
            Utils.showToast(res.error || 'Failed to remove balance', 'error');
        }
    },
    
    // Legacy method for backward compatibility
    async adjustBalance(wallet) {
        const amount = parseFloat(document.getElementById('adjustAmount')?.value);
        if (isNaN(amount)) { 
            Utils.showToast('Enter valid amount', 'error'); 
            return; 
        }
        
        if (amount > 0) {
            document.getElementById('addAmount').value = amount;
            await this.addBalance(wallet);
        } else if (amount < 0) {
            document.getElementById('removeAmount').value = Math.abs(amount);
            await this.removeBalance(wallet);
        }
    },
    
    closeModal() { 
        document.getElementById('memberModal')?.classList.add('hidden'); 
    },
    
    export() { 
        Utils.exportToCSV(this.data, 'members'); 
    }
};
