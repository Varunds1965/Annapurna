/**
 * Paytm Payment Integration
 * Direct gateway integration (not just deep links)
 */
const crypto = require('crypto');
const https = require('https');

async function createPaytmOrder(amount, orderId, customerName, customerEmail, customerMobile) {
  const merchantId = process.env.PAYTM_MERCHANT_ID;
  const merchantKey = process.env.PAYTM_MERCHANT_KEY;
  const website = process.env.PAYTM_WEBSITE || 'WEBSTAGING';
  const env = process.env.PAYTM_ENV || 'UAT'; // UAT or PROD

  // If Paytm not configured, return null to fallback
  if (!merchantId || !merchantKey || merchantId === 'your-paytm-merchant-id') {
    return { success: false, error: 'Paytm not configured' };
  }

  const txnAmount = amount.toFixed(2);
  const callbackUrl = `${process.env.BASE_URL || 'http://localhost:3000'}/api/payments/paytm-callback`;
  const mid = merchantId;

  // Paytm checksum generation
  const body = {
    body: {
      requestType: 'Payment',
      mid: mid,
      websiteName: website,
      orderId: orderId,
      callbackUrl: callbackUrl,
      txnAmount: {
        value: txnAmount,
        currency: 'INR',
      },
      userInfo: {
        custId: customerMobile || customerEmail || `customer_${orderId}`,
        mobile: customerMobile || '',
        email: customerEmail || '',
        firstName: customerName ? customerName.split(' ')[0] : 'Customer',
      },
    },
  };

  const checksum = generatePaytmChecksum(body, merchantKey);
  const requestBody = JSON.stringify({
    head: {
      signature: checksum,
    },
    body: body.body,
  });

  const host = env === 'PROD' ? 'securegw.paytm.in' : 'securegw-stage.paytm.in';

  return new Promise((resolve) => {
    const options = {
      hostname: host,
      port: 443,
      path: '/theia/api/v1/initiateTransaction?mid=' + mid + '&orderId=' + orderId,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(requestBody),
      },
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try {
          const response = JSON.parse(body);
          if (response.body?.resultInfo?.resultStatus === 'Succeeded' || response.body?.resultInfo?.resultStatus === 'Pending') {
            resolve({
              success: true,
              method: 'paytm',
              txnToken: response.body.txnToken,
              orderId: orderId,
              mid: mid,
              // Frontend will open Paytm checkout page
            });
          } else {
            resolve({
              success: false,
              error: response.body?.resultInfo?.resultMsg || 'Paytm order creation failed',
            });
          }
        } catch (err) {
          resolve({ success: false, error: 'Invalid response from Paytm' });
        }
      });
    });

    req.on('error', (err) => {
      resolve({ success: false, error: err.message });
    });

    req.write(requestBody);
    req.end();
  });
}

function generatePaytmChecksum(body, key) {
  const text = JSON.stringify(body);
  const salt = generateRandomString(4);
  const hashString = sha256(text + key + salt);
  return salt + hashString;
}

function verifyPaytmChecksum(body, checksum, key) {
  const salt = checksum.slice(0, 4);
  const hashString = checksum.slice(4);
  const text = JSON.stringify(body);
  const expectedHash = sha256(text + key + salt);
  return hashString === expectedHash;
}

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function generateRandomString(length) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

async function verifyPaytmPayment(responseBody, merchantKey) {
  const body = responseBody.body || {};
  const checksum = responseBody.head?.signature;

  if (!checksum) {
    return { success: false, error: 'Missing checksum' };
  }

  // Verify checksum
  if (!verifyPaytmChecksum(body, checksum, merchantKey)) {
    return { success: false, error: 'Invalid checksum' };
  }

  const resultInfo = body.resultInfo || {};
  if (resultInfo.resultStatus === 'Txn_SUCCESS') {
    return {
      success: true,
      amount: parseFloat(body.txnAmount || 0),
      txnId: body.txnId,
      orderId: body.orderId,
      status: resultInfo.resultStatus,
    };
  }

  return {
    success: false,
    error: resultInfo.resultMsg || 'Payment failed',
    txnId: body.txnId,
  };
}

async function refundPaytmPayment(orderId, txnId, amount = null) {
  const merchantId = process.env.PAYTM_MERCHANT_ID;
  const merchantKey = process.env.PAYTM_MERCHANT_KEY;
  const env = process.env.PAYTM_ENV || 'UAT';

  if (!merchantId || !merchantKey) {
    return { success: false, error: 'Paytm not configured' };
  }

  const body = {
    body: {
      mid: merchantId,
      orderId: orderId,
      txnId: txnId,
      refundAmount: amount ? parseFloat(amount.toFixed(2)) : 0,
    },
  };

  const checksum = generatePaytmChecksum(body, merchantKey);
  const requestBody = JSON.stringify({
    head: { signature: checksum },
    body: body.body,
  });

  const host = env === 'PROD' ? 'securegw.paytm.in' : 'securegw-stage.paytm.in';

  return new Promise((resolve) => {
    const options = {
      hostname: host,
      port: 443,
      path: '/v3/refund/apply',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(requestBody),
      },
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try {
          const response = JSON.parse(body);
          if (response.body?.resultInfo?.resultStatus === 'TXN_SUCCESS') {
            resolve({ success: true, refundId: response.body?.refundId, status: 'SUCCESS' });
          } else {
            resolve({ success: false, error: response.body?.resultInfo?.resultMsg || 'Refund failed' });
          }
        } catch {
          resolve({ success: false, error: 'Invalid response from Paytm' });
        }
      });
    });

    req.on('error', (err) => {
      resolve({ success: false, error: err.message });
    });

    req.write(requestBody);
    req.end();
  });
}

module.exports = {
  createPaytmOrder,
  verifyPaytmPayment,
  refundPaytmPayment,
};