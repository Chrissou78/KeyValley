// ============================================
// PUBLIC CLAIM ENDPOINT (with signature verification)
// ============================================

const SIGNATURE_MESSAGE = process.env.SIGNATURE_MESSAGE || 'FREE_BONUS_TOKENS_KEA_VALLEY';

// Verify signature and recover wallet address
function verifySignature(signature, message, expectedWallet) {
  try {
    // Recover the address that signed this message
    const recoveredAddress = ethers.verifyMessage(message, signature);
    
    console.log(`   Signature verification:`);
    console.log(`   - Message: "${message}"`);
    console.log(`   - Expected wallet: ${expectedWallet}`);
    console.log(`   - Recovered from signature: ${recoveredAddress}`);
    
    // Check if recovered address matches the claimed wallet
    if (recoveredAddress.toLowerCase() === expectedWallet.toLowerCase()) {
      return { valid: true, recoveredAddress };
    } else {
      return { 
        valid: false, 
        error: 'Signature does not match wallet address',
        recoveredAddress,
        expectedWallet,
      };
    }
  } catch (error) {
    return { 
      valid: false, 
      error: `Invalid signature format: ${error.message}`,
    };
  }
}

// POST /api/claim/register - Register wallet with signature verification
app.post('/api/claim/register', async (req, res) => {
  const { wallet_address, signature, message } = req.body;

  console.log('\n🎁 Claim request:', wallet_address);

  // Validate wallet address
  if (!wallet_address) {
    return res.status(400).json({ error: 'wallet_address is required' });
  }

  if (!ethers.isAddress(wallet_address)) {
    return res.status(400).json({ error: 'Invalid wallet address' });
  }

  // Verify signature if provided
  if (signature) {
    const messageToVerify = message || SIGNATURE_MESSAGE;
    const verification = verifySignature(signature, messageToVerify, wallet_address);
    
    if (!verification.valid) {
      console.log(`   ❌ Signature verification failed: ${verification.error}`);
      return res.status(401).json({ 
        error: 'Signature verification failed',
        details: verification.error,
        expected: wallet_address,
        recovered: verification.recoveredAddress,
      });
    }
    
    console.log(`   ✅ Signature verified!`);
  } else {
    // No signature provided - you can choose to:
    // Option A: Reject the request
    // return res.status(400).json({ error: 'Signature is required' });
    
    // Option B: Allow it (trusting the redirect came from WalletTwo)
    console.log(`   ⚠️ No signature provided, proceeding without verification`);
  }

  try {
    // Initialize minter
    await minter.initialize();

    // Check if already has tokens on-chain
    const hasTokens = await minter.hasTokens(wallet_address);
    if (hasTokens) {
      const balance = await minter.getBalance(wallet_address);
      console.log(`   Already has tokens: ${balance}`);
      
      const existing = db.getRegistrant(wallet_address);
      if (existing && !existing.minted) {
        const network = process.env.NETWORK || 'amoy';
        db.markAsMinted(wallet_address, 'ALREADY_HAD_TOKENS', network);
      }

      return res.json({
        already_claimed: true,
        wallet_address: wallet_address.toLowerCase(),
        balance: balance,
        symbol: minter.tokenSymbol,
      });
    }

    // Check if already registered and minted in DB
    const existing = db.getRegistrant(wallet_address);
    if (existing && existing.minted) {
      const balance = await minter.getBalance(wallet_address);
      console.log(`   Already claimed in DB`);
      
      return res.json({
        already_claimed: true,
        wallet_address: wallet_address.toLowerCase(),
        balance: balance,
        symbol: minter.tokenSymbol,
        tx_hash: existing.tx_hash,
      });
    }

    // Register if not exists
    if (!existing) {
      db.addRegistrant(wallet_address);
      console.log(`   Registered: ${wallet_address}`);
    }

    // Mint immediately!
    const MINT_AMOUNT = parseInt(process.env.MINT_AMOUNT) || 2;
    console.log(`   Minting ${MINT_AMOUNT} ${minter.tokenSymbol}...`);

    const mintResult = await minter.mintToAddress(wallet_address, MINT_AMOUNT, true);

    if (mintResult.skipped) {
      const balance = await minter.getBalance(wallet_address);
      return res.json({
        already_claimed: true,
        wallet_address: wallet_address.toLowerCase(),
        balance: balance,
        symbol: minter.tokenSymbol,
      });
    }

    // Mark as minted
    const network = process.env.NETWORK || 'amoy';
    db.markAsMinted(wallet_address, mintResult.receipt.hash, network);

    console.log(`   ✅ Minted! TX: ${mintResult.receipt.hash}`);

    res.json({
      success: true,
      minted: true,
      wallet_address: wallet_address.toLowerCase(),
      amount: MINT_AMOUNT,
      symbol: minter.tokenSymbol,
      tx_hash: mintResult.receipt.hash,
      explorer_url: `${minter.networkConfig.explorer}/tx/${mintResult.receipt.hash}`,
    });

  } catch (error) {
    console.error('Claim error:', error);
    res.status(500).json({ error: error.message });
  }
});
