const Marketplace = {
    services: [],
    currentServiceId: null,

    async init() {
        this.setupImageUpload();
        this.setupEventListeners();
        this.setupBookingTypeToggle();
        await this.load();
    },

    setupBookingTypeToggle() {
        const enabled = document.getElementById('serviceBookingEnabled');
        const fields = document.getElementById('bookingSettingsFields');
        const unit = document.getElementById('serviceDurationUnit');

        const updateVisibility = () => {
            if (!enabled || !fields) return;
            fields.classList.toggle('hidden', !enabled.checked);
        };

        const updateUnitLabels = () => {
            if (!unit) return;
            const isHours = unit.value === 'hours';
            document.getElementById('serviceMinDurationLabel').textContent = isHours ? 'Minimum Duration (hours)' : 'Minimum Duration (nights)';
            document.getElementById('serviceStartTimeLabel').textContent = isHours ? 'Available From' : 'Check-in Time';
            document.getElementById('serviceEndTimeLabel').textContent = isHours ? 'Available Until' : 'Check-out Time';
        };

        enabled?.addEventListener('change', updateVisibility);
        unit?.addEventListener('change', updateUnitLabels);
        this._updateBookingUnitLabels = updateUnitLabels;
    },

    setupImageUpload() {
        document.addEventListener('change', async (e) => {
            if (e.target.id !== 'serviceImageFile') return;
            
            const file = e.target.files[0];
            if (!file) return;

            console.log('File selected:', file.name);

            if (!file.type.match(/image\/(jpeg|jpg|png|webp)/)) {
                Utils.showToast('Only JPG, PNG, WebP allowed', 'error');
                return;
            }

            if (file.size > 4 * 1024 * 1024) {
                Utils.showToast('Image must be less than 4MB', 'error');
                return;
            }

            const previewImg = document.getElementById('imagePreviewImg');
            const placeholder = document.getElementById('imagePlaceholder');
            const urlField = document.getElementById('serviceImageUrl');
            const previousImageUrl = urlField.value;

            const showPreview = (src) => {
                if (!previewImg || !placeholder) return;
                if (src) {
                    previewImg.src = src;
                    previewImg.classList.remove('hidden');
                    placeholder.classList.add('hidden');
                } else {
                    previewImg.src = '';
                    previewImg.classList.add('hidden');
                    placeholder.classList.remove('hidden');
                }
            };

            // Instant feedback from the local file while the upload is in flight
            const reader = new FileReader();
            reader.onload = (ev) => showPreview(ev.target.result);
            reader.readAsDataURL(file);

            const formData = new FormData();
            formData.append('image', file);

            if (previousImageUrl) {
                formData.append('oldImageUrl', previousImageUrl);
            }

            Utils.showToast('Uploading...', 'success');

            try {
                const res = await fetch('/api/admin/upload/service-image', {
                    method: 'POST',
                    credentials: 'include',
                    body: formData
                });
                const data = await res.json();

                if (data.success) {
                    urlField.value = data.imageUrl;
                    // Preview the stored copy, not the local file, so a failed
                    // server-side save is visible straight away
                    showPreview(data.imageUrl);
                    Utils.showToast('Image uploaded!', 'success');
                    console.log('Image URL:', data.imageUrl);
                } else {
                    showPreview(previousImageUrl);
                    e.target.value = '';
                    Utils.showToast('Upload failed: ' + data.error, 'error');
                }
            } catch (err) {
                console.error('Upload error:', err);
                showPreview(previousImageUrl);
                e.target.value = '';
                Utils.showToast('Upload failed', 'error');
            }
        });
    },

    setupEventListeners() {
        document.getElementById('addServiceBtn')?.addEventListener('click', () => this.openModal());
        document.getElementById('closeServiceModal')?.addEventListener('click', () => this.closeModal());
        document.getElementById('cancelServiceBtn')?.addEventListener('click', () => this.closeModal());
        document.getElementById('serviceForm')?.addEventListener('submit', (e) => this.save(e));

        document.querySelectorAll('[data-service-category]').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('[data-service-category]').forEach(b => b.classList.remove('active', 'bg-primary', 'text-black'));
                btn.classList.add('active', 'bg-primary', 'text-black');
                this.render(btn.dataset.serviceCategory);
            });
        });

        document.getElementById('addPricingOptionBtn')?.addEventListener('click', () => this.addPricingOptionRow());

        const rows = document.getElementById('pricingOptionsRows');
        if (rows) {
            rows.addEventListener('input', () => this.updatePricingPreview());
            rows.addEventListener('click', (e) => {
                const btn = e.target.closest('.remove-pricing-option-btn');
                if (!btn) return;
                if (rows.querySelectorAll('.pricing-option-row').length <= 1) return;
                btn.closest('.pricing-option-row').remove();
                this.updatePricingPreview();
            });
        }
    },

    renderPricingOptionRow(option) {
        const row = document.createElement('div');
        row.className = 'pricing-option-row grid grid-cols-[1fr,auto,auto,auto] gap-3 items-center';
        row.innerHTML = `
            <input type="text" class="pricing-option-label w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 focus:border-primary focus:outline-none" placeholder="e.g. 40 minutes">
            <input type="number" class="pricing-option-price w-28 bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 focus:border-primary focus:outline-none" placeholder="Price" min="0" step="0.01">
            <input type="number" class="pricing-option-duration w-28 bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 focus:border-primary focus:outline-none" placeholder="Optional" min="1" step="1">
            <button type="button" class="remove-pricing-option-btn w-9 h-9 flex items-center justify-center rounded-lg bg-red-900/40 text-red-400 hover:bg-red-900/60">
                <span class="material-symbols-outlined text-lg">remove</span>
            </button>
        `;
        row.querySelector('.pricing-option-label').value = option.label || '';
        row.querySelector('.pricing-option-price').value = option.price ?? '';
        row.querySelector('.pricing-option-duration').value = option.durationMinutes || '';
        return row;
    },

    renderPricingOptionRows(options) {
        const container = document.getElementById('pricingOptionsRows');
        if (!container) return;
        container.innerHTML = '';
        (options.length ? options : [{ label: '', price: '' }]).forEach(opt => {
            container.appendChild(this.renderPricingOptionRow(opt));
        });
        this.updatePricingPreview();
    },

    addPricingOptionRow() {
        const container = document.getElementById('pricingOptionsRows');
        if (!container) return;
        container.appendChild(this.renderPricingOptionRow({ label: '', price: '' }));
        this.updatePricingPreview();
    },

    readPricingOptionRows() {
        return Array.from(document.querySelectorAll('#pricingOptionsRows .pricing-option-row')).map(row => {
            const durationVal = parseInt(row.querySelector('.pricing-option-duration').value, 10);
            return {
                label: row.querySelector('.pricing-option-label').value.trim(),
                price: parseFloat(row.querySelector('.pricing-option-price').value),
                durationMinutes: isNaN(durationVal) ? null : durationVal
            };
        });
    },

    updatePricingPreview() {
        const preview = document.getElementById('pricingOptionsPreview');
        if (!preview) return;
        const options = this.readPricingOptionRows().filter(o => !isNaN(o.price));
        if (!options.length) {
            preview.innerHTML = '<span class="text-white text-sm">No pricing set yet</span>';
            return;
        }
        preview.innerHTML = options.map(o => {
            const label = o.label ? (Utils.escapeHtml ? Utils.escapeHtml(o.label) : o.label) + ' ' : '';
            const duration = o.durationMinutes ? ` <span class="text-gray-500">(${o.durationMinutes} min)</span>` : '';
            return `<span class="px-3 py-1.5 rounded-lg bg-gray-900 border border-gray-700 text-sm text-white">${label}€${o.price}${duration}</span>`;
        }).join('');
    },

    async load() {
        try {
            let data = await API.get('/services');
            if (!data.success) {
                const res = await fetch('/api/marketplace/services');
                data = await res.json();
            }
            this.services = data.services || [];
            this.render();
        } catch (err) {
            this.services = [];
            this.render();
        }
    },

    render(category = 'all') {
        const grid = document.getElementById('servicesGrid');
        if (!grid) return;

        const list = category === 'all' ? this.services : this.services.filter(s => s.category === category);

        if (!list.length) {
            grid.innerHTML = '<p class="text-white col-span-full text-center py-8">No services found</p>';
            return;
        }

        grid.innerHTML = list.map(s => {
            let options = s.pricing_options;
            if (typeof options === 'string') {
                try { options = JSON.parse(options); } catch (e) { options = []; }
            }
            const hasMultipleOptions = Array.isArray(options) && options.length > 1;

            return `
            <div class="glass rounded-xl overflow-hidden group">
                <div class="relative" style="aspect-ratio: 3/1;">
                    ${s.image_url
                        ? `<img src="${s.image_url}" alt="${s.name}" class="w-full h-full object-cover" onerror="this.src='https://placehold.co/600x200/1a1a2e/666?text=No+Image'">`
                        : `<div class="w-full h-full bg-gray-800 flex items-center justify-center"><span class="material-symbols-outlined text-4xl text-white">image</span></div>`
                    }
                    <span class="absolute top-2 right-2 px-2 py-0.5 rounded-full text-xs ${s.is_active ? 'bg-green-500/20 text-green-400' : 'bg-gray-500/20 text-white'}">${s.is_active ? 'Active' : 'Inactive'}</span>
                    ${s.booking_type && s.booking_type !== 'none' ? `<span class="absolute top-2 left-2 px-2 py-0.5 rounded-full text-xs bg-blue-500/20 text-blue-400">Booking Required</span>` : ''}
                </div>
                <div class="p-4">
                    <h4 class="font-semibold mb-1">${s.name}</h4>
                    <p class="text-white text-sm mb-3 line-clamp-2">${s.short_description || ''}</p>
                    <div class="flex items-center justify-between">
                        <span class="text-primary font-bold">${hasMultipleOptions ? 'From ' : ''}${Utils.formatCurrency(s.price)}${!hasMultipleOptions && s.price_note ? `<span class="text-white text-xs">/${s.price_note}</span>` : ''}</span>
                        <div class="flex gap-2">
                            <button onclick="Marketplace.edit('${s.id}')" class="text-primary hover:text-primary-light"><span class="material-symbols-outlined text-lg">edit</span></button>
                            <button onclick="Marketplace.delete('${s.id}')" class="text-red-400 hover:text-red-300"><span class="material-symbols-outlined text-lg">delete</span></button>
                        </div>
                    </div>
                </div>
            </div>
        `;
        }).join('');
    },

    openModal(service = null) {
        this.currentServiceId = service?.id || null;
        document.getElementById('serviceModalTitle').textContent = service ? 'Edit Service' : 'Add Service';
        document.getElementById('serviceId').value = service?.id || '';
        document.getElementById('serviceName').value = service?.name || '';
        document.getElementById('serviceShortDesc').value = service?.short_description || '';
        document.getElementById('serviceDescription').value = service?.description || '';
        document.getElementById('serviceCategory').value = service?.category || '';
        document.getElementById('serviceLocation').value = service?.location || '';
        document.getElementById('serviceMaxQuantity').value = service?.max_quantity || 10;
        document.getElementById('serviceActive').checked = service?.is_active ?? true;
        document.getElementById('serviceFeatures').value = Array.isArray(service?.features) ? service.features.join(', ') : '';
        document.getElementById('serviceImageUrl').value = service?.image_url || '';

        // Pricing options
        let pricingOptions = service?.pricing_options;
        if (typeof pricingOptions === 'string') {
            try { pricingOptions = JSON.parse(pricingOptions); } catch (e) { pricingOptions = []; }
        }
        if (!Array.isArray(pricingOptions) || !pricingOptions.length) {
            pricingOptions = service ? [{ label: service.price_note || '', price: service.price ?? '' }] : [{ label: '', price: '' }];
        }
        this.renderPricingOptionRows(pricingOptions);

        // Booking fields
        const bookingEnabled = !!service?.booking_type && service.booking_type !== 'none';
        document.getElementById('serviceBookingEnabled').checked = bookingEnabled;
        document.getElementById('serviceDurationUnit').value = service?.duration_unit || 'days';
        document.getElementById('serviceMinDuration').value = service?.min_duration || 1;
        document.getElementById('serviceSlotsPerDay').value = service?.slots_per_day || 1;
        document.getElementById('serviceStartTime').value = service?.booking_start_time || '09:00';
        document.getElementById('serviceEndTime').value = service?.booking_end_time || '18:00';
        document.getElementById('serviceAvailableDays').value = service?.available_days || '1,2,3,4,5,6,0';

        document.getElementById('bookingSettingsFields')?.classList.toggle('hidden', !bookingEnabled);
        this._updateBookingUnitLabels?.();

        const previewImg = document.getElementById('imagePreviewImg');
        const placeholder = document.getElementById('imagePlaceholder');
        if (service?.image_url) {
            previewImg.src = service.image_url;
            previewImg.classList.remove('hidden');
            placeholder.classList.add('hidden');
        } else {
            previewImg.classList.add('hidden');
            placeholder.classList.remove('hidden');
        }

        document.getElementById('serviceModal').classList.remove('hidden');
    },

    closeModal() {
        document.getElementById('serviceModal').classList.add('hidden');
        this.currentServiceId = null;
    },

    edit(id) {
        const service = this.services.find(s => s.id === id);
        if (service) this.openModal(service);
    },

    async save(e) {
        e.preventDefault();

        const pricingOptions = this.readPricingOptionRows().filter(o => !isNaN(o.price) && o.price >= 0);
        if (!pricingOptions.length) {
            Utils.showToast('Add at least one pricing option', 'error');
            return;
        }
        const cheapest = pricingOptions.reduce((min, o) => o.price < min.price ? o : min, pricingOptions[0]);
        document.getElementById('servicePrice').value = cheapest.price;
        document.getElementById('servicePriceNote').value = pricingOptions.length > 1 ? '' : (cheapest.label || '');

        const featuresVal = document.getElementById('serviceFeatures').value;
        const data = {
            name: document.getElementById('serviceName').value,
            short_description: document.getElementById('serviceShortDesc').value,
            description: document.getElementById('serviceDescription').value,
            category: document.getElementById('serviceCategory').value,
            location: document.getElementById('serviceLocation').value,
            price: parseFloat(document.getElementById('servicePrice').value),
            price_note: document.getElementById('servicePriceNote').value,
            pricing_options: JSON.stringify(pricingOptions),
            max_quantity: parseInt(document.getElementById('serviceMaxQuantity').value) || 10,
            is_active: document.getElementById('serviceActive').checked,
            features: featuresVal ? JSON.stringify(featuresVal.split(',').map(f => f.trim())) : '[]',
            image_url: document.getElementById('serviceImageUrl').value,
            // Booking fields
            booking_type: (() => {
                if (!document.getElementById('serviceBookingEnabled').checked) return 'none';
                return document.getElementById('serviceDurationUnit').value === 'hours' ? 'time_slots' : 'daily';
            })(),
            duration_unit: document.getElementById('serviceDurationUnit').value,
            min_duration: parseInt(document.getElementById('serviceMinDuration').value) || 1,
            slots_per_day: parseInt(document.getElementById('serviceSlotsPerDay').value) || 1,
            booking_start_time: document.getElementById('serviceStartTime').value,
            booking_end_time: document.getElementById('serviceEndTime').value,
            available_days: document.getElementById('serviceAvailableDays').value
        };

        try {
            const result = this.currentServiceId
                ? await API.put(`/services/${this.currentServiceId}`, data)
                : await API.post('/services', data);

            if (result.success) {
                Utils.showToast(this.currentServiceId ? 'Service updated' : 'Service created', 'success');
                this.closeModal();
                await this.load();
            } else {
                Utils.showToast(result.error || 'Save failed', 'error');
            }
        } catch (err) {
            Utils.showToast('Save failed', 'error');
        }
    },

    async delete(id) {
        if (!confirm('Delete this service?')) return;
        try {
            const result = await API.delete(`/services/${id}`);
            if (result.success) {
                Utils.showToast('Service deleted', 'success');
                await this.load();
            }
        } catch (err) {
            Utils.showToast('Delete failed', 'error');
        }
    }
};

window.Marketplace = Marketplace;
