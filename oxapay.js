// oxapay.js - OxaPay API integration

import { OXAPAY_API_KEY, OXAPAY_BASE_URL, logger } from './config.js';

/**
 * Create an invoice via OxaPay
 * @param {number} amountUsdt - Amount in USDT
 * @param {string} orderId - Order ID
 * @param {string} callbackUrl - Callback URL for payment notifications
 * @returns {Promise<{success: boolean, data?: object, error?: string}>}
 */
export async function createInvoice(amountUsdt, orderId, callbackUrl = null) {
    const payload = {
        merchant: OXAPAY_API_KEY,
        amount: amountUsdt,
        currency: 'USDT',
        lifeTime: 30, // minutes
        feePaidByPayer: 1,
        underPaidCover: 2.5,
        callbackUrl: callbackUrl || '',
        returnUrl: '',
        description: `GTC Presale Payment - Order ${orderId}`,
        orderId: orderId,
    };

    try {
        const response = await fetch(`${OXAPAY_BASE_URL}/merchants/request`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });

        const data = await response.json();
        if (data.result === 100) {
            logger.info(`Invoice created: ${orderId}`);
            return { success: true, data };
        }
        logger.error(`Invoice creation failed: ${data.message}`);
        return { success: false, error: data.message || 'Unknown error' };
    } catch (error) {
        logger.error(`createInvoice error: ${error.message}`);
        return { success: false, error: error.message };
    }
}

/**
 * Verify a payment by track ID
 * @param {string} trackId - OxaPay track ID
 * @returns {Promise<{success: boolean, paid?: boolean, status?: string, data?: object, error?: string}>}
 */
export async function verifyPayment(trackId) {
    const payload = {
        merchant: OXAPAY_API_KEY,
        trackId: trackId,
    };

    try {
        const response = await fetch(`${OXAPAY_BASE_URL}/merchants/inquiry`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });

        const data = await response.json();
        if (data.result === 100) {
            const status = data.status || '';
            const paid = status === 'Paid';
            logger.info(`Payment verification: ${trackId} - Status: ${status}`);
            return {
                success: true,
                paid,
                status,
                data
            };
        }
        logger.error(`Payment verification failed: ${data.message}`);
        return { success: false, error: data.message || 'Unknown error' };
    } catch (error) {
        logger.error(`verifyPayment error: ${error.message}`);
        return { success: false, error: error.message };
    }
}

/**
 * Verify payment by transaction hash (manual fallback)
 * @param {string} txHash - Transaction hash
 * @returns {Promise<{success: boolean, paid?: boolean, data?: object, error?: string}>}
 */
export async function verifyByHash(txHash) {
    const payload = {
        merchant: OXAPAY_API_KEY,
        txHash: txHash,
    };

    try {
        const response = await fetch(`${OXAPAY_BASE_URL}/merchants/inquiry`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });

        const data = await response.json();
        if (data.result === 100) {
            const paid = data.status === 'Paid';
            logger.info(`Hash verification: ${txHash} - Paid: ${paid}`);
            return { success: true, paid, data };
        }
        logger.error(`Hash verification failed: ${data.message}`);
        return { success: false, error: data.message || 'Unknown error' };
    } catch (error) {
        logger.error(`verifyByHash error: ${error.message}`);
        return { success: false, error: error.message };
    }
}
