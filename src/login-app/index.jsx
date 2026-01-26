import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { WalletTwoProvider, AuthAction, useWalletTwo } from '@oc-labs/wallettwo-sdk';

// Admin Login Component
function AdminLogin() {
    const { user, isLoggedIn } = useWalletTwo();
    const [status, setStatus] = useState('idle'); // idle, checking, authenticating, error, unauthorized
    const [error, setError] = useState('');

    // Check existing session on mount
    useEffect(() => {
        checkExistingSession();
    }, []);

    // Handle WalletTwo login
    useEffect(() => {
        if (isLoggedIn && user?.email) {
            authenticateAdmin(user);
        }
    }, [isLoggedIn, user]);

    async function checkExistingSession() {
        setStatus('checking');
        try {
            const res = await fetch('/api/admin/session', { credentials: 'include' });
            const data = await res.json();
            if (data.authenticated) {
                // Already logged in, redirect to dashboard
                localStorage.setItem('keavalley_admin', JSON.stringify(data.admin));
                window.location.href = '/dashboard';
            } else {
                setStatus('idle');
            }
        } catch (err) {
            console.error('Session check failed:', err);
            setStatus('idle');
        }
    }

    async function authenticateAdmin(user) {
        setStatus('authenticating');
        setError('');

        try {
            const res = await fetch('/api/admin/auth', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    email: user.email,
                    walletAddress: user.wallet || user.address,
                    name: user.name || user.email.split('@')[0]
                })
            });

            const data = await res.json();

            if (data.success) {
                localStorage.setItem('keavalley_admin', JSON.stringify(data.admin));
                window.location.href = '/dashboard';
            } else {
                setStatus('unauthorized');
                setError(data.error || 'Access denied. Your email is not on the admin whitelist.');
            }
        } catch (err) {
            console.error('Auth error:', err);
            setStatus('error');
            setError('Authentication failed. Please try again.');
        }
    }

    // Loading states
    if (status === 'checking') {
        return (
            <div className="login-container">
                <div className="login-card">
                    <div className="loader"></div>
                    <p>Checking session...</p>
                </div>
            </div>
        );
    }

    if (status === 'authenticating') {
        return (
            <div className="login-container">
                <div className="login-card">
                    <div className="loader"></div>
                    <p>Verifying admin access...</p>
                </div>
            </div>
        );
    }

    // Unauthorized
    if (status === 'unauthorized') {
        return (
            <div className="login-container">
                <div className="login-card error-card">
                    <h2>Access Denied</h2>
                    <p className="error-message">{error}</p>
                    <p className="email-display">Email: {user?.email}</p>
                    <p className="help-text">Contact the super admin to request access.</p>
                    <a href="/" className="back-link">← Back to Home</a>
                </div>
            </div>
        );
    }

    // Error state
    if (status === 'error') {
        return (
            <div className="login-container">
                <div className="login-card error-card">
                    <h2>Error</h2>
                    <p className="error-message">{error}</p>
                    <button onClick={() => setStatus('idle')} className="retry-btn">Try Again</button>
                </div>
            </div>
        );
    }

    // Main login view
    return (
        <div className="login-container">
            <div className="login-card">
                <div className="logo-section">
                    <h1>KEA VALLEY</h1>
                    <p className="subtitle">Admin Dashboard</p>
                </div>

                <div className="login-section">
                    <h2>Sign in with WalletTwo</h2>
                    <p className="description">
                        Connect with your authorized email to access the admin dashboard.
                    </p>

                    <div className="auth-button-container">
                        <AuthAction>
                            <button className="wallettwo-btn">
                                Connect with WalletTwo
                            </button>
                        </AuthAction>
                    </div>

                    <p className="note">
                        Only whitelisted emails can access the dashboard.
                    </p>
                </div>

                <a href="/" className="back-link">← Back to Home</a>
            </div>
        </div>
    );
}

// Custom loader for WalletTwo
function CustomLoader() {
    return (
        <div className="login-container">
            <div className="login-card">
                <div className="loader"></div>
                <p>Loading WalletTwo...</p>
            </div>
        </div>
    );
}

// Main App
function App() {
    return (
        <WalletTwoProvider loader={<CustomLoader />}>
            <AdminLogin />
        </WalletTwoProvider>
    );
}

// Mount
const container = document.getElementById('login-root');
if (container) {
    const root = createRoot(container);
    root.render(<App />);
}
