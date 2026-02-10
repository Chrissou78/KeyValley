// questionnaire.js - Questionnaire management

const Questionnaire = {
    responses: [],
    stats: {},

    async load() {
        try {
            const [responsesData, statsData] = await Promise.all([
                API.getQuestionnaireExport(),
                API.getQuestionnaireStats()
            ]);
            
            this.responses = responsesData.responses || responsesData || [];
            this.stats = statsData.stats || statsData || {};
            
            this.updateStats();
            this.renderTable();
        } catch (error) {
            console.error('Failed to load questionnaire:', error);
            this.responses = [];
            this.stats = {};
            this.updateStats();
            this.renderTable();
        }
    },

    updateStats() {
        const setEl = (id, value) => {
            const el = document.getElementById(id);
            if (el) el.textContent = value;
        };
        
        setEl('qTotalResponses', this.stats.total_responses || this.responses.length || 0);
        setEl('qPropertyOwners', this.stats.property_owners || 0);
        setEl('qMembersClub', this.stats.interested_members_club || 0);
        setEl('qBoatOwners', this.stats.boat_owners || 0);
    },

    renderTable() {
        const tbody = document.getElementById('questionnaireTableBody');
        if (!tbody) return;
        
        if (this.responses.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" class="text-center py-8 text-gray-400">No questionnaire responses yet</td></tr>';
            return;
        }
        
        tbody.innerHTML = this.responses.map(r => `
            <tr class="border-b border-gray-700/50 hover:bg-white/5">
                <td class="py-3 px-4">
                    <code class="text-xs text-gray-400">${Utils.formatAddress(r.wallet_address)}</code>
                </td>
                <td class="py-3 px-4 text-sm">${r.email || '-'}</td>
                <td class="py-3 px-4">
                    <span class="px-2 py-1 rounded text-xs ${r.is_property_owner ? 'bg-green-500/20 text-green-400' : 'bg-gray-700 text-gray-400'}">
                        ${r.is_property_owner ? 'Yes' : 'No'}
                    </span>
                </td>
                <td class="py-3 px-4 text-sm text-gray-300">${r.property_location || '-'}</td>
                <td class="py-3 px-4">
                    <span class="px-2 py-1 rounded text-xs ${r.interested_members_club ? 'bg-blue-500/20 text-blue-400' : 'bg-gray-700 text-gray-400'}">
                        ${r.interested_members_club ? 'Yes' : 'No'}
                    </span>
                </td>
                <td class="py-3 px-4">
                    <span class="px-2 py-1 rounded text-xs ${r.owns_boat ? 'bg-yellow-500/20 text-yellow-400' : 'bg-gray-700 text-gray-400'}">
                        ${r.owns_boat ? 'Yes' : 'No'}
                    </span>
                </td>
                <td class="py-3 px-4 text-sm text-gray-400">${Utils.formatDate(r.created_at)}</td>
            </tr>
        `).join('');
    },

    exportCSV() {
        if (!this.responses.length) {
            Utils.showToast('No data to export', 'error');
            return;
        }
        
        const headers = [
            'Wallet Address',
            'Email',
            'Property Owner',
            'Property Location',
            'Interested Property Index',
            'Interested Property Tour',
            'Interested Members Club',
            'Owns Boat',
            'Interested Yacht Club',
            'Interested Restaurant Review',
            'Date'
        ];
        
        const rows = this.responses.map(r => [
            r.wallet_address,
            r.email || '',
            r.is_property_owner ? 'Yes' : 'No',
            r.property_location || '',
            r.interested_property_index ? 'Yes' : 'No',
            r.interested_property_tour ? 'Yes' : 'No',
            r.interested_members_club ? 'Yes' : 'No',
            r.owns_boat ? 'Yes' : 'No',
            r.interested_yacht_club ? 'Yes' : 'No',
            r.interested_restaurant_review ? 'Yes' : 'No',
            r.created_at || ''
        ]);
        
        const csv = [headers, ...rows].map(row => row.map(c => `"${c}"`).join(',')).join('\n');
        
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `kea-valley-questionnaire-${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        
        Utils.showToast('CSV exported successfully!');
    }
};

window.Questionnaire = Questionnaire;
