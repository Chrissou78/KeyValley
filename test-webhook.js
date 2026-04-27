// test-webhook.js
// Run with: node test-webhook.js

const WEBHOOK_URL = 'https://api.wallettwo.com/workflow/v1/vbd3tHept6rmcdF7gSSo0WjIdBDU7hGf/b00ca238-bbc2-4896-b835-de0aa4ab0d04/webhook?secret_key=whk_wUBn1nBx4qOQ9SoukmKGHnYFRd2PXkdd';

async function testWebhook() {
    console.log('=== WEBHOOK TEST ===\n');
    
    // Test 1: Minimal payload
    console.log('Test 1: Minimal ASCII payload');
    const payload1 = { email: 'christopher.fourquier@onchainlabs.ch', content: 'Test' };
    await sendAndLog(payload1);
    
    // Test 2: With HTML
    console.log('\nTest 2: Simple HTML');
    const payload2 = { email: 'christopher.fourquier@onchainlabs.ch', content: '<p>Test</p>' };
    await sendAndLog(payload2);
    
    // Test 3: Check what Node.js version sends
    console.log('\nTest 3: Debug info');
    console.log('Node version:', process.version);
    console.log('Platform:', process.platform);
    
    const testPayload = { email: 'test@test.com', content: 'Hello' };
    const jsonString = JSON.stringify(testPayload);
    console.log('JSON string:', jsonString);
    console.log('JSON bytes:', Buffer.from(jsonString).toString('hex'));
    console.log('JSON length:', jsonString.length);
    console.log('Buffer length:', Buffer.byteLength(jsonString, 'utf8'));
}

async function sendAndLog(payload) {
    const jsonBody = JSON.stringify(payload);
    console.log('  Payload:', jsonBody);
    console.log('  Content-Length:', Buffer.byteLength(jsonBody, 'utf8'));
    
    try {
        const response = await fetch(WEBHOOK_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(jsonBody, 'utf8').toString()
            },
            body: jsonBody
        });
        
        const text = await response.text();
        console.log('  Status:', response.status);
        console.log('  Response:', text.substring(0, 200));
    } catch (err) {
        console.log('  Error:', err.message);
    }
}

testWebhook();
