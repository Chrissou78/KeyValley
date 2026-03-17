// Main Dashboard Controller
document.addEventListener('DOMContentLoaded', () => {
    console.log('Dashboard initializing...');
    
    // Initialize authentication (your existing auth.js)
    Auth.init();
        // Initialize modules
    Marketplace.init();
    
    // Tab navigation
    document.querySelectorAll('[data-tab]').forEach(btn => {
        btn.addEventListener('click', () => {
            const tab = btn.dataset.tab;
            
            // Update active tab styling
            document.querySelectorAll('[data-tab]').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            // Show corresponding panel
            document.querySelectorAll('[data-panel]').forEach(p => p.classList.add('hidden'));
            document.querySelector(`[data-panel="${tab}"]`)?.classList.remove('hidden');
            
            // Load data for the tab
            switch (tab) {
                case 'overview': Overview.load(); break;
                case 'orders': Orders.load(); break;
                case 'marketplace': Marketplace.load(); break;
                case 'memberships': Memberships.load(); break;
                case 'members': Members.load(); break;
                case 'vouchers': Vouchers.load(); break;
                case 'referrals': Referrals.load(); break;
                case 'admins': Admins.load(); break;
                case 'settings': Settings.load(); break;
            }
        });
    });
    
    // Goto links (View All buttons)
    document.querySelectorAll('[data-goto]').forEach(a => {
        a.addEventListener('click', (e) => {
            e.preventDefault();
            document.querySelector(`[data-tab="${a.dataset.goto}"]`)?.click();
        });
    });
    
    // Filter handlers
    document.getElementById('orderStatusFilter')?.addEventListener('change', () => Orders.filter());
    document.getElementById('membershipStatusFilter')?.addEventListener('change', () => Memberships.filter());
    document.getElementById('memberSearch')?.addEventListener('input', () => Members.search());
    document.getElementById('voucherStatusFilter')?.addEventListener('change', () => Vouchers.filter());
    
    // Category filter buttons
    document.querySelectorAll('.category-btn').forEach(btn => {
        btn.addEventListener('click', () => Marketplace.filterCategory(btn.dataset.category));
    });
    
    // Referral code filter buttons
    document.querySelectorAll('[data-code-filter]').forEach(btn => {
        btn.addEventListener('click', () => Referrals.filterCodes(btn.dataset.codeFilter));
    });
    
    // Action buttons
    document.getElementById('addServiceBtn')?.addEventListener('click', () => Marketplace.openAddModal());
    document.getElementById('serviceForm')?.addEventListener('submit', (e) => Marketplace.save(e));
    document.getElementById('addAdminBtn')?.addEventListener('click', () => Admins.add());
    document.getElementById('saveReferralSettingsBtn')?.addEventListener('click', () => Referrals.saveSettings());
    document.getElementById('savePlatformSettingsBtn')?.addEventListener('click', () => Settings.savePlatform());
    document.getElementById('refreshReferralsBtn')?.addEventListener('click', () => Referrals.load());
    
    // Referral settings change handlers
    document.getElementById('refBonusType')?.addEventListener('change', () => Referrals.updateExplanations());
    document.getElementById('refBonusAmount')?.addEventListener('input', () => Referrals.updateExplanations());
    document.getElementById('refEnabled')?.addEventListener('change', () => Referrals.settingsChanged());
    
    // Export buttons
    document.getElementById('exportOrdersBtn')?.addEventListener('click', () => Orders.export());
    document.getElementById('exportMembershipsBtn')?.addEventListener('click', () => Memberships.export());
    document.getElementById('exportMembersBtn')?.addEventListener('click', () => Members.export());
    document.getElementById('exportVouchersBtn')?.addEventListener('click', () => Vouchers.export());
    document.getElementById('exportReferralsBtn')?.addEventListener('click', () => Referrals.exportCodesCSV());
    
    // Modal close handlers
    document.getElementById('closeOrderModal')?.addEventListener('click', () => Orders.closeModal());
    document.getElementById('orderModalBackdrop')?.addEventListener('click', () => Orders.closeModal());
    
    document.getElementById('closeServiceModal')?.addEventListener('click', () => Marketplace.closeModal());
    document.getElementById('serviceModalBackdrop')?.addEventListener('click', () => Marketplace.closeModal());
    document.getElementById('cancelServiceBtn')?.addEventListener('click', () => Marketplace.closeModal());
    
    document.getElementById('closeMemberModal')?.addEventListener('click', () => Members.closeModal());
    document.getElementById('memberModalBackdrop')?.addEventListener('click', () => Members.closeModal());
});
