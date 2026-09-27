// /frontend/src/api/blurGame.js
import api from './axios';

// ============================================================
// SHARED CONSTANTS — must mirror the backend controller
// (GAME_DURATION / CARD_WINDOW in blurGameController.js).
// These were missing before, which is why the timer/blur math
// silently turned into NaN and the game looked "frozen".
// ============================================================
export const GAME_DURATION_SECONDS = 60;
export const CARD_WINDOW_SECONDS = 30;

// ============================================================
// BLUR GAME API SERVICE
// ============================================================

/**
 * Start a new blur game session
 * @returns {Promise} Game session data (no imageUrl/characterName — those
 * are never sent to the client while a game is active)
 */
export const startGame = async () => {
  const response = await api.post('/blur-game/start');
  return response.data;
};

/**
 * Submit a guess for the current game
 * @param {string} gameId - The game session ID
 * @param {string} guess - The user's guess
 * @param {number} timeTaken - Time taken in seconds
 * @returns {Promise} Result of the guess
 */
export const submitGuess = async (gameId, guess, timeTaken) => {
  const response = await api.post('/blur-game/guess', {
    gameId,
    guess,
    timeTaken
  });
  return response.data;
};

/**
 * Tell the server the player left/closed the game early.
 * Server marks the session as a loss and returns the real answer,
 * since the round is over either way.
 * @param {string} gameId
 * @returns {Promise}
 */
export const abandonGame = async (gameId) => {
  const response = await api.post('/blur-game/abandon', { gameId });
  return response.data;
};

/**
 * Tell the server the client-side 60s timer ran out.
 * Keeps the backend session in sync with what the player sees,
 * so a reload can never resume a session that should already be over.
 * @param {string} gameId
 * @returns {Promise}
 */
export const timeoutGame = async (gameId) => {
  const response = await api.post('/blur-game/timeout', { gameId });
  return response.data;
};

/**
 * Fetch the current blurred frame for an active game as a Blob.
 * This hits the authenticated secure proxy (/blur-game/image/:gameId),
 * which returns blurred JPEG bytes (or a placeholder SVG) while the
 * round is live, and only redirects to the real image once the game
 * is completed server-side. Nothing about the source URL is ever
 * exposed in the response — the Network tab only ever sees opaque
 * image bytes for an active round.
 * @param {string} gameId
 * @returns {Promise<Blob>}
 */
export const fetchBlurImageBlob = async (gameId) => {
  const response = await api.get(`/blur-game/image/${gameId}`, {
    responseType: 'blob'
  });
  return response.data;
};

/**
 * Get user's game history
 * @param {number} limit - Number of records to fetch
 * @param {number} page - Page number
 * @returns {Promise} Game history data
 */
export const getGameHistory = async (limit = 20, page = 1) => {
  const response = await api.get('/blur-game/history', {
    params: { limit, page }
  });
  return response.data;
};

/**
 * Get today's daily challenge
 * @returns {Promise} Daily challenge data
 */
export const getDailyChallenge = async () => {
  const response = await api.get('/blur-game/daily');
  return response.data;
};

/**
 * Get user's blur game stats
 * @returns {Promise} Game stats
 */
export const getGameStats = async () => {
  const response = await api.get('/blur-game/stats');
  return response.data;
};

// ============================================================
// UTILITY FUNCTIONS
// (Purely cosmetic/local helpers — the server is always the source
// of truth for correctness/timing/rewards. Nothing here is used to
// decide whether a guess is right.)
// ============================================================

/**
 * Calculate blur percentage based on time elapsed (local display only)
 */
export const calculateBlur = (
  elapsedSeconds,
  totalSeconds = GAME_DURATION_SECONDS,
  maxBlur = 100,
  minBlur = 0
) => {
  const progress = Math.min(elapsedSeconds / totalSeconds, 1);
  const blur = Math.max(minBlur, maxBlur - (maxBlur - minBlur) * progress);
  return Math.round(blur);
};

/**
 * Check if user can win a card based on time (local display only —
 * the server re-checks this authoritatively in submitGuess)
 */
export const canWinCard = (timeTaken, timeLimit = CARD_WINDOW_SECONDS) => {
  return timeTaken <= timeLimit;
};

/**
 * Get reward emoji based on time taken (cosmetic only)
 */
export const getRewardEmoji = (timeTaken) => {
  if (timeTaken <= 10) return '🏆';
  if (timeTaken <= 20) return '🥈';
  if (timeTaken <= 30) return '🥉';
  return '😅';
};

/**
 * Get reward message based on time taken (cosmetic only — server sends
 * its own authoritative rewardMessage in every response)
 */
export const getRewardMessage = (timeTaken, isCorrect) => {
  if (!isCorrect) return 'Better luck next time!';
  if (timeTaken <= 10) return '🏆 Amazing! Lightning fast guess!';
  if (timeTaken <= 20) return '🥈 Great job! Very quick!';
  if (timeTaken <= 30) return '🥉 Nice! You won the card!';
  return '✅ Correct! But try to guess within 30 seconds next time!';
};

// ============================================================
// DAILY CHALLENGE HELPERS
// ============================================================

export const isDailyChallengeAvailable = (lastPlayedDate) => {
  const today = new Date().toISOString().split('T')[0];
  return lastPlayedDate !== today;
};

export const getTodayString = () => {
  return new Date().toISOString().split('T')[0];
};

// ============================================================
// STATS HELPERS
// ============================================================

export const calculateWinRate = (gamesPlayed, gamesWon) => {
  if (gamesPlayed === 0) return 0;
  return Math.round((gamesWon / gamesPlayed) * 100);
};

export const formatTimeDisplay = (seconds) => {
  if (!seconds) return '--';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
};