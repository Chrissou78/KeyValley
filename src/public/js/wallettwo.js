/**
 * WalletTwo Vanilla JS SDK
 * Adapted from @oc-labs/wallettwo-sdk for non-React applications
 * 
 * Usage:
 *   WalletTwo.init({ onLogin: (user) => {...}, onLogout: () => {...} });
 *   WalletTwo.showLogin();
 *   WalletTwo.logout();
 */

const WalletTwo = (function() {
    // ============================================
    // Configuration
    // ============================================
    const CONFIG = {
        WALLET_ORIGIN: 'https://wallet.wallettwo.com',
        API_BASE: 'https://api.wallettwo.com',
        STORAGE_KEY: 'wallettwo_token'
    };

    // ============================================
    // State
    // ============================================
    let currentUser = null;
    let accessToken = localStorage.getItem(CONFIG.STORAGE_KEY) || null;
    let callbacks = {
        onLogin: null,
        onLogout: null,
        onError: null
    };
    let isInitialized = false;

    // ============================================
    // API Methods
    // ============================================
    
    /**
     * Exchange one-time token for session
     */
    async function exchangeToken(token) {
        const response = await fetch(`${CONFIG.API_BASE}/auth/api/auth/one-time-token/verify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token })
        });
        
        if (!response.ok) {
            throw new Error('Failed to exchange token');
        }
        
        return response.json();
    }

    /**
     * Get user session info from access token
     */
    async function getUserInfo(token) {
        const response = await fetch(`${CONFIG.API_BASE}/auth/api/auth/get-session`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (!response.ok) {
            throw new Error('Failed to get user info');
        }
        
        return response.json();
    }

    // ============================================
    // Token Management
    // ============================================
    
    function setAccessToken(token) {
        accessToken = token;
        if (token) {
            localStorage.setItem(CONFIG.STORAGE_KEY, token);
        } else {
            localStorage.removeItem(CONFIG.STORAGE_KEY);
        }
    }

    function getAccessToken() {
        return accessToken;
    }

    // ============================================
    // Message Handlers
    // ============================================
    
    /**
     * Handle messages from WalletTwo iframes
     */
    function handleMessage(event) {
        if (event.origin !== CONFIG.WALLET_ORIGIN) return;

        const { type, token, event: eventType } = event.data;
        
        console.log('[WalletTwo] Message received:', event.data);

        // Handle session/login event
        if (type === 'wallet_session' && token) {
            handleLoginToken(token);
            return;
        }

        // Handle logout event
        if (type === 'wallet_logout' || eventType === 'wallet_logout') {
            handleLogoutComplete();
            return;
        }

        // Handle signature event
        if (eventType === 'message_signed') {
            // This will be handled by the signMessage promise
            return;
        }

        // Handle auth flow states (user needs to complete registration, etc.)
        if (['login_required', 'pin_required', 'register_required', 
             'email_verification_required', 'wallet_required'].includes(type)) {
            console.log('[WalletTwo] Auth state:', type);
            // User needs to complete auth flow in iframe
            return;
        }
    }

    /**
     * Process login token
     */
    async function handleLoginToken(token) {
        try {
            const { session } = await exchangeToken(token);
            
            if (session && session.token) {
                setAccessToken(session.token);
                
                // Get user info
                const { user } = await getUserInfo(session.token);
                currentUser = user;
                
                console.log('[WalletTwo] Login successful:', user?.email);
                
                // Remove login iframe if exists
                removeIframe('wallettwo-login-iframe');
                removeIframe('wallettwo-headless-iframe');
                
                if (callbacks.onLogin) {
                    callbacks.onLogin(user, session.token);
                }
            }
        } catch (error) {
            console.error('[WalletTwo] Login error:', error);
            if (callbacks.onError) {
                callbacks.onError(error);
            }
        }
    }

    /**
     * Handle logout completion
     */
    function handleLogoutComplete() {
        setAccessToken(null);
        currentUser = null;
        
        removeIframe('wallettwo-logout-iframe');
        
        console.log('[WalletTwo] Logout complete');
        
        if (callbacks.onLogout) {
            callbacks.onLogout();
        }
    }

    // ============================================
    // Iframe Management
    // ============================================
    
    function createIframe(id, src, visible = false) {
        // Remove existing iframe with same id
        removeIframe(id);
        
        const iframe = document.createElement('iframe');
        iframe.id = id;
        iframe.src = src;
        iframe.allow = 'clipboard-write';
        
        if (visible) {
            iframe.style.cssText = 'width:100%;height:500px;border:none;display:block;';
        } else {
            iframe.style.cssText = 'display:none;width:1px;height:1px;';
        }
        
        return iframe;
    }

    function removeIframe(id) {
        const existing = document.getElementById(id);
        if (existing && existing.parentNode) {
            existing.parentNode.removeChild(existing);
        }
    }

    // ============================================
    // Public API
    // ============================================
    
    return {
        /**
         * Initialize WalletTwo SDK
         * @param {Object} options
         * @param {Function} options.onLogin - Called when user logs in (user, token)
         * @param {Function} options.onLogout - Called when user logs out
         * @param {Function} options.onError - Called on errors
         * @param {boolean} options.autoLogin - Attempt headless login on init (default: true)
         */
        init: function(options = {}) {
            if (isInitialized) return;
            
            callbacks.onLogin = options.onLogin || null;
            callbacks.onLogout = options.onLogout || null;
            callbacks.onError = options.onError || null;
            
            // Listen for messages
            window.addEventListener('message', handleMessage);
            
            isInitialized = true;
            console.log('[WalletTwo] SDK initialized');
            
            // Attempt headless login if we have a stored token
            if (options.autoLogin !== false) {
                this.headlessLogin();
            }
        },

        /**
         * Attempt headless login (check existing session)
         */
        headlessLogin: function() {
            const url = new URL(`${CONFIG.WALLET_ORIGIN}/auth/login`);
            url.searchParams.append('action', 'session');
            url.searchParams.append('iframe', 'true');
            
            const iframe = createIframe('wallettwo-headless-iframe', url.toString(), false);
            document.body.appendChild(iframe);
            
            // Remove iframe after timeout if no response
            setTimeout(() => {
                removeIframe('wallettwo-headless-iframe');
            }, 10000);
        },

        /**
         * Load user from existing access token
         * @param {string} token - Access token
         */
        loadUserFromToken: async function(token) {
            try {
                setAccessToken(token);
                const { user } = await getUserInfo(token);
                currentUser = user;
                
                if (callbacks.onLogin) {
                    callbacks.onLogin(user, token);
                }
                
                return user;
            } catch (error) {
                console.error('[WalletTwo] Failed to load user:', error);
                setAccessToken(null);
                throw error;
            }
        },

        /**
         * Show login iframe in a container
         * @param {string|HTMLElement} container - Container element or selector
         */
        showLogin: function(container) {
            const url = new URL(`${CONFIG.WALLET_ORIGIN}/auth/login`);
            url.searchParams.append('action', 'session');
            url.searchParams.append('iframe', 'true');
            
            const iframe = createIframe('wallettwo-login-iframe', url.toString(), true);
            
            if (typeof container === 'string') {
                container = document.querySelector(container);
            }
            
            if (container) {
                container.innerHTML = '';
                container.appendChild(iframe);
            }
            
            return iframe;
        },

        /**
         * Get login iframe URL (for manual iframe creation)
         */
        getLoginUrl: function() {
            const url = new URL(`${CONFIG.WALLET_ORIGIN}/auth/login`);
            url.searchParams.append('action', 'session');
            url.searchParams.append('iframe', 'true');
            return url.toString();
        },

        /**
         * Logout user
         * @returns {Promise} Resolves when logout is complete
         */
        logout: function() {
            return new Promise((resolve, reject) => {
                const url = new URL(`${CONFIG.WALLET_ORIGIN}/action/logout`);
                url.searchParams.append('iframe', 'true');
                url.searchParams.append('auto_accept', 'true');
                
                const iframe = createIframe('wallettwo-logout-iframe', url.toString(), false);
                document.body.appendChild(iframe);
                
                const timeout = setTimeout(() => {
                    removeIframe('wallettwo-logout-iframe');
                    // Still clear local state even if no response
                    setAccessToken(null);
                    currentUser = null;
                    resolve();
                }, 5000);
                
                const originalOnLogout = callbacks.onLogout;
                callbacks.onLogout = () => {
                    clearTimeout(timeout);
                    if (originalOnLogout) originalOnLogout();
                    callbacks.onLogout = originalOnLogout;
                    resolve();
                };
            });
        },

        /**
         * Sign a message
         * @param {string} message - Message to sign
         * @returns {Promise<string>} Signature
         */
        signMessage: function(message) {
            return new Promise((resolve, reject) => {
                const url = new URL(`${CONFIG.WALLET_ORIGIN}/auth/login`);
                url.searchParams.append('action', 'signature');
                url.searchParams.append('message', message);
                url.searchParams.append('iframe', 'true');
                url.searchParams.append('auto_accept', 'true');
                
                const iframe = createIframe('wallettwo-signature-iframe', url.toString(), false);
                document.body.appendChild(iframe);
                
                const timeout = setTimeout(() => {
                    window.removeEventListener('message', signHandler);
                    removeIframe('wallettwo-signature-iframe');
                    reject(new Error('Sign message timed out'));
                }, 30000);
                
                const signHandler = (event) => {
                    if (event.origin !== CONFIG.WALLET_ORIGIN) return;
                    
                    if (event.data.event === 'message_signed') {
                        clearTimeout(timeout);
                        window.removeEventListener('message', signHandler);
                        removeIframe('wallettwo-signature-iframe');
                        resolve(event.data.signature);
                    }
                };
                
                window.addEventListener('message', signHandler);
            });
        },

        /**
         * Get current user
         */
        getUser: function() {
            return currentUser;
        },

        /**
         * Get access token
         */
        getToken: function() {
            return accessToken;
        },

        /**
         * Check if user is logged in
         */
        isLoggedIn: function() {
            return !!currentUser && !!accessToken;
        },

        /**
         * Destroy SDK (cleanup)
         */
        destroy: function() {
            window.removeEventListener('message', handleMessage);
            removeIframe('wallettwo-login-iframe');
            removeIframe('wallettwo-logout-iframe');
            removeIframe('wallettwo-headless-iframe');
            removeIframe('wallettwo-signature-iframe');
            isInitialized = false;
        }
    };
})();

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = WalletTwo;
}
