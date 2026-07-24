// public/admin/js/packages.js
// VERSION: 2026-07-01 - Package management module with metallic tier icons

const Packages = {
    all: [],
    toDelete: null,
    loaded: false,

    // Tier icon configuration
    tierConfig: {
        'test': { icon: 'science', class: 'tier-icon-test' },
        'bronze': { icon: 'military_tech', class: 'tier-icon-bronze' },
        'silver': { icon: 'military_tech', class: 'tier-icon-silver' },
        'gold': { icon: 'military_tech', class: 'tier-icon-gold' },
        'platinum': { icon: 'hexagon', class: 'tier-icon-platinum' },
        'diamond': { icon: 'hexagon', class: 'tier-icon-diamond' },
        'standard': { icon: 'card_membership', class: 'tier-icon-standard' }
    },

    init() {
        console.log('📦 Packages module initialized');
        this.injectTierStyles();
    },

    // Inject metallic gradient styles
    injectTierStyles() {
        if (document.getElementById('tier-icon-styles')) return;
        
        const styles = document.createElement('style');
        styles.id = 'tier-icon-styles';
        styles.textContent = `
            /* Test tier */
            .tier-icon-test .material-symbols-outlined {
                color: #eab308;
            }
            
            /* Bronze medal - warm copper tones */
            .tier-icon-bronze .material-symbols-outlined {
                background: linear-gradient(180deg, #e8a065 0%, #cd7f32 30%, #8b4513 70%, #cd7f32 100%);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
                background-clip: text;
                filter: drop-shadow(1px 1px 1px rgba(139, 69, 19, 0.4));
            }
            
            /* Silver medal - cool metallic gray */
            .tier-icon-silver .material-symbols-outlined {
                background: linear-gradient(180deg, #f5f5f5 0%, #d4d4d4 25%, #a8a8a8 50%, #c0c0c0 75%, #e8e8e8 100%);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
                background-clip: text;
                filter: drop-shadow(1px 1px 1px rgba(100, 100, 100, 0.4));
            }
            
            /* Gold medal - rich gold tones */
            .tier-icon-gold .material-symbols-outlined {
                background: linear-gradient(180deg, #fff4a3 0%, #ffd700 25%, #daa520 50%, #b8860b 75%, #ffd700 100%);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
                background-clip: text;
                filter: drop-shadow(1px 1px 1px rgba(184, 134, 11, 0.4));
            }
            
            /* Platinum hexagon - cool steel blue */
            .tier-icon-platinum .material-symbols-outlined {
                background: linear-gradient(135deg, #f0f0f0 0%, #a0b2c6 25%, #e5e4e2 50%, #8896ab 75%, #d4d4d4 100%);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
                background-clip: text;
                filter: drop-shadow(1px 1px 2px rgba(160, 178, 198, 0.5));
            }
            
            /* Diamond hexagon - brilliant blue */
            .tier-icon-diamond .material-symbols-outlined {
                background: linear-gradient(135deg, #e0ffff 0%, #87ceeb 25%, #00bfff 50%, #4fc3f7 75%, #b9f2ff 100%);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
                background-clip: text;
                filter: drop-shadow(1px 1px 2px rgba(0, 191, 255, 0.5));
            }
            
            /* Standard tier */
            .tier-icon-standard .material-symbols-outlined {
                color: #ee9d2b;
            }
        `;
        document.head.appendChild(styles);
    },

    async load() {
        console.log('📦 Loading packages...');
        await this.loadStripeConnectStatus();
        await this.loadPackages();
    },

    async loadStripeConnectStatus() {
        try {
            const response = await fetch('/api/membership/verify-connect', {
                credentials: 'include'
            });
            const data = await response.json();
            
            const badge = document.getElementById('stripeConnectBadge');
            const splitConfig = document.getElementById('splitConfig');
            
            if (data.success && data.configured) {
                badge.textContent = 'Connected';
                badge.className = 'px-3 py-1 rounded-full text-xs font-medium bg-green-500/20 text-green-400';
                splitConfig.textContent = `${data.splitConfig.connectedAccountPercent}% to partner, ${data.splitConfig.platformFeePercent}% platform fee (on NET)`;
            } else {
                badge.textContent = 'Not Configured';
                badge.className = 'px-3 py-1 rounded-full text-xs font-medium bg-red-500/20 text-red-400';
                splitConfig.textContent = 'Stripe Connect not configured';
            }
        } catch (error) {
            console.error('Failed to load Stripe Connect status:', error);
            const badge = document.getElementById('stripeConnectBadge');
            if (badge) {
                badge.textContent = 'Error';
                badge.className = 'px-3 py-1 rounded-full text-xs font-medium bg-red-500/20 text-red-400';
            }
        }
    },

    async loadPackages() {
        const grid = document.getElementById('packagesGrid');
        if (!grid) return;
        
        grid.innerHTML = '<p class="text-gray-500 col-span-full text-center py-8">Loading packages...</p>';
        
        try {
            const response = await API.get('/packages');
            if (response.success) {
                this.all = response.packages;
                this.render();
                this.updateStats();
                this.loaded = true;
            } else {
                grid.innerHTML = `<p class="text-red-400 col-span-full text-center py-8">${this.escapeHtml(response.error) || 'Failed to load packages'}</p>`;
            }
        } catch (error) {
            console.error('Failed to load packages:', error);
            grid.innerHTML = '<p class="text-red-400 col-span-full text-center py-8">Failed to load packages</p>';
        }
    },

    escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    },

    getTierIcon(tier) {
        const config = this.tierConfig[tier] || this.tierConfig['standard'];
        return config.icon;
    },

    getTierClass(tier) {
        const config = this.tierConfig[tier] || this.tierConfig['standard'];
        return config.class;
    },

    render() {
        const grid = document.getElementById('packagesGrid');
        if (!grid) return;
        
        if (this.all.length === 0) {
            grid.innerHTML = `
                <div class="col-span-full text-center py-12">
                    <span class="material-symbols-outlined text-6xl text-gray-600 mb-4">inventory_2</span>
                    <p class="text-gray-400 mb-4">No packages configured</p>
                    <button onclick="Packages.openModal()" class="px-4 py-2 bg-primary text-black rounded-lg font-medium hover:bg-primary-light transition-colors">
                        Add First Package
                    </button>
                </div>
            `;
            return;
        }
        
        grid.innerHTML = this.all.map(pkg => {
            const tierIcon = pkg.icon || this.getTierIcon(pkg.tier);
            const tierClass = this.getTierClass(pkg.tier);
            
            return `
            <div class="glass rounded-xl overflow-hidden ${!pkg.active ? 'opacity-60' : ''} ${pkg.testOnly ? 'border-2 border-yellow-500/30' : ''}">
                <div class="p-5">
                    <div class="flex items-start justify-between mb-3">
                        <div class="flex items-center gap-3">
                            <div class="${tierClass}">
                                <span class="material-symbols-outlined text-4xl">${tierIcon}</span>
                            </div>
                            <div>
                                <h3 class="font-semibold text-lg">${this.escapeHtml(pkg.name)}</h3>
                                <p class="text-gray-500 text-xs font-mono">${pkg.id}</p>
                            </div>
                        </div>
                        <div class="flex gap-1 flex-wrap justify-end">
                            ${pkg.popular ? '<span class="px-2 py-0.5 bg-primary/20 text-primary text-xs rounded">Popular</span>' : ''}
                            ${pkg.testOnly ? '<span class="px-2 py-0.5 bg-yellow-500/20 text-yellow-400 text-xs rounded">Test</span>' : ''}
                            ${!pkg.active ? '<span class="px-2 py-0.5 bg-gray-500/20 text-gray-400 text-xs rounded">Inactive</span>' : ''}
                        </div>
                    </div>
                    
                    <p class="text-gray-400 text-sm mb-4 line-clamp-2">${this.escapeHtml(pkg.description) || 'No description'}</p>
                    
                    <div class="grid grid-cols-2 gap-3 mb-4">
                        <div class="bg-gray-800/50 rounded-lg p-3 text-center">
                            <div class="text-xl font-bold text-primary">${Utils.formatCurrency(pkg.price)}</div>
                            <div class="text-gray-500 text-xs">Price</div>
                        </div>
                        <div class="bg-gray-800/50 rounded-lg p-3 text-center">
                            <div class="text-xl font-bold text-green-400">${Utils.formatCurrency(pkg.buyingPower)}</div>
                            <div class="text-gray-500 text-xs">Kea Euros</div>
                        </div>
                    </div>
                    
                    ${pkg.features && pkg.features.length > 0 ? `
                    <ul class="text-sm text-gray-400 space-y-1 mb-4">
                        ${pkg.features.slice(0, 3).map(f => `
                            <li class="flex items-center gap-2">
                                <span class="material-symbols-outlined text-green-400 text-sm">check</span>
                                ${this.escapeHtml(f)}
                            </li>
                        `).join('')}
                        ${pkg.features.length > 3 ? `<li class="text-gray-500 text-xs">+${pkg.features.length - 3} more...</li>` : ''}
                    </ul>
                    ` : ''}
                    
                    <div class="flex gap-2 pt-3 border-t border-gray-700">
                        <button onclick="Packages.edit('${pkg.id}')" class="flex-1 px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm flex items-center justify-center gap-1 transition-colors">
                            <span class="material-symbols-outlined text-lg">edit</span>
                            Edit
                        </button>
                        <button onclick="Packages.toggle('${pkg.id}')" class="px-3 py-2 ${pkg.active ? 'bg-yellow-600 hover:bg-yellow-700' : 'bg-green-600 hover:bg-green-700'} rounded-lg text-sm flex items-center justify-center transition-colors" title="${pkg.active ? 'Deactivate' : 'Activate'}">
                            <span class="material-symbols-outlined text-lg">${pkg.active ? 'visibility_off' : 'visibility'}</span>
                        </button>
                        <button onclick="Packages.promptDelete('${pkg.id}')" class="px-3 py-2 bg-red-600 hover:bg-red-700 rounded-lg text-sm flex items-center justify-center transition-colors" title="Delete">
                            <span class="material-symbols-outlined text-lg">delete</span>
                        </button>
                    </div>
                </div>
            </div>
        `}).join('');
    },

    updateStats() {
        const total = document.getElementById('packagesTotal');
        const active = document.getElementById('packagesActive');
        const test = document.getElementById('packagesTest');
        
        if (total) total.textContent = this.all.length;
        if (active) active.textContent = this.all.filter(p => p.active).length;
        if (test) test.textContent = this.all.filter(p => p.testOnly).length;
    },

    openModal(pkg = null) {
        const modal = document.getElementById('packageModal');
        const title = document.getElementById('packageModalTitle');
        const form = document.getElementById('packageForm');
        const idField = document.getElementById('packageId');
        
        if (!modal || !form) return;
        
        form.reset();
        
        if (pkg) {
            title.textContent = 'Edit Package';
            document.getElementById('packageEditMode').value = pkg.id;
            idField.value = pkg.id;
            idField.disabled = true;
            document.getElementById('packageName').value = pkg.name;
            document.getElementById('packageDescription').value = pkg.description || '';
            document.getElementById('packagePrice').value = pkg.price;
            document.getElementById('packageBuyingPower').value = pkg.buyingPower;
            document.getElementById('packageBonus').value = pkg.bonus || 0;
            document.getElementById('packageTier').value = pkg.tier || 'standard';
            document.getElementById('packageIcon').value = pkg.icon || '';
            document.getElementById('packageSortOrder').value = pkg.sortOrder || 0;
            document.getElementById('packageFeatures').value = (pkg.features || []).join('\n');
            document.getElementById('packageActive').checked = pkg.active !== false;
            document.getElementById('packagePopular').checked = pkg.popular || false;
            document.getElementById('packageTestOnly').checked = pkg.testOnly || false;
        } else {
            title.textContent = 'Add Package';
            document.getElementById('packageEditMode').value = '';
            idField.disabled = false;
            document.getElementById('packageActive').checked = true;
            document.getElementById('packageTier').value = 'standard';
            document.getElementById('packageIcon').value = '';
            document.getElementById('packageSortOrder').value = '0';
        }
        
        this.updateIconPreview();
        modal.classList.remove('hidden');
    },

    updateIconPreview() {
        const tierSelect = document.getElementById('packageTier');
        const iconInput = document.getElementById('packageIcon');
        const preview = document.getElementById('iconPreview');
        
        if (!tierSelect || !preview) return;
        
        const tier = tierSelect.value;
        const customIcon = iconInput?.value?.trim();
        const icon = customIcon || this.getTierIcon(tier);
        const tierClass = this.getTierClass(tier);
        
        preview.innerHTML = `
            <div class="${tierClass}">
                <span class="material-symbols-outlined text-4xl">${icon}</span>
            </div>
            <span class="text-xs text-gray-500 mt-1">${tier} tier</span>
        `;
    },

    edit(id) {
        const pkg = this.all.find(p => p.id === id);
        if (pkg) this.openModal(pkg);
    },

    closeModal() {
        const modal = document.getElementById('packageModal');
        if (modal) modal.classList.add('hidden');
    },

    calculateBonus() {
        const priceEl = document.getElementById('packagePrice');
        const buyingPowerEl = document.getElementById('packageBuyingPower');
        const bonusEl = document.getElementById('packageBonus');
        
        if (!priceEl || !buyingPowerEl || !bonusEl) return;
        
        const price = parseFloat(priceEl.value) || 0;
        const buyingPower = parseFloat(buyingPowerEl.value) || 0;
        const bonus = Math.max(0, buyingPower - price);
        bonusEl.value = bonus.toFixed(2);
    },

    async save(e) {
        e.preventDefault();
        
        const editMode = document.getElementById('packageEditMode').value;
        const isEdit = editMode !== '';
        
        const featuresText = document.getElementById('packageFeatures').value;
        const features = featuresText
            .split('\n')
            .map(f => f.trim())
            .filter(f => f.length > 0);
        
        const tier = document.getElementById('packageTier').value;
        const customIcon = document.getElementById('packageIcon').value.trim();
        
        const data = {
            id: document.getElementById('packageId').value.trim().toLowerCase(),
            name: document.getElementById('packageName').value.trim(),
            description: document.getElementById('packageDescription').value.trim(),
            price: parseFloat(document.getElementById('packagePrice').value) || 0,
            buyingPower: parseFloat(document.getElementById('packageBuyingPower').value) || 0,
            bonus: parseFloat(document.getElementById('packageBonus').value) || 0,
            tier: tier,
            icon: customIcon || this.getTierIcon(tier),
            sortOrder: parseInt(document.getElementById('packageSortOrder').value) || 0,
            features: features,
            active: document.getElementById('packageActive').checked,
            popular: document.getElementById('packagePopular').checked,
            testOnly: document.getElementById('packageTestOnly').checked
        };
        
        // Validation
        if (!data.id || !data.name) {
            Utils.showToast('Package ID and Name are required', 'error');
            return;
        }
        
        if (!/^[a-z0-9-]+$/.test(data.id)) {
            Utils.showToast('Package ID must be lowercase letters, numbers, and hyphens only', 'error');
            return;
        }
        
        if (data.price < 0 || data.buyingPower < 0) {
            Utils.showToast('Price and Kea Euros must be positive', 'error');
            return;
        }
        
        try {
            let response;
            if (isEdit) {
                response = await API.put(`/packages/${editMode}`, data);
            } else {
                response = await API.post('/packages', data);
            }
            
            if (response.success) {
                Utils.showToast(isEdit ? 'Package updated successfully' : 'Package created successfully', 'success');
                this.closeModal();
                await this.loadPackages();
            } else {
                Utils.showToast(response.error || 'Failed to save package', 'error');
            }
        } catch (error) {
            console.error('Failed to save package:', error);
            Utils.showToast('Failed to save package', 'error');
        }
    },

    async toggle(id) {
        try {
            const response = await API.post(`/packages/${id}/toggle`);
            if (response.success) {
                Utils.showToast(`Package ${response.active ? 'activated' : 'deactivated'}`, 'success');
                await this.loadPackages();
            } else {
                Utils.showToast(response.error || 'Failed to toggle package', 'error');
            }
        } catch (error) {
            console.error('Failed to toggle package:', error);
            Utils.showToast('Failed to toggle package status', 'error');
        }
    },

    promptDelete(id) {
        const pkg = this.all.find(p => p.id === id);
        if (!pkg) return;
        
        this.toDelete = id;
        const nameEl = document.getElementById('deletePackageName');
        if (nameEl) nameEl.textContent = pkg.name;
        
        const modal = document.getElementById('deletePackageModal');
        if (modal) modal.classList.remove('hidden');
    },

    closeDeleteModal() {
        const modal = document.getElementById('deletePackageModal');
        if (modal) modal.classList.add('hidden');
        this.toDelete = null;
    },

    async confirmDelete() {
        if (!this.toDelete) return;
        
        try {
            const response = await API.delete(`/packages/${this.toDelete}`);
            if (response.success) {
                Utils.showToast(response.softDeleted ? 'Package deactivated (has existing purchases)' : 'Package deleted successfully', 'success');
                this.closeDeleteModal();
                await this.loadPackages();
            } else {
                Utils.showToast(response.error || 'Failed to delete package', 'error');
            }
        } catch (error) {
            console.error('Failed to delete package:', error);
            Utils.showToast('Failed to delete package', 'error');
        }
    },
    
    export() {
        if (!this.all.length) {
            Utils.showToast('No packages to export', 'error');
            return;
        }
        
        const data = this.all.map(p => ({
            id: p.id,
            name: p.name,
            description: p.description,
            price: p.price,
            buying_power: p.buyingPower,
            bonus: p.bonus,
            bonus_percent: p.bonusPercent,
            tier: p.tier,
            icon: p.icon,
            active: p.active,
            popular: p.popular,
            test_only: p.testOnly,
            features: (p.features || []).join('; ')
        }));
        
        Utils.exportToCSV(data, 'membership_packages');
    }
};
