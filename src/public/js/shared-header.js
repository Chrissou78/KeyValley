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
    if (!this.CONFIG.VIP_TOKEN_ADDRESS || !this.CONFIG.POLYGON_RPC) {
      console.warn('Config not loaded, cannot fetch balance');
      return;
    }

    try {
      if (typeof ethers === 'undefined') {
        await this.loadEthers();
      }

      const provider = new ethers.JsonRpcProvider(this.CONFIG.POLYGON_RPC);
      const erc20Abi = ['function balanceOf(address) view returns (uint256)', 'function decimals() view returns (uint8)'];
      const tokenContract = new ethers.Contract(this.CONFIG.VIP_TOKEN_ADDRESS, erc20Abi, provider);
      
      const [rawBalance, decimals] = await Promise.all([
        tokenContract.balanceOf(wallet),
        tokenContract.decimals()
      ]);
      
      this.userBalance = parseFloat(ethers.formatUnits(rawBalance, decimals));
      console.log('💰 On-chain balance:', this.userBalance);
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
        if (wallet) {
          if (code) this.exchangeCode(code, wallet, d.user);
          else {
            this.currentUser = { wallet: wallet.toLowerCase(), timestamp: Date.now() };
            this.saveSession();
            this.onUserConnected();
          }
        }
      }
    });
  },

  async exchangeCode(code, wallet, userId) {
    try {
      const r = await fetch('/api/wallettwo/exchange', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
      const data = await r.json();
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
      this.currentUser = { wallet: wallet.toLowerCase(), timestamp: Date.now() };
      this.saveSession();
      this.onUserConnected();
    }
  },

  saveSession() {
    if (this.currentUser) localStorage.setItem(this.CONFIG.STORAGE_KEY, JSON.stringify(this.currentUser));
  },

  disconnect() {
    console.log('🔌 Disconnecting...');
    this.currentUser = null;
    this.userBalance = 0;
    localStorage.removeItem(this.CONFIG.STORAGE_KEY);
    const iframe = document.getElementById('walletTwoLogoutIframe') || document.getElementById('logoutIframe') || document.getElementById('logout-iframe');
    if (iframe && this.CONFIG.WALLETTWO_COMPANY_ID) {
      iframe.src = `${this.CONFIG.WALLETTWO_ORIGIN}/action/logout?iframe=true&auto_accept=true&companyId=${this.CONFIG.WALLETTWO_COMPANY_ID}`;
    }
    this.showDisconnectedState();
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
    modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  },

  closeLoginModal() {
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
