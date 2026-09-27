// /backend/routes/blurGame.js
const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const { authMiddleware } = require('../middleware/auth');
const {
  startGame,
  submitGuess,
  getGameHistory,
  getDailyChallenge,
  getGameStats,
  abandonGame,
  timeoutGame,   // ✅ NEW — closes the session the instant the client timer hits 0
  getTestCharacter,
  getBlurImage
} = require('../controllers/blurGameController');

// ============================================================
// VALIDATION RULES
// ============================================================

const validateGuess = [
  body('guess')
    .trim()
    .escape()
    .isLength({ min: 1, max: 100 })
    .withMessage('Guess must be between 1 and 100 characters')
    .matches(/^[a-zA-Z0-9\s\-'.,!?]+$/)
    .withMessage('Guess contains invalid characters')
];

const validateGameId = [
  body('gameId')
    .trim()
    .isLength({ min: 1 })
    .withMessage('Game ID is required')
];

// ============================================================
// ROUTES
// ============================================================

router.post('/start', authMiddleware, startGame);
router.post('/guess', authMiddleware, validateGuess, submitGuess);
router.post('/abandon', authMiddleware, validateGameId, abandonGame);
router.post('/timeout', authMiddleware, validateGameId, timeoutGame); // ✅ NEW

router.get('/image/:gameId', authMiddleware, getBlurImage);

router.get('/history', authMiddleware, getGameHistory);
router.get('/daily', authMiddleware, getDailyChallenge);
router.get('/stats', authMiddleware, getGameStats);
router.get('/test-character', authMiddleware, getTestCharacter);

module.exports = router;