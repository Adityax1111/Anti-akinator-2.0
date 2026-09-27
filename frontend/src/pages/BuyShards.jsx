// /frontend/src/pages/BuyShards.jsx
import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../api/axios';
import PaymentQRModal from '../components/PaymentQRModal';
import './BuyShards.css';

const shardPackages = [
  { id: 1, name: 'STARTER', shards: 50, price: '₹10 INR', priceValue: 10, hints: 0, tag: null },
  { id: 2, name: 'ENTHUSIAST', shards: 100, price: '₹20 INR', priceValue: 20, hints: 1, tag: null },
  { id: 3, name: 'PRO', shards: 300, price: '₹30 INR', priceValue: 30, hints: 3, tag: null },
  { id: 4, name: 'POPULAR', shards: 700, price: '₹40 INR', priceValue: 40, hints: 7, tag: '⭐ Popular' },
  { id: 5, name: 'ULTIMATE', shards: 1000, price: '₹50 INR', priceValue: 50, hints: 10, tag: null },
  { id: 6, name: 'LEGENDARY', shards: 2000, price: '₹90 INR', priceValue: 90, hints: 20, tag: null },
];

const BuyShards = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [selectedPack, setSelectedPack] = useState(null);
  const [agreed, setAgreed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [isVisible, setIsVisible] = useState(false);
  const [showPurchase, setShowPurchase] = useState(false);
  const [showQRModal, setShowQRModal] = useState(false);

  const purchaseRef = useRef(null);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setIsVisible(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (selectedPack) {
      const frame = requestAnimationFrame(() => {
        setShowPurchase(true);
        purchaseRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
      return () => cancelAnimationFrame(frame);
    } else {
      setShowPurchase(false);
    }
  }, [selectedPack]);

  const handleSelectPack = (pack) => {
    setSelectedPack(pack);
    setError('');
  };

  const handleQRPayment = () => {
    if (!selectedPack) {
      setError('Please select a shards pack.');
      return;
    }

    if (!agreed) {
      setError('You must agree to the Terms & Conditions, Privacy Policy, and Refund Policy.');
      return;
    }

    if (!user) {
      setError('Please login to continue.');
      return;
    }

    setShowQRModal(true);
  };

  const handleQRSuccess = (data) => {
    setSuccess(`✅ Payment submitted for ${selectedPack.shards} Shards! We'll verify it and add them to your account within 24 hours.`);
    setSelectedPack(null);
    setAgreed(false);
  };

  const handleQRError = (error) => {
    setError(error || 'Failed to submit payment verification. Please try again.');
  };

  return (
    <div className={`buyshards-page ${isVisible ? 'visible' : ''}`}>
      <div className="bg-noise"></div>
      <div className="bg-grid"></div>

      <section className="buyshards-hero">
        <div className="aurora aurora-1"></div>
        <div className="aurora aurora-2"></div>
        <div className="buyshards-hero-content">
          <div className="hero-badge">
            <span className="badge-dot"></span>
            Power Up Your Collection
          </div>
          <h1 className="buyshards-title">
            <span className="buyshards-title-gradient">Buy Character Shards</span>
          </h1>
          <p className="buyshards-subtitle">Purchase shards to use hints and unlock premium features</p>
          <div className="shards-display">
            <span className="shards-icon">🎴</span>
            <span>You have</span>
            <strong>{user?.shards || 0}</strong>
            <span>Shards</span>
          </div>
        </div>
      </section>

      {error && <div className="buyshards-alert error">{error}</div>}
      {success && <div className="buyshards-alert success">{success}</div>}

      <div className="shards-packs-grid">
        {shardPackages.map((pack, index) => (
          <div
            key={pack.id}
            className={`shards-pack ${pack.tag ? 'popular' : ''} ${selectedPack?.id === pack.id ? 'selected' : ''} ${isVisible ? 'visible' : ''}`}
            style={{ animationDelay: `${0.15 + index * 0.08}s` }}
            onClick={() => handleSelectPack(pack)}
          >
            <div className="shards-pack-border"></div>
            {pack.tag && <div className="pack-tag">{pack.tag}</div>}
            {selectedPack?.id === pack.id && <div className="pack-selected-check">✓</div>}
            <div className="pack-name">{pack.name}</div>
            <div className="pack-shards">🎴 {pack.shards} Shards</div>
            <div className="pack-price">{pack.price}</div>
            <div className="pack-hints">💡 <strong>{pack.hints}</strong> Hints</div>
          </div>
        ))}
      </div>

      {selectedPack && (
        <div className={`purchase-section ${showPurchase ? 'visible' : ''}`} ref={purchaseRef}>
          <div className="purchase-summary">
            <h3>📋 Order Summary</h3>
            <p>
              <span>Package:</span>
              <strong>{selectedPack.name} – {selectedPack.shards} Shards</strong>
            </p>
            <p>
              <span>Price:</span>
              <strong className="price-highlight">{selectedPack.price}</strong>
            </p>
            <p>
              <span>Hints Included:</span>
              <strong>{selectedPack.hints} hints</strong>
            </p>
          </div>

          <div className="agreement-section">
            <label className="agreement-checkbox">
              <input
                type="checkbox"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
              />
              <span>
                I agree to the{' '}
                <a href="/terms" target="_blank" rel="noopener noreferrer">Terms & Conditions</a>,{' '}
                <a href="/privacy" target="_blank" rel="noopener noreferrer">Privacy Policy</a>, and{' '}
                <a href="/refund" target="_blank" rel="noopener noreferrer">Refund & Cancellation Policy</a>.
              </span>
            </label>
          </div>

          <button
            className="purchase-btn"
            onClick={handleQRPayment}
            disabled={!agreed || loading}
          >
            {loading ? 'Processing...' : `Pay ${selectedPack.price} Now`}
          </button>
        </div>
      )}

      {/* Payment Modal - single screen: pay + confirm UTR */}
      {user && selectedPack && (
        <PaymentQRModal
          isOpen={showQRModal}
          onClose={() => {
            setShowQRModal(false);
          }}
          userId={user._id}
          itemType="shards"
          itemName={`${selectedPack.shards} Shards Pack`}
          amount={selectedPack.priceValue}
          itemDetails={{
            shardCount: selectedPack.shards,
            packId: selectedPack.id,
            packName: selectedPack.name
          }}
          onSuccess={handleQRSuccess}
          onError={handleQRError}
        />
      )}
    </div>
  );
};

export default BuyShards;