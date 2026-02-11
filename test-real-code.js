// test-real-code.js
// Usage: node test-real-code.js <REAL_CODE_FROM_LOGIN>

const WALLETTWO_API_KEY = 'e8ec94d87c108718d3ec6cd01f7f50888dbdf12dcc029ea294d0f4763773f7a4';
const WALLETTWO_COMPANY_ID = '6a27c2f8-894c-46c7-bf9f-f5af11d4e092';
const BASE_URL = 'https://api.wallettwo.com';

const realCode = process.argv[2];

if (!realCode) {
    console.log('❌ Please provide a real code from WalletTwo login');
    console.log('   Usage: node test-real-code.js <CODE>');
    console.log('\n   To get the code:');
    console.log('   1. Open profile page in browser');
    console.log('   2. Open DevTools Console');
    console.log('   3. Log in via WalletTwo iframe');
    console.log('   4. Look for "WalletTwo message:" log');
    console.log('   5. Copy the "code" value');
    process.exit(1);
}

async function test(name, url, options = {}) {
    console.log(`\n🔍 ${name}`);
    console.log(`   ${options.method || 'GET'} ${url.replace(WALLETTWO_API_KEY, 'KEY').replace(realCode, 'CODE')}`);
    if (options.body) console.log(`   Body:`, JSON.stringify(options.body).replace(realCode, 'CODE'));
    
    try {
        const response = await fetch(url, {
            method: options.method || 'GET',
            headers: { 'Content-Type': 'application/json', ...options.headers },
            body: options.body ? JSON.stringify(options.body) : undefined
        });
        
        const text = await response.text();
        let data;
        try { data = JSON.parse(text); } catch { data = text.substring(0, 300); }
        
        const icon = response.ok ? '✅' : '❌';
        console.log(`   ${icon} ${response.status}:`, JSON.stringify(data, null, 2).substring(0, 500));
        
        return { ok: response.ok, status: response.status, data };
    } catch (e) {
        console.log(`   ❌ Error: ${e.message}`);
        return { ok: false };
    }
}

async function run() {
    console.log('🚀 WalletTwo - Testing with REAL code\n');
    console.log(`Code: ${realCode.substring(0, 20)}...`);
    
    let accessToken = null;
    
    // ============================================
    // Step 1: Exchange code for token
    // ============================================
    console.log('\n' + '='.repeat(50));
    console.log('STEP 1: Exchange code for access token');
    console.log('='.repeat(50));
    
    // Try GET with query params
    let result = await test(
        'Consent - GET',
        `${BASE_URL}/auth/consent?code=${realCode}&apiKey=${WALLETTWO_API_KEY}&companyId=${WALLETTWO_COMPANY_ID}`
    );
    
    if (result.ok && result.data?.access_token) {
        accessToken = result.data.access_token;
        console.log('\n   🎉 Got access token!');
    }
    
    // Try POST if GET didn't work
    if (!accessToken) {
        result = await test(
            'Consent - POST (body)',
            `${BASE_URL}/auth/consent?apiKey=${WALLETTWO_API_KEY}&companyId=${WALLETTWO_COMPANY_ID}`,
            { method: 'POST', body: { code: realCode } }
        );
        
        if (result.ok && result.data?.access_token) {
            accessToken = result.data.access_token;
            console.log('\n   🎉 Got access token!');
        }
    }
    
    // Try with headers
    if (!accessToken) {
        result = await test(
            'Consent - POST (headers)',
            `${BASE_URL}/auth/consent`,
            { 
                method: 'POST', 
                body: { code: realCode },
                headers: { 
                    'x-api-key': WALLETTWO_API_KEY, 
                    'x-company-id': WALLETTWO_COMPANY_ID 
                }
            }
        );
        
        if (result.ok && result.data?.access_token) {
            accessToken = result.data.access_token;
            console.log('\n   🎉 Got access token!');
        }
    }
    
    // Try /auth/token endpoint
    if (!accessToken) {
        result = await test(
            'Token endpoint - POST',
            `${BASE_URL}/auth/token?apiKey=${WALLETTWO_API_KEY}&companyId=${WALLETTWO_COMPANY_ID}`,
            { method: 'POST', body: { code: realCode } }
        );
        
        if (result.ok && result.data?.access_token) {
            accessToken = result.data.access_token;
            console.log('\n   🎉 Got access token!');
        }
    }
    
    // ============================================
    // Step 2: Get user info with token
    // ============================================
    if (accessToken) {
        console.log('\n' + '='.repeat(50));
        console.log('STEP 2: Get user info with access token');
        console.log('='.repeat(50));
        console.log(`\nAccess Token: ${accessToken.substring(0, 30)}...`);
        
        // Try Bearer token
        await test(
            'UserInfo - Bearer token',
            `${BASE_URL}/auth/userinfo`,
            { headers: { 'Authorization': `Bearer ${accessToken}` } }
        );
        
        // Try Bearer + API key
        await test(
            'UserInfo - Bearer + apiKey query',
            `${BASE_URL}/auth/userinfo?apiKey=${WALLETTWO_API_KEY}&companyId=${WALLETTWO_COMPANY_ID}`,
            { headers: { 'Authorization': `Bearer ${accessToken}` } }
        );
        
        // Try Bearer + headers
        await test(
            'UserInfo - Bearer + x-api-key header',
            `${BASE_URL}/auth/userinfo`,
            { 
                headers: { 
                    'Authorization': `Bearer ${accessToken}`,
                    'x-api-key': WALLETTWO_API_KEY,
                    'x-company-id': WALLETTWO_COMPANY_ID
                } 
            }
        );
        
        // Try /company/members with token
        await test(
            'Members - Bearer token',
            `${BASE_URL}/company/members`,
            { headers: { 'Authorization': `Bearer ${accessToken}` } }
        );
        
    } else {
        console.log('\n❌ Could not obtain access token. The code may be expired or invalid.');
        console.log('   Codes are typically single-use and expire quickly.');
        console.log('   Try logging in again and using a fresh code immediately.');
    }
    
    console.log('\n✅ Done!\n');
}

run();
