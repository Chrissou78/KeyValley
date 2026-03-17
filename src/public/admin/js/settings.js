// Settings Panel
const Settings = {
    async load() {
        console.log('Loading settings...');
        
        try {
            const res = await fetch('/api/health');
            const health = await res.json();
            
            const setStatus = (id, connected, label) => {
                const el = document.getElementById(id);
                if (el) {
                    el.textContent = label || (connected ? 'Connected' : 'Error');
                    el.className = `px-3 py-1 rounded-full text-xs font-medium ${connected ? 'bg-green-500/20 text-green-400' : 'bg-yellow-500/20 text-yellow-400'}`;
                }
            };
            
            setStatus('dbStatus', health.database);
            setStatus('stripeStatus', health.stripe, health.stripe ? 'Connected' : 'Not configured');
            setStatus('walletTwoStatus', health.walletTwo, health.walletTwo ? 'Connected' : 'Not configured');
            
            if (health.counts) {
                const dbMembers = document.getElementById('dbMembers');
                const dbOrders = document.getElementById('dbOrders');
                if (dbMembers) dbMembers.textContent = health.counts.members || 0;
                if (dbOrders) dbOrders.textContent = health.counts.orders || 0;
            }
        } catch (e) {
            console.error('Health check failed:', e);
            const dbStatus = document.getElementById('dbStatus');
            if (dbStatus) {
                dbStatus.textContent = 'Error';
                dbStatus.className = 'px-3 py-1 rounded-full text-xs font-medium bg-red-500/20 text-red-400';
            }
        }
    },
    
    async savePlatform() {
        const res = await API.put('/settings', {
            platform_fee: parseFloat(document.getElementById('settingPlatformFee')?.value) || 10,
            voucher_validity: parseInt(document.getElementById('settingVoucherValidity')?.value) || 365
        });
        
        const el = document.getElementById('platformSettingsStatus');
        if (el) {
            el.textContent = res.success ? 'Settings saved!' : (res.error || 'Failed');
            el.className = `text-sm text-center ${res.success ? 'text-green-400' : 'text-red-400'}`;
            setTimeout(() => { el.textContent = ''; }, 3000);
        }
    }
};
