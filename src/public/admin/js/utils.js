// utils.js - Shared utilities for admin dashboard

const Utils = {
    // Format wallet address
    formatAddress(address, chars = 6) {
        if (!address) return 'N/A';
        return `${address.slice(0, chars)}...${address.slice(-4)}`;
    },

    // Format date
    formatDate(dateStr) {
        if (!dateStr) return 'N/A';
        return new Date(dateStr).toLocaleString();
    },

    // Format currency
    formatEUR(amount) {
        return new Intl.NumberFormat('en-EU', {
            style: 'currency',
            currency: 'EUR'
        }).format(amount || 0);
    },

    // Format number with commas
    formatNumber(num) {
        return new Intl.NumberFormat().format(num || 0);
    },

    // Copy to clipboard
    async copyToClipboard(text) {
        try {
            await navigator.clipboard.writeText(text);
            this.showToast('Copied to clipboard!');
            return true;
        } catch (err) {
            console.error('Copy failed:', err);
            return false;
        }
    },

    // Show toast notification
    showToast(message, type = 'success') {
        const toast = document.createElement('div');
        toast.className = `fixed bottom-4 right-4 px-6 py-3 rounded-lg text-white z-50 transition-opacity duration-300 ${
            type === 'success' ? 'bg-green-600' : 
            type === 'error' ? 'bg-red-600' : 'bg-blue-600'
        }`;
        toast.textContent = message;
        document.body.appendChild(toast);
        
        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    },

    // Show loading state
    showLoading(elementId, message = 'Loading...') {
        const el = document.getElementById(elementId);
        if (el) {
            el.innerHTML = `
                <div class="flex items-center justify-center p-8">
                    <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mr-3"></div>
                    <span class="text-gray-400">${message}</span>
                </div>
            `;
        }
    },

    // Show error state
    showError(elementId, message) {
        const el = document.getElementById(elementId);
        if (el) {
            el.innerHTML = `
                <div class="text-center p-8 text-red-400">
                    <span class="material-symbols-outlined text-4xl mb-2">error</span>
                    <p>${message}</p>
                </div>
            `;
        }
    },

    // Get status badge HTML
    getStatusBadge(status) {
        const badges = {
            completed: 'bg-green-500/20 text-green-400',
            minted: 'bg-green-500/20 text-green-400',
            confirmed: 'bg-green-500/20 text-green-400',
            pending: 'bg-yellow-500/20 text-yellow-400',
            pending_mint: 'bg-yellow-500/20 text-yellow-400',
            paid: 'bg-blue-500/20 text-blue-400',
            failed: 'bg-red-500/20 text-red-400',
            timeout: 'bg-orange-500/20 text-orange-400'
        };
        const className = badges[status] || 'bg-gray-500/20 text-gray-400';
        return `<span class="px-2 py-1 rounded text-xs ${className}">${status}</span>`;
    },

    // Debounce function
    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    },

    // Export to CSV
    exportToCSV(data, filename) {
        if (!data || data.length === 0) {
            this.showToast('No data to export', 'error');
            return;
        }
        
        const headers = Object.keys(data[0]);
        const csvContent = [
            headers.join(','),
            ...data.map(row => 
                headers.map(header => {
                    let cell = row[header] ?? '';
                    if (typeof cell === 'string' && (cell.includes(',') || cell.includes('"'))) {
                        cell = `"${cell.replace(/"/g, '""')}"`;
                    }
                    return cell;
                }).join(',')
            )
        ].join('\n');
        
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `${filename}_${new Date().toISOString().split('T')[0]}.csv`;
        link.click();
        
        this.showToast('CSV exported successfully');
    },

    // Confirm dialog
    async confirm(message) {
        return new Promise(resolve => {
            const modal = document.createElement('div');
            modal.className = 'fixed inset-0 bg-black/50 flex items-center justify-center z-50';
            modal.innerHTML = `
                <div class="bg-gray-800 rounded-xl p-6 max-w-md mx-4">
                    <p class="text-white mb-6">${message}</p>
                    <div class="flex gap-4 justify-end">
                        <button class="px-4 py-2 bg-gray-700 rounded-lg text-white hover:bg-gray-600" id="confirmCancel">Cancel</button>
                        <button class="px-4 py-2 bg-red-600 rounded-lg text-white hover:bg-red-700" id="confirmOk">Confirm</button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
            
            modal.querySelector('#confirmCancel').onclick = () => {
                modal.remove();
                resolve(false);
            };
            modal.querySelector('#confirmOk').onclick = () => {
                modal.remove();
                resolve(true);
            };
        });
    }
};

window.Utils = Utils;
