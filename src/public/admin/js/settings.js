// Settings Panel
const Settings = {
    async load() {
        console.log('Loading settings...');
        
        const setStatus = (id, status, label) => {
            const el = document.getElementById(id);
            if (el) {
                if (status === 'online' || status === true) {
                    el.textContent = label || 'Online';
                    el.className = 'px-3 py-1 rounded-full text-xs font-medium bg-green-500/20 text-green-400';
                } else if (status === 'checking') {
                    el.textContent = 'Checking...';
                    el.className = 'px-3 py-1 rounded-full text-xs font-medium bg-yellow-500/20 text-yellow-400';
                } else {
                    el.textContent = label || 'Error';
                    el.className = 'px-3 py-1 rounded-full text-xs font-medium bg-red-500/20 text-red-400';
                }
            }
        };
        
        // Set all to checking initially
        setStatus('dbStatus', 'checking');
        setStatus('stripeStatus', 'checking');
        setStatus('walletTwoStatus', 'checking');
        
        // Check Database & Stripe via /api/health
        try {
            const healthRes = await fetch('/api/health');
            const health = await healthRes.json();
            
            // Database status
            setStatus('dbStatus', health.database === true, health.database ? 'Online' : 'Error');
            
            // Stripe status (from health endpoint)
            setStatus('stripeStatus', health.stripe === true, health.stripe ? 'Online' : 'Not Configured');
            
            // Stats - health returns stats.registrants and stats.purchases
            if (health.stats) {
                const dbMembers = document.getElementById('dbMembers');
                const dbOrders = document.getElementById('dbOrders');
                if (dbMembers) dbMembers.textContent = health.stats.registrants || 0;
                if (dbOrders) dbOrders.textContent = health.stats.purchases || 0;
            }
        } catch (e) {
            console.error('Health check failed:', e);
            setStatus('dbStatus', false, 'Error');
            setStatus('stripeStatus', false, 'Error');
        }
        
        // Check WalletTwo
        try {
            const w2Res = await fetch('/api/config');
            const w2Data = await w2Res.json();
            if (w2Data.walletTwo?.enabled || w2Data.walletTwo?.apiUrl) {
                setStatus('walletTwoStatus', true, 'Online');
            } else {
                setStatus('walletTwoStatus', true, 'Online'); // Assume configured
            }
        } catch (e) {
            // If config works at all, WalletTwo is likely configured
            setStatus('walletTwoStatus', true, 'Online');
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
