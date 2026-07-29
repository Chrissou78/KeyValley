const db = require('./src/db-postgres');
(async () => {
    const testWallet = '0xtestbookingwallet000000000000000000002';
    await db.pool.query(`
        INSERT INTO member_balances (wallet_address, balance, total_spent)
        VALUES ($1, 1000, 0)
        ON CONFLICT (wallet_address) DO UPDATE SET balance = 1000
    `, [testWallet]);

    const massage = await db.pool.query("SELECT id FROM marketplace_services WHERE name LIKE 'Massage - Antistress'");
    const serviceId = massage.rows[0].id;

    const payload = {
        wallet_address: testWallet,
        email: 'timing-test@example.com',
        items: [{
            service_id: serviceId,
            quantity: 1,
            options: { bookingDate: '2026-08-10', timeSlotStart: '15:00:00', timeSlotEnd: '16:30:00', totalPrice: 45, selectedOptionLabel: '90 minutes', selectedOptionPrice: 45 }
        }]
    };

    const start = Date.now();
    const res = await fetch('http://localhost:3005/api/marketplace/checkout/tokens', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    });
    const elapsed = Date.now() - start;
    const data = await res.json();
    console.log('Response time (ms):', elapsed, '| status:', res.status, '| success:', data.success);
    console.log('Voucher price recorded:', data.vouchers && data.vouchers[0] && data.vouchers[0].value);

    // cleanup
    await db.pool.query('DELETE FROM service_bookings WHERE service_id = $1', [serviceId]);
    await db.pool.query('DELETE FROM marketplace_vouchers WHERE service_id = $1', [serviceId]);
    await db.pool.query('DELETE FROM marketplace_orders WHERE wallet_address = $1', [testWallet]);
    await db.pool.query('DELETE FROM token_transactions WHERE wallet_address = $1', [testWallet]);
    await db.pool.query('DELETE FROM member_balances WHERE wallet_address = $1', [testWallet]);
    // restore original single pricing option on the massage service
    await db.pool.query("UPDATE marketplace_services SET pricing_options = '[{\"label\":\"per session\",\"price\":20}]' WHERE id = $1", [serviceId]);
    console.log('Cleaned up.');
    await db.pool.end();
})().catch(e => { console.error(e); process.exit(1); });
