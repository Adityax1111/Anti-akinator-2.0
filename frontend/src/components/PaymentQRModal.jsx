// /frontend/src/components/PaymentQRModal.jsx
import React, { useState, useEffect } from 'react';
import './PaymentQRModal.css';

// Simple SVG Icons
const XIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const CopyIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

const CheckIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const AlertCircleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="8" x2="12" y2="12" />
    <line x1="12" y1="16" x2="12.01" y2="16" />
  </svg>
);

const InfoIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="12" x2="12" y2="16" />
    <line x1="12" y1="8" x2="12.01" y2="8" />
  </svg>
);

const ShieldIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    <polyline points="9 12 11 14 15 10" />
  </svg>
);

const SmartphoneIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
    <line x1="12" y1="18" x2="12.01" y2="18" />
  </svg>
);

const PaymentQRModal = ({
  isOpen,
  onClose,
  userId,
  itemType,
  itemName,
  amount,
  itemDetails = {},
  onSuccess,
  onError
}) => {
  const [utrNumber, setUtrNumber] = useState('');
  const [paidAmount, setPaidAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [utrError, setUtrError] = useState('');
  const [isUtrChecking, setIsUtrChecking] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showUtrHelp, setShowUtrHelp] = useState(false);

  const API_URL = import.meta.env.VITE_API_URL || '';
  const UPI_ID = 'adisinghx11@okaxis';

  // Lock body scroll when modal opens
  useEffect(() => {
    if (isOpen) {
      document.body.classList.add('modal-open');
    } else {
      document.body.classList.remove('modal-open');
    }

    return () => {
      document.body.classList.remove('modal-open');
    };
  }, [isOpen]);

  // Reset state every time the modal opens, and pre-fill the paid amount
  // so most people don't have to type anything into that field at all.
  useEffect(() => {
    if (isOpen) {
      setUtrNumber('');
      setPaidAmount(amount ? String(amount) : '');
      setError('');
      setSuccess('');
      setUtrError('');
      setLoading(false);
      setShowUtrHelp(false);
    }
  }, [isOpen, amount]);

  const upiLink = `upi://pay?pa=${UPI_ID}&pn=Anti-Akinator&am=${amount}&cu=INR`;

  const checkUtr = async (utr) => {
    if (!utr || utr.length < 6) {
      setUtrError('UTR must be at least 6 characters');
      return false;
    }

    setIsUtrChecking(true);
    setUtrError('');

    try {
      const token = localStorage.getItem('token');

      if (!token) {
        setUtrError('Please login to continue');
        return false;
      }

      const response = await fetch(`${API_URL}/transactions/check-utr`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ utrNumber: utr })
      });

      if (!response.ok) {
        setUtrError(`Server error: ${response.status}. Please try again.`);
        return false;
      }

      let data;
      try {
        data = await response.json();
      } catch (parseError) {
        setUtrError('Server returned invalid response. Please try again.');
        return false;
      }

      if (!data.success) {
        setUtrError(data.message || 'Error checking UTR');
        return false;
      }

      if (!data.available) {
        setUtrError('This UTR number has already been used. Please check and try again.');
        return false;
      }

      return true;
    } catch (error) {
      setUtrError('Network error. Please check your connection and try again.');
      return false;
    } finally {
      setIsUtrChecking(false);
    }
  };

  const handleUtrChange = (e) => {
    const value = e.target.value.toUpperCase().trim();
    setUtrNumber(value);
    setUtrError('');
    if (error) setError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!utrNumber || utrNumber.length < 6) {
      setError('Please enter a valid UTR number (minimum 6 characters)');
      return;
    }

    if (!paidAmount || parseFloat(paidAmount) < 1) {
      setError('Please enter a valid amount');
      return;
    }

    const isAvailable = await checkUtr(utrNumber);
    if (!isAvailable) {
      return;
    }

    setLoading(true);

    try {
      const token = localStorage.getItem('token');

      if (!token) {
        setError('Please login to continue');
        setLoading(false);
        return;
      }

      const response = await fetch(`${API_URL}/transactions/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          userId,
          utrNumber: utrNumber.toUpperCase(),
          paidAmount: parseFloat(paidAmount),
          expectedAmount: amount,
          itemType,
          itemName,
          itemDetails: {
            ...itemDetails,
            timestamp: new Date().toISOString()
          }
        })
      });

      if (!response.ok) {
        setError('Server error. Please try again.');
        setLoading(false);
        return;
      }

      let data;
      try {
        data = await response.json();
      } catch (parseError) {
        setError('Server returned invalid response. Please try again.');
        setLoading(false);
        return;
      }

      if (response.ok && data.success) {
        setSuccess(`We've received your payment details for ${itemName}. Our team will verify it and add it to your account within 24 hours.`);

        if (onSuccess) {
          setTimeout(() => {
            onSuccess(data.data);
          }, 1000);
        }

        setTimeout(() => {
          onClose();
        }, 4500);
      } else {
        setError(data.message || 'Failed to submit payment verification. Please try again.');
        if (onError) onError(data.message);
      }
    } catch (error) {
      setError('Network error. Please check your connection and try again.');
      if (onError) onError(error.message);
    } finally {
      setLoading(false);
    }
  };

  const copyUpiId = () => {
    navigator.clipboard.writeText(UPI_ID);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleClose = () => {
    if (!loading) {
      onClose();
    }
  };

  const generateQRCode = () => {
    return `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(upiLink)}`;
  };

  const getFallbackQR = () => {
    return `data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200"%3E%3Crect width="200" height="200" fill="%231a1a2e"/%3E%3Ctext x="40" y="85" font-family="Arial" font-size="14" fill="%2394a3b8"%3EUPI ID:%3C/text%3E%3Ctext x="40" y="110" font-family="Arial" font-size="16" fill="%23ffffff"%3E${UPI_ID}%3C/text%3E%3Ctext x="40" y="135" font-family="Arial" font-size="12" fill="%2364748b"%3EScan from UPI app%3C/text%3E%3Ctext x="40" y="160" font-family="Arial" font-size="11" fill="%2364748b"%3EAmount: ₹${amount}%3C/text%3E%3C/svg%3E`;
  };

  if (!isOpen) return null;

  return (
    <div className="payment-modal-overlay" onClick={handleClose}>
      <div className="payment-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="payment-modal-header">
          <h2 className="payment-modal-title">
            {success ? 'Payment Submitted' : 'Complete Your Payment'}
          </h2>
          <button
            onClick={handleClose}
            className="payment-modal-close"
            disabled={loading}
          >
            <XIcon />
          </button>
        </div>

        {/* Content */}
        <div className="payment-modal-body">
          {success ? (
            // ---- Success screen ----
            <div className="success-full">
              <div className="success-icon-circle">
                <CheckIcon />
              </div>
              <h3>You're all set!</h3>
              <p>{success}</p>
            </div>
          ) : (
            // ---- Single-screen pay + confirm flow ----
            <>
              <div className="trust-badge">
                <ShieldIcon />
                <span>100% Secure</span>
                <span className="trust-dot">•</span>
                <span>Verified by Admin</span>
              </div>

              <div className="item-info">
                <p className="item-name">{itemName}</p>
                <p className="item-amount">₹{amount}</p>
              </div>

              {/* Fastest path: one tap opens the user's UPI app pre-filled */}
              <div className="pay-actions">
                <a href={upiLink} className="btn-primary upi-pay-btn">
                  <SmartphoneIcon />
                  Tap to Pay with UPI App
                </a>
                <p className="pay-hint-small">Opens GPay, PhonePe, Paytm, or any UPI app with the amount pre-filled.</p>
              </div>

              <div className="divider-or"><span>or scan the QR code</span></div>

              <div className="qr-container">
                <img
                  src={generateQRCode()}
                  alt="Payment QR Code"
                  className="qr-image"
                  onError={(e) => {
                    e.target.src = getFallbackQR();
                  }}
                />
              </div>

              <div className="upi-details">
                <p className="upi-label">UPI ID</p>
                <div className="upi-id-container">
                  <span className="upi-id">{UPI_ID}</span>
                  <button onClick={copyUpiId} className="copy-btn" type="button">
                    {copied ? <CheckIcon /> : <CopyIcon />}
                    {copied ? 'Copied!' : 'Copy'}
                  </button>
                </div>
              </div>

              {/* The step people were missing - now impossible to scroll past */}
              <div className="attention-banner">
                <span className="attention-badge">Next step</span>
                <p><strong>Already paid?</strong> Enter your UTR number below so our team can confirm it and deliver your order. Skipping this means we can't verify your payment.</p>
              </div>

              <form onSubmit={handleSubmit} className="confirm-form">
                <div className="form-group">
                  <label htmlFor="utrNumber" className="form-label">
                    UTR / Transaction ID <span className="required">*</span>
                  </label>
                  <input
                    id="utrNumber"
                    type="text"
                    value={utrNumber}
                    onChange={handleUtrChange}
                    placeholder="e.g. 402812345678"
                    required
                    className={`form-input ${utrError ? 'error' : ''}`}
                    disabled={loading}
                    maxLength={20}
                  />
                  {utrError && (
                    <div className="error-message">
                      <AlertCircleIcon />
                      {utrError}
                    </div>
                  )}
                  <button
                    type="button"
                    className="utr-help-toggle"
                    onClick={() => setShowUtrHelp((s) => !s)}
                  >
                    <InfoIcon />
                    Where do I find my UTR number?
                  </button>
                  {showUtrHelp && (
                    <div className="utr-help-box">
                      Open your UPI app → <strong>Transaction History</strong> → tap the payment you just made.
                      The UTR (sometimes called "Reference No." or "Transaction ID") is the 12+ digit number shown there.
                    </div>
                  )}
                </div>

                <div className="form-group">
                  <label htmlFor="paidAmount" className="form-label">
                    Amount Paid (₹) <span className="required">*</span>
                  </label>
                  <input
                    id="paidAmount"
                    type="number"
                    value={paidAmount}
                    onChange={(e) => setPaidAmount(e.target.value)}
                    required
                    min="1"
                    step="1"
                    className="form-input"
                    disabled={loading}
                  />
                  <p className="input-hint">Already filled in for you - only change it if you paid a different amount.</p>
                </div>

                {error && (
                  <div className="error-box">
                    <AlertCircleIcon />
                    <span>{error}</span>
                  </div>
                )}

                <div className="form-actions">
                  <button
                    type="button"
                    onClick={handleClose}
                    className="btn-secondary"
                    disabled={loading}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn-primary"
                    disabled={loading || isUtrChecking}
                  >
                    {loading ? (
                      <>
                        <span className="spinner"></span>
                        Confirming...
                      </>
                    ) : isUtrChecking ? (
                      <>
                        <span className="spinner"></span>
                        Checking UTR...
                      </>
                    ) : (
                      <>
                        <CheckIcon />
                        Confirm Payment
                      </>
                    )}
                  </button>
                </div>

                <p className="form-footer">
                  🔒 We'll verify your payment and deliver your order within 24 hours.
                </p>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default PaymentQRModal;