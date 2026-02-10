// src/public/admin/js/admins.js
const Admins = {
    admins: [],

    async load() {
        // Check if user is super admin
        if (!Auth.isSuper()) {
            document.getElementById('adminsPanel').innerHTML = `
                <div class="glass rounded-xl p-6 text-center">
                    <p class="text-gray-400">Only super admins can manage the admin whitelist.</p>
                </div>
            `;
            return;
        }

        try {
            const data = await Api.getAdmins();
            this.admins = data.admins || [];
            this.render();
        } catch (error) {
            console.error('Failed to load admins:', error);
        }
    },

    render() {
        const tbody = document.getElementById('adminsTableBody');
        if (!tbody) return;

        tbody.innerHTML = this.admins.map(admin => `
            <tr class="border-t border-gray-800">
                <td class="py-3 px-4">
                    <div class="font-medium">${admin.name || '-'}</div>
                    <div class="text-sm text-gray-400">${admin.email}</div>
                </td>
                <td class="py-3 px-4">
                    <span class="px-2 py-1 rounded text-xs ${admin.role === 'super_admin' ? 'bg-purple-500/20 text-purple-400' : 'bg-blue-500/20 text-blue-400'}">
                        ${admin.role}
                    </span>
                </td>
                <td class="py-3 px-4 text-sm text-gray-400">${admin.last_login ? new Date(admin.last_login).toLocaleString() : 'Never'}</td>
                <td class="py-3 px-4 text-sm text-gray-400">${new Date(admin.created_at).toLocaleDateString()}</td>
                <td class="py-3 px-4">
                    ${admin.email !== Auth.admin?.email ? `
                        <button onclick="Admins.remove('${admin.email}')" class="text-red-400 hover:text-red-300 text-sm">
                            Remove
                        </button>
                    ` : '<span class="text-gray-600 text-sm">You</span>'}
                </td>
            </tr>
        `).join('');
    },

    async add() {
        const email = document.getElementById('newAdminEmail')?.value?.trim();
        const name = document.getElementById('newAdminName')?.value?.trim();
        const role = document.getElementById('newAdminRole')?.value || 'admin';

        if (!email) {
            alert('Email is required');
            return;
        }

        try {
            await Api.addAdmin({ email, name, role });
            document.getElementById('newAdminEmail').value = '';
            document.getElementById('newAdminName').value = '';
            this.load();
        } catch (error) {
            alert('Failed to add admin: ' + error.message);
        }
    },

    async remove(email) {
        if (!confirm(`Remove ${email} from admin whitelist?`)) return;

        try {
            await Api.removeAdmin(email);
            this.load();
        } catch (error) {
            alert('Failed to remove admin: ' + error.message);
        }
    }
};
