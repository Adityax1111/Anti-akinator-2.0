// /frontend/src/components/BlurImage.jsx
//
// NOTE: This is a general-purpose reusable component and is NOT part of
// the secure BlurGame flow (BlurGame.jsx renders its own image via the
// authenticated /image/:gameId proxy). It's left functionally identical
// to before — only the CSS has been aligned to the same premium palette
// as the game page. If you use this elsewhere for anything where the
// source URL must stay secret, route the `src` through a server-side
// proxy the same way BlurGame.jsx does, rather than passing a raw URL.
import React, { useState, useEffect, useRef, useCallback } from 'react';
import './BlurImage.css';

// ============================================================
// BASIC BLUR IMAGE COMPONENT
// ============================================================
const BlurImage = ({
  src,
  alt = 'Image',
  className = '',
  blurAmount = 0,
  maxBlur = 50,
  minBlur = 0,
  onImageLoad = () => {},
  onImageError = () => {},
  showOverlay = true,
  overlayText = '🔮',
  overlayEmoji = true,
  containerClassName = '',
  imageClassName = '',
  style = {},
  transitionSpeed = '0.3s'
}) => {
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [currentBlur, setCurrentBlur] = useState(blurAmount);

  useEffect(() => {
    setCurrentBlur(blurAmount);
  }, [blurAmount]);

  const handleImageLoad = () => {
    setIsLoaded(true);
    onImageLoad();
  };

  const handleImageError = (e) => {
    setError(true);
    onImageError(e);
  };

  const getBlurStyle = () => {
    const blur = Math.min(Math.max(currentBlur, minBlur), maxBlur);
    return {
      filter: `blur(${blur}px)`,
      WebkitFilter: `blur(${blur}px)`,
      transition: `filter ${transitionSpeed} ease-in-out`
    };
  };

  const getBlurIntensity = () => {
    const percentage = maxBlur > 0 ? (currentBlur / maxBlur) * 100 : 0;
    if (percentage > 80) return 'Very Blurry';
    if (percentage > 50) return 'Blurry';
    if (percentage > 20) return 'Slightly Clear';
    return 'Clear';
  };

  const getEmoji = () => {
    const percentage = maxBlur > 0 ? (currentBlur / maxBlur) * 100 : 0;
    if (percentage > 80) return '🔮';
    if (percentage > 50) return '👀';
    if (percentage > 20) return '✨';
    return '🌟';
  };

  const fallbackImage = () => {
    if (error) {
      return (
        <div className="blur-image-fallback">
          <span className="fallback-icon">🖼️</span>
          <span className="fallback-text">Image not available</span>
        </div>
      );
    }
    return null;
  };

  return (
    <div className={`blur-image-container ${containerClassName}`} style={style}>
      {!error ? (
        <img
          src={src}
          alt={alt}
          className={`blur-image ${imageClassName} ${isLoaded ? 'loaded' : 'loading'}`}
          style={getBlurStyle()}
          onLoad={handleImageLoad}
          onError={handleImageError}
          loading="lazy"
          draggable="false"
        />
      ) : (
        fallbackImage()
      )}

      {!isLoaded && !error && (
        <div className="blur-image-loading">
          <div className="loading-spinner"></div>
        </div>
      )}

      {showOverlay && !error && isLoaded && (
        <div className="blur-image-overlay">
          <div className="overlay-content">
            {overlayEmoji && <span className="overlay-emoji">{getEmoji()}</span>}
            {overlayText && <span className="overlay-text">{overlayText}</span>}
            <span className="overlay-blur-level">
              {getBlurIntensity()} ({Math.round(maxBlur > 0 ? (currentBlur / maxBlur) * 100 : 0)}%)
            </span>
          </div>
        </div>
      )}

      {!error && isLoaded && (
        <div className="blur-progress-badge">
          <span className="blur-badge-icon">👁️</span>
          <span className="blur-badge-value">
            {Math.round(maxBlur > 0 ? (currentBlur / maxBlur) * 100 : 0)}%
          </span>
        </div>
      )}
    </div>
  );
};

// ============================================================
// BLUR IMAGE WITH TIMER (For standalone use)
// ============================================================
export const BlurImageWithTimer = ({
  src,
  alt = 'Image',
  className = '',
  initialBlur = 50,
  maxBlur = 50,
  minBlur = 0,
  duration = 60,
  onComplete = () => {},
  onBlurUpdate = () => {},
  autoStart = true,
  showTimer = true,
  showProgress = true,
  ...props
}) => {
  const [blur, setBlur] = useState(initialBlur);
  const [timeElapsed, setTimeElapsed] = useState(0);
  const [isComplete, setIsComplete] = useState(false);
  const [isRunning, setIsRunning] = useState(autoStart);

  const timerRef = useRef(null);
  const startTimeRef = useRef(null);

  const startTimer = useCallback(() => {
    if (timerRef.current) return;
    setIsRunning(true);
    startTimeRef.current = Date.now();

    timerRef.current = setInterval(() => {
      const elapsed = (Date.now() - startTimeRef.current) / 1000;
      const newTime = Math.min(elapsed, duration);
      setTimeElapsed(newTime);

      const progress = newTime / duration;
      const newBlur = Math.max(minBlur, initialBlur - (initialBlur - minBlur) * progress);
      const roundedBlur = Math.round(newBlur);
      setBlur(roundedBlur);

      onBlurUpdate(roundedBlur);

      if (newTime >= duration) {
        setIsComplete(true);
        setIsRunning(false);
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
        onComplete();
      }
    }, 100);
  }, [duration, initialBlur, minBlur, onBlurUpdate, onComplete]);

  const stopTimer = useCallback(() => {
    setIsRunning(false);
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const resetTimer = useCallback(() => {
    stopTimer();
    setTimeElapsed(0);
    setBlur(initialBlur);
    setIsComplete(false);
    setIsRunning(false);
    if (autoStart) {
      setTimeout(startTimer, 100);
    }
  }, [stopTimer, initialBlur, autoStart, startTimer]);

  useEffect(() => {
    if (autoStart) {
      startTimer();
    }
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [autoStart, startTimer]);

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    if (mins > 0) return `${mins}m ${secs}s`;
    return `${secs}s`;
  };

  const progressPercentage = Math.min((timeElapsed / duration) * 100, 100);

  const getStatusColor = () => {
    if (isComplete) return '#10b981';
    if (timeElapsed / duration > 0.7) return '#ef4444';
    if (timeElapsed / duration > 0.4) return '#f59e0b';
    return '#6c63ff';
  };

  const blurPercentage = maxBlur > 0 ? Math.round((blur / maxBlur) * 100) : 0;

  return (
    <div className="blur-image-timer-container">
      {showTimer && (
        <div className="blur-timer-display">
          <div className="timer-info">
            <span className="timer-icon">⏱️</span>
            <span className="timer-value" style={{ color: getStatusColor() }}>
              {formatTime(timeElapsed)}
            </span>
            <span className="timer-status">
              {isComplete ? '✅ Complete' : isRunning ? '▶️ Running' : '⏸️ Paused'}
            </span>
          </div>
          <div className="timer-controls">
            {!isComplete && (
              <button className="timer-btn" onClick={isRunning ? stopTimer : startTimer}>
                {isRunning ? '⏸️' : '▶️'}
              </button>
            )}
            <button className="timer-btn" onClick={resetTimer}>
              🔄
            </button>
          </div>
        </div>
      )}

      <BlurImage
        src={src}
        alt={alt}
        className={className}
        blurAmount={blur}
        maxBlur={maxBlur}
        minBlur={minBlur}
        overlayText={`${blurPercentage}% blur`}
        {...props}
      />

      {showProgress && (
        <div className="blur-progress-container">
          <div className="blur-progress-bar">
            <div
              className="blur-progress-fill"
              style={{
                width: `${progressPercentage}%`,
                background: `linear-gradient(90deg, #6c63ff, ${getStatusColor()})`
              }}
            />
          </div>
          <div className="blur-progress-labels">
            <span>🔮 {blurPercentage}% blur</span>
            <span>🌟 0% blur</span>
          </div>
        </div>
      )}
    </div>
  );
};

// ============================================================
// SIMPLE BLUR IMAGE (Game Version)
// ============================================================
export const GameBlurImage = ({
  src,
  alt = 'Mystery Character',
  className = '',
  timeElapsed = 0,
  maxTime = 60,
  maxBlur = 50,
  minBlur = 0,
  onBlurUpdate = () => {},
  showOverlay = true,
  showBadge = true,
  ...props
}) => {
  const getBlurFromTime = (time) => {
    const progress = Math.min(time / maxTime, 1);
    const blur = Math.max(minBlur, maxBlur - (maxBlur - minBlur) * progress);
    return Math.round(blur);
  };

  const [blur, setBlur] = useState(getBlurFromTime(timeElapsed));

  useEffect(() => {
    const newBlur = getBlurFromTime(timeElapsed);
    setBlur(newBlur);
    onBlurUpdate(newBlur);
  }, [timeElapsed, maxTime, maxBlur, minBlur, onBlurUpdate]);

  const displayPercentage = maxBlur > 0 ? Math.round((blur / maxBlur) * 100) : 0;

  const getEmoji = () => {
    if (displayPercentage > 80) return '🔮';
    if (displayPercentage > 50) return '👀';
    if (displayPercentage > 20) return '✨';
    return '🌟';
  };

  const getOverlayText = () => {
    if (displayPercentage > 80) return 'Too blurry! 👀';
    if (displayPercentage > 50) return 'Getting clearer...';
    if (displayPercentage > 20) return 'Almost there!';
    return 'Clear!';
  };

  return (
    <div className="game-blur-image-container">
      <img
        src={src}
        alt={alt}
        className={`game-blur-image ${className}`}
        style={{
          filter: `blur(${blur}px)`,
          WebkitFilter: `blur(${blur}px)`,
          transition: 'filter 0.3s ease-in-out',
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          display: 'block'
        }}
        draggable="false"
        {...props}
      />

      {showOverlay && (
        <div className="game-blur-image-overlay">
          <div className="game-overlay-content">
            <span className="game-overlay-emoji">{getEmoji()}</span>
            <span className="game-overlay-text">{getOverlayText()}</span>
          </div>
        </div>
      )}

      {showBadge && (
        <div className="game-blur-badge">
          <span>👁️ {displayPercentage}% blur</span>
        </div>
      )}
    </div>
  );
};

export default BlurImage;