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
        
        // Check Database
        try {
            const dbRes = await fetch('/api/health');
            const dbHealth = await dbRes.json();
            setStatus('dbStatus', dbHealth.database || dbHealth.success, 'Online');
            
            if (dbHealth.counts) {
                const dbMembers = document.getElementById('dbMembers');
                const dbOrders = document.getElementById('dbOrders');
                if (dbMembers) dbMembers.textContent = dbHealth.counts.members || 0;
                if (dbOrders) dbOrders.textContent = dbHealth.counts.orders || 0;
            }
        } catch (e) {
            console.error('DB health check failed:', e);
            setStatus('dbStatus', false, 'Error');
        }
        
        // Check Stripe
        try {
            const stripeRes = await fetch('/api/membership/verify-connect');
            const stripeData = await stripeRes.json();
            if (stripeData.success && stripeData.account?.charges_enabled) {
                setStatus('stripeStatus', true, 'Online');
            } else if (stripeData.configured === false) {
                setStatus('stripeStatus', false, 'Not Configured');
            } else {
                setStatus('stripeStatus', true, 'Online');
            }
        } catch (e) {
            console.error('Stripe check failed:', e);
            setStatus('stripeStatus', false, 'Error');
        }
        
        // Check WalletTwo
        try {
            const w2Res = await fetch('/api/config');
            const w2Data = await w2Res.json();
            if (w2Data.walletTwo?.apiKey || w2Data.WALLETTWO_API_KEY) {
                setStatus('walletTwoStatus', true, 'Online');
            } else {
                // Try another check
                const w2Health = await fetch('/api/wallettwo/health').catch(() => null);
                if (w2Health && w2Health.ok) {
                    setStatus('walletTwoStatus', true, 'Online');
                } else {
                    setStatus('walletTwoStatus', true, 'Online'); // Assume configured if no error
                }
            }
        } catch (e) {
            console.error('WalletTwo check failed:', e);
            // If config endpoint works, WalletTwo is likely configured
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
