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
        const bookingType = document.getElementById('serviceBookingType');
        const timeSlotSettings = document.getElementById('timeSlotSettings');
        
        if (bookingType && timeSlotSettings) {
            bookingType.addEventListener('change', () => {
                if (bookingType.value === 'time_slots') {
                    timeSlotSettings.classList.remove('hidden');
                } else {
                    timeSlotSettings.classList.add('hidden');
                }
            });
        }
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

            if (file.size > 5 * 1024 * 1024) {
                Utils.showToast('Image must be less than 5MB', 'error');
                return;
            }

            const reader = new FileReader();
            reader.onload = (ev) => {
                const previewImg = document.getElementById('imagePreviewImg');
                const placeholder = document.getElementById('imagePlaceholder');
                if (previewImg && placeholder) {
                    previewImg.src = ev.target.result;
                    previewImg.classList.remove('hidden');
                    placeholder.classList.add('hidden');
                }
            };
            reader.readAsDataURL(file);

            const formData = new FormData();
            formData.append('image', file);
            
            const oldImageUrl = document.getElementById('serviceImageUrl').value;
            if (oldImageUrl) {
                formData.append('oldImageUrl', oldImageUrl);
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
                    document.getElementById('serviceImageUrl').value = data.imageUrl;
                    Utils.showToast('Image uploaded!', 'success');
                    console.log('Image URL:', data.imageUrl);
                } else {
                    Utils.showToast('Upload failed: ' + data.error, 'error');
                }
            } catch (err) {
                console.error('Upload error:', err);
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
            grid.innerHTML = '<p class="text-gray-500 col-span-full text-center py-8">No services found</p>';
            return;
        }

        grid.innerHTML = list.map(s => `
            <div class="glass rounded-xl overflow-hidden group">
                <div class="relative" style="aspect-ratio: 3/1;">
                    ${s.image_url
                        ? `<img src="${s.image_url}" alt="${s.name}" class="w-full h-full object-cover" onerror="this.src='https://placehold.co/600x200/1a1a2e/666?text=No+Image'">`
                        : `<div class="w-full h-full bg-gray-800 flex items-center justify-center"><span class="material-symbols-outlined text-4xl text-gray-600">image</span></div>`
                    }
                    <span class="absolute top-2 right-2 px-2 py-0.5 rounded-full text-xs ${s.is_active ? 'bg-green-500/20 text-green-400' : 'bg-gray-500/20 text-gray-400'}">${s.is_active ? 'Active' : 'Inactive'}</span>
                    ${s.booking_type && s.booking_type !== 'none' ? `<span class="absolute top-2 left-2 px-2 py-0.5 rounded-full text-xs bg-blue-500/20 text-blue-400">Booking Required</span>` : ''}
                </div>
                <div class="p-4">
                    <h4 class="font-semibold mb-1">${s.name}</h4>
                    <p class="text-gray-400 text-sm mb-3 line-clamp-2">${s.short_description || ''}</p>
                    <div class="flex items-center justify-between">
                        <span class="text-primary font-bold">${Utils.formatCurrency(s.price)}${s.price_note ? `<span class="text-gray-500 text-xs">/${s.price_note}</span>` : ''}</span>
                        <div class="flex gap-2">
                            <button onclick="Marketplace.edit('${s.id}')" class="text-primary hover:text-primary-light"><span class="material-symbols-outlined text-lg">edit</span></button>
                            <button onclick="Marketplace.delete('${s.id}')" class="text-red-400 hover:text-red-300"><span class="material-symbols-outlined text-lg">delete</span></button>
                        </div>
                    </div>
                </div>
            </div>
        `).join('');
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
        document.getElementById('servicePrice').value = service?.price || '';
        document.getElementById('servicePriceNote').value = service?.price_note || '';
        document.getElementById('serviceMaxQuantity').value = service?.max_quantity || 10;
        document.getElementById('serviceActive').checked = service?.is_active ?? true;
        document.getElementById('serviceFeatures').value = Array.isArray(service?.features) ? service.features.join(', ') : '';
        document.getElementById('serviceImageUrl').value = service?.image_url || '';
        
        // Booking fields
        document.getElementById('serviceBookingType').value = service?.booking_type || 'none';
        document.getElementById('serviceSlotsPerDay').value = service?.slots_per_day || 1;
        document.getElementById('serviceStartTime').value = service?.booking_start_time || '09:00';
        document.getElementById('serviceEndTime').value = service?.booking_end_time || '18:00';
        document.getElementById('serviceSlotDuration').value = service?.slot_duration_minutes || 60;
        document.getElementById('serviceAvailableDays').value = service?.available_days || '1,2,3,4,5,6,0';
        
        // Toggle time slot settings visibility
        const timeSlotSettings = document.getElementById('timeSlotSettings');
        if (service?.booking_type === 'time_slots') {
            timeSlotSettings?.classList.remove('hidden');
        } else {
            timeSlotSettings?.classList.add('hidden');
        }

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

        const featuresVal = document.getElementById('serviceFeatures').value;
        const data = {
            name: document.getElementById('serviceName').value,
            short_description: document.getElementById('serviceShortDesc').value,
            description: document.getElementById('serviceDescription').value,
            category: document.getElementById('serviceCategory').value,
            location: document.getElementById('serviceLocation').value,
            price: parseFloat(document.getElementById('servicePrice').value),
            price_note: document.getElementById('servicePriceNote').value,
            max_quantity: parseInt(document.getElementById('serviceMaxQuantity').value) || 10,
            is_active: document.getElementById('serviceActive').checked,
            features: featuresVal ? JSON.stringify(featuresVal.split(',').map(f => f.trim())) : '[]',
            image_url: document.getElementById('serviceImageUrl').value,
            // Booking fields
            booking_type: document.getElementById('serviceBookingType').value,
            slots_per_day: parseInt(document.getElementById('serviceSlotsPerDay').value) || 1,
            booking_start_time: document.getElementById('serviceStartTime').value,
            booking_end_time: document.getElementById('serviceEndTime').value,
            slot_duration_minutes: parseInt(document.getElementById('serviceSlotDuration').value) || 60,
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
