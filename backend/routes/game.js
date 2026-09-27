// /backend/routes/game.js
const express = require('express');
const { body, validationResult } = require('express-validator');
const Character = require('../models/Character');
const GameSession = require('../models/GameSession');
const User = require('../models/User');
const Referral = require('../models/Referral');
const ProfilePhoto = require('../models/ProfilePhoto');
const SeasonPass = require('../models/SeasonPass');
const { checkAndUnlockAchievements, unlockProfilePhoto } = require('../utils/achievementUtils');
const { getCurrentSeason } = require('../utils/seasonUtils');
const { askAI } = require('../utils/aiRouter');
const router = express.Router();

// ============================================================
// 🧠 SMART ANSWER ENGINE
//   Order of operations for every question:
//   1. Is the player trying to guess the character's actual name? -> "Maybe"
//   2. Can we answer with 100% certainty from OUR OWN structured data
//      (gender, alive/dead, species, or a direct keyword hit anywhere
//      in the character sheet)? -> answer directly, no AI call needed.
//   3. Otherwise, ask the AI to reason it out using the full character
//      sheet + its general anime knowledge.
// ============================================================

// ===== HELPER: Levenshtein Distance (spelling tolerance) =====
function levenshteinDistance(str1, str2) {
  const len1 = str1.length;
  const len2 = str2.length;

  if (len1 === 0) return len2;
  if (len2 === 0) return len1;

  const matrix = [];
  for (let i = 0; i <= len1; i++) matrix[i] = [i];
  for (let j = 0; j <= len2; j++) matrix[0][j] = j;

  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  return matrix[len1][len2];
}

// ===== HELPER: Check if two words match with spelling tolerance =====
// Only meaningful for words of length >= 3 - short words (he, is, no...)
// are too noisy for fuzzy matching and cause false positives.
function isSimilarWord(word1, word2) {
  if (!word1 || !word2) return false;

  const w1 = word1.toLowerCase().trim();
  const w2 = word2.toLowerCase().trim();

  if (w1.length < 3 || w2.length < 3) return w1 === w2;

  if (w1 === w2) return true;

  if (w1.length > 3 && w2.length > 3) {
    if (w1.includes(w2) || w2.includes(w1)) return true;
  }

  const distance = levenshteinDistance(w1, w2);
  const maxLength = Math.max(w1.length, w2.length);
  const similarity = (maxLength - distance) / maxLength;
  return similarity >= 0.75;
}

// ===== HELPER: Common words to skip when scanning a question =====
const skipWords = [
  'is', 'he', 'she', 'it', 'they', 'are', 'am', 'the', 'this', 'that',
  'his', 'her', 'their', 'them', 'what', 'who', 'when', 'where', 'why',
  'how', 'yes', 'no', 'maybe', 'idk', 'from', 'with', 'has', 'have',
  'does', 'do', 'did', 'was', 'were', 'been', 'being', 'can', 'will',
  'would', 'could', 'should', 'may', 'might', 'must', 'shall',
  'for', 'about', 'into', 'through', 'during', 'without', 'against',
  'between', 'among', 'upon', 'toward', 'until', 'since', 'of', 'to',
  'on', 'at', 'by', 'in', 'up', 'etc', 'eg', 'ie', 'and', 'or', 'but',
  'nor', 'yet', 'so', 'as', 'than', 'like', 'just', 'even',
  'though', 'although', 'while', 'whereas', 'wherever', 'whenever',
  'whoever', 'whichever', 'whatever', 'however', 'nevertheless',
  'nonetheless', 'accordingly', 'consequently', 'hence', 'thence',
  'your', 'you', 'ur', 'my', 'our', 'not', 'use', 'uses', 'used',
  'have', 'having', 'got', 'get'
];

// ===== HELPER: Get every piece of text we have on a character =====
function getAllCharacterText(character) {
  const texts = [];

  if (character.description) texts.push(character.description);
  if (character.crucialHint) texts.push(character.crucialHint);
  if (character.element) texts.push(character.element);
  if (character.rarity) texts.push(character.rarity);

  if (character.appearance) {
    if (character.appearance.hairColor) texts.push(character.appearance.hairColor);
    if (character.appearance.eyeColor) texts.push(character.appearance.eyeColor);
    if (character.appearance.skinColor) texts.push(character.appearance.skinColor);
    if (character.appearance.height) texts.push(character.appearance.height);
    if (character.appearance.build) texts.push(character.appearance.build);
    if (character.appearance.distinctiveFeatures) texts.push(character.appearance.distinctiveFeatures);
    if (character.appearance.clothing) texts.push(character.appearance.clothing);
    if (character.appearance.accessories) texts.push(character.appearance.accessories);
  }

  if (character.identity) {
    if (character.identity.gender) texts.push(character.identity.gender);
    if (character.identity.age) texts.push(String(character.identity.age));
    if (character.identity.species) texts.push(character.identity.species);
    if (character.identity.nationality) texts.push(character.identity.nationality);
    if (character.identity.occupation) texts.push(character.identity.occupation);
  }

  if (character.status) {
    if (character.status.currentStatus) texts.push(character.status.currentStatus);
    if (character.status.deathDetails) texts.push(character.status.deathDetails);
  }

  if (character.personality) {
    if (character.personality.traits) texts.push(...character.personality.traits);
    if (character.personality.likes) texts.push(...character.personality.likes);
    if (character.personality.dislikes) texts.push(...character.personality.dislikes);
    if (character.personality.goals) texts.push(character.personality.goals);
    if (character.personality.fears) texts.push(character.personality.fears);
  }

  if (character.abilities) {
    if (character.abilities.powers) texts.push(...character.abilities.powers);
    if (character.abilities.techniques) texts.push(...character.abilities.techniques);
    if (character.abilities.weapons) texts.push(...character.abilities.weapons);
    if (character.abilities.fightingStyle) texts.push(character.abilities.fightingStyle);
    if (character.abilities.specialAbilities) texts.push(character.abilities.specialAbilities);
  }

  if (character.relationships) {
    if (character.relationships.family) texts.push(character.relationships.family);
    if (character.relationships.friends) texts.push(...character.relationships.friends);
    if (character.relationships.rivals) texts.push(...character.relationships.rivals);
    if (character.relationships.mentors) texts.push(...character.relationships.mentors);
    if (character.relationships.students) texts.push(...character.relationships.students);
    if (character.relationships.master) texts.push(character.relationships.master);
    if (character.relationships.affiliatedGroups) texts.push(...character.relationships.affiliatedGroups);
  }

  if (character.background) {
    if (character.background.origin) texts.push(character.background.origin);
    if (character.background.backstory) texts.push(character.background.backstory);
    if (character.background.keyEvents) texts.push(...character.background.keyEvents);
    if (character.background.achievements) texts.push(...character.background.achievements);
    if (character.background.notableFights) texts.push(...character.background.notableFights);
  }

  if (character.traits) {
    if (character.traits.gender) texts.push(character.traits.gender);
    if (character.traits.species) texts.push(character.traits.species);
    if (character.traits.occupation) texts.push(character.traits.occupation);
    if (character.traits.powers) texts.push(...character.traits.powers);
    if (character.traits.personality) texts.push(...character.traits.personality);
    if (character.traits.affiliations) texts.push(...character.traits.affiliations);
    if (character.traits.relationships) texts.push(...character.traits.relationships);
    if (character.traits.keyEvents) texts.push(...character.traits.keyEvents);
  }

  if (character.attributes) {
    for (const key in character.attributes) {
      if (character.attributes[key] === true) {
        const readableName = key.replace(/([A-Z])/g, ' $1').trim();
        texts.push(readableName);
      }
    }
  }

  return [...new Set(texts.filter(t => t && typeof t === 'string' && t.length > 0))];
}

// ===== HELPER: Normalize string for flexible matching =====
function normalize(str) {
  if (!str) return '';
  return str.toLowerCase()
    .replace(/[^a-zA-Z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ===== HELPER: Sanitize user input =====
function sanitizeInput(str) {
  if (!str) return '';
  return str.replace(/[<>]/g, '').trim();
}

// ===== HELPER: Split a question into meaningful words =====
function extractQuestionWords(question) {
  return question
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 0 && !skipWords.includes(w));
}

// ============================================================
// CHARACTER NAME CACHE (used to detect "are you trying to guess
// the name directly" questions without false-positiving on every
// ordinary "is he/she/it ___?" question)
// ============================================================
let characterNamesCache = { names: [], lastFetched: 0 };
const NAME_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function getAllCharacterNames() {
  const now = Date.now();
  if (characterNamesCache.names.length === 0 || (now - characterNamesCache.lastFetched) > NAME_CACHE_TTL_MS) {
    try {
      characterNamesCache.names = await Character.distinct('name');
      characterNamesCache.lastFetched = now;
    } catch (e) {
      // If the lookup fails, fall back to whatever we had cached (possibly empty)
    }
  }
  return characterNamesCache.names;
}

// ===== Identity-reveal detection (FIXED) =====
// The old version used regexes like /is he (.+?)\?/ which matched almost
// ANY question ("is he marine?", "is she a girl?"), silently forcing IDK
// on completely ordinary attribute questions. This version only flags a
// question as an identity-guess when it either (a) explicitly asks for
// a name/identity in general terms, or (b) actually contains a word that
// fuzzy-matches a real character name in your database.
function isIdentityRevealQuestion(question, allCharacterNames = []) {
  const lower = question.toLowerCase().trim();

  const identityPhrases = [
    'who is it', 'who is he', 'who is she', 'who is this', 'who is that',
    'who is the character', 'who is your character',
    'what is his name', 'what is her name', 'what is its name', 'what is the name',
    'what is your name', "what's his name", "what's her name", "what's the name",
    "what's his real name", 'tell me the name', 'tell me who', 'reveal the name',
    'reveal who', 'guess who', 'who am i thinking', 'which character is this',
    'which character is it', 'what character is this', 'what character is it',
    'who are you'
  ];

  for (const phrase of identityPhrases) {
    if (lower.includes(phrase)) return true;
  }

  // Does the question actually contain a real character name from the DB?
  const words = extractQuestionWords(lower).filter(w => w.length >= 3);
  if (words.length === 0) return false;

  for (const name of allCharacterNames) {
    const nameWords = name.toLowerCase().split(/\s+/).filter(w => w.length >= 3);
    for (const nameWord of nameWords) {
      for (const w of words) {
        if (isSimilarWord(w, nameWord)) {
          return true;
        }
      }
    }
  }

  return false;
}

// ============================================================
// DETERMINISTIC ANSWER ENGINE
// Answers straight from the character sheet whenever we can be
// certain - this never depends on the AI, so it's always accurate
// and instant. Returns 'Yes' | 'No' | null (null = "ask the AI").
// ============================================================
function getDeterministicAnswer(question, character) {
  const words = extractQuestionWords(question);
  if (words.length === 0) return null;

  // ---- Gender (every character has one - safe to answer both ways) ----
  const gender = (character.identity?.gender || character.traits?.gender || '').toLowerCase();
  const explicitFemaleWords = ['girl', 'female', 'woman', 'women', 'lady', 'gal'];
  const explicitMaleWords = ['boy', 'male', 'man', 'men', 'guy', 'dude'];

  if (gender) {
    if (words.some(w => explicitFemaleWords.includes(w))) {
      return gender.includes('female') ? 'Yes' : 'No';
    }
    if (words.some(w => explicitMaleWords.includes(w))) {
      return (gender.includes('male') && !gender.includes('female')) ? 'Yes' : 'No';
    }
  }

  // ---- Alive / Dead (every character has a status - safe both ways) ----
  const statusStr = (character.status?.currentStatus || '').toLowerCase();
  const deceasedFlag = character.status?.deceased === true
    || character.status?.isDeceased === true
    || statusStr.includes('dead')
    || statusStr.includes('deceased');
  const aliveFlag = character.status?.isAlive === true || statusStr.includes('alive');
  const statusKnown = deceasedFlag || aliveFlag;

  if (statusKnown) {
    if (words.some(w => ['alive', 'living', 'live'].includes(w))) {
      return deceasedFlag ? 'No' : 'Yes';
    }
    if (words.some(w => ['dead', 'deceased', 'die', 'died', 'killed'].includes(w))) {
      return deceasedFlag ? 'Yes' : 'No';
    }
  }

  // ---- Species / "is X human?" (safe both ways when species is known) ----
  const species = (character.identity?.species || character.traits?.species || '').toLowerCase();
  if (species && words.includes('human')) {
    return species.includes('human') ? 'Yes' : 'No';
  }

  // ---- General keyword hit anywhere in the character sheet ----
  // If the player's word (or something close to it) genuinely appears in
  // OUR data about this character, the answer is definitely "Yes".
  // We do NOT infer "No" from absence here (the admin's notes are never
  // 100% exhaustive) - absence just means "let the AI reason about it".
  const allTexts = getAllCharacterText(character);
  const combinedText = allTexts.join(' | ').toLowerCase();
  const textWords = combinedText.split(/[^a-z0-9']+/).filter(w => w.length >= 3);

  for (const word of words) {
    if (word.length < 3) continue;
    if (combinedText.includes(word)) {
      return 'Yes';
    }
    for (const tw of textWords) {
      if (isSimilarWord(word, tw)) {
        return 'Yes';
      }
    }
  }

  return null;
}

// ============================================================
// AI PROMPT + PARSING
// ============================================================
const SYSTEM_PROMPT = `You are an expert anime encyclopedia AI acting as the host of a 20-questions style guessing game.

Your job: answer a Yes/No/Maybe/IDK question about a hidden anime character, using the CHARACTER DATA provided plus your own accurate canon knowledge of that anime.

RULES:
1. Base your answer on the CHARACTER DATA first.
2. If a field is "Unknown" or doesn't cover the question, use your real knowledge of that specific anime/character to deduce the correct answer. Only answer confidently if you actually know the canon fact - do not guess randomly.
3. Respect mutually exclusive categories (e.g. a Pirate is not a Marine; a character marked Deceased cannot be "alive"; a character with no Devil Fruit mentioned should be answered based on canon knowledge, not assumed).
4. Use "Maybe" only when the true answer is genuinely ambiguous, partially true, or changed over the course of the story.
5. Use "IDK" only when the fact is truly unknowable / never established in canon - this should be rare.
6. Never reveal or mention the character's actual name in your reasoning.
7. Output STRICT JSON only, nothing else - no markdown, no code fences, no commentary: {"answer": "Yes" | "No" | "Maybe" | "IDK", "reason": "brief reason"}`;

function buildCharacterContext(character, question) {
  const statusText = character.status?.currentStatus
    || (character.status?.deceased || character.status?.isDeceased ? 'Deceased' : 'Alive');

  return `
===== CHARACTER DATA (READ CAREFULLY) =====
Name: ${character.name} (CONFIDENTIAL - never reveal this)
Anime: ${character.anime}

===== IDENTITY =====
Gender: ${character.identity?.gender || character.traits?.gender || 'Unknown'}
Age: ${character.identity?.age || character.traits?.age || 'Unknown'}
Species: ${character.identity?.species || character.traits?.species || 'Unknown'}
Occupation: ${character.identity?.occupation || character.traits?.occupation || 'Unknown'}
Nationality: ${character.identity?.nationality || 'Unknown'}

===== APPEARANCE =====
Hair: ${character.appearance?.hairColor || 'Unknown'}
Eyes: ${character.appearance?.eyeColor || 'Unknown'}
Skin: ${character.appearance?.skinColor || 'Unknown'}
Height: ${character.appearance?.height || 'Unknown'}
Build: ${character.appearance?.build || 'Unknown'}
Clothing: ${character.appearance?.clothing || 'Unknown'}
Accessories: ${character.appearance?.accessories || 'Unknown'}
Distinctive Features: ${character.appearance?.distinctiveFeatures || 'Unknown'}

===== STATUS =====
Current Status: ${statusText}
Death Details: ${character.status?.deathDetails || 'N/A'}

===== PERSONALITY =====
Traits: ${character.personality?.traits?.join(', ') || 'Unknown'}
Likes: ${character.personality?.likes?.join(', ') || 'Unknown'}
Dislikes: ${character.personality?.dislikes?.join(', ') || 'Unknown'}
Goals: ${character.personality?.goals || 'Unknown'}
Fears: ${character.personality?.fears || 'Unknown'}

===== ABILITIES =====
Powers: ${character.abilities?.powers?.join(', ') || 'None'}
Techniques: ${character.abilities?.techniques?.join(', ') || 'None'}
Weapons: ${character.abilities?.weapons?.join(', ') || 'None'}
Fighting Style: ${character.abilities?.fightingStyle || 'Unknown'}
Special Abilities: ${character.abilities?.specialAbilities || 'Unknown'}

===== RELATIONSHIPS =====
Family: ${character.relationships?.family || 'Unknown'}
Friends: ${character.relationships?.friends?.join(', ') || 'None'}
Rivals: ${character.relationships?.rivals?.join(', ') || 'None'}
Mentors: ${character.relationships?.mentors?.join(', ') || 'None'}
Master: ${character.relationships?.master || 'None'}
Affiliated Groups: ${character.relationships?.affiliatedGroups?.join(', ') || 'None'}

===== BACKGROUND =====
Origin: ${character.background?.origin || 'Unknown'}
Backstory: ${character.background?.backstory || 'Unknown'}
Key Events: ${character.background?.keyEvents?.join(', ') || 'Unknown'}
Achievements: ${character.background?.achievements?.join(', ') || 'Unknown'}

===== DESCRIPTION =====
${character.description || 'Unknown'}

===== USER QUESTION =====
"${question}"

===== YOUR TASK =====
Answer the yes/no/maybe question above about "${character.name}" from "${character.anime}", using the data given plus your real knowledge of this anime. Never reveal the name "${character.name}". Reply with STRICT JSON ONLY: {"answer": "Yes", "reason": "short reason"}
`;
}

// Robust parsing: try JSON first, then fall back to whole-word text scanning
// instead of collapsing straight to IDK the moment the model adds one stray
// character around its JSON.
function parseAIAnswer(rawAnswer) {
  if (!rawAnswer || typeof rawAnswer !== 'string') return 'IDK';

  const jsonMatch = rawAnswer.match(/\{[\s\S]*?\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed && parsed.answer) {
        const a = String(parsed.answer).toLowerCase().trim();
        if (a === 'yes') return 'Yes';
        if (a === 'no') return 'No';
        if (a === 'maybe') return 'Maybe';
        if (a === 'idk') return 'IDK';
      }
    } catch (e) {
      // fall through to text scanning below
    }
  }

  const text = rawAnswer.toLowerCase();
  if (/\bno\b/.test(text)) return 'No';
  if (/\byes\b/.test(text)) return 'Yes';
  if (/\bmaybe\b/.test(text)) return 'Maybe';

  return 'IDK';
}

// ============================================================
// VALIDATION RULES
// ============================================================
const validateGameId = [
  body('gameId')
    .notEmpty()
    .withMessage('Game ID is required')
    .isMongoId()
    .withMessage('Invalid game ID format')
];

const validateQuestion = [
  body('question')
    .trim()
    .escape()
    .isLength({ min: 1, max: 500 })
    .withMessage('Question must be between 1 and 500 characters')
];

const validateGuess = [
  body('guess')
    .trim()
    .escape()
    .isLength({ min: 1, max: 100 })
    .withMessage('Guess must be between 1 and 100 characters')
    .matches(/^[a-zA-Z0-9\s\-'.,!?]+$/)
    .withMessage('Guess contains invalid characters')
];

// ============================================================
// GET ANIME OPTIONS (4 random anime)
// ============================================================
router.get('/anime-options', async (req, res) => {
  try {
    const allAnime = await Character.distinct('anime');

    if (!allAnime || allAnime.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No anime found in database.'
      });
    }

    if (allAnime.length < 4) {
      return res.status(400).json({
        success: false,
        message: 'Not enough anime in database. Need at least 4.',
        total: allAnime.length
      });
    }

    const shuffled = allAnime.sort(() => 0.5 - Math.random());
    const selectedAnime = shuffled.slice(0, 4);

    res.json({
      success: true,
      anime: selectedAnime,
      total: allAnime.length
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get anime options'
    });
  }
});

// ============================================================
// START GAME WITH SELECTED ANIME
// ============================================================
router.post('/start', async (req, res) => {
  try {
    const { anime } = req.body;

    if (!anime) {
      return res.status(400).json({
        success: false,
        message: 'Please select an anime first!'
      });
    }

    const characters = await Character.find({ anime: anime });

    if (!characters || characters.length === 0) {
      return res.status(400).json({
        success: false,
        message: `No characters found for "${anime}". Please try another anime.`
      });
    }

    const randomIndex = Math.floor(Math.random() * characters.length);
    const randomCharacter = characters[randomIndex];

    if (!randomCharacter) {
      return res.status(404).json({
        success: false,
        message: 'No character found. Please try again.'
      });
    }

    const activeGame = await GameSession.findOne({
      user: req.user._id,
      status: 'active'
    });

    if (activeGame) {
      activeGame.status = 'abandoned';
      activeGame.endedAt = new Date();
      await activeGame.save();
    }

    const game = new GameSession({
      user: req.user._id,
      character: randomCharacter._id,
      anime: anime,
      status: 'active',
      startedAt: new Date()
    });

    await game.save();

    res.json({
      success: true,
      gameId: game._id,
      anime: anime,
      characterCount: characters.length,
      message: `Game started! Guess the character from ${anime}.`
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error starting game. Please try again.'
    });
  }
});

// ============================================================
// ASK QUESTION
// ============================================================
router.post('/question', [...validateGameId, ...validateQuestion], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array().map(e => e.msg)
      });
    }

    const { gameId, question } = req.body;
    const sanitizedQuestion = sanitizeInput(question);

    const game = await GameSession.findById(gameId).populate('character');

    if (!game) {
      return res.status(404).json({
        success: false,
        message: 'Game not found'
      });
    }

    if (game.status !== 'active') {
      return res.status(400).json({
        success: false,
        message: 'Game is not active. Start a new game.'
      });
    }

    if (game.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to access this game'
      });
    }

    if (game.totalQuestions >= 10) {
      return res.status(400).json({
        success: false,
        message: 'You have used all 10 questions. Please make a guess.',
        limitReached: true
      });
    }

    const isDuplicate = game.questions.some(q =>
      q.question.toLowerCase().trim() === sanitizedQuestion.toLowerCase().trim()
    );

    if (isDuplicate) {
      return res.status(400).json({
        success: false,
        message: '❌ You already asked this question! Try something else.',
        isDuplicate: true
      });
    }

    const character = game.character;
    let finalAnswer;
    let usedProvider = 'local';

    // ---- STEP 1: Is this actually trying to guess the name? ----
    const allNames = await getAllCharacterNames();

    if (isIdentityRevealQuestion(sanitizedQuestion, allNames)) {
      finalAnswer = 'Maybe';
    } else {
      // ---- STEP 2: Can our own data answer this with certainty? ----
      const deterministic = getDeterministicAnswer(sanitizedQuestion, character);

      if (deterministic) {
        finalAnswer = deterministic;
      } else {
        // ---- STEP 3: Ask the AI to reason it out ----
        const context = buildCharacterContext(character, sanitizedQuestion);
        const messages = [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: context }
        ];

        try {
          const result = await askAI(messages);
          finalAnswer = parseAIAnswer(result?.answer);
          usedProvider = result?.provider || 'ai';
        } catch (error) {
          return res.status(503).json({
            success: false,
            message: 'AI service temporarily unavailable. Please try again.'
          });
        }
      }
    }

    game.questions.push({
      question: sanitizedQuestion,
      answer: finalAnswer,
      confidence: 1.0
    });
    game.totalQuestions += 1;
    await game.save();

    await User.findByIdAndUpdate(req.user._id, {
      $inc: { 'stats.totalQuestions': 1 }
    });

    res.json({
      success: true,
      answer: finalAnswer,
      questionCount: game.totalQuestions,
      maxQuestions: 10,
      provider: usedProvider
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error processing question. Please try again.'
    });
  }
});

// ============================================================
// USE HINT
// ============================================================
router.post('/hint', validateGameId, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array().map(e => e.msg)
      });
    }

    const { gameId } = req.body;

    const game = await GameSession.findById(gameId).populate('character');

    if (!game) {
      return res.status(404).json({
        success: false,
        message: 'Game not found'
      });
    }

    if (game.status !== 'active') {
      return res.status(400).json({
        success: false,
        message: 'Game is not active'
      });
    }

    if (game.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized'
      });
    }

    const user = await User.findById(req.user._id);

    if (game.hintUsed) {
      return res.status(400).json({
        success: false,
        message: 'Hint already used for this game!'
      });
    }

    if (user.shards < 100) {
      return res.status(400).json({
        success: false,
        message: `Not enough Character Shards! You have ${user.shards}, need 100.`,
        shards: user.shards
      });
    }

    user.shards -= 100;
    game.hintUsed = true;

    await user.save();
    await game.save();

    const hint = game.character.crucialHint || 'No hint available for this character.';

    res.json({
      success: true,
      hint: hint,
      shards: user.shards,
      message: '💡 Hint used! -100 Shards'
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error using hint. Please try again.'
    });
  }
});

// ============================================================
// MAKE GUESS
// ============================================================
router.post('/guess', [...validateGameId, ...validateGuess], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array().map(e => e.msg)
      });
    }

    const { gameId, guess } = req.body;
    const sanitizedGuess = sanitizeInput(guess);

    const game = await GameSession.findById(gameId).populate('character');

    if (!game) {
      return res.status(404).json({
        success: false,
        message: 'Game not found'
      });
    }

    if (game.status !== 'active') {
      return res.status(400).json({
        success: false,
        message: 'Game is not active. Start a new game.'
      });
    }

    if (game.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized'
      });
    }

    const wrongGuesses = game.guesses ? game.guesses.filter(g => !g.isCorrect) : [];
    if (wrongGuesses.length >= 3) {
      return res.status(400).json({
        success: false,
        message: 'Game already ended. Start a new game.'
      });
    }

    const normalizedGuess = normalize(sanitizedGuess);
    const normalizedCharName = normalize(game.character.name);

    let isCorrect = normalizedGuess === normalizedCharName;

    if (!isCorrect) {
      const guessWords = normalizedGuess.split(' ');
      const charWords = normalizedCharName.split(' ');
      const allWordsMatch = guessWords.every(word => charWords.includes(word));
      if (allWordsMatch && guessWords.length > 0) {
        isCorrect = true;
      }
    }

    if (!isCorrect && normalizedCharName.includes(normalizedGuess) && normalizedGuess.length >= 3) {
      isCorrect = true;
    }

    game.guesses.push({ guess: sanitizedGuess, isCorrect });

    if (isCorrect) {
      game.status = 'won';
      game.endedAt = new Date();
      game.totalQuestions = game.questions.length;
      await game.save();

      const user = await User.findById(req.user._id);

      user.stats.gamesPlayed += 1;
      user.stats.gamesWon += 1;
      user.stats.winStreak += 1;
      user.totalGuesses += 1;

      const currentSeason = getCurrentSeason();

      if (!user.seasonStats) {
        user.seasonStats = {
          currentSeason: currentSeason,
          seasonWins: 0,
          seasonPlayed: 0,
          seasonStreak: 0
        };
      }

      user.seasonStats.currentSeason = currentSeason;
      user.seasonStats.seasonWins += 1;
      user.seasonStats.seasonPlayed += 1;
      user.seasonStats.seasonStreak += 1;

      const anime = game.character.anime;
      const currentAnimeGuesses = user.animeGuesses?.get(anime) || 0;
      user.animeGuesses.set(anime, currentAnimeGuesses + 1);

      user.shards += 10;

      const character = game.character;
      const cardAdded = user.addCard(character);

      if (user.seasonPass && user.seasonPass.active) {
        const activeSeason = await SeasonPass.getActiveSeason();

        if (activeSeason) {
          user.seasonPass.correctGuesses = (user.seasonPass.correctGuesses || 0) + 1;

          const guessesPerTier = activeSeason.correctGuessesPerTier || 2;
          const newTier = Math.floor(user.seasonPass.correctGuesses / guessesPerTier) + 1;
          const finalTier = Math.min(newTier, activeSeason.totalTiers);

          const tierAdvanced = finalTier > (user.seasonPass.currentTier || 1);

          user.seasonPass.currentTier = finalTier;

          const progressInTier = user.seasonPass.correctGuesses % guessesPerTier;
          user.seasonPass.progress = Math.round((progressInTier / guessesPerTier) * 100);

          if (finalTier >= activeSeason.totalTiers && !user.seasonPass.isCompleted) {
            user.seasonPass.isCompleted = true;
            user.seasonPass.completedAt = new Date();
          }

          if (tierAdvanced) {
            if (!user.seasonPass.unlockedTiers) user.seasonPass.unlockedTiers = [];
            for (let i = (user.seasonPass.currentTier || 1); i <= finalTier; i++) {
              const alreadyUnlocked = user.seasonPass.unlockedTiers.some(t => t.tier === i);
              if (!alreadyUnlocked) {
                user.seasonPass.unlockedTiers.push({ tier: i, unlockedAt: new Date() });
              }
            }
          }
        }
      }

      const isFirstWin = user.stats.gamesWon === 1;

      if (user.referredBy && isFirstWin) {
        const referral = await Referral.findOne({
          referredUser: user._id,
          status: { $ne: 'completed' }
        });

        if (referral && !referral.referrerRewards.firstWin) {
          const referrer = await User.findById(referral.referrer);

          if (referrer) {
            referrer.shards += 50;
            referrer.referralStats.shardsEarned = (referrer.referralStats?.shardsEarned || 0) + 50;
            referrer.referralStats.completedReferrals = (referrer.referralStats?.completedReferrals || 0) + 1;
            await referrer.save();

            user.shards += 50;

            referral.referrerRewards.firstWin = true;
            referral.referredUserRewards.welcomeBonus = true;
            referral.status = 'completed';
            referral.firstWinAt = new Date();
            referral.completedAt = new Date();
            await referral.save();
          }
        }
      }

      const unlockedAchievements = await checkAndUnlockAchievements(user._id);
      const photoUnlock = await unlockProfilePhoto(user._id, game.character._id);

      let allUnlocked = [];
      if (photoUnlock) allUnlocked.push(photoUnlock);
      if (unlockedAchievements.length > 0) allUnlocked = allUnlocked.concat(unlockedAchievements);

      await user.save();

      return res.json({
        success: true,
        isCorrect: true,
        character: game.character.name,
        anime: game.character.anime,
        image: game.character.image || '',
        powerLevel: game.character.powerLevel || 25,
        message: `🎉 Correct! It was ${game.character.name}!`,
        questionsUsed: game.totalQuestions,
        unlockedItems: allUnlocked,
        shards: user.shards,
        cardAdded: cardAdded,
        cardCount: user.cards.length
      });

    } else {
      const newWrongGuesses = game.guesses.filter(g => !g.isCorrect);

      if (newWrongGuesses.length >= 3) {
        game.status = 'lost';
        game.endedAt = new Date();
        game.totalQuestions = game.questions.length;
        await game.save();

        const currentSeason = getCurrentSeason();

        await User.findByIdAndUpdate(req.user._id, {
          $inc: {
            'stats.gamesPlayed': 1,
            'seasonStats.seasonPlayed': 1
          },
          $set: {
            'stats.winStreak': 0,
            'seasonStats.seasonStreak': 0,
            'seasonStats.currentSeason': currentSeason
          }
        });

        return res.json({
          success: true,
          isCorrect: false,
          gameOver: true,
          character: game.character.name,
          anime: game.character.anime,
          image: game.character.image || '',
          powerLevel: game.character.powerLevel || 25,
          message: `❌ Game over! The character was ${game.character.name}.`
        });
      } else {
        await game.save();
        return res.json({
          success: true,
          isCorrect: false,
          message: `❌ Not ${sanitizedGuess}. Try again! (${3 - newWrongGuesses.length} guesses left)`,
          remainingGuesses: 3 - newWrongGuesses.length
        });
      }
    }

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error processing guess. Please try again.'
    });
  }
});

// ============================================================
// GIVE UP
// ============================================================
router.post('/giveup', validateGameId, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array().map(e => e.msg)
      });
    }

    const { gameId } = req.body;

    const game = await GameSession.findById(gameId).populate('character');

    if (!game) {
      return res.status(404).json({
        success: false,
        message: 'Game not found'
      });
    }

    if (game.status !== 'active') {
      return res.status(400).json({
        success: false,
        message: 'Game is not active'
      });
    }

    // FIX: this check previously had an empty body and enforced nothing.
    if (game.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized'
      });
    }

    game.status = 'abandoned';
    game.endedAt = new Date();
    game.totalQuestions = game.questions.length;
    await game.save();

    const currentSeason = getCurrentSeason();

    await User.findByIdAndUpdate(req.user._id, {
      $inc: {
        'stats.gamesPlayed': 1,
        'seasonStats.seasonPlayed': 1
      },
      $set: {
        'stats.winStreak': 0,
        'seasonStats.seasonStreak': 0,
        'seasonStats.currentSeason': currentSeason
      }
    });

    return res.json({
      success: true,
      character: game.character.name,
      anime: game.character.anime,
      image: game.character.image || '',
      powerLevel: game.character.powerLevel || 25,
      message: `You gave up! The character was ${game.character.name} from ${game.character.anime}.`
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error giving up. Please try again.'
    });
  }
});

// ============================================================
// GET HISTORY
// ============================================================
router.get('/history', async (req, res) => {
  try {
    const games = await GameSession.find({ user: req.user._id })
      .populate('character', 'name anime image powerLevel')
      .sort({ startedAt: -1 })
      .limit(20);

    const sanitizedGames = games.map(game => ({
      id: game._id,
      character: game.character?.name || 'Unknown',
      anime: game.character?.anime || 'Unknown',
      powerLevel: game.character?.powerLevel || 25,
      status: game.status,
      questions: game.totalQuestions || game.questions.length,
      startedAt: game.startedAt,
      endedAt: game.endedAt
    }));

    res.json({
      success: true,
      games: sanitizedGames
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching history. Please try again.'
    });
  }
});

module.exports = router;