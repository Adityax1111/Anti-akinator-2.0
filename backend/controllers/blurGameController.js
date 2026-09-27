// /backend/controllers/blurGameController.js
const Character = require('../models/Character');
const User = require('../models/User');
const BlurGameSession = require('../models/BlurGameSession');
const sharp = require('sharp'); // ✅ Added for image blurring

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
// ✅ EXPORT: getBlurImage - SECURE BLURRED IMAGE PROXY
// ============================================================
exports.getBlurImage = async (req, res) => {
  try {
    const game = await BlurGameSession.findOne({
      _id: req.params.gameId,
      userId: req.user._id
    });

    if (!game) {
      return res.status(404).json({
        success: false,
        message: 'Game not found'
      });
    }

    // If game is completed, send the original clear image
    if (game.isCompleted) {
      return res.redirect(game.imageUrl);
    }

    const imageUrl = game.imageUrl;
    
    if (!imageUrl) {
      return res.status(404).json({
        success: false,
        message: 'No image found for this character'
      });
    }

    // Calculate time elapsed in seconds
    const secondsElapsed = Math.floor((Date.now() - new Date(game.createdAt).getTime()) / 1000);
    
    // Calculate blur amount (30px blur at 0s, 0px blur at 60s)
    const maxBlur = 30;
    let blurAmount = Math.max(0, maxBlur - (secondsElapsed / 60) * maxBlur);
    blurAmount = Math.round(blurAmount);

    // If no blur needed, redirect to original
    if (blurAmount === 0) {
      return res.redirect(imageUrl);
    }

    try {
      // Download the original image
      const response = await fetch(imageUrl);
      
      if (!response.ok) {
        throw new Error('Failed to fetch image');
      }

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      // Blur the image using sharp on the fly
      const blurredBuffer = await sharp(buffer)
        .blur(blurAmount)
        .jpeg({ quality: 80 }) // Convert to jpeg for smaller size
        .toBuffer();

      // Send the blurred image
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
      return res.send(blurredBuffer);
      
    } catch (fetchError) {
      console.error('Error processing image:', fetchError);
      
      // Fallback: send an SVG placeholder if image fails
      res.setHeader('Content-Type', 'image/svg+xml');
      res.send(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">
        <rect width="400" height="400" fill="#1a1a2e"/>
        <text x="200" y="200" font-family="Arial" font-size="24" fill="#94a3b8" text-anchor="middle">🔮 Image Unavailable</text>
        <text x="200" y="240" font-family="Arial" font-size="14" fill="#64748b" text-anchor="middle">Try guessing anyway!</text>
      </svg>`);
    }

  } catch (error) {
    console.error('getBlurImage error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to load image'
    });
  }
};

// ============================================================
// ✅ EXPORT: startGame
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
          imageUrl: existingGame.imageUrl,
          anime: existingGame.anime,
          characterId: existingGame.characterId,
          characterName: existingGame.characterName,
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
      imageUrl: character.image,
      anime: character.anime,
      characterId: character._id,
      characterName: character.name,
      startedAt: new Date().toISOString(),
      isExisting: false,
      maxGuesses: 3,
      wrongGuesses: 0,
      guessedNames: [],
      message: 'Game started! You have 3 guesses. Guess within 30 seconds to win the card!'
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

    const game = await BlurGameSession.findOne({
      _id: gameId,
      userId: userId
    });

    if (!game) {
      return res.status(404).json({
        success: false,
        message: 'Game not found'
      });
    }

    if (game.isCompleted) {
      return res.status(400).json({
        success: false,
        message: 'This game has already ended.',
        gameEnded: true
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

    const timeTakenSeconds = timeTaken || Math.floor((Date.now() - game.createdAt.getTime()) / 1000);
    const finalTimeTaken = Math.min(timeTakenSeconds, 60);

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
        if (!user.blurGameStats) {
          user.blurGameStats = {
            gamesPlayed: 0,
            gamesWon: 0,
            bestTime: null,
            totalCardsWon: 0
          };
        }
        user.blurGameStats.gamesPlayed += 1;
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

    const winsCard = finalTimeTaken <= 30;

    game.guessedAt = new Date();
    game.timeTaken = finalTimeTaken;
    game.isCompleted = true;
    game.isCorrect = true;
    game.wonCard = winsCard;
    game.guessedNames.push(guess);
    await game.save();

    const user = await User.findById(userId);

    if (!user.blurGameStats) {
      user.blurGameStats = {
        gamesPlayed: 0,
        gamesWon: 0,
        bestTime: null,
        totalCardsWon: 0
      };
    }

    user.blurGameStats.gamesPlayed += 1;
    user.blurGameStats.gamesWon += 1;

    if (!user.blurGameStats.bestTime || finalTimeTaken < user.blurGameStats.bestTime) {
      user.blurGameStats.bestTime = finalTimeTaken;
    }

    if (winsCard) {
      const character = await Character.findById(game.characterId);
      if (character) {
        const cardAdded = user.addCard(character);
        if (cardAdded) {
          user.blurGameStats.totalCardsWon += 1;
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
      message = `✅ Correct! But it took you ${finalTimeTaken}s (over 30s).`;
      rewardMessage = `❌ No card won. Try to guess within 30 seconds next time!`;
    }

    const winRate = user.blurGameStats.gamesPlayed > 0
      ? Math.round((user.blurGameStats.gamesWon / user.blurGameStats.gamesPlayed) * 100)
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
        gamesPlayed: user.blurGameStats.gamesPlayed,
        gamesWon: user.blurGameStats.gamesWon,
        winRate: winRate,
        bestTime: user.blurGameStats.bestTime,
        totalCardsWon: user.blurGameStats.totalCardsWon
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
// ============================================================
exports.abandonGame = async (req, res) => {
  try {
    const userId = req.user._id;
    const { gameId } = req.body;

    if (!gameId) {
      return res.status(400).json({
        success: false,
        message: 'Game ID is required'
      });
    }

    const game = await BlurGameSession.findOne({
      _id: gameId,
      userId: userId,
      isCompleted: false
    });

    if (!game) {
      return res.status(200).json({
        success: true,
        message: 'Game already completed or not found'
      });
    }

    game.isCompleted = true;
    game.guessedAt = new Date();
    game.timeTaken = 0;
    game.wonCard = false;
    await game.save();

    const user = await User.findById(userId);
    if (!user.blurGameStats) {
      user.blurGameStats = {
        gamesPlayed: 0,
        gamesWon: 0,
        bestTime: null,
        totalCardsWon: 0
      };
    }
    user.blurGameStats.gamesPlayed += 1;
    await user.save();

    res.status(200).json({
      success: true,
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
// ============================================================
exports.getDailyChallenge = async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const existingGame = await BlurGameSession.findOne({
      userId: req.user._id,
      createdAt: { $gte: today },
      isCompleted: true
    });

    if (existingGame) {
      return res.status(200).json({
        success: true,
        isCompleted: true,
        characterName: existingGame.characterName,
        timeTaken: existingGame.timeTaken,
        wonCard: existingGame.wonCard,
        message: 'You already completed today\'s challenge!'
      });
    }

    const dateString = today.toISOString().split('T')[0];
    const seed = dateString.split('-').join('');
    const characters = await Character.find({ image: { $ne: '', $exists: true } });

    if (characters.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No characters found'
      });
    }

    const randomIndex = parseInt(seed.slice(-2)) % characters.length;
    const character = characters[randomIndex];

    res.status(200).json({
      success: true,
      isCompleted: false,
      characterId: character._id,
      characterName: character.name,
      anime: character.anime,
      imageUrl: character.image,
      date: dateString,
      message: 'Today\'s daily challenge! Guess the character within 30 seconds to win the card!'
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
// ✅ EXPORT: getTestCharacter
// ============================================================
exports.getTestCharacter = async (req, res) => {
  try {
    const characters = await Character.find({ image: { $ne: '', $exists: true } });
    
    if (characters.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No characters with images found'
      });
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