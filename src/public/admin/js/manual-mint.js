// manual-mint.js - Manual minting functionality (COMPLETE)

const ManualMint = {
    tokenPrice: 1.00,

    async loadConfig() {
        try {
            const config = await API.getPresaleConfig();
            this.tokenPrice = config.tokenPrice || 1.00;
            console.log('Manual mint token price loaded:', this.tokenPrice);
        } catch (error) {
            console.error('Error loading presale config for manual mint:', error);
        }
    },

    updateSummary() {
        const eur = parseFloat(document.getElementById('mint-eur')?.value) || 0;
        const fee = eur * 0.01;
        const tokensToMint = eur / this.tokenPrice;
        
        const summaryEur = document.getElementById('summary-eur');
        const summaryFee = document.getElementById('summary-fee');
        const summaryTokens = document.getElementById('summary-tokens');
        
        if (summaryEur) summaryEur.textContent = `€${eur.toFixed(2)}`;
        if (summaryFee) summaryFee.textContent = `€${fee.toFixed(2)}`;
        if (summaryTokens) summaryTokens.textContent = `${tokensToMint.toFixed(2)} VIP`;
    },

    // Mint claim tokens (free claim amount)
    async mintClaim() {
        const addressInput = document.getElementById('manualMintAddress');
        const resultDiv = document.getElementById('manualMintResult');
        const btn = document.getElementById('manualMintBtn');
        
        const address = addressInput?.value?.trim();
        
        if (!address) {
            if (resultDiv) resultDiv.innerHTML = '<p class="text-red-400">Please enter a wallet address</p>';
            return;
        }
        
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<span class="flex items-center justify-center gap-2"><span class="material-symbols-outlined animate-spin">refresh</span>Minting...</span>';
        }
        
        try {
            const data = await API.manualMint(address);
            
            if (resultDiv) {
                resultDiv.innerHTML = `
                    <div class="p-3 bg-green-500/10 rounded-lg">
                        <p class="text-green-400">✅ Minted successfully!</p>
                        ${data.txHash ? `
                            <a href="https://polygonscan.com/tx/${data.txHash}" target="_blank" 
                               class="text-primary hover:underline text-sm">
                                View TX: ${data.txHash.slice(0, 10)}...
                            </a>
                        ` : ''}
                    </div>
                `;
            }
            
            if (addressInput) addressInput.value = '';
            
        } catch (error) {
            if (resultDiv) {
                resultDiv.innerHTML = `<p class="text-red-400 p-3 bg-red-500/10 rounded-lg">${error.message}</p>`;
            }
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = '<span class="flex items-center justify-center gap-2"><span class="material-symbols-outlined">token</span>Mint Tokens</span>';
            }
        }
    },

    // Mint presale tokens
    async submit(event) {
        event.preventDefault();
        
        const wallet = document.getElementById('mint-wallet')?.value?.trim();
        const eurAmount = parseFloat(document.getElementById('mint-eur')?.value);
        
        const errorDiv = document.getElementById('mint-error');
        const successDiv = document.getElementById('mint-success');
        const submitBtn = document.getElementById('mint-submit-btn');
        
        if (errorDiv) errorDiv.classList.add('hidden');
        if (successDiv) successDiv.classList.add('hidden');
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.innerHTML = '<span class="flex items-center justify-center gap-2"><span class="material-symbols-outlined animate-spin">refresh</span>Minting...</span>';
        }
        
        try {
            const data = await API.presaleManualMint(wallet, eurAmount);
            
            if (successDiv) {
                successDiv.innerHTML = `
                    ✅ Successfully minted ${data.tokenAmount?.toFixed(2) || data.tokens} VIP to ${wallet.slice(0,6)}...${wallet.slice(-4)}<br>
                    ${data.txHash ? `
                        <a href="https://polygonscan.com/tx/${data.txHash}" target="_blank" class="text-primary hover:underline">
                            View TX: ${data.txHash.slice(0,10)}...
                        </a>
                    ` : ''}
                `;
                successDiv.classList.remove('hidden');
            }
            
            document.getElementById('manual-mint-form')?.reset();
            this.updateSummary();
            this.loadMints();
            
        } catch (error) {
            if (errorDiv) {
                errorDiv.textContent = error.message;
                errorDiv.classList.remove('hidden');
            }
        } finally {
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerHTML = '<span class="flex items-center justify-center gap-2"><span class="material-symbols-outlined">shopping_cart</span>Mint Presale Tokens</span>';
            }
        }
    },

    async loadMints() {
        const container = document.getElementById('manual-mints-list');
        if (!container) return;
        
        try {
            const data = await API.getManualMints();
            const mints = data.mints || data || [];
            
            if (!mints || mints.length === 0) {
                container.innerHTML = '<p class="text-gray-500 text-sm text-center py-4 col-span-full">No manual mints yet</p>';
                return;
            }
            
            container.innerHTML = mints.map(mint => `
                <div class="p-4 bg-gray-800/50 rounded-lg border border-gray-700">
                    <div class="flex justify-between items-start mb-2">
                        <span class="text-primary font-bold">${parseFloat(mint.token_amount || mint.tokenAmount || 0).toFixed(2)} VIP</span>
                        <span class="text-xs text-gray-500">${Utils.formatDate(mint.created_at || mint.createdAt)}</span>
                    </div>
                    <p class="text-sm text-gray-300 font-mono truncate" title="${mint.wallet_address || mint.walletAddress}">
                        To: ${Utils.formatAddress(mint.wallet_address || mint.walletAddress)}
                    </p>
                    <p class="text-sm text-gray-500">€${parseFloat(mint.eur_amount || mint.eurAmount || 0).toFixed(2)} received</p>
                    ${mint.mint_tx_hash || mint.txHash ? `
                        <a href="https://polygonscan.com/tx/${mint.mint_tx_hash || mint.txHash}" target="_blank" 
                           class="text-xs text-primary hover:underline mt-2 block">
                            TX: ${(mint.mint_tx_hash || mint.txHash).slice(0,10)}...
                        </a>
                    ` : ''}
                </div>
            `).join('');
            
        } catch (error) {
            console.error('Error loading manual mints:', error);
            container.innerHTML = `<p class="text-red-400 text-sm text-center py-4 col-span-full">Error loading mints</p>`;
        }
    },

    updatePreview() {
        this.updateSummary();
    },

    // Called when switching to manual-mint tab
    async load() {
        await this.loadConfig();
        await this.loadMints();
    }
};

window.ManualMint = ManualMint;
