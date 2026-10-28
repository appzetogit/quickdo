import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion as Motion } from 'framer-motion';
import {
    AlertCircle,
    ArrowLeft,
    ArrowDownLeft,
    ArrowUpRight,
    CheckCircle2,
    Clock3,
    IndianRupee,
    RefreshCw,
    Wallet,
    X,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import DriverBottomNav from '../../shared/components/DriverBottomNav';
import api from '../../../shared/api/axiosInstance';
import { socketService } from '../../../shared/api/socket';
import { useSettings } from '../../../shared/context/SettingsContext';
import { getLocalDriverToken } from '../services/registrationService';

const emptyWallet = {
    balance: 0,
    cashLimit: 0,
    minimumBalanceForOrders: 0,
    availableForOrders: 0,
    isBlocked: false,
};

const money = (value) => {
    const amount = Number(value || 0);
    const sign = amount < 0 ? '-' : '';
    return `${sign}Rs ${Math.abs(amount).toFixed(2)}`;
};

const toNumber = (value, fallback = 0) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
};

const isEnabled = (value, fallback = true) => {
    if (value === undefined || value === null || value === '') return fallback;
    return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
};

const transactionLabel = (tx) => {
    if (!tx) return 'Wallet transaction';
    const type = typeof tx === 'string' ? tx : tx.type || '';
    const source = String(tx.metadata?.source || '').toLowerCase();

    if (type === 'adjustment' && source === 'ride_tip') {
        return 'Ride tip';
    }

    const labels = {
        ride_earning: 'Online ride earning',
        commission_deduction: 'Cash ride commission',
        top_up: 'Wallet top-up',
        adjustment: 'Wallet adjustment',
    };

    return labels[type] || String(type || 'Wallet transaction').replace(/_/g, ' ');
};

const withdrawalStatusMeta = (status = '') => {
    const normalized = String(status || '').toLowerCase();

    if (normalized === 'completed' || normalized === 'approved') {
        return {
            label: 'Approved',
            className: 'bg-emerald-100 text-emerald-700',
        };
    }

    if (normalized === 'cancelled' || normalized === 'rejected') {
        return {
            label: 'Rejected',
            className: 'bg-rose-100 text-rose-700',
        };
    }

    return {
        label: 'Pending',
        className: 'bg-amber-100 text-amber-700',
    };
};

const transactionHint = (tx = {}) => {
    const payment = tx.metadata?.paymentMethod;
    const commission = tx.metadata?.commissionAmount;
    const fare = tx.metadata?.fare;
    const source = String(tx.metadata?.source || '').toLowerCase();

    if (tx.type === 'commission_deduction') {
        return `COD ride${fare ? ` of ${money(fare)}` : ''}${commission ? `, admin commission ${money(commission)}` : ''}`;
    }

    if (tx.type === 'ride_earning') {
        return `${payment === 'online' ? 'Online' : 'Ride'} payout after admin commission`;
    }

    if (tx.type === 'adjustment' && source === 'user_wallet_transfer') {
        return tx.description || 'Received from rider wallet';
    }

    if (tx.type === 'adjustment' && source === 'ride_tip') {
        return tx.description || 'Tip received from rider';
    }

    return tx.description || 'Updated by wallet activity';
};

const shortenText = (value, maxLength = 88) => {
    const normalized = String(value || '').replace(/\s+/g, ' ').trim();
    if (!normalized) {
        return 'Updated by wallet activity';
    }

    return normalized.length > maxLength
        ? `${normalized.slice(0, maxLength - 3).trimEnd()}...`
        : normalized;
};

const formatDate = (value) => {
    const date = value ? new Date(value) : null;
    if (!date || Number.isNaN(date.getTime())) return 'Just now';

    return date.toLocaleString('en-IN', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
    });
};

const normalizeWalletResponse = (payload) => {
    const data = payload?.data || payload || {};
    return {
        wallet: data.wallet || emptyWallet,
        transactions: Array.isArray(data.transactions) ? data.transactions : [],
        withdrawalRequests: Array.isArray(data.withdrawalRequests) ? data.withdrawalRequests : [],
        settings: data.settings || {},
        summary: data.summary || {
            totalAppEarnings: 0,
            onlineRideEarnings: 0,
            cashRideCommission: 0,
            totalTips: 0,
        },
    };
};

const WALLET_FILTERS = [
    { id: 'all', label: 'All' },
    { id: 'ride_earning', label: 'Online rides' },
    { id: 'commission_deduction', label: 'Cash commission' },
    { id: 'top_up', label: 'Top-ups' },
    { id: 'ride_tip', label: 'Tips' },
    { id: 'adjustment', label: 'Adjustments' },
];

const getDriverAuthConfig = () => {
    const token = getLocalDriverToken();

    if (!token) {
        throw new Error('Driver session expired. Please login again.');
    }

    return {
        headers: {
            Authorization: `Bearer ${token}`,
        },
    };
};

const StatPill = ({ label, value, tone = 'dark' }) => {
    const toneClass = tone === 'good' ? 'text-emerald-700 bg-emerald-50' : tone === 'warn' ? 'text-amber-700 bg-amber-50' : 'text-slate-700 bg-slate-100';

    return (
        <div className={`rounded-2xl px-4 py-3 ${toneClass}`}>
            <p className="text-[10px] font-black uppercase tracking-[0.16em] opacity-70">{label}</p>
            <p className="mt-1 text-base font-black">{value}</p>
        </div>
    );
};

const isOwnerManagedDriverProfile = (driver = {}) =>
    Boolean(
        driver?.owner_id
        || driver?.ownerId
        || driver?.fleet_id
        || driver?.fleetId
        || driver?.owner?._id,
    );

const DriverWallet = () => {
    const navigate = useNavigate();
    const { settings: appSettings } = useSettings();
    const appName = appSettings.general?.app_name || 'App';
    const activePaymentGateway = appSettings.paymentGateway || null;
    const [wallet, setWallet] = useState(emptyWallet);
    const [transactions, setTransactions] = useState([]);
    const [withdrawalRequests, setWithdrawalRequests] = useState([]);
    const [settings, setSettings] = useState({});
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState('');
    const [showTopUp, setShowTopUp] = useState(false);
    const [topUpAmount, setTopUpAmount] = useState('500');
    const [processingTopUp, setProcessingTopUp] = useState(false);
    const [topUpSuccess, setTopUpSuccess] = useState(false);
    const [activeFilter, setActiveFilter] = useState('all');
    const [showWithdraw, setShowWithdraw] = useState(false);
    const [withdrawAmount, setWithdrawAmount] = useState('');
    const [processingWithdraw, setProcessingWithdraw] = useState(false);
    const [withdrawSuccess, setWithdrawSuccess] = useState(false);
    const [driverProfile, setDriverProfile] = useState({
        salary: 0,
        isOwnerManagedDriver: false,
    });
    const [backendSummary, setBackendSummary] = useState({
        totalAppEarnings: 0,
        onlineRideEarnings: 0,
        cashRideCommission: 0,
        totalTips: 0,
    });
    const [expandedTransactions, setExpandedTransactions] = useState({});

    const toggleTransaction = (id) => {
        setExpandedTransactions((prev) => ({
            ...prev,
            [id]: !prev[id],
        }));
    };

    const loadWallet = useCallback(async ({ quiet = false } = {}) => {
        if (!quiet) setRefreshing(true);
        setError('');

        try {
            const authConfig = getDriverAuthConfig();
            const [walletResponse, profileResponse] = await Promise.all([
                api.get('/drivers/wallet', authConfig),
                api.get('/drivers/me', authConfig).catch(() => null),
            ]);
            const next = normalizeWalletResponse(walletResponse);
            const profile = profileResponse?.data?.data || profileResponse?.data || profileResponse || {};
            setWallet(next.wallet);
            setTransactions(next.transactions);
            setWithdrawalRequests(next.withdrawalRequests);
            setSettings(next.settings);
            setBackendSummary(next.summary);
            setDriverProfile({
                salary: toNumber(profile.salary, 0),
                isOwnerManagedDriver: isOwnerManagedDriverProfile(profile),
            });
        } catch (requestError) {
            setError(requestError?.response?.data?.message || requestError?.message || 'Could not load wallet.');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, []);

    useEffect(() => {
        loadWallet({ quiet: true });

        const socket = socketService.connect({ role: 'driver' });
        const onWalletUpdated = (payload) => {
            if (payload?.wallet) setWallet(payload.wallet);
            if (payload?.summary) setBackendSummary(payload.summary);
            if (payload?.transaction) {
                setTransactions((previous) => [
                    payload.transaction,
                    ...previous.filter((item) => item._id !== payload.transaction._id),
                ].slice(0, 50));
            }
        };

        if (socket) socketService.on('driver:wallet:updated', onWalletUpdated);

        return () => {
            socketService.off('driver:wallet:updated', onWalletUpdated);
        };
    }, [loadWallet]);

    const rules = useMemo(() => {
        const minimumBalance = toNumber(
            wallet.minimumBalanceForOrders,
            toNumber(settings.driver_wallet_minimum_amount_to_get_an_order, 0),
        );
        const availableForOrders = toNumber(wallet.availableForOrders, toNumber(wallet.balance) - minimumBalance);
        const minimumTopUp = toNumber(wallet.minimumTopUpAmount, toNumber(settings.minimum_amount_added_to_wallet, 0));
        const minimumTransferAmount = toNumber(wallet.minimumTransferAmount, toNumber(settings.minimum_wallet_amount_for_transfer, 0));
        const walletEnabled = wallet.isWalletEnabled ?? isEnabled(settings.show_wallet_feature_for_driver, true);
        const transferEnabled = wallet.isTransferEnabled ?? isEnabled(settings.enable_wallet_transfer_driver, true);
        const canReceiveOrders = walletEnabled && !wallet.isBlocked && availableForOrders > 0;

        return {
            minimumBalance,
            availableForOrders,
            minimumTopUp,
            minimumTransferAmount,
            walletEnabled,
            transferEnabled,
            canReceiveOrders,
        };
    }, [settings, wallet]);

    const quickAmounts = useMemo(() => {
        const base = Math.max(rules.minimumTopUp, 100);
        return [base, base * 2, base * 5].map((amount) => String(Math.round(amount)));
    }, [rules.minimumTopUp]);

    const walletSummary = useMemo(() => {
        return {
            totalAppEarnings: backendSummary.totalAppEarnings || 0,
            onlineRideEarnings: backendSummary.onlineRideEarnings || 0,
            cashRideCommission: backendSummary.cashRideCommission || 0,
            totalTips: backendSummary.totalTips || 0,
        };
    }, [backendSummary]);

    const filteredTransactions = useMemo(() => {
        if (activeFilter === 'all') {
            return transactions;
        }

        if (activeFilter === 'ride_tip') {
            return transactions.filter(tx => String(tx.metadata?.source) === 'ride_tip' || Number(tx.metadata?.tipAmount) > 0);
        }

        return transactions.filter((tx) => tx.type === activeFilter && String(tx.metadata?.source) !== 'ride_tip');
    }, [activeFilter, transactions]);

    const recentTransactions = useMemo(() => filteredTransactions.slice(0, 20), [filteredTransactions]);
    const recentWithdrawalRequests = useMemo(
        () => withdrawalRequests.slice(0, 5),
        [withdrawalRequests],
    );
    const walletTopUpGatewayLabel = activePaymentGateway?.label || 'payment gateway';
    const supportsWalletTopUp = activePaymentGateway?.supportsWalletTopUp === true;
    const walletTopUpMode = activePaymentGateway?.walletTopUpMode || '';
    const canTopUpWallet = supportsWalletTopUp && ['razorpay_checkout', 'phonepe_redirect'].includes(walletTopUpMode);

    useEffect(() => {
        const merchantTransactionId = new URLSearchParams(window.location.search).get('phonepe_txn');
        if (!merchantTransactionId || walletTopUpMode !== 'phonepe_redirect') {
            return;
        }

        let cancelled = false;

        const clearPhonePeQuery = () => {
            const url = new URL(window.location.href);
            url.searchParams.delete('phonepe_txn');
            window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
        };

        const syncPhonePeTopup = async () => {
            setError('');
            setLoading(true);

            try {
                const response = await api.get(
                    `/drivers/wallet/top-up/phonepe/status/${merchantTransactionId}`,
                    getDriverAuthConfig(),
                );
                if (cancelled) return;

                const data = response?.data || response || {};
                if (data.status === 'paid') {
                    if (data.wallet) setWallet(data.wallet);
                    if (data.transaction) {
                        setTransactions((previous) => [
                            data.transaction,
                            ...previous.filter((item) => item._id !== data.transaction._id),
                        ].slice(0, 50));
                    }
                    setTopUpSuccess(true);
                    setShowTopUp(false);
                    setTopUpAmount('500');
                    window.setTimeout(() => {
                        if (!cancelled) setTopUpSuccess(false);
                    }, 1800);
                } else if (data.status === 'pending') {
                    setError('PhonePe payment is still pending. Please refresh in a few seconds.');
                } else if (data.status === 'failed') {
                    setError(response?.message || 'PhonePe payment was not completed.');
                }
            } catch (requestError) {
                if (!cancelled) {
                    setError(requestError?.message || 'Could not verify PhonePe payment.');
                }
            } finally {
                if (!cancelled) {
                    setLoading(false);
                    clearPhonePeQuery();
                }
            }
        };

        syncPhonePeTopup();

        return () => {
            cancelled = true;
        };
    }, [walletTopUpMode]);

    const loadRazorpayScript = useCallback(() =>
        new Promise((resolve) => {
            if (window.Razorpay) {
                resolve(true);
                return;
            }

            const script = document.createElement('script');
            script.src = 'https://checkout.razorpay.com/v1/checkout.js';
            script.async = true;
            script.onload = () => resolve(true);
            script.onerror = () => resolve(false);
            document.body.appendChild(script);
        }), []);

    const handleTopUp = async () => {
        const amount = Number(topUpAmount);

        if (!rules.walletEnabled) {
            setError('Wallet is disabled by admin.');
            return;
        }

        if (!Number.isFinite(amount) || amount <= 0) {
            setError('Enter a valid top-up amount.');
            return;
        }

        if (rules.minimumTopUp > 0 && amount < rules.minimumTopUp) {
            setError(`Minimum top-up amount is Rs ${rules.minimumTopUp}.`);
            return;
        }

        setProcessingTopUp(true);
        setError('');

        try {
            if (!activePaymentGateway) {
                throw new Error('No payment gateway is enabled by admin right now.');
            }

            if (!supportsWalletTopUp || !canTopUpWallet) {
                throw new Error(`${walletTopUpGatewayLabel} is enabled by admin, but driver wallet top-up is not implemented for it yet.`);
            }

            if (walletTopUpMode === 'phonepe_redirect') {
                const sessionResponse = await api.post('/drivers/wallet/top-up/phonepe/order', {
                    amount,
                }, getDriverAuthConfig());
                const session = sessionResponse?.data || sessionResponse || {};

                if (!session?.checkoutUrl) {
                    throw new Error('Could not initiate PhonePe payment. Please try again.');
                }

                window.location.assign(session.checkoutUrl);
                return;
            }

            const scriptLoaded = await loadRazorpayScript();
            if (!scriptLoaded) {
                throw new Error('Razorpay SDK failed to load. Please check your internet connection.');
            }

            // 1. Create order on backend
            const orderResponse = await api.post('/drivers/wallet/top-up/razorpay/order', {
                amount,
            }, getDriverAuthConfig());
            const orderData = orderResponse?.data || orderResponse;

            if (!orderData?.orderId || !orderData?.keyId) {
                throw new Error('Could not initiate payment. Please try again.');
            }

            // 2. Open Razorpay checkout
            const options = {
                key: orderData.keyId,
                amount: orderData.amount,
                currency: orderData.currency || 'INR',
                name: appName,
                description: 'Wallet Top-up',
                order_id: orderData.orderId,
                handler: async (response) => {
                    try {
                        setProcessingTopUp(true);
                        // 3. Verify payment on backend
                        const verifyResponse = await api.post('/drivers/wallet/top-up/razorpay/verify', {
                            razorpay_order_id: response.razorpay_order_id,
                            razorpay_payment_id: response.razorpay_payment_id,
                            razorpay_signature: response.razorpay_signature,
                        }, getDriverAuthConfig());

                        const result = verifyResponse?.data || verifyResponse;
                        if (result?.wallet) {
                            setWallet(result.wallet);
                        }
                        if (result?.transaction) {
                            setTransactions((previous) => [
                                result.transaction,
                                ...previous.filter((item) => item._id !== result.transaction._id),
                            ].slice(0, 50));
                        }
                        
                        setTopUpSuccess(true);
                        setTimeout(() => {
                            setTopUpSuccess(false);
                            setShowTopUp(false);
                            setTopUpAmount('500');
                        }, 2000);
                    } catch (verifyError) {
                        setError(verifyError?.response?.data?.message || 'Payment verification failed.');
                    } finally {
                        setProcessingTopUp(false);
                    }
                },
                modal: {
                    ondismiss: () => {
                        setProcessingTopUp(false);
                    },
                },
                theme: {
                    color: '#0F172A',
                },
            };

            if (orderData.orderId?.startsWith('mock_order_')) {
                console.warn('⚠️ Bypassing Razorpay checkout due to mock order ID (development fallback)');
                setTimeout(async () => {
                    await options.handler({
                        razorpay_payment_id: `mock_pay_${Date.now()}`,
                        razorpay_order_id: orderData.orderId,
                        razorpay_signature: 'mock_signature_bypass'
                    });
                }, 1000);
                return;
            }

            const rzp = new window.Razorpay(options);
            rzp.on('payment.failed', (response) => {
                setError(response.error?.description || 'Payment failed.');
                setProcessingTopUp(false);
            });
            rzp.open();
        } catch (requestError) {
            setError(requestError?.response?.data?.message || requestError?.message || 'Top-up request failed.');
            setProcessingTopUp(false);
        }
    };

    const handleWithdrawRequest = async () => {
        const amount = Number(withdrawAmount);

        if (!rules.transferEnabled) {
            setError('Withdrawals are disabled by admin.');
            return;
        }

        if (!Number.isFinite(amount) || amount <= 0) {
            setError('Enter a valid withdrawal amount.');
            return;
        }

        if (rules.minimumTransferAmount > 0 && amount < rules.minimumTransferAmount) {
            setError(`Minimum withdrawal amount is Rs ${rules.minimumTransferAmount}.`);
            return;
        }

        if (amount > Number(wallet.balance || 0)) {
            setError('Withdrawal amount cannot exceed current balance.');
            return;
        }

        setProcessingWithdraw(true);
        setError('');

        try {
            const response = await api.post('/drivers/wallet/withdrawals', {
                amount,
                payment_method: 'bank_transfer',
            }, getDriverAuthConfig());
            const payload = response?.data || response || {};

            if (payload?.request) {
                setWithdrawalRequests((previous) => [
                    payload.request,
                    ...previous.filter((item) => item._id !== payload.request._id),
                ].slice(0, 10));
            }

            setWithdrawSuccess(true);
            setTimeout(() => {
                setWithdrawSuccess(false);
                setShowWithdraw(false);
                setWithdrawAmount('');
            }, 1800);
        } catch (requestError) {
            setError(requestError?.response?.data?.message || requestError?.message || 'Could not send withdrawal request.');
        } finally {
            setProcessingWithdraw(false);
        }
    };


    const statusCopy = rules.walletEnabled
        ? rules.canReceiveOrders
            ? 'Ready for orders'
            : 'Top up to receive orders'
        : 'Wallet disabled';

    const walletIntro = driverProfile.isOwnerManagedDriver
        ? 'Monthly salary and wallet activity'
        : 'Cash commission and online earnings';

    return (
        <div className="min-h-screen bg-[#f5f1e8] px-4 pb-28 pt-4 text-slate-950">
            <div className="mx-auto max-w-md">
                <header className="mb-4 flex items-center justify-between">
                    <button
                        type="button"
                        onClick={() => navigate(-1)}
                        className="grid h-11 w-11 place-items-center rounded-full bg-white text-slate-900 shadow-sm"
                        aria-label="Go back"
                    >
                        <ArrowLeft size={18} />
                    </button>
                    <div className="text-center">
                        <h1 className="text-lg font-black tracking-tight">Driver wallet</h1>
                        <p className="text-xs font-bold text-slate-500">{walletIntro}</p>
                    </div>
                    <button
                        type="button"
                        onClick={() => loadWallet()}
                        disabled={refreshing}
                        className="grid h-11 w-11 place-items-center rounded-full bg-white text-slate-900 shadow-sm disabled:opacity-60"
                        aria-label="Refresh wallet"
                    >
                        <RefreshCw size={18} className={refreshing ? 'animate-spin' : ''} />
                    </button>
                </header>

                {loading ? (
                    <div className="grid min-h-[60vh] place-items-center">
                        <div className="text-center">
                            <RefreshCw className="mx-auto animate-spin text-emerald-700" size={28} />
                            <p className="mt-3 text-sm font-black text-slate-500">Loading wallet...</p>
                        </div>
                    </div>
                ) : (
                    <main className="space-y-4">
                        <section className="overflow-hidden rounded-[2rem] bg-[#101521] p-5 text-white shadow-xl">
                            <div className="flex items-start justify-between gap-4">
                                <div>
                                    <p className="text-xs font-black uppercase tracking-[0.18em] text-white/45">Current balance</p>
                                    <h2 className="mt-2 text-4xl font-black tracking-tight">{money(wallet.balance)}</h2>
                                    <span className={`mt-3 inline-flex rounded-full px-3 py-1 text-xs font-black ${rules.canReceiveOrders ? 'bg-emerald-400/15 text-emerald-200' : 'bg-amber-400/15 text-amber-200'}`}>
                                        {statusCopy}
                                    </span>
                                </div>
                                <div className="grid h-14 w-14 place-items-center rounded-2xl bg-white/10">
                                    <Wallet size={26} />
                                </div>
                            </div>

                            {driverProfile.isOwnerManagedDriver && (
                                <div className="mt-5 rounded-3xl border border-white/10 bg-gradient-to-r from-white/12 to-white/5 p-4">
                                    <div className="flex items-center justify-between gap-3">
                                        <div>
                                            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-white/45">Monthly salary</p>
                                            <p className="mt-1 text-2xl font-black text-emerald-200">{money(driverProfile.salary)}</p>
                                            <p className="mt-1 text-[11px] font-bold text-white/55">
                                                Set by fleet owner for this driver profile
                                            </p>
                                        </div>
                                        <div className="grid h-12 w-12 place-items-center rounded-2xl bg-emerald-400/15 text-emerald-200">
                                            <IndianRupee size={22} />
                                        </div>
                                    </div>
                                </div>
                            )}

                            <div className={`mt-5 grid gap-3 ${driverProfile.isOwnerManagedDriver ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-2'}`}>
                                <div className="rounded-2xl bg-white/10 p-3">
                                    <p className="text-[10px] font-black uppercase tracking-[0.16em] text-white/45">Minimum needed</p>
                                    <p className="mt-1 text-lg font-black">{money(rules.minimumBalance)}</p>
                                </div>
                                <div className="rounded-2xl bg-white/10 p-3">
                                    <p className="text-[10px] font-black uppercase tracking-[0.16em] text-white/45">Available cash limit</p>
                                    <p className={`mt-1 text-lg font-black ${rules.availableForOrders > 0 ? 'text-emerald-200' : 'text-amber-200'}`}>
                                        {money(rules.availableForOrders)}
                                    </p>
                                </div>
                            </div>
                        </section>

                        {error && (
                            <div className="flex items-start gap-3 rounded-2xl border border-rose-100 bg-rose-50 p-4 text-sm font-bold text-rose-700">
                                <AlertCircle className="mt-0.5 shrink-0" size={18} />
                                <p>{error}</p>
                            </div>
                        )}
                        {activePaymentGateway && !canTopUpWallet && (
                            <div className="rounded-2xl border border-amber-100 bg-amber-50 p-4 text-sm font-bold text-amber-700">
                                {walletTopUpGatewayLabel} is active, but driver wallet top-up is not available for it yet.
                            </div>
                        )}

                        <section>
                            <div className="grid grid-cols-2 gap-3">
                                <button
                                    type="button"
                                    onClick={() => setShowTopUp(true)}
                                    disabled={!rules.walletEnabled || !canTopUpWallet}
                                    className="flex h-13 w-full items-center justify-center gap-2 rounded-2xl bg-[#009b72] text-sm font-black uppercase tracking-[0.08em] text-white shadow-sm disabled:bg-slate-200 disabled:text-slate-400"
                                >
                                    Top up <ArrowUpRight size={17} />
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setShowWithdraw(true)}
                                    disabled={!rules.transferEnabled || Number(wallet.balance || 0) <= 0}
                                    className="flex h-13 w-full items-center justify-center gap-2 rounded-2xl bg-slate-900 text-sm font-black uppercase tracking-[0.08em] text-white shadow-sm disabled:bg-slate-200 disabled:text-slate-400"
                                >
                                    Withdraw <ArrowDownLeft size={17} />
                                </button>
                            </div>
                        </section>

                        {recentWithdrawalRequests.length > 0 && (
                            <section className="rounded-[1.7rem] bg-white p-4 shadow-sm">
                                <div className="mb-3 flex items-center justify-between">
                                    <h3 className="text-sm font-black text-slate-950">Withdrawal requests</h3>
                                    <p className="text-xs font-bold text-slate-500">{recentWithdrawalRequests.length} recent</p>
                                </div>
                                <div className="space-y-2">
                                    {recentWithdrawalRequests.map((request) => {
                                        const statusMeta = withdrawalStatusMeta(request.status);

                                        return (
                                        <div key={request._id || request.transactionId} className="flex items-center justify-between rounded-2xl bg-slate-50 p-3">
                                            <div>
                                                <p className="text-sm font-black text-slate-900">{money(request.amount)}</p>
                                                <p className="mt-0.5 text-[11px] font-bold text-slate-500">{formatDate(request.createdAt)}</p>
                                            </div>
                                            <span className={`rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] ${statusMeta.className}`}>
                                                {statusMeta.label}
                                            </span>
                                        </div>
                                    )})}
                                </div>
                            </section>
                        )}

                        <section className="rounded-[1.7rem] bg-white p-4 shadow-sm">
                            <div className="mb-3 flex items-center gap-2">
                                <IndianRupee size={18} className="text-emerald-700" />
                                <h3 className="text-sm font-black text-slate-950">
                                    {driverProfile.isOwnerManagedDriver ? 'Wallet activity guide' : 'How it reflects'}
                                </h3>
                            </div>
                            <div className="grid gap-2">
                                <div className="rounded-2xl bg-slate-50 p-3">
                                    <p className="text-sm font-black text-slate-900">
                                        {driverProfile.isOwnerManagedDriver ? 'Monthly salary' : 'Cash / COD ride'}
                                    </p>
                                    <p className="mt-1 text-xs font-bold leading-relaxed text-slate-500">
                                        {driverProfile.isOwnerManagedDriver
                                            ? 'This fixed amount is the monthly salary configured by the fleet owner for this driver.'
                                            : 'Driver collects the full cash fare. Wallet deducts only admin commission.'}
                                    </p>
                                </div>
                                <div className="rounded-2xl bg-slate-50 p-3">
                                    <p className="text-sm font-black text-slate-900">
                                        {driverProfile.isOwnerManagedDriver ? 'Wallet balance' : 'Online ride'}
                                    </p>
                                    <p className="mt-1 text-xs font-bold leading-relaxed text-slate-500">
                                        {driverProfile.isOwnerManagedDriver
                                            ? 'Wallet entries here still show live collections, transfers, top-ups, and deductions separately from salary.'
                                            : 'Platform receives the fare. Wallet credits driver earning after commission.'}
                                    </p>
                                </div>
                            </div>
                        </section>

                        <section className="space-y-3">
                            {driverProfile.isOwnerManagedDriver && (
                                <StatPill label="Monthly salary" value={money(driverProfile.salary)} tone="good" />
                            )}
                            <div className="grid grid-cols-1 gap-3">
                                <StatPill label="Cash commission deducted" value={money(walletSummary.cashRideCommission)} tone="warn" />
                            </div>
                        </section>

                        <section className="space-y-3">
                            <div className="flex items-center justify-between">
                                <div>
                                    <h3 className="text-sm font-black text-slate-950">Recent transactions</h3>
                                    <p className="mt-1 text-[11px] font-bold text-slate-500">Filter earnings and wallet entries by type</p>
                                </div>
                                <p className="text-xs font-bold text-slate-500">{recentTransactions.length} shown</p>
                            </div>

                            <div className="flex gap-2 overflow-x-auto pb-1">
                                {WALLET_FILTERS.map((filter) => (
                                    <button
                                        key={filter.id}
                                        type="button"
                                        onClick={() => setActiveFilter(filter.id)}
                                        className={`shrink-0 rounded-full px-3 py-2 text-[10px] font-black uppercase tracking-[0.16em] transition-all ${
                                            activeFilter === filter.id
                                                ? 'bg-slate-900 text-white'
                                                : 'bg-white text-slate-500 shadow-sm'
                                        }`}
                                    >
                                        {filter.label}
                                    </button>
                                ))}
                            </div>

                            {recentTransactions.length === 0 ? (
                                <div className="rounded-[1.7rem] bg-white p-8 text-center shadow-sm">
                                    <Clock3 className="mx-auto text-slate-300" size={30} />
                                    <p className="mt-3 text-sm font-black text-slate-700">No transactions yet</p>
                                    <p className="mt-1 text-xs font-bold text-slate-400">No entries match the selected earnings filter.</p>
                                </div>
                            ) : (
                                recentTransactions.map((tx, index) => {
                                    const isDebit = Number(tx.amount || 0) < 0;
                                    return (
                                        <Motion.div
                                            key={tx._id || tx.id || index}
                                            initial={{ opacity: 0, y: 8 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            transition={{ delay: Math.min(index * 0.02, 0.18) }}
                                            className="rounded-[1.4rem] bg-white p-4 shadow-sm"
                                        >
                                            <div className="flex items-center justify-between gap-3">
                                                <div className="flex min-w-0 items-center gap-3">
                                                    <div className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl ${isDebit ? 'bg-rose-50 text-rose-600' : 'bg-emerald-50 text-emerald-700'}`}>
                                                        {isDebit ? <ArrowDownLeft size={18} /> : <ArrowUpRight size={18} />}
                                                    </div>
                                                    <div className="min-w-0">
                                                        <p className="text-sm font-black text-slate-950">{transactionLabel(tx)}</p>
                                                        <p className="mt-0.5 text-xs font-bold leading-5 text-slate-500 break-words" title={transactionHint(tx)}>
                                                            {shortenText(transactionHint(tx))}
                                                        </p>
                                                        <p className="mt-1 text-[11px] font-bold text-slate-400">{formatDate(tx.createdAt)}</p>
                                                    </div>
                                                </div>
                                                <div className="shrink-0 text-right">
                                                    <p className={`text-sm font-black ${isDebit ? 'text-rose-600' : 'text-emerald-700'}`}>{money(tx.amount)}</p>
                                                    <p className="mt-1 text-[10px] font-black uppercase text-slate-400">Bal {money(tx.balanceAfter)}</p>
                                                </div>
                                            </div>
                                            
                                            {/* Extra Metadata Dropdown / Display */}
                                            {Boolean((tx.metadata?.tipAmount && Number(tx.metadata.tipAmount) > 0) || (tx.type === 'adjustment' && tx.metadata?.source === 'ride_tip')) && (
                                                <div className="mt-3">
                                                    <button
                                                        type="button"
                                                        onClick={() => toggleTransaction(tx._id || tx.id || index)}
                                                        className="flex w-full items-center justify-between border-t border-slate-100 pt-2 pb-1"
                                                    >
                                                        <span className="text-[10px] font-black uppercase tracking-widest text-emerald-600/70">View Breakdown</span>
                                                        <span className="text-slate-400 text-xs font-bold">{expandedTransactions[tx._id || tx.id || index] ? 'Hide' : 'Show'}</span>
                                                    </button>
                                                    {expandedTransactions[tx._id || tx.id || index] && (
                                                        <div className="pt-2 grid grid-cols-2 gap-2">
                                                            {Number(tx.metadata?.farePortion) > 0 && (
                                                                <div className="bg-slate-50 rounded-xl p-2.5 flex flex-col justify-center">
                                                                    <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">Base Fare</span>
                                                                    <span className="text-[11px] font-bold text-slate-700">{money(tx.metadata.farePortion)}</span>
                                                                </div>
                                                            )}
                                                            <div className="bg-emerald-50 rounded-xl p-2.5 flex flex-col justify-center">
                                                                <span className="text-[9px] font-black uppercase tracking-widest text-emerald-600/70">Tip Amount</span>
                                                                <span className="text-[11px] font-bold text-emerald-700">{money(tx.metadata?.tipAmount || tx.amount)}</span>
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </Motion.div>
                                    );
                                })
                            )}
                        </section>
                    </main>
                )}
            </div>

            <AnimatePresence>
                {showTopUp && (
                    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-950/55 px-3 backdrop-blur-sm">
                        <Motion.div
                            initial={{ y: '100%' }}
                            animate={{ y: 0 }}
                            exit={{ y: '100%' }}
                            className="w-full max-w-md rounded-t-[2rem] bg-white p-5 pb-8 shadow-2xl"
                        >
                            <div className="mb-5 flex items-center justify-between">
                                <div>
                                    <h3 className="text-xl font-black text-slate-950">Top up wallet</h3>
                                    <p className="text-sm font-bold text-slate-500">
                                        Minimum amount: {money(rules.minimumTopUp)}
                                        {activePaymentGateway ? ` • Via ${walletTopUpGatewayLabel}` : ''}
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setShowTopUp(false)}
                                    className="grid h-10 w-10 place-items-center rounded-full bg-slate-100 text-slate-600"
                                    aria-label="Close top-up"
                                >
                                    <X size={18} />
                                </button>
                            </div>

                            {topUpSuccess ? (
                                <div className="grid place-items-center py-10 text-center">
                                    <div className="grid h-20 w-20 place-items-center rounded-full bg-emerald-50 text-emerald-700">
                                        <CheckCircle2 size={38} strokeWidth={3} />
                                    </div>
                                    <p className="mt-4 text-lg font-black">Wallet updated</p>
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    <div className="rounded-3xl bg-slate-50 p-5 text-center">
                                        <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">Amount</p>
                                        <input
                                            type="number"
                                            min="1"
                                            value={topUpAmount}
                                            onChange={(event) => setTopUpAmount(event.target.value)}
                                            className="mt-2 w-full bg-transparent text-center text-4xl font-black text-slate-950 outline-none"
                                        />
                                    </div>
                                    <div className="grid grid-cols-3 gap-2">
                                        {quickAmounts.map((amount) => (
                                            <button
                                                key={amount}
                                                type="button"
                                                onClick={() => setTopUpAmount(amount)}
                                                className="rounded-2xl border border-slate-100 bg-white py-3 text-sm font-black text-slate-700 shadow-sm"
                                            >
                                                {money(amount)}
                                            </button>
                                        ))}
                                    </div>
                                    {error && (
                                        <div className="flex items-start gap-2 rounded-xl bg-rose-50 p-3 text-xs font-bold text-rose-700">
                                            <AlertCircle className="mt-0.5 shrink-0" size={14} />
                                            <p>{error}</p>
                                        </div>
                                    )}
                                    <button
                                        type="button"
                                        onClick={handleTopUp}
                                        disabled={processingTopUp || !rules.walletEnabled}
                                        className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-[#101521] text-sm font-black uppercase tracking-widest text-white disabled:bg-slate-200 disabled:text-slate-400"
                                    >
                                        {processingTopUp ? <RefreshCw className="animate-spin" size={18} /> : 'Add money'}
                                    </button>
                                </div>
                            )}
                        </Motion.div>
                    </div>
                )}
            </AnimatePresence>

            <AnimatePresence>
                {showWithdraw && (
                    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-950/55 px-3 backdrop-blur-sm">
                        <Motion.div
                            initial={{ y: '100%' }}
                            animate={{ y: 0 }}
                            exit={{ y: '100%' }}
                            className="w-full max-w-md rounded-t-[2rem] bg-white p-5 pb-8 shadow-2xl"
                        >
                            <div className="mb-5 flex items-center justify-between">
                                <div>
                                    <h3 className="text-xl font-black text-slate-950">Withdraw to admin request</h3>
                                    <p className="text-sm font-bold text-slate-500">Minimum amount: {money(rules.minimumTransferAmount)}</p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setShowWithdraw(false)}
                                    className="grid h-10 w-10 place-items-center rounded-full bg-slate-100 text-slate-600"
                                    aria-label="Close withdrawal"
                                >
                                    <X size={18} />
                                </button>
                            </div>

                            {withdrawSuccess ? (
                                <div className="grid place-items-center py-10 text-center">
                                    <div className="grid h-20 w-20 place-items-center rounded-full bg-emerald-50 text-emerald-700">
                                        <CheckCircle2 size={38} strokeWidth={3} />
                                    </div>
                                    <p className="mt-4 text-lg font-black">Request sent</p>
                                    <p className="mt-1 text-sm font-bold text-slate-500">Admin will review your withdrawal request.</p>
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    <div className="rounded-3xl bg-slate-50 p-5 text-center">
                                        <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">Withdrawal amount</p>
                                        <input
                                            type="number"
                                            min="1"
                                            value={withdrawAmount}
                                            onChange={(event) => setWithdrawAmount(event.target.value)}
                                            className="mt-2 w-full bg-transparent text-center text-4xl font-black text-slate-950 outline-none"
                                            placeholder="0"
                                        />
                                        <p className="mt-2 text-xs font-bold text-slate-500">Available balance: {money(wallet.balance)}</p>
                                    </div>
                                    {error && (
                                        <div className="flex items-start gap-2 rounded-xl bg-rose-50 p-3 text-xs font-bold text-rose-700">
                                            <AlertCircle className="mt-0.5 shrink-0" size={14} />
                                            <p>{error}</p>
                                        </div>
                                    )}
                                    <button
                                        type="button"
                                        onClick={handleWithdrawRequest}
                                        disabled={processingWithdraw || !rules.transferEnabled}
                                        className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-slate-900 text-sm font-black uppercase tracking-widest text-white disabled:bg-slate-200 disabled:text-slate-400"
                                    >
                                        {processingWithdraw ? <RefreshCw className="animate-spin" size={18} /> : 'Send request'}
                                    </button>
                                </div>
                            )}
                        </Motion.div>
                    </div>
                )}
            </AnimatePresence>

            <DriverBottomNav />
        </div>
    );
};

export default DriverWallet;
