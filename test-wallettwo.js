// test-wallettwo-v4.js
// Focus on /company/members and auth variations

const WALLETTWO_API_KEY = 'e8ec94d87c108718d3ec6cd01f7f50888dbdf12dcc029ea294d0f4763773f7a4';
const WALLETTWO_COMPANY_ID = '6a27c2f8-894c-46c7-bf9f-f5af11d4e092';

const BASE_URL = 'https://api.wallettwo.com';
const TEST_USER_ID = '350413999524806984';
const TEST_WALLET = '0xFf0F56711F61c52662d60be95f954649441107Ec';

async function test(name, url, options = {}) {
    console.log(`\n🔍 ${name}`);
    
    try {
        const response = await fetch(url, {
            method: options.method || 'GET',
            headers: { 'Content-Type': 'application/json', ...options.headers },
            body: options.body ? JSON.stringify(options.body) : undefined
        });
        
        const text = await response.text();
        let data;
        try { data = JSON.parse(text); } catch { data = text.substring(0, 150); }
        
        const icon = response.ok ? '✅' : (response.status === 401 ? '🔐' : '❌');
        console.log(`   ${icon} ${response.status}: ${JSON.stringify(data).substring(0, 200)}`);
        
        return { ok: response.ok, status: response.status, data };
    } catch (e) {
        console.log(`   ❌ Error: ${e.message}`);
        return { ok: false };
    }
}

async function run() {
    console.log('🚀 WalletTwo API - Auth Variations Test\n');
    
    // Different auth header combinations for /company/members
    console.log('=== Testing /company/members with different auth ===\n');
    
    // 1. Query params only
    await test(
        'Members - Query params (apiKey + companyId)',
        `${BASE_URL}/company/members?apiKey=${WALLETTWO_API_KEY}&companyId=${WALLETTWO_COMPANY_ID}`
    );
    
    // 2. Headers only (x-api-key style)
    await test(
        'Members - Headers (x-api-key + x-company-id)',
        `${BASE_URL}/company/members`,
        { headers: { 'x-api-key': WALLETTWO_API_KEY, 'x-company-id': WALLETTWO_COMPANY_ID } }
    );
    
    // 3. Authorization Bearer header
    await test(
        'Members - Authorization Bearer (apiKey)',
        `${BASE_URL}/company/members?companyId=${WALLETTWO_COMPANY_ID}`,
        { headers: { 'Authorization': `Bearer ${WALLETTWO_API_KEY}` } }
    );
    
    // 4. Authorization Basic header
    await test(
        'Members - Authorization Basic',
        `${BASE_URL}/company/members?companyId=${WALLETTWO_COMPANY_ID}`,
        { headers: { 'Authorization': `Basic ${Buffer.from(WALLETTWO_API_KEY + ':').toString('base64')}` } }
    );
    
    // 5. API-Key header (different casing)
    await test(
        'Members - API-Key header',
        `${BASE_URL}/company/members?companyId=${WALLETTWO_COMPANY_ID}`,
        { headers: { 'API-Key': WALLETTWO_API_KEY } }
    );
    
    // 6. Combined query + headers
    await test(
        'Members - Query + Headers combined',
        `${BASE_URL}/company/members?apiKey=${WALLETTWO_API_KEY}&companyId=${WALLETTWO_COMPANY_ID}`,
        { headers: { 'x-api-key': WALLETTWO_API_KEY, 'x-company-id': WALLETTWO_COMPANY_ID } }
    );
    
    // 7. Try with api_key (underscore)
    await test(
        'Members - api_key underscore',
        `${BASE_URL}/company/members?api_key=${WALLETTWO_API_KEY}&company_id=${WALLETTWO_COMPANY_ID}`
    );

    // Try member singular endpoints
    console.log('\n=== Testing /company/member endpoints ===\n');
    
    await test(
        'Member by wallet (singular)',
        `${BASE_URL}/company/member?apiKey=${WALLETTWO_API_KEY}&companyId=${WALLETTWO_COMPANY_ID}&wallet=${TEST_WALLET}`
    );
    
    await test(
        'Member by userId',
        `${BASE_URL}/company/member?apiKey=${WALLETTWO_API_KEY}&companyId=${WALLETTWO_COMPANY_ID}&userId=${TEST_USER_ID}`
    );
    
    await test(
        'Member by address',
        `${BASE_URL}/company/member?apiKey=${WALLETTWO_API_KEY}&companyId=${WALLETTWO_COMPANY_ID}&address=${TEST_WALLET}`
    );

    // Try auth/consent with real flow simulation
    console.log('\n=== Testing auth endpoints ===\n');
    
    await test(
        'Auth consent - POST with code in body',
        `${BASE_URL}/auth/consent?apiKey=${WALLETTWO_API_KEY}&companyId=${WALLETTWO_COMPANY_ID}`,
        { method: 'POST', body: { code: 'test' } }
    );
    
    await test(
        'Auth userinfo - with x-api-key header',
        `${BASE_URL}/auth/userinfo`,
        { headers: { 'x-api-key': WALLETTWO_API_KEY, 'x-company-id': WALLETTWO_COMPANY_ID } }
    );
    
    // Try central API (from SDK code)
    console.log('\n=== Testing central API endpoints ===\n');
    
    await test(
        'Central API - member',
        `https://central.wallettwo.com/api/member?apiKey=${WALLETTWO_API_KEY}&companyId=${WALLETTWO_COMPANY_ID}&wallet=${TEST_WALLET}`
    );
    
    await test(
        'Central API - user',
        `https://central.wallettwo.com/api/user?apiKey=${WALLETTWO_API_KEY}&companyId=${WALLETTWO_COMPANY_ID}&userId=${TEST_USER_ID}`
    );
    
    await test(
        'Central API - userinfo',
        `https://central.wallettwo.com/api/auth/userinfo?apiKey=${WALLETTWO_API_KEY}&companyId=${WALLETTWO_COMPANY_ID}&userId=${TEST_USER_ID}`
    );

    // Try wallet.wallettwo.com endpoints
    console.log('\n=== Testing wallet.wallettwo.com endpoints ===\n');
    
    await test(
        'Wallet domain - userinfo',
        `https://wallet.wallettwo.com/api/auth/userinfo?apiKey=${WALLETTWO_API_KEY}&companyId=${WALLETTWO_COMPANY_ID}`
    );
    
    await test(
        'Wallet domain - user',
        `https://wallet.wallettwo.com/api/user/${TEST_USER_ID}?apiKey=${WALLETTWO_API_KEY}&companyId=${WALLETTWO_COMPANY_ID}`
    );

    console.log('\n✅ Done!\n');
}

run();