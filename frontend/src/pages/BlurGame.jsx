// /frontend/src/pages/BlurGame.jsx
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { startGame, submitGuess, getGameStats } from '../api/blurGame';
import './BlurGame.css';

const BlurGame = () => {
  const { user, updateUser } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [gameStarted, setGameStarted] = useState(false);
  const [gameEnded, setGameEnded] = useState(false);
  const [imageUrl, setImageUrl] = useState('');
  const [secureImageUrl, setSecureImageUrl] = useState(''); // ✅ NEW
  const [characterName, setCharacterName] = useState('');
  const [anime, setAnime] = useState('');
  const [gameId, setGameId] = useState(null);
  const [guess, setGuess] = useState('');
  const [timeElapsed, setTimeElapsed] = useState(0);
  const [displayBlur, setDisplayBlur] = useState(100);
  const [result, setResult] = useState(null);
  const [stats, setStats] = useState(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [canGuess, setCanGuess] = useState(true);
  const [wrongGuesses, setWrongGuesses] = useState(0);
  const [maxGuesses, setMaxGuesses] = useState(3);
  const [remainingGuesses, setRemainingGuesses] = useState(3);
  const [guessedNames, setGuessedNames] = useState([]);

  const timerRef = useRef(null);
  const startTimeRef = useRef(null);
  const guessInputRef = useRef(null);
  const gameAbandonedRef = useRef(false);
  const isGameEndingRef = useRef(false);
  const isGameStartingRef = useRef(false);

  // ============================================================
  // ✅ BLUR CALCULATION
  // ============================================================
  const getBlurValues = (seconds) => {
    const totalTime = 60;
    const display = Math.max(0, 100 - (seconds / totalTime) * 100);
    const displayRounded = Math.round(display);
    return {
      display: displayRounded,
      actual: Math.round((displayRounded / 100) * 50)
    };
  };

  // ============================================================
  // ✅ START THE TIMER
  // ============================================================
  const startTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    startTimeRef.current = Date.now();
    isGameStartingRef.current = false;
    

    timerRef.current = setInterval(() => {
      const now = Date.now();
      const elapsed = Math.floor((now - startTimeRef.current) / 1000);
      
      setTimeElapsed(elapsed);
      
      const { display } = getBlurValues(elapsed);
      setDisplayBlur(display);
      
      if (elapsed >= 60) {
        clearInterval(timerRef.current);
        timerRef.current = null;
        endGame(null, true);
      }
    }, 100);
  }, []);

  // ============================================================
  // ✅ CLEANUP GAME
  // ============================================================
  const cleanupGame = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    gameAbandonedRef.current = false;
    isGameEndingRef.current = false;
    isGameStartingRef.current = false;
    setGameEnded(false);
    setGameStarted(false);
    setCanGuess(true);
    setResult(null);
    setGuess('');
    setTimeElapsed(0);
    setDisplayBlur(100);
    setGameId(null);
    setImageUrl('');
    setSecureImageUrl(''); // ✅ NEW
    setCharacterName('');
    setAnime('');
    setError('');
    setSuccess('');
    setWrongGuesses(0);
    setMaxGuesses(3);
    setRemainingGuesses(3);
    setGuessedNames([]);
    startTimeRef.current = null;
  }, []);

  // ============================================================
  // ✅ ABANDON GAME
  // ============================================================
  const abandonGame = useCallback(async () => {
    if (isGameStartingRef.current) {
      return;
    }
    
    if (gameAbandonedRef.current || isGameEndingRef.current) {
      return;
    }
    
    if (!gameStarted || gameEnded) {
      return;
    }
    isGameEndingRef.current = true;
    gameAbandonedRef.current = true;
    
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    
    setGameEnded(true);
    setCanGuess(false);
    
    setResult({
      isCorrect: false,
      wonCard: false,
      characterName: characterName || 'Unknown',
      anime: anime || 'Unknown',
      imageUrl: imageUrl || '',
      timeTaken: timeElapsed,
      message: '🚪 You left the game!',
      rewardMessage: 'Game counted as a loss. Stay on the page to play!'
    });
    
    if (gameId) {
      try {
        const token = localStorage.getItem('token');
        await fetch(`${import.meta.env.VITE_API_URL}/api/blur-game/abandon`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ gameId })
        });
      } catch (err) {
      }
    }
    
    await fetchStats();
    isGameEndingRef.current = false;
  }, [gameStarted, gameEnded, gameId, characterName, anime, imageUrl, timeElapsed]);

  // ============================================================
  // ✅ PAGE VISIBILITY (Tab switch)
  // ============================================================
  useEffect(() => {
    let timeoutId = null;
    
    const handleVisibilityChange = () => {
      if (document.hidden && gameStarted && !gameEnded && !gameAbandonedRef.current) {
        timeoutId = setTimeout(() => {
          if (document.hidden && gameStarted && !gameEnded && !gameAbandonedRef.current) {
            abandonGame();
          }
        }, 500);
      }
    };
    
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [gameStarted, gameEnded, abandonGame]);

  // ============================================================
  // ✅ BEFORE UNLOAD
  // ============================================================
  useEffect(() => {
    const handleBeforeUnload = (e) => {
      if (gameStarted && !gameEnded && !gameAbandonedRef.current) {
        e.preventDefault();
        e.returnValue = 'You have an active game! Are you sure you want to leave?';
        return e.returnValue;
      }
    };
    
    const handleUnload = () => {
      if (gameStarted && !gameEnded && !gameAbandonedRef.current) {
        abandonGame();
      }
    };
    
    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('unload', handleUnload);
    
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('unload', handleUnload);
    };
  }, [gameStarted, gameEnded, abandonGame]);

  // ============================================================
  // ✅ COMPONENT UNMOUNT
  // ============================================================
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, []);

  // ============================================================
  // ✅ FETCH STATS
  // ============================================================
  const fetchStats = useCallback(async () => {
    try {
      const data = await getGameStats();
      if (data.success) {
        setStats(data.data);
      }
    } catch (err) {
    }
  }, []);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  // ============================================================
  // ✅ FETCH SECURE BLURRED IMAGE (NEW)
  // ============================================================
  useEffect(() => {
    if (!gameStarted || !gameId) return;

    let intervalId;
    let currentObjectUrl = null;

    const fetchBlurredImage = async () => {
      // Don't fetch if game already ended and we have an image
      if (gameEnded && secureImageUrl) return;

      try {
        const token = localStorage.getItem('token');
        const url = `${import.meta.env.VITE_API_URL}/api/blur-game/image/${gameId}?t=${Date.now()}`;
        
        const response = await fetch(url, {
          headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!response.ok) {
          throw new Error('Failed to fetch image');
        }

        const blob = await response.blob();
        const objectUrl = URL.createObjectURL(blob);
        
        // Revoke previous URL to prevent memory leaks
        if (currentObjectUrl) {
          URL.revokeObjectURL(currentObjectUrl);
        }
        currentObjectUrl = objectUrl;
        
        setSecureImageUrl(objectUrl);
      } catch (err) {
        console.error("Failed to load image", err);
      }
    };

    // Fetch immediately
    fetchBlurredImage();

    // Fetch every 1 second to update the blur
    if (!gameEnded) {
      intervalId = setInterval(fetchBlurredImage, 1000);
    }

    return () => {
      if (intervalId) clearInterval(intervalId);
      if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
    };
  }, [gameStarted, gameId, gameEnded]);

  // ============================================================
  // ✅ START NEW GAME
  // ============================================================
  const startNewGame = async () => {
    
    isGameStartingRef.current = true;
    
    cleanupGame();
    
    setLoading(true);
    setError('');
    setSuccess('');
    setResult(null);
    setGameEnded(false);
    setCanGuess(true);
    setGuess('');
    setWrongGuesses(0);
    setMaxGuesses(3);
    setRemainingGuesses(3);
    setGuessedNames([]);
    gameAbandonedRef.current = false;
    isGameEndingRef.current = false;
    
    try {
      const data = await startGame();
      
      if (data.success && data.gameId) {
        
        setGameId(data.gameId);
        setImageUrl(data.imageUrl);  // Keep this for result display
        setCharacterName(data.characterName || '');
        setAnime(data.anime || '');
        setGameStarted(true);
        setTimeElapsed(0);
        setDisplayBlur(100);
        setMaxGuesses(data.maxGuesses || 3);
        setRemainingGuesses(data.maxGuesses || 3);
        
        setLoading(false);
        setSuccess(`🎯 Game started! You have ${data.maxGuesses || 3} guesses. Guess within 30 seconds to win the card!`);
        setTimeout(() => setSuccess(''), 4000);
        
        setTimeout(() => {
          isGameStartingRef.current = false;
          startTimer();
        }, 300);
        
        setTimeout(() => {
          if (guessInputRef.current) {
            guessInputRef.current.focus();
          }
        }, 400);
        
      } else {
        setError(data.message || 'Failed to start game. Please try again.');
        setLoading(false);
        isGameStartingRef.current = false;
      }
    } catch (err) {
      
      if (err.response?.data?.gameId && err.response?.data?.imageUrl) {
        const data = err.response.data;
        setGameId(data.gameId);
        setImageUrl(data.imageUrl);
        setCharacterName(data.characterName || '');
        setAnime(data.anime || '');
        setGameStarted(true);
        setTimeElapsed(0);
        setDisplayBlur(100);
        setMaxGuesses(data.maxGuesses || 3);
        setRemainingGuesses(data.maxGuesses || 3);
        
        setLoading(false);
        setSuccess('🔄 Resuming existing game...');
        setTimeout(() => setSuccess(''), 3000);
        
        setTimeout(() => {
          isGameStartingRef.current = false;
          startTimer();
        }, 300);
      } else {
        setError(err.response?.data?.message || 'Failed to start game. Please try again.');
        setLoading(false);
        isGameStartingRef.current = false;
      }
    }
  };

  // ============================================================
  // ✅ END GAME
  // ============================================================
  const endGame = async (guessText = null, timedOut = false) => {
    if (isGameEndingRef.current || gameAbandonedRef.current) return;
    if (gameEnded) return;
    
    if (timedOut) {
      isGameEndingRef.current = true;
      
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      
      setGameEnded(true);
      setCanGuess(false);
      
      setResult({
        isCorrect: false,
        wonCard: false,
        characterName: characterName || 'Unknown',
        anime: anime || 'Unknown',
        imageUrl: imageUrl || '',
        timeTaken: timeElapsed,
        message: '⏰ Time\'s up!',
        rewardMessage: 'The image is fully clear now! Better luck next time!'
      });
      
      if (stats) {
        setStats({
          ...stats,
          gamesPlayed: (stats.gamesPlayed || 0) + 1
        });
      }
      
      isGameEndingRef.current = false;
      return;
    }
    
    if (guessText) {
      setIsSubmitting(true);
      try {
        const data = await submitGuess(gameId, guessText, timeElapsed);
        
        // ✅ WRONG GUESS - CAN RETRY
        if (data.success === false && data.canRetry) {
          
          setWrongGuesses(data.wrongGuesses || 0);
          setRemainingGuesses(data.remainingGuesses || 0);
          setGuessedNames(prev => [...prev, guessText]);
          
          setError(data.message || 'Wrong guess! Try again.');
          setGuess('');
          setIsSubmitting(false);
          isGameEndingRef.current = false;
          
          setTimeout(() => {
            if (guessInputRef.current) {
              guessInputRef.current.focus();
            }
          }, 100);
          return;
        }
        
        // ✅ GAME OVER OR CORRECT
        if (data.success || data.gameOver) {
          
          if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
          }
          
          setGameEnded(true);
          setCanGuess(false);
          
          setResult({
            isCorrect: data.isCorrect || false,
            wonCard: data.winsCard || false,
            characterName: data.characterName || characterName || 'Unknown',
            anime: data.anime || anime || 'Unknown',
            imageUrl: data.imageUrl || imageUrl || '',
            timeTaken: data.timeTaken || timeElapsed,
            message: data.message || 'Game Over!',
            rewardMessage: data.rewardMessage || '',
            wrongGuesses: data.wrongGuesses || 0,
            maxGuesses: data.maxGuesses || 3,
            guessedNames: data.guessedNames || []
          });
          
          if (data.stats) {
            setStats(data.stats);
            if (updateUser) {
              updateUser({
                blurGameStats: data.stats
              });
            }
          }
          
          if (data.winsCard) {
            setSuccess('🎉 You won the character card!');
            setTimeout(() => setSuccess(''), 4000);
          }
        }
      } catch (err) {
        setError(err.response?.data?.message || 'Failed to submit guess. Please try again.');
      } finally {
        setIsSubmitting(false);
        isGameEndingRef.current = false;
      }
    }
  };

  // ============================================================
  // ✅ HANDLE GUESS SUBMIT
  // ============================================================
  const handleSubmitGuess = (e) => {
    e.preventDefault();
    if (!guess.trim() || !canGuess || isSubmitting || gameEnded || gameAbandonedRef.current) {
      return;
    }
    endGame(guess.trim());
  };

  // ============================================================
  // ✅ KEYBOARD SHORTCUTS
  // ============================================================
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Enter' && guess.trim() && canGuess && !gameEnded && !gameAbandonedRef.current) {
        handleSubmitGuess(e);
      }
    };
    
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [guess, canGuess, gameEnded]);

  // ============================================================
  // ✅ CLEANUP TIMER ON UNMOUNT
  // ============================================================
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
      if (secureImageUrl) {
        URL.revokeObjectURL(secureImageUrl);
      }
    };
  }, [secureImageUrl]);

  // ============================================================
  // ✅ RENDER
  // ============================================================
  
  if (loading) {
    return (
      <div className="blur-game-page">
        <div className="blur-game-loading">
          <div className="loader"></div>
          <p>Starting game...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="blur-game-page">
      <div className="blur-game-bg-noise"></div>
      <div className="blur-game-bg-grid"></div>
      
      <div className="blur-game-header">
        <h1>🔮 Mystery Character</h1>
        <p>Guess the character before the image becomes clear!</p>
        <p className="warning-text">⚠️ Don't leave the page or switch tabs - it counts as a loss!</p>
      </div>

      {stats && (
        <div className="blur-game-stats">
          <div className="stat-item">
            <span className="stat-value">{stats.gamesPlayed || 0}</span>
            <span className="stat-label">Played</span>
          </div>
          <div className="stat-item">
            <span className="stat-value">{stats.gamesWon || 0}</span>
            <span className="stat-label">Won</span>
          </div>
          <div className="stat-item">
            <span className="stat-value">{stats.winRate || 0}%</span>
            <span className="stat-label">Win Rate</span>
          </div>
          <div className="stat-item">
            <span className="stat-value">{stats.bestTime ? `${stats.bestTime}s` : '--'}</span>
            <span className="stat-label">Best Time</span>
          </div>
          <div className="stat-item">
            <span className="stat-value">{stats.totalCardsWon || 0}</span>
            <span className="stat-label">Cards Won</span>
          </div>
        </div>
      )}

      {error && <div className="blur-game-alert error">{error}</div>}
      {success && <div className="blur-game-alert success">{success}</div>}

      {!gameStarted ? (
        <div className="blur-game-start">
          <div className="start-card">
            <div className="start-icon">🔮</div>
            <h2>Mystery Character</h2>
            <p>You'll see a blurry image of an anime character.</p>
            <p>The image gets clearer over time.</p>
            <div className="start-rules">
              <div className="rule-item highlight">
                <span className="rule-icon">🏆</span>
                <div>
                  <strong>0-30s - WIN THE CARD!</strong>
                  <span>Guess correctly within 30 seconds → Win the character card!</span>
                </div>
              </div>
              <div className="rule-item">
                <span className="rule-icon">🎯</span>
                <div>
                  <strong>3 Guesses Allowed</strong>
                  <span>You have 3 attempts to guess the character!</span>
                </div>
              </div>
              <div className="rule-item">
                <span className="rule-icon">⏰</span>
                <div>
                  <strong>30-60s - No Reward</strong>
                  <span>Guess correctly after 30 seconds → No card, no shards</span>
                </div>
              </div>
              <div className="rule-item warning">
                <span className="rule-icon">🚪</span>
                <div>
                  <strong>⚠️ Warning</strong>
                  <span>Leaving the page or switching tabs = Loss!</span>
                </div>
              </div>
            </div>
            <button onClick={startNewGame} className="btn-start">
              🎯 Start Game
            </button>
          </div>
        </div>
      ) : (
        <div className="blur-game-container">
          <div className="game-info">
            <div className="timer-section">
              <span className="timer-label">⏱️ Time</span>
              <span className={`timer-value ${timeElapsed <= 30 ? 'good' : 'warning'}`}>
                {timeElapsed}s
              </span>
            </div>
            <div className="blur-section">
              <span className="blur-label">👁️ Blur</span>
              <span className="blur-value">{displayBlur}%</span>
            </div>
            <div className="guesses-section">
              <span className="guesses-label">🎯 Guesses</span>
              <span className={`guesses-value ${remainingGuesses > 0 ? 'good' : 'warning'}`}>
                {remainingGuesses}/{maxGuesses}
              </span>
            </div>
            <div className="reward-section">
              <span className="reward-label">🎯 Status</span>
              <span className={`reward-value ${timeElapsed <= 30 ? 'active' : 'expired'}`}>
                {timeElapsed <= 30 ? '🏆 Card Reward' : '❌ No Reward'}
              </span>
            </div>
          </div>

          <div className="image-container">
            <img 
              src={secureImageUrl || 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="400" height="400"%3E%3Crect width="400" height="400" fill="%231a1a2e"/%3E%3Ctext x="50" y="200" font-family="Arial" font-size="24" fill="%2394a3b8"%3ELoading...%3C/text%3E%3C/svg%3E'}
              alt="Mystery Character"
              className="mystery-image"
              style={{ 
                transition: 'filter 0.3s ease, opacity 0.3s ease',
                width: '100%',
                height: '100%',
                objectFit: 'cover'
              }}
              onError={(e) => {
                e.target.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400"%3E%3Crect width="400" height="400" fill="%231a1a2e"/%3E%3Ctext x="50" y="200" font-family="Arial" font-size="24" fill="%2394a3b8"%3ENo Image Available%3C/text%3E%3C/svg%3E';
              }}
            />
            {!gameEnded && (
              <div className="image-overlay">
                <span className="overlay-text">
                  {displayBlur > 80 ? '🔮' : displayBlur > 50 ? '👀' : displayBlur > 20 ? '✨' : '🌟'}
                </span>
                <span className="overlay-blur-badge">{displayBlur}% blur</span>
                <span className="overlay-guesses-badge">{remainingGuesses} guesses left</span>
              </div>
            )}
          </div>

          <div className="progress-container">
            <div className="progress-bar">
              <div 
                className="progress-fill"
                style={{
                  width: `${100 - displayBlur}%`,
                  background: timeElapsed <= 30 
                    ? 'linear-gradient(90deg, #4a9eff, #6c63ff)'
                    : 'linear-gradient(90deg, #f59e0b, #ef4444)'
                }}
              />
            </div>
            <div className="progress-labels">
              <span>🔮 100% blur</span>
              <span>✨ 50% blur</span>
              <span>🌟 0% blur</span>
            </div>
          </div>

          {result && (
            <div className={`result-container ${result.wonCard ? 'won' : result.isCorrect ? 'correct' : 'wrong'}`}>
              <div className="result-content">
                <div className="result-icon">
                  {result.wonCard ? '🎉' : result.isCorrect ? '✅' : '❌'}
                </div>
                <div className="result-details">
                  <h3>{result.message}</h3>
                  <p>{result.rewardMessage}</p>
                  {result.wonCard && (
                    <div className="result-card">
                      <span>🃏</span>
                      <span>You won: <strong>{result.characterName}</strong></span>
                      <span className="result-anime">from {result.anime}</span>
                    </div>
                  )}
                  {result.wrongGuesses !== undefined && result.wrongGuesses > 0 && (
                    <p className="result-hint">📝 Used {result.wrongGuesses} out of {result.maxGuesses || 3} guesses</p>
                  )}
                  {result.guessedNames && result.guessedNames.length > 0 && (
                    <p className="result-hint">📝 Guessed: {result.guessedNames.join(', ')}</p>
                  )}
                  {!result.wonCard && result.isCorrect && result.message !== '🚪 You left the game!' && (
                    <p className="result-hint">💡 You guessed correctly but took longer than 30 seconds! No card this time.</p>
                  )}
                  {!result.isCorrect && result.message !== '🚪 You left the game!' && result.message !== '⏰ Time\'s up!' && (
                    <p className="result-hint">💡 The character was: <strong>{result.characterName}</strong> from {result.anime}</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {!gameEnded ? (
            <form onSubmit={handleSubmitGuess} className="guess-form">
              <input
                ref={guessInputRef}
                type="text"
                value={guess}
                onChange={(e) => setGuess(e.target.value)}
                placeholder={`Type character name... (${remainingGuesses} guesses left)`}
                className="guess-input"
                disabled={!canGuess || isSubmitting}
                autoFocus
              />
              <button 
                type="submit" 
                className="guess-btn"
                disabled={!guess.trim() || !canGuess || isSubmitting}
              >
                {isSubmitting ? '⏳' : '🎯 Guess'}
              </button>
            </form>
          ) : (
            <div className="game-actions">
              <button onClick={startNewGame} className="btn-play-again">
                🔄 Play Again
              </button>
            </div>
          )}

          {!gameEnded && remainingGuesses > 0 && (
            <div className="guesses-hint">
              <p>🎯 {remainingGuesses} guess{remainingGuesses > 1 ? 'es' : ''} remaining</p>
              {guessedNames.length > 0 && (
                <p className="guessed-names">Tried: {guessedNames.join(', ')}</p>
              )}
            </div>
          )}

          {!gameEnded && timeElapsed > 10 && timeElapsed <= 25 && (
            <div className="hint-section">
              <p>👀 The image is getting clearer. Can you see any features?</p>
            </div>
          )}
          {!gameEnded && timeElapsed > 25 && timeElapsed <= 40 && (
            <div className="hint-section">
              <p>✨ You should be able to see the character now! Hurry up!</p>
            </div>
          )}
          {!gameEnded && timeElapsed > 40 && (
            <div className="hint-section urgent">
              <p>⚠️ The image is almost clear! Type your guess quickly!</p>
            </div>
          )}
          {!gameEnded && (
            <div className="warning-hint">
              <p>🚪 Don't leave the page or switch tabs - it counts as a loss!</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default BlurGame;