// VERSION: 2026-04-11 – shared header using backend config
var HeaderManager = {
  CONFIG: {
    // Defaults - will be overwritten by /api/config/public
    VIP_TOKEN_ADDRESS: null,
    POLYGON_RPC: null,
    EXPLORER_URL: null,
    SESSION_DURATION: 24*60*60*1000,
    WALLETTWO_ORIGIN: 'https://wallet.wallettwo.com',
    WALLETTWO_COMPANY_ID: null,
    STORAGE_KEY: 'keavalley_profile'
  },
  currentUser: null,
  userBalance: 0,
  initialized: false,
  configLoaded: false,

  async init() {
    if (this.initialized) return;
    this.initialized = true;
    console.log('🔧 HeaderManager initializing...');
    await this.loadConfig();
    this.checkSession();
    this.setupWalletListener();
    this.setupMobileMenu();
  },

  async loadConfig() {
    try {
      const r = await fetch('/api/config/public');
      const c = await r.json();
      
      if (c.walletTwoCompanyId) this.CONFIG.WALLETTWO_COMPANY_ID = c.walletTwoCompanyId;
      if (c.vipTokenAddress) this.CONFIG.VIP_TOKEN_ADDRESS = c.vipTokenAddress;
      if (c.polygonRpc) this.CONFIG.POLYGON_RPC = c.polygonRpc;
      if (c.explorerUrl) this.CONFIG.EXPLORER_URL = c.explorerUrl;
      if (c.sessionDuration) this.CONFIG.SESSION_DURATION = c.sessionDuration;
      
      this.configLoaded = true;
      console.log('✅ Config loaded from server');
    } catch (e) {
      console.error('Failed to load config:', e);
    }
  },

  checkSession() {
    try {
      const s = localStorage.getItem(this.CONFIG.STORAGE_KEY);
      if (s) {
        const d = JSON.parse(s);
        if (d.wallet && Date.now() - (d.timestamp || 0) < this.CONFIG.SESSION_DURATION) {
          this.currentUser = d;
          this.onUserConnected();
          return;
        }
      }
    } catch (e) {
      console.error('Session check error:', e);
    }
    this.showDisconnectedState();
  },

  showDisconnectedState() {
    this.setElementDisplay('headerConnected', 'none');
    this.setElementDisplay('mobileUserSection', 'none');
    this.setElementClass('headerDisconnected', 'remove', 'hidden');
    this.setElementDisplay('headerDisconnected', 'flex');
    this.setElementClass('mobileConnectSection', 'remove', 'hidden');
    this.updateBalanceDisplays(0);
  },

  onUserConnected() {
    if (this.currentUser && this.currentUser.wallet) {
      this.fetchUserBalance(this.currentUser.wallet);
    }
    this.setElementClass('headerDisconnected', 'add', 'hidden');
    this.setElementDisplay('headerDisconnected', 'none');
    this.setElementClass('mobileConnectSection', 'add', 'hidden');
    this.setElementClass('headerConnected', 'remove', 'hidden');
    this.setElementDisplay('headerConnected', 'flex');
    this.setElementClass('mobileUserSection', 'remove', 'hidden');
    
    const name = this.getUserDisplayName();
    const shortName = name.length > 15 ? name.substring(0, 12) + '...' : name;
    const email = this.currentUser.email || '';
    const shortEmail = this.getShortEmail(email);

    this.setElementText('headerUserName', shortName);
    this.setElementText('headerAvatarInitials', this.getUserInitials(name));
    this.setElementText('headerUserEmail', shortEmail);
    this.setElementText('dropdownEmail', email || this.currentUser.wallet.slice(0, 6) + '...' + this.currentUser.wallet.slice(-4));
    
    this.closeLoginModal();
    console.log('✅ User connected:', this.currentUser.wallet);
  },

  getUserDisplayName() {
    if (!this.currentUser) return 'Member';
    if (this.currentUser.firstName || this.currentUser.lastName) {
      return [this.currentUser.firstName, this.currentUser.lastName].filter(Boolean).join(' ');
    }
    return this.currentUser.name || 'Member';
  },

  // Get shortened email for header display (e.g., "chris...@domain.com")
  getShortEmail(email) {
    if (!email) return '';
    
    const atIndex = email.indexOf('@');
    if (atIndex === -1) return email;
    
    const localPart = email.substring(0, atIndex);
    const domain = email.substring(atIndex);
    
    // If local part is short enough, show full email
    if (localPart.length <= 8) return email;
    
    // Otherwise, truncate: first 5 chars + ... + @domain
    return localPart.substring(0, 5) + '...' + domain;
  },

  getUserInitials(name) {
    if (!this.currentUser) return '--';
    if (this.currentUser.firstName && this.currentUser.lastName) {
      return (this.currentUser.firstName[0] + this.currentUser.lastName[0]).toUpperCase();
    }
    if (name && name !== 'Member') {
      const p = name.trim().split(' ');
      return p.length > 1 ? (p[0][0] + p[p.length - 1][0]).toUpperCase() : name.slice(0, 2).toUpperCase();
    }
    if (this.currentUser.wallet) return this.currentUser.wallet.slice(2, 4).toUpperCase();
    return '--';
  },

  async fetchUserBalance(wallet) {
    try {
        const response = await fetch('/api/member/balance/' + wallet.toLowerCase());
        const data = await response.json();
        
        if (data.success) {
            this.userBalance = parseFloat(data.balance) || 0;
            console.log('💰 Kea€ balance:', this.userBalance);
        } else {
            this.userBalance = 0;
        }
    } catch (e) {
        console.error('Failed to fetch balance:', e);
        this.userBalance = 0;
    }
    this.updateBalanceDisplays(this.userBalance);
  },

  async loadEthers() {
    return new Promise((resolve, reject) => {
      if (typeof ethers !== 'undefined') { resolve(); return; }
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/ethers/6.9.0/ethers.umd.min.js';
      script.onload = () => { console.log('✅ ethers.js loaded'); resolve(); };
      script.onerror = () => reject(new Error('Failed to load ethers.js'));
      document.head.appendChild(script);
    });
  },

  updateBalanceDisplays(balance) {
    const fmt = Math.floor(balance || 0).toLocaleString();
    ['dropdownBalance', 'mobileBalance', 'headerUserBalance', 'userBalance'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.textContent = fmt;
    });
    document.querySelectorAll('[data-user-balance]').forEach(el => el.textContent = fmt);
  },

  setupWalletListener() {
    window.addEventListener('message', e => {
      if (!e.origin.includes('wallettwo.com')) return;
      const d = e.data;
      
      if (d && (d.type === 'wallet_error' || d.type === 'auth_error' || d.type === 'auth_cancelled' || d.type === 'wallet_cancelled' || d.type === 'close' || d.type === 'cancel' || d.event === 'cancel' || d.event === 'close')) {
        console.log('🚫 Login cancelled');
        return;
      }
      
      if (d && (d.type === 'wallet_login' || d.event === 'wallet_login' || d.type === 'wallet_session' || d.event === 'wallet_session')) {
        const wallet = d.wallet || d.wlt || d.address;
        const code = d.code || d.token;
        console.log('🔐 Login event, wallet:', wallet);

        // Only a login the user started counts. WalletTwo iframes elsewhere -
        // the logout one included - can announce a session in the background,
        // and acting on that logs the member straight back in.
        if (!this.loginOpen) return;

        if (wallet) {
          if (code) this.exchangeCode(code, wallet, d.user);
          else this.startSession(wallet, d.user);
        }
      }
    });
  },

  async startSession(wallet, userId, details) {
    details = details || {};
    try {
      const r = await fetch('/api/wallettwo/session', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet: wallet, email: details.email || null, name: details.name || null })
      });
      if (!r.ok) console.error('Session registration failed:', r.status);
    } catch (err) {
      console.error('Session registration failed:', err);
    }

    this.currentUser = {
      wallet: wallet.toLowerCase(),
      userId: userId || null,
      email: details.email || null,
      name: details.name || null,
      timestamp: Date.now()
    };
    this.saveSession();
    this.onUserConnected();
  },

  async exchangeCode(code, wallet, userId) {
    try {
      const r = await fetch('/api/wallettwo/exchange', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
      const data = await r.json();

      // The login itself succeeded; if the server could not verify the token,
      // start the session from the wallet so the member still gets in.
      if (!r.ok || data.success === false) {
        console.warn('Token exchange rejected (' + r.status + ') - starting session from wallet');
        if (wallet) return this.startSession(wallet, userId);
      }

      this.currentUser = {
        wallet: wallet.toLowerCase(),
        userId: userId || (data.user && data.user.sub),
        email: data.email || (data.user && data.user.email),
        firstName: data.firstName || (data.user && data.user.given_name),
        lastName: data.lastName || (data.user && data.user.family_name),
        name: data.name || (data.user && data.user.name),
        timestamp: Date.now()
      };
      this.saveSession();
      this.onUserConnected();
    } catch (err) {
      console.error('Exchange failed:', err);
      this.startSession(wallet, userId);
    }
  },

  saveSession() {
    if (this.currentUser) localStorage.setItem(this.CONFIG.STORAGE_KEY, JSON.stringify(this.currentUser));
  },

  // One logout for every page, done the way Zai does it: end the WalletTwo
  // session in an off-screen iframe (display:none stops it running in Safari),
  // wait for WalletTwo to confirm with wallet_logout, then clear every local
  // trace and the membership cookie and return to the members page.
  disconnect() {
    if (this.loggingOut) return;
    this.loggingOut = true;
    this.loginOpen = false;
    console.log('🔌 Disconnecting...');

    this.currentUser = null;
    this.userBalance = 0;
    this.clearLocalSession();
    this.showDisconnectedState();

    const origin = this.CONFIG.WALLETTWO_ORIGIN;
    const companyId = this.CONFIG.WALLETTWO_COMPANY_ID;

    const walletTwoDone = new Promise(resolve => {
      if (!companyId) return resolve();
      const iframe = document.createElement('iframe');
      iframe.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:400px;height:600px;opacity:0;pointer-events:none;';
      iframe.src = `${origin}/auth/login?action=logout&iframe=true&auto_accept=true&companyId=${companyId}&_t=${Date.now()}`;

      const finish = () => {
        clearTimeout(timer);
        window.removeEventListener('message', onMessage);
        if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
        resolve();
      };
      const onMessage = (event) => {
        if (event.origin !== origin) return;
        if (event.data && (event.data.type === 'wallet_logout' || event.data.event === 'wallet_logout')) finish();
      };
      const timer = setTimeout(finish, 6000);

      window.addEventListener('message', onMessage);
      document.body.appendChild(iframe);
    });

    const cookieCleared = fetch('/api/wallettwo/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {});

    Promise.all([walletTwoDone, cookieCleared]).then(() => {
      this.clearLocalSession();
      window.location.href = '/';
    });
  },

  clearLocalSession() {
    ['keavalley_profile', 'wallettwo_token', 'userEmail'].forEach(k => localStorage.removeItem(k));
    Object.keys(localStorage)
      .filter(k => k.includes('wallettwo') || k.includes('wallet_two'))
      .forEach(k => localStorage.removeItem(k));
    sessionStorage.clear();
  },

  buildWalletTwoUrl(action, extra) {
    extra = extra || {};
    let url = action === 'auth' ? `${this.CONFIG.WALLETTWO_ORIGIN}/auth/login?action=session&iframe=true` : `${this.CONFIG.WALLETTWO_ORIGIN}/action/${action}?iframe=true`;
    if (this.CONFIG.WALLETTWO_COMPANY_ID) url += `&companyId=${this.CONFIG.WALLETTWO_COMPANY_ID}`;
    for (let k in extra) if (extra.hasOwnProperty(k)) url += `&${k}=${encodeURIComponent(extra[k])}`;
    url += `&_t=${Date.now()}`;
    return url;
  },

  showLoginModal() {
    const modal = document.getElementById('loginModal') || document.getElementById('login-modal');
    if (!modal) { window.location.href = '/profile'; return; }
    const iframe = document.getElementById('loginWalletIframe') || document.getElementById('login-wallet-iframe') || modal.querySelector('iframe');
    if (iframe && this.CONFIG.WALLETTWO_COMPANY_ID) iframe.src = this.buildWalletTwoUrl('auth');
    this.loginOpen = true;
    modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  },

  closeLoginModal() {
    this.loginOpen = false;
    const modal = document.getElementById('loginModal') || document.getElementById('login-modal');
    if (modal) { modal.classList.add('hidden'); document.body.style.overflow = ''; }
  },

  setupMobileMenu() {
    const btn = document.getElementById('mobileMenuBtn'), menu = document.getElementById('mobileMenu');
    if (btn && menu) btn.addEventListener('click', () => menu.classList.toggle('hidden'));
  },

  setElementText(id, text) { const el = document.getElementById(id); if (el) el.textContent = text; },
  setElementDisplay(id, display) { const el = document.getElementById(id); if (el) el.style.display = display; },
  setElementClass(id, action, className) {
    const el = document.getElementById(id);
    if (el) { action === 'add' ? el.classList.add(className) : el.classList.remove(className); }
  },

  getUser() { return this.currentUser; },
  getBalance() { return this.userBalance; },
  getWallet() { return this.currentUser ? this.currentUser.wallet : null; },
  isConnected() { return !!(this.currentUser && this.currentUser.wallet); }
};

function disconnect() { HeaderManager.disconnect(); }
function showLoginModal() { HeaderManager.showLoginModal(); }
function closeLoginModal() { HeaderManager.closeLoginModal(); }

document.addEventListener('DOMContentLoaded', () => HeaderManager.init());
