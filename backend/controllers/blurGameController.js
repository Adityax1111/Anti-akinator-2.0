// /backend/controllers/blurGameController.js
const Character = require('../models/Character');
const User = require('../models/User');
const BlurGameSession = require('../models/BlurGameSession');

// ============================================================
// ✅ GUARD SHARP — a missing/broken native binary must never be able
// to take the whole controller (and therefore startGame/submitGuess/
// the timer) down with it. This was the actual root cause of "nothing
// works at all".
// ============================================================
let sharp = null;
let sharpAvailable = false;
try {
  sharp = require('sharp');
  sharpAvailable = true;
} catch (err) {
  console.error('[blurGame] sharp failed to load — falling back to placeholder images:', err.message);
}

const GAME_DURATION = 60; // seconds until fully clear
const CARD_WINDOW = 30;   // seconds within which a correct guess wins the card
const MAX_BLUR = 30;      // px, used by the sharp pipeline

// ============================================================
// HELPER: Normalize string for matching
// ============================================================
function normalize(str) {
  if (!str) return '';
  return str.toLowerCase()
    .replace(/[^a-zA-Z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ============================================================
// HELPER: Check if guess matches character name (PARTIAL + EXACT)
// ============================================================
function isMatchingGuess(guess, characterName) {
  const normalizedGuess = normalize(guess);
  const normalizedName = normalize(characterName);

  if (normalizedGuess === normalizedName) return true;
  if (normalizedName.includes(normalizedGuess) && normalizedGuess.length >= 3) return true;

  const guessWords = normalizedGuess.split(' ');
  const nameWords = normalizedName.split(' ');

  const anyWordMatch = nameWords.some(word =>
    normalizedGuess.includes(word) && word.length >= 3
  );
  if (anyWordMatch) return true;

  const allWordsMatch = guessWords.every(word => nameWords.includes(word));
  if (allWordsMatch && guessWords.length > 0) return true;

  return false;
}

// ============================================================
// HELPER: seconds elapsed since game session was created
// ============================================================
function secondsElapsedFor(game) {
  return Math.floor((Date.now() - new Date(game.createdAt).getTime()) / 1000);
}

// ============================================================
// HELPER: ensure a blank/empty stats object always exists
// ============================================================
function ensureStats(user) {
  if (!user.blurGameStats) {
    user.blurGameStats = {
      gamesPlayed: 0,
      gamesWon: 0,
      bestTime: null,
      totalCardsWon: 0
    };
  }
  return user.blurGameStats;
}

// ============================================================
// ✅ HELPER: if a session has quietly run past GAME_DURATION
// (tab was closed without triggering /timeout or /abandon, browser
// crashed, etc.) close it out server-side so it can never be resumed
// as if it were still live. Fixes the stale-session resume bug.
// ============================================================
async function finalizeIfExpired(game) {
  if (game.isCompleted) return game;
  if (secondsElapsedFor(game) < GAME_DURATION) return game;

  game.isCompleted = true;
  game.guessedAt = new Date();
  game.timeTaken = GAME_DURATION;
  game.isCorrect = false;
  game.wonCard = false;
  await game.save();

  try {
    const user = await User.findById(game.userId);
    if (user) {
      ensureStats(user).gamesPlayed += 1;
      await user.save();
    }
  } catch (e) {
    console.error('[blurGame] failed to update stats for an expired game:', e.message);
  }

  return game;
}

// ============================================================
// ✅ EXPORT: getBlurImage - SECURE BLURRED IMAGE PROXY
// The real image URL is NEVER sent to the client while a game is
// active — not via JSON, not via redirect — only once isCompleted.
// ============================================================
exports.getBlurImage = async (req, res) => {
  try {
    let game = await BlurGameSession.findOne({
      _id: req.params.gameId,
      userId: req.user._id
    });

    if (!game) {
      return res.status(404).json({ success: false, message: 'Game not found' });
    }

    game = await finalizeIfExpired(game);

    // Game over (won, lost, timed out, abandoned) → safe to reveal the original.
    if (game.isCompleted) {
      return res.redirect(game.imageUrl);
    }

    const imageUrl = game.imageUrl;
    if (!imageUrl) {
      return res.status(404).json({ success: false, message: 'No image found for this character' });
    }

    const secondsElapsed = secondsElapsedFor(game);
    const progress = Math.min(secondsElapsed / GAME_DURATION, 1);
    const blurAmount = Math.round(Math.max(0, MAX_BLUR * (1 - progress)));

    try {
      const response = await fetch(imageUrl);
      if (!response.ok) throw new Error('Failed to fetch source image');

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      let outBuffer;
      if (sharpAvailable) {
        let pipeline = sharp(buffer);
        // sharp's minimum usable blur sigma is ~0.3 — anything below that
        // throws, so only apply blur when there's meaningfully something to hide.
        if (blurAmount >= 1) {
          pipeline = pipeline.blur(blurAmount);
        }
        outBuffer = await pipeline.jpeg({ quality: 82 }).toBuffer();
      } else {
        // sharp unavailable on this deploy: never fall back to the raw
        // image or a redirect while the round is live — serve a generic
        // placeholder instead so nothing about the answer leaks.
        const pct = Math.round(progress * 100);
        return res
          .setHeader('Content-Type', 'image/svg+xml')
          .setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private')
          .send(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">
            <rect width="400" height="400" fill="#1a1a2e"/>
            <text x="200" y="190" font-family="Arial" font-size="22" fill="#94a3b8" text-anchor="middle">🔮 Rendering unavailable</text>
            <text x="200" y="220" font-family="Arial" font-size="14" fill="#64748b" text-anchor="middle">Keep guessing — ${pct}% revealed</text>
          </svg>`);
      }

      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
      return res.send(outBuffer);

    } catch (fetchError) {
      console.error('Error processing image:', fetchError);
      res.setHeader('Content-Type', 'image/svg+xml');
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
      return res.send(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">
        <rect width="400" height="400" fill="#1a1a2e"/>
        <text x="200" y="200" font-family="Arial" font-size="24" fill="#94a3b8" text-anchor="middle">🔮 Image Unavailable</text>
        <text x="200" y="240" font-family="Arial" font-size="14" fill="#64748b" text-anchor="middle">Try guessing anyway!</text>
      </svg>`);
    }

  } catch (error) {
    console.error('getBlurImage error:', error);
    res.status(500).json({ success: false, message: 'Failed to load image' });
  }
};

// ============================================================
// ✅ EXPORT: startGame
// characterName / imageUrl are intentionally NEVER included here —
// that was the actual answer-leak bug. The client gets the image only
// through the secure blur proxy, and the name only once the game ends.
// ============================================================
exports.startGame = async (req, res) => {
  try {
    const userId = req.user._id;

    const existingGame = await BlurGameSession.findOne({
      userId: userId,
      isCompleted: false
    });

    if (existingGame) {
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      if (existingGame.createdAt < fiveMinutesAgo) {
        await BlurGameSession.findByIdAndDelete(existingGame._id);
      } else {
        return res.status(200).json({
          success: true,
          gameId: existingGame._id,
          anime: existingGame.anime,
          startedAt: existingGame.createdAt,
          isExisting: true,
          maxGuesses: existingGame.maxGuesses || 3,
          wrongGuesses: existingGame.wrongGuesses || 0,
          guessedNames: existingGame.guessedNames || [],
          message: 'Resuming existing game...'
        });
      }
    }

    const characters = await Character.find({
      image: { $ne: '', $exists: true }
    });

    if (characters.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No characters with images found in database. Please add some characters first.'
      });
    }

    const randomIndex = Math.floor(Math.random() * characters.length);
    const character = characters[randomIndex];

    const game = new BlurGameSession({
      userId: userId,
      characterId: character._id,
      characterName: character.name,
      anime: character.anime,
      imageUrl: character.image,
      isCompleted: false,
      guessedAt: null,
      timeTaken: null,
      wonCard: false,
      isCorrect: false,
      wrongGuesses: 0,
      maxGuesses: 3,
      guessedNames: []
    });

    await game.save();

    res.status(200).json({
      success: true,
      gameId: game._id,
      anime: character.anime,
      startedAt: new Date().toISOString(),
      isExisting: false,
      maxGuesses: 3,
      wrongGuesses: 0,
      guessedNames: [],
      message: `Game started! You have 3 guesses. Guess within ${CARD_WINDOW} seconds to win the card!`
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to start game: ' + error.message
    });
  }
};

// ============================================================
// ✅ EXPORT: submitGuess
// ============================================================
exports.submitGuess = async (req, res) => {
  try {
    const userId = req.user._id;
    const { gameId, guess, timeTaken } = req.body;

    if (!gameId || !guess) {
      return res.status(400).json({
        success: false,
        message: 'Game ID and guess are required'
      });
    }

    let game = await BlurGameSession.findOne({ _id: gameId, userId: userId });

    if (!game) {
      return res.status(404).json({ success: false, message: 'Game not found' });
    }

    game = await finalizeIfExpired(game);

    if (game.isCompleted) {
      return res.status(400).json({
        success: false,
        message: 'This game has already ended.',
        gameEnded: true,
        characterName: game.characterName,
        anime: game.anime,
        imageUrl: game.imageUrl
      });
    }

    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    if (game.createdAt < fiveMinutesAgo) {
      game.isCompleted = true;
      await game.save();
      return res.status(400).json({
        success: false,
        message: 'Game has expired. Please start a new game.'
      });
    }

    const guessedNames = game.guessedNames || [];
    const normalizedGuess = normalize(guess);
    if (guessedNames.some(name => normalize(name) === normalizedGuess)) {
      const remaining = game.maxGuesses - game.wrongGuesses;
      return res.status(200).json({
        success: false,
        isCorrect: false,
        canRetry: true,
        gameOver: false,
        wrongGuesses: game.wrongGuesses,
        maxGuesses: game.maxGuesses,
        remainingGuesses: remaining,
        message: `⚠️ You already guessed "${guess}". Try a different name! (${remaining} guesses left)`,
        rewardMessage: 'Keep trying!'
      });
    }

    const timeTakenSeconds = timeTaken || secondsElapsedFor(game);
    const finalTimeTaken = Math.min(timeTakenSeconds, GAME_DURATION);

    const isCorrect = isMatchingGuess(guess, game.characterName);

    if (!isCorrect) {
      game.wrongGuesses = (game.wrongGuesses || 0) + 1;
      game.guessedNames.push(guess);

      if (game.wrongGuesses >= game.maxGuesses) {
        game.isCompleted = true;
        game.guessedAt = new Date();
        game.timeTaken = finalTimeTaken;
        game.isCorrect = false;
        game.wonCard = false;
        await game.save();

        const user = await User.findById(userId);
        ensureStats(user).gamesPlayed += 1;
        await user.save();

        const winRate = user.blurGameStats.gamesPlayed > 0
          ? Math.round((user.blurGameStats.gamesWon / user.blurGameStats.gamesPlayed) * 100)
          : 0;

        return res.status(200).json({
          success: true,
          isCorrect: false,
          gameOver: true,
          wonCard: false,
          characterName: game.characterName,
          anime: game.anime,
          imageUrl: game.imageUrl,
          timeTaken: finalTimeTaken,
          wrongGuesses: game.wrongGuesses,
          maxGuesses: game.maxGuesses,
          guessedNames: game.guessedNames,
          message: `❌ Game Over! You used all ${game.maxGuesses} guesses.`,
          rewardMessage: `The character was ${game.characterName}. Better luck next time!`,
          stats: {
            gamesPlayed: user.blurGameStats.gamesPlayed,
            gamesWon: user.blurGameStats.gamesWon,
            winRate: winRate,
            bestTime: user.blurGameStats.bestTime,
            totalCardsWon: user.blurGameStats.totalCardsWon
          }
        });
      }

      await game.save();

      const remaining = game.maxGuesses - game.wrongGuesses;

      return res.status(200).json({
        success: false,
        isCorrect: false,
        canRetry: true,
        gameOver: false,
        wrongGuesses: game.wrongGuesses,
        maxGuesses: game.maxGuesses,
        remainingGuesses: remaining,
        guessedNames: game.guessedNames,
        message: `❌ Wrong guess! "${guess}" is not correct. ${remaining} guess${remaining > 1 ? 'es' : ''} remaining.`,
        rewardMessage: 'Keep trying!'
      });
    }

    const winsCard = finalTimeTaken <= CARD_WINDOW;

    game.guessedAt = new Date();
    game.timeTaken = finalTimeTaken;
    game.isCompleted = true;
    game.isCorrect = true;
    game.wonCard = winsCard;
    game.guessedNames.push(guess);
    await game.save();

    const user = await User.findById(userId);
    const stats = ensureStats(user);

    stats.gamesPlayed += 1;
    stats.gamesWon += 1;

    if (!stats.bestTime || finalTimeTaken < stats.bestTime) {
      stats.bestTime = finalTimeTaken;
    }

    if (winsCard) {
      const character = await Character.findById(game.characterId);
      if (character) {
        const cardAdded = user.addCard(character);
        if (cardAdded) {
          stats.totalCardsWon += 1;
        }
      }
    }

    await user.save();

    let message = '';
    let rewardMessage = '';

    if (winsCard) {
      message = `🎉 Correct! You guessed it in ${finalTimeTaken}s!`;
      rewardMessage = `🎴 You won the ${game.characterName} card!`;
    } else {
      message = `✅ Correct! But it took you ${finalTimeTaken}s (over ${CARD_WINDOW}s).`;
      rewardMessage = `❌ No card won. Try to guess within ${CARD_WINDOW} seconds next time!`;
    }

    const winRate = stats.gamesPlayed > 0
      ? Math.round((stats.gamesWon / stats.gamesPlayed) * 100)
      : 0;

    res.status(200).json({
      success: true,
      isCorrect: true,
      gameOver: true,
      winsCard: winsCard,
      characterName: game.characterName,
      anime: game.anime,
      imageUrl: game.imageUrl,
      timeTaken: finalTimeTaken,
      wrongGuesses: game.wrongGuesses,
      maxGuesses: game.maxGuesses,
      guessedNames: game.guessedNames,
      message: message,
      rewardMessage: rewardMessage,
      stats: {
        gamesPlayed: stats.gamesPlayed,
        gamesWon: stats.gamesWon,
        winRate: winRate,
        bestTime: stats.bestTime,
        totalCardsWon: stats.totalCardsWon
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to submit guess: ' + error.message
    });
  }
};

// ============================================================
// ✅ EXPORT: abandonGame
// Now returns the answer (game is already over/lost either way) so the
// frontend can show what the character actually was.
// ============================================================
exports.abandonGame = async (req, res) => {
  try {
    const userId = req.user._id;
    const { gameId } = req.body;

    if (!gameId) {
      return res.status(400).json({ success: false, message: 'Game ID is required' });
    }

    const game = await BlurGameSession.findOne({ _id: gameId, userId: userId });

    if (!game) {
      return res.status(200).json({ success: true, message: 'Game already completed or not found' });
    }

    if (!game.isCompleted) {
      game.isCompleted = true;
      game.guessedAt = new Date();
      game.timeTaken = Math.min(secondsElapsedFor(game), GAME_DURATION);
      game.wonCard = false;
      game.isCorrect = false;
      await game.save();

      const user = await User.findById(userId);
      ensureStats(user).gamesPlayed += 1;
      await user.save();
    }

    res.status(200).json({
      success: true,
      characterName: game.characterName,
      anime: game.anime,
      imageUrl: game.imageUrl,
      timeTaken: game.timeTaken,
      message: 'Game abandoned successfully'
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to abandon game: ' + error.message
    });
  }
};

// ============================================================
// ✅ EXPORT: timeoutGame (NEW)
// Called by the client the instant its local 60s timer runs out, so
// the backend session is always closed in step with what the player
// sees — no more stale "still active" sessions to resume later.
// ============================================================
exports.timeoutGame = async (req, res) => {
  try {
    const userId = req.user._id;
    const { gameId } = req.body;

    if (!gameId) {
      return res.status(400).json({ success: false, message: 'Game ID is required' });
    }

    const game = await BlurGameSession.findOne({ _id: gameId, userId: userId });

    if (!game) {
      return res.status(404).json({ success: false, message: 'Game not found' });
    }

    if (!game.isCompleted) {
      game.isCompleted = true;
      game.guessedAt = new Date();
      game.timeTaken = GAME_DURATION;
      game.isCorrect = false;
      game.wonCard = false;
      await game.save();

      const user = await User.findById(userId);
      ensureStats(user).gamesPlayed += 1;
      await user.save();
    }

    res.status(200).json({
      success: true,
      characterName: game.characterName,
      anime: game.anime,
      imageUrl: game.imageUrl,
      timeTaken: GAME_DURATION,
      wrongGuesses: game.wrongGuesses,
      maxGuesses: game.maxGuesses,
      guessedNames: game.guessedNames,
      message: "⏰ Time's up!",
      rewardMessage: 'The image is fully clear now! Better luck next time!'
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to end game: ' + error.message
    });
  }
};

// ============================================================
// ✅ EXPORT: getGameHistory
// ============================================================
exports.getGameHistory = async (req, res) => {
  try {
    const userId = req.user._id;
    const { limit = 20, page = 1 } = req.query;

    const skip = (page - 1) * limit;

    const games = await BlurGameSession.find({ userId: userId })
      .sort({ createdAt: -1 })
      .skip(parseInt(skip))
      .limit(parseInt(limit))
      .select('characterName anime imageUrl isCorrect timeTaken wonCard createdAt wrongGuesses maxGuesses guessedNames');

    const total = await BlurGameSession.countDocuments({ userId: userId });

    res.status(200).json({
      success: true,
      data: {
        games,
        pagination: {
          total,
          page: parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(total / limit)
        }
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get game history: ' + error.message
    });
  }
};

// ============================================================
// ✅ EXPORT: getDailyChallenge
// Same answer-leak fixed here: no characterName / imageUrl while the
// round is active. This now creates a BlurGameSession (flagged
// isDailyChallenge) so the client can use the same secure image proxy.
//
// ⚠️ NOTE: this requires an `isDailyChallenge: { type: Boolean, default: false }`
// field on your BlurGameSession model — add it if it isn't already there.
// ============================================================
exports.getDailyChallenge = async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const existingCompleted = await BlurGameSession.findOne({
      userId: req.user._id,
      isDailyChallenge: true,
      createdAt: { $gte: today },
      isCompleted: true
    });

    if (existingCompleted) {
      return res.status(200).json({
        success: true,
        isCompleted: true,
        characterName: existingCompleted.characterName,
        timeTaken: existingCompleted.timeTaken,
        wonCard: existingCompleted.wonCard,
        message: "You already completed today's challenge!"
      });
    }

    const existingActive = await BlurGameSession.findOne({
      userId: req.user._id,
      isDailyChallenge: true,
      createdAt: { $gte: today },
      isCompleted: false
    });

    if (existingActive) {
      return res.status(200).json({
        success: true,
        isCompleted: false,
        gameId: existingActive._id,
        anime: existingActive.anime,
        date: today.toISOString().split('T')[0],
        maxGuesses: existingActive.maxGuesses || 3,
        wrongGuesses: existingActive.wrongGuesses || 0,
        guessedNames: existingActive.guessedNames || [],
        message: "Today's daily challenge! Guess the character to win the card!"
      });
    }

    const dateString = today.toISOString().split('T')[0];
    const seed = dateString.split('-').join('');
    const characters = await Character.find({ image: { $ne: '', $exists: true } });

    if (characters.length === 0) {
      return res.status(404).json({ success: false, message: 'No characters found' });
    }

    const randomIndex = parseInt(seed.slice(-2)) % characters.length;
    const character = characters[randomIndex];

    const game = new BlurGameSession({
      userId: req.user._id,
      characterId: character._id,
      characterName: character.name,
      anime: character.anime,
      imageUrl: character.image,
      isCompleted: false,
      isDailyChallenge: true,
      wrongGuesses: 0,
      maxGuesses: 3,
      guessedNames: []
    });
    await game.save();

    res.status(200).json({
      success: true,
      isCompleted: false,
      gameId: game._id,
      anime: character.anime,
      date: dateString,
      maxGuesses: 3,
      wrongGuesses: 0,
      guessedNames: [],
      message: "Today's daily challenge! Guess the character to win the card!"
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get daily challenge: ' + error.message
    });
  }
};

// ============================================================
// ✅ EXPORT: getGameStats
// ============================================================
exports.getGameStats = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);

    const stats = user.blurGameStats || {
      gamesPlayed: 0,
      gamesWon: 0,
      bestTime: null,
      totalCardsWon: 0
    };

    const winRate = stats.gamesPlayed > 0
      ? Math.round((stats.gamesWon / stats.gamesPlayed) * 100)
      : 0;

    const recentGames = await BlurGameSession.find({ userId: req.user._id })
      .sort({ createdAt: -1 })
      .limit(5)
      .select('characterName timeTaken wonCard createdAt wrongGuesses maxGuesses');

    res.status(200).json({
      success: true,
      data: {
        gamesPlayed: stats.gamesPlayed,
        gamesWon: stats.gamesWon,
        winRate: winRate,
        bestTime: stats.bestTime,
        totalCardsWon: stats.totalCardsWon,
        recentGames: recentGames
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get game stats: ' + error.message
    });
  }
};

// ============================================================
// EXPORT: getTestCharacter
// ⚠️ Dev/admin utility only — intentionally exposes full character
// data. Make sure this route is gated behind an admin check, not just
// authMiddleware, before shipping.
// ============================================================
exports.getTestCharacter = async (req, res) => {
  try {
    const characters = await Character.find({ image: { $ne: '', $exists: true } });

    if (characters.length === 0) {
      return res.status(404).json({ success: false, message: 'No characters with images found' });
    }

    const randomIndex = Math.floor(Math.random() * characters.length);
    const character = characters[randomIndex];

    res.status(200).json({
      success: true,
      character: {
        id: character._id,
        name: character.name,
        anime: character.anime,
        image: character.image
      },
      totalCharacters: characters.length
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get test character: ' + error.message
    });
  }
};