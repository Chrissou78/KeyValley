const db = require('./src/db-postgres');
(async () => {
    const testWallet = '0xtestbookingwallet000000000000000000001';

    await db.pool.query(`
        INSERT INTO member_balances (wallet_address, balance, total_spent)
        VALUES ($1, 1000, 0)
        ON CONFLICT (wallet_address) DO UPDATE SET balance = 1000
    `, [testWallet]);

    const massage = await db.pool.query("SELECT id, price FROM marketplace_services WHERE name LIKE 'Massage - Antistress'");
    const serviceId = massage.rows[0].id;

    const payload = {
        wallet_address: testWallet,
        email: 'test@example.com',
        items: [{
            service_id: serviceId,
            quantity: 1,
            options: { bookingDate: '2026-08-03', timeSlotStart: '11:00:00', timeSlotEnd: '12:00:00', totalPrice: parseFloat(massage.rows[0].price) }
        }]
    };

    const res1 = await fetch('http://localhost:3005/api/marketplace/checkout/tokens', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    });
    const data1 = await res1.json();
    console.log('First checkout (should succeed):', res1.status, data1.success, data1.error || '');

    const bookingCheck = await db.pool.query('SELECT * FROM service_bookings WHERE service_id = $1', [serviceId]);
    console.log('service_bookings rows for this service:', bookingCheck.rows.length);
    console.log(JSON.stringify(bookingCheck.rows, null, 2));

    // Try to book the exact same overlapping slot again (capacity=1, should be rejected)
    const res2 = await fetch('http://localhost:3005/api/marketplace/checkout/tokens', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    });
    const data2 = await res2.json();
    console.log('Second checkout of same slot (should FAIL):', res2.status, data2.success, data2.error || '');

    // Cleanup
    await db.pool.query('DELETE FROM service_bookings WHERE service_id = $1', [serviceId]);
    await db.pool.query('DELETE FROM marketplace_vouchers WHERE service_id = $1', [serviceId]);
    await db.pool.query("DELETE FROM marketplace_orders WHERE wallet_address = $1", [testWallet]);
    await db.pool.query("DELETE FROM token_transactions WHERE wallet_address = $1", [testWallet]);
    await db.pool.query('DELETE FROM member_balances WHERE wallet_address = $1', [testWallet]);
    console.log('Cleaned up test data.');

    await db.pool.end();
})().catch(e => { console.error(e); process.exit(1); });
