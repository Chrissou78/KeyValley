// src/public/admin/js/main.js
// Main dashboard initialization

document.addEventListener('DOMContentLoaded', async () => {
    console.log('Dashboard initializing...');
    
    // Initialize auth first
    const authenticated = await Auth.init();
    if (!authenticated) return;
    
    console.log('Authenticated as:', Auth.admin?.email);
    
    // Setup logout button
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => Auth.logout());
    }
    
    // Setup tab navigation
    setupTabs();
    
    // Load initial data
    loadInitialData();
});

function setupTabs() {
    const tabButtons = document.querySelectorAll('[data-tab]');
    const panels = document.querySelectorAll('[data-panel]');
    
    tabButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const tab = btn.dataset.tab;
            
            // Update button styles - use nav-tab active class
            tabButtons.forEach(b => {
                b.classList.remove('active');
            });
            btn.classList.add('active');
            
            // Show/hide panels
            panels.forEach(panel => {
                if (panel.dataset.panel === tab) {
                    panel.classList.remove('hidden');
                } else {
                    panel.classList.add('hidden');
                }
            });
            
            // Load data for the tab
            loadTabData(tab);
        });
    });
}

function loadInitialData() {
    // Load claims by default (first tab)
    if (typeof Claims !== 'undefined' && Claims.load) {
        Claims.load();
    }
}

function loadTabData(tab) {
    switch(tab) {
        case 'claims':
            if (typeof Claims !== 'undefined') Claims.load();
            break;
        case 'questionnaire':
            if (typeof Questionnaire !== 'undefined') Questionnaire.load();
            break;
        case 'presale':
            if (typeof Presale !== 'undefined') Presale.load();
            break;
        case 'referrals':
            if (typeof Referrals !== 'undefined') Referrals.load();
            break;
        case 'admins':
            if (typeof Admins !== 'undefined') Admins.load();
            break;
        case 'settings':
            if (typeof Settings !== 'undefined') Settings.load();
            break;
        case 'manual-mint':
            if (typeof ManualMint !== 'undefined') ManualMint.load();
            break;
    }
}
