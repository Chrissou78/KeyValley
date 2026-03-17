// Overview Panel
const Overview = {
    async load() {
        console.log('Loading overview...');
        const data = await API.get('/overview');
        
        if (!data.success) {
            console.log('Overview endpoint not available, using defaults');
            return;
        }
        
        const stats = data.stats || {};
        document.getElementById('totalRevenue').textContent = Utils.formatCurrency(stats.totalRevenue);
        document.getElementById('totalOrders').textContent = stats.totalOrders || 0;
        document.getElementById('pendingOrdersBadge').textContent = `${stats.pendingOrders || 0} pending`;
        document.getElementById('totalMembers').textContent = stats.totalMembers || 0;
        document.getElementById('activeVouchers').textContent = stats.activeVouchers || 0;
        document.getElementById('revenueToday').textContent = Utils.formatCurrency(stats.revenueToday);
        document.getElementById('revenueWeek').textContent = Utils.formatCurrency(stats.revenueWeek);
        document.getElementById('revenueMonth').textContent = Utils.formatCurrency(stats.revenueMonth);
        
        this.renderRecentOrders(data.recentOrders || []);
        this.renderRecentMemberships(data.recentMemberships || []);
    },
    
    renderRecentOrders(orders) {
        const el = document.getElementById('recentOrdersList');
        if (!el) return;
        if (!orders.length) {
            el.innerHTML = '<p class="text-gray-500 text-sm">No recent orders</p>';
            return;
        }
        el.innerHTML = orders.slice(0, 5).map(o => `
            <div class="flex items-center justify-between p-3 bg-gray-800/50 rounded-lg">
                <div>
                    <div class="font-medium">${o.order_number || o.id?.slice(0,8) || '-'}</div>
                    <div class="text-sm text-gray-400">${Utils.shortAddress(o.wallet_address)}</div>
                </div>
                <div class="text-right">
                    <div class="font-medium text-primary">${Utils.formatCurrency(o.total_amount)}</div>
                    <span class="px-2 py-0.5 rounded-full text-xs status-${o.status}">${o.status}</span>
                </div>
            </div>
        `).join('');
    },
    
    renderRecentMemberships(memberships) {
        const el = document.getElementById('recentMembershipsList');
        if (!el) return;
        if (!memberships.length) {
            el.innerHTML = '<p class="text-gray-500 text-sm">No recent memberships</p>';
            return;
        }
        el.innerHTML = memberships.slice(0, 5).map(m => `
            <div class="flex items-center justify-between p-3 bg-gray-800/50 rounded-lg">
                <div>
                    <div class="font-medium capitalize">${m.package_type || 'Package'}</div>
                    <div class="text-sm text-gray-400">${Utils.shortAddress(m.wallet_address)}</div>
                </div>
                <div class="text-right">
                    <div class="font-medium text-primary">${Utils.formatCurrency(m.amount_paid)}</div>
                    <span class="px-2 py-0.5 rounded-full text-xs status-${m.status}">${m.status}</span>
                </div>
            </div>
        `).join('');
    }
};
