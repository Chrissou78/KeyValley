// Utility Functions
const Utils = {
    formatCurrency(amount) {
        return `€${parseFloat(amount || 0).toLocaleString('en-IE', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
    },
    
    formatDate(dateStr) {
        if (!dateStr) return '-';
        return new Date(dateStr).toLocaleDateString('en-IE', { day: '2-digit', month: 'short', year: 'numeric' });
    },
    
    formatDateTime(dateStr) {
        if (!dateStr) return '-';
        return new Date(dateStr).toLocaleDateString('en-IE', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    },
    
    shortAddress(addr) {
        if (!addr) return '-';
        return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
    },
    
    showToast(message, type = 'success') {
        const existing = document.querySelector('.toast');
        if (existing) existing.remove();
        
        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.style.cssText = `position:fixed;bottom:20px;right:20px;padding:16px 24px;border-radius:12px;z-index:9999;color:white;font-weight:500;animation:slideIn 0.3s ease;background:${type === 'success' ? 'rgba(34,197,94,0.95)' : 'rgba(239,68,68,0.95)'};`;
        toast.textContent = message;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 3000);
    },
    
    exportToCSV(data, filename) {
        if (!data || !data.length) { this.showToast('No data to export', 'error'); return; }
        const headers = Object.keys(data[0]);
        const csv = [
            headers.join(','),
            ...data.map(row => headers.map(h => {
                let val = row[h];
                if (typeof val === 'object') val = JSON.stringify(val);
                if (typeof val === 'string' && (val.includes(',') || val.includes('"'))) val = `"${val.replace(/"/g, '""')}"`;
                return val ?? '';
            }).join(','))
        ].join('\n');
        
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${filename}_${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    }
};
