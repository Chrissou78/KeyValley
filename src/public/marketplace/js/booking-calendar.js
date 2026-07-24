// Booking Calendar Component for Services
const BookingCalendar = {
  serviceId: null,
  currentDate: new Date(),
  selectedDate: null,
  selectedSlot: null,
  availability: {},
  settings: {},
  onSelectCallback: null,
  containerId: 'bookingCalendarContainer',

  async init(serviceId, onSelect) {
    this.serviceId = serviceId;
    this.onSelectCallback = onSelect;
    this.selectedDate = null;
    this.selectedSlot = null;
    this.currentDate = new Date();
    
    await this.loadAvailability();
    this.render();
  },

  async loadAvailability() {
    try {
      const year = this.currentDate.getFullYear();
      const month = this.currentDate.getMonth() + 1;
      
      const response = await fetch(`/api/marketplace/services/${this.serviceId}/availability?year=${year}&month=${month}`);
      const data = await response.json();
      
      if (data.success) {
        this.settings = data.settings || {};
        this.availability = data.bookedSlots || {};
      }
    } catch (error) {
      console.error('Failed to load availability:', error);
    }
  },

  render() {
    const container = document.getElementById(this.containerId);
    if (!container) return;

    const year = this.currentDate.getFullYear();
    const month = this.currentDate.getMonth();
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 
                        'July', 'August', 'September', 'October', 'November', 'December'];
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    // Get first day of month and total days
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Available days (0=Sun, 1=Mon, etc.)
    const availableDays = this.settings.available_days 
      ? this.settings.available_days.split(',').map(d => parseInt(d.trim()))
      : [0, 1, 2, 3, 4, 5, 6];

    let html = `
      <div class="booking-calendar bg-gray-800/50 rounded-xl p-4 border border-gray-700">
        <div class="calendar-header flex items-center justify-between mb-4">
          <button type="button" onclick="BookingCalendar.prevMonth()" 
                  class="p-2 hover:bg-gray-700 rounded-lg transition-colors">
            <svg class="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/>
            </svg>
          </button>
          <h3 class="text-lg font-semibold text-white">${monthNames[month]} ${year}</h3>
          <button type="button" onclick="BookingCalendar.nextMonth()" 
                  class="p-2 hover:bg-gray-700 rounded-lg transition-colors">
            <svg class="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/>
            </svg>
          </button>
        </div>

        <div class="calendar-grid">
          <div class="grid grid-cols-7 gap-1 mb-2">
            ${dayNames.map(day => `
              <div class="text-center text-xs font-medium text-white py-2">${day}</div>
            `).join('')}
          </div>
          
          <div class="grid grid-cols-7 gap-1">
    `;

    // Empty cells for days before first of month
    for (let i = 0; i < firstDay; i++) {
      html += `<div class="aspect-square"></div>`;
    }

    // Day cells
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(year, month, day);
      const dateStr = this.formatDate(date);
      const dayOfWeek = date.getDay();
      
      const isPast = date < today;
      const isAvailableDay = availableDays.includes(dayOfWeek);
      const bookedCount = this.availability[dateStr] || 0;
      const maxSlots = this.settings.slots_per_day || 1;
      const isFullyBooked = bookedCount >= maxSlots;
      const isSelected = this.selectedDate === dateStr;
      
      const isDisabled = isPast || !isAvailableDay || isFullyBooked;

      let cellClass = 'aspect-square flex items-center justify-center rounded-lg text-sm font-medium transition-all cursor-pointer ';
      
      if (isSelected) {
        cellClass += 'bg-amber-500 text-gray-900 ring-2 ring-amber-400';
      } else if (isDisabled) {
        cellClass += 'bg-gray-800/30 text-white cursor-not-allowed';
      } else if (bookedCount > 0) {
        cellClass += 'bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 border border-amber-500/30';
      } else {
        cellClass += 'bg-gray-700/50 text-white hover:bg-gray-700 hover:text-white';
      }

      const clickHandler = isDisabled ? '' : `onclick="BookingCalendar.selectDate('${dateStr}')"`;
      
      html += `
        <div class="${cellClass}" ${clickHandler} title="${isFullyBooked ? 'Fully booked' : (isPast ? 'Past date' : (!isAvailableDay ? 'Not available' : 'Available'))}">
          ${day}
          ${bookedCount > 0 && !isFullyBooked ? `<span class="absolute bottom-0.5 text-[8px]">${maxSlots - bookedCount} left</span>` : ''}
        </div>
      `;
    }

    html += `
          </div>
        </div>

        <div class="calendar-legend flex items-center justify-center gap-4 mt-4 text-xs text-white">
          <div class="flex items-center gap-1">
            <div class="w-3 h-3 rounded bg-gray-700/50"></div>
            <span>Available</span>
          </div>
          <div class="flex items-center gap-1">
            <div class="w-3 h-3 rounded bg-amber-500/20 border border-amber-500/30"></div>
            <span>Limited</span>
          </div>
          <div class="flex items-center gap-1">
            <div class="w-3 h-3 rounded bg-gray-800/30"></div>
            <span>Unavailable</span>
          </div>
        </div>
    `;

    // Time slots section (if booking_type is 'time_slots')
    if (this.settings.booking_type === 'time_slots' && this.selectedDate) {
      html += this.renderTimeSlots();
    }

    // Selected date display
    if (this.selectedDate) {
      const displayDate = new Date(this.selectedDate + 'T00:00:00');
      html += `
        <div class="selected-date mt-4 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg">
          <p class="text-sm text-amber-400">
            <span class="font-medium">Selected:</span> 
            ${displayDate.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
            ${this.selectedSlot ? ` at ${this.selectedSlot}` : ''}
          </p>
        </div>
      `;
    }

    html += `</div>`;
    container.innerHTML = html;
  },

  renderTimeSlots() {
    const slots = this.generateTimeSlots();
    const dateBookings = this.getBookedSlotsForDate(this.selectedDate);
    
    return `
      <div class="time-slots mt-4 pt-4 border-t border-gray-700">
        <h4 class="text-sm font-medium text-white mb-3">Select a time slot:</h4>
        <div class="grid grid-cols-3 sm:grid-cols-4 gap-2">
          ${slots.map(slot => {
            const isBooked = dateBookings.includes(slot);
            const isSelected = this.selectedSlot === slot;
            
            let btnClass = 'py-2 px-3 rounded-lg text-sm font-medium transition-all ';
            if (isSelected) {
              btnClass += 'bg-amber-500 text-gray-900';
            } else if (isBooked) {
              btnClass += 'bg-gray-800/30 text-white cursor-not-allowed';
            } else {
              btnClass += 'bg-gray-700/50 text-white hover:bg-gray-700 hover:text-white cursor-pointer';
            }
            
            const clickHandler = isBooked ? '' : `onclick="BookingCalendar.selectSlot('${slot}')"`;
            
            return `<button type="button" class="${btnClass}" ${clickHandler} ${isBooked ? 'disabled' : ''}>${slot}</button>`;
          }).join('')}
        </div>
      </div>
    `;
  },

  generateTimeSlots() {
    const slots = [];
    const startTime = this.settings.booking_start_time || '09:00';
    const endTime = this.settings.booking_end_time || '18:00';
    const duration = this.settings.slot_duration_minutes || 60;

    const [startHour, startMin] = startTime.split(':').map(Number);
    const [endHour, endMin] = endTime.split(':').map(Number);

    let current = startHour * 60 + startMin;
    const end = endHour * 60 + endMin;

    while (current + duration <= end) {
      const hours = Math.floor(current / 60);
      const mins = current % 60;
      slots.push(`${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`);
      current += duration;
    }

    return slots;
  },

  getBookedSlotsForDate(dateStr) {
    // This would come from the API - for now return empty array
    return this.availability[dateStr + '_slots'] || [];
  },

  formatDate(date) {
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return `${year}-${month}-${day}`;
  },

  selectDate(dateStr) {
    this.selectedDate = dateStr;
    this.selectedSlot = null;
    this.render();
    
    if (this.settings.booking_type !== 'time_slots') {
      this.triggerCallback();
    }
  },

  selectSlot(slot) {
    this.selectedSlot = slot;
    this.render();
    this.triggerCallback();
  },

  triggerCallback() {
    if (this.onSelectCallback) {
      this.onSelectCallback({
        date: this.selectedDate,
        slot: this.selectedSlot
      });
    }
  },

  async prevMonth() {
    this.currentDate.setMonth(this.currentDate.getMonth() - 1);
    await this.loadAvailability();
    this.render();
  },

  async nextMonth() {
    this.currentDate.setMonth(this.currentDate.getMonth() + 1);
    await this.loadAvailability();
    this.render();
  },

  getSelection() {
    return {
      date: this.selectedDate,
      slot: this.selectedSlot
    };
  },

  clearSelection() {
    this.selectedDate = null;
    this.selectedSlot = null;
    this.render();
  }
};

window.BookingCalendar = BookingCalendar;
