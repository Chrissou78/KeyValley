// API Helper
const API = {
    BASE: '/api/admin',
    
    async call(endpoint, options = {}) {
        try {
            const res = await fetch(`${this.BASE}${endpoint}`, {
                ...options,
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json',
                    ...options.headers
                }
            });
            
            const data = await res.json();
            
            if (!res.ok) {
                if (res.status === 401 || res.status === 403) {
                    window.location.href = '/admin/login.html';
                    return { success: false, error: 'Session expired' };
                }
                throw new Error(data.error || 'Request failed');
            }
            return data;
        } catch (err) {
            console.error('API Error:', err);
            return { success: false, error: err.message };
        }
    },
    
    get(endpoint) {
        return this.call(endpoint);
    },
    
    post(endpoint, data) {
        return this.call(endpoint, { method: 'POST', body: JSON.stringify(data) });
    },
    
    put(endpoint, data) {
        return this.call(endpoint, { method: 'PUT', body: JSON.stringify(data) });
    },
    
    delete(endpoint) {
        return this.call(endpoint, { method: 'DELETE' });
    }
};
