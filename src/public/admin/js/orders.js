// Orders Panel
const Orders = {
    data: [],
    
    async load() {
        console.log('Loading orders...');
        const result = await API.get('/orders');
        this.data = result.success ? (result.orders || []) : [];
        this.render();
        this.updateStats();
    },
    
    render() {
        const filter = document.getElementById('orderStatusFilter')?.value || 'all';
        const search = document.getElementById('orderSearch')?.value?.toLowerCase() || '';
        
        let filtered = filter === 'all' ? this.data : this.data.filter(o => o.status === filter);
        
        // Apply search
        if (search) {
            filtered = filtered.filter(o => 
                o.order_number?.toLowerCase().includes(search) ||
                o.member_name?.toLowerCase().includes(search) ||
                o.member_email?.toLowerCase().includes(search) ||
                o.email?.toLowerCase().includes(search) ||
                o.wallet_address?.toLowerCase().includes(search)
            );
        }
        
        const tbody = document.getElementById('ordersTableBody');
        if (!tbody) return;
        
        if (!filtered.length) {
            tbody.innerHTML = '<tr><td colspan="7" class="py-8 text-center text-gray-500">No orders found</td></tr>';
            return;
        }
        
        tbody.innerHTML = filtered.map(order => {
            const items = typeof order.items === 'string' ? JSON.parse(order.items) : (order.items || []);
            const itemCount = items.reduce((sum, i) => sum + (i.quantity || 1), 0);
            
            // Get member display - name first, then email, then wallet
            const memberName = order.member_name || '';
            const memberEmail = order.member_email || order.email || '';
            const walletShort = Utils.shortAddress(order.wallet_address);
            
            let memberDisplay = '';
            if (memberName && memberName !== memberEmail) {
                memberDisplay = `
                    <div class="font-medium">${Utils.escapeHtml(memberName)}</div>
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
            
            // Status colors
            const statusColors = {
                'pending': 'bg-yellow-500/20 text-yellow-400',
                'confirmed': 'bg-blue-500/20 text-blue-400',
                'completed': 'bg-green-500/20 text-green-400',
                'cancelled': 'bg-red-500/20 text-red-400',
                'refunded': 'bg-gray-500/20 text-gray-400'
            };
            const statusClass = statusColors[order.status] || 'bg-gray-500/20 text-gray-400';
            
            return `
                <tr class="border-t border-gray-800 hover:bg-gray-800/30">
                    <td class="py-4 px-4 font-medium">${order.order_number || order.id?.slice(0,8) || '-'}</td>
                    <td class="py-4 px-4">${memberDisplay}</td>
                    <td class="py-4 px-4">${itemCount} item${itemCount !== 1 ? 's' : ''}</td>
                    <td class="py-4 px-4 font-medium">${Utils.formatCurrency(order.total_amount)}</td>
                    <td class="py-4 px-4"><span class="px-2 py-1 rounded-full text-xs ${statusClass}">${order.status}</span></td>
                    <td class="py-4 px-4 text-gray-400">${Utils.formatDate(order.created_at)}</td>
                    <td class="py-4 px-4">
                        <button onclick="Orders.view('${order.id}')" class="text-primary hover:text-primary-light text-sm">View</button>
                    </td>
                </tr>
            `;
        }).join('');
    },
    
    updateStats() {
        const el = (id) => document.getElementById(id);
        if (el('ordersTotal')) el('ordersTotal').textContent = this.data.length;
        if (el('ordersPending')) el('ordersPending').textContent = this.data.filter(o => o.status === 'pending').length;
        if (el('ordersConfirmed')) el('ordersConfirmed').textContent = this.data.filter(o => o.status === 'confirmed').length;
        if (el('ordersCompleted')) el('ordersCompleted').textContent = this.data.filter(o => o.status === 'completed').length;
        if (el('ordersCancelled')) el('ordersCancelled').textContent = this.data.filter(o => o.status === 'cancelled' || o.status === 'refunded').length;
    },
    
    filter() { this.render(); },
    
    search() { this.render(); },
    
    async view(id) {
        const order = this.data.find(o => o.id === id);
        if (!order) return;
        
        const items = typeof order.items === 'string' ? JSON.parse(order.items) : (order.items || []);
        
        // Member info for modal
        const memberName = order.member_name || '';
        const memberEmail = order.member_email || order.email || '';
        const walletShort = Utils.shortAddress(order.wallet_address);
        
        let customerDisplay = '';
        if (memberName && memberName !== memberEmail) {
            customerDisplay = `<p class="font-medium">${Utils.escapeHtml(memberName)}</p>
                              <p class="text-sm text-gray-400">${memberEmail}</p>
                              <p class="font-mono text-xs text-gray-500">${walletShort}</p>`;
        } else if (memberEmail) {
            customerDisplay = `<p class="font-medium">${memberEmail}</p>
                              <p class="font-mono text-xs text-gray-500">${walletShort}</p>`;
        } else {
            customerDisplay = `<p class="font-mono text-sm">${order.wallet_address}</p>`;
        }
        
        const content = document.getElementById('orderModalContent');
        if (!content) return;
        
        content.innerHTML = `
            <div class="space-y-6">
                <div class="grid grid-cols-2 gap-4">
                    <div><p class="text-gray-400 text-sm">Order Number</p><p class="font-medium">${order.order_number || order.id?.slice(0,8)}</p></div>
                    <div><p class="text-gray-400 text-sm">Status</p><span class="px-2 py-1 rounded-full text-xs status-${order.status}">${order.status}</span></div>
                    <div><p class="text-gray-400 text-sm">Customer</p>${customerDisplay}</div>
                    <div><p class="text-gray-400 text-sm">Date</p><p>${Utils.formatDateTime(order.created_at)}</p></div>
                </div>
                <div>
                    <p class="text-gray-400 text-sm mb-2">Items</p>
                    <div class="space-y-2">
                        ${items.map(item => `<div class="flex justify-between p-3 bg-gray-800/50 rounded-lg"><div><p class="font-medium">${item.service_name || item.name || 'Item'}</p><p class="text-sm text-gray-400">Qty: ${item.quantity || 1}</p></div><p class="font-medium">${Utils.formatCurrency(item.total || item.price)}</p></div>`).join('')}
                    </div>
                </div>
                <div class="flex justify-between p-4 bg-primary/10 rounded-lg"><p class="font-semibold">Total</p><p class="font-bold text-primary text-xl">${Utils.formatCurrency(order.total_amount)}</p></div>
                <div>
                    <p class="text-gray-400 text-sm mb-2">Update Status</p>
                    <div class="flex gap-2">
                        <select id="orderStatusUpdate" class="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-4 py-2">
                            <option value="pending" ${order.status === 'pending' ? 'selected' : ''}>Pending</option>
                            <option value="confirmed" ${order.status === 'confirmed' ? 'selected' : ''}>Confirmed</option>
                            <option value="completed" ${order.status === 'completed' ? 'selected' : ''}>Completed</option>
                            <option value="cancelled" ${order.status === 'cancelled' ? 'selected' : ''}>Cancelled</option>
                            <option value="refunded" ${order.status === 'refunded' ? 'selected' : ''}>Refunded</option>
                        </select>
                        <button onclick="Orders.updateStatus('${order.id}')" class="bg-primary hover:bg-primary-light text-black px-4 py-2 rounded-lg font-medium">Update</button>
                    </div>
                </div>
            </div>
        `;
        document.getElementById('orderModal')?.classList.remove('hidden');
    },
    
    async updateStatus(id) {
        const status = document.getElementById('orderStatusUpdate')?.value;
        if (!status) return;
        
        const res = await API.put(`/orders/${id}/status`, { status });
        if (res.success) {
            Utils.showToast('Order updated');
            this.closeModal();
            this.load();
        } else {
            Utils.showToast(res.error || 'Failed to update', 'error');
        }
    },
    
    closeModal() {
        document.getElementById('orderModal')?.classList.add('hidden');
    },
    
    export() {
        Utils.exportToCSV(this.data, 'orders');
    }
};
