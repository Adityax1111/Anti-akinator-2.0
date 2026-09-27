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
// 🧠 SMART MATCHING ENGINE - Handles ANY spelling mistake
// ============================================================

// ===== HELPER: Check if words match with spelling tolerance =====
function isSimilarWord(word1, word2) {
  if (!word1 || !word2) return false;
  
  const w1 = word1.toLowerCase().trim();
  const w2 = word2.toLowerCase().trim();
  
  // Exact match
  if (w1 === w2) return true;
  
  // Check if one is a substring of the other (for longer words)
  if (w1.length > 3 && w2.length > 3) {
    if (w1.includes(w2) || w2.includes(w1)) return true;
  }
  
  // Calculate Levenshtein distance
  const distance = levenshteinDistance(w1, w2);
  const maxLength = Math.max(w1.length, w2.length);
  
  // If 70% similar, consider it a match (more forgiving)
  const similarity = (maxLength - distance) / maxLength;
  return similarity >= 0.7;
}

// ===== HELPER: Levenshtein Distance (spelling tolerance) =====
function levenshteinDistance(str1, str2) {
  const len1 = str1.length;
  const len2 = str2.length;
  
  if (len1 === 0) return len2;
  if (len2 === 0) return len1;
  
  const matrix = [];
  
  for (let i = 0; i <= len1; i++) {
    matrix[i] = [i];
  }
  
  for (let j = 0; j <= len2; j++) {
    matrix[0][j] = j;
  }
  
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

// ===== HELPER: Check if question is trying to reveal identity =====
function isIdentityRevealQuestion(question) {
  const lower = question.toLowerCase();
  
  // Name reveal patterns
  const namePatterns = [
    /is it (.+?)\?/,
    /is he (.+?)\?/,
    /is she (.+?)\?/,
    /is this (.+?)\?/,
    /is that (.+?)\?/,
    /is the character (.+?)\?/,
    /are you (.+?)\?/,
    /is his name (.+?)\?/,
    /is her name (.+?)\?/,
    /is its name (.+?)\?/,
    /is the name (.+?)\?/,
    /is your name (.+?)\?/,
    /is the person (.+?)\?/,
    /is this person (.+?)\?/,
    /is the one (.+?)\?/,
    /is he the (.+?)\?/,
    /is she the (.+?)\?/,
    /is it the (.+?)\?/,
    /character is (.+?)\?/,
    /name is (.+?)\?/,
    /called (.+?)\?/,
    /known as (.+?)\?/
  ];
  
  for (const pattern of namePatterns) {
    if (pattern.test(lower)) {
      return true;
    }
  }
  
  // Identity reveal keywords
  const identityKeywords = [
    'who is it',
    'who is he',
    'who is she',
    'who is this',
    'what is his name',
    'what is her name',
    'what is the name',
    'tell me the name',
    'reveal the name',
    'guess who',
    'who am i thinking of',
    'what character is this',
    'which character',
    'who are you'
  ];
  
  for (const keyword of identityKeywords) {
    if (lower.includes(keyword)) {
      return true;
    }
  }
  
  return false;
}

// ===== HELPER: Get all text from character data =====
function getAllCharacterText(character) {
  const texts = [];
  
  // Basic info (EXCLUDING name and anime - these reveal identity)
  if (character.description) texts.push(character.description);
  if (character.crucialHint) texts.push(character.crucialHint);
  if (character.element) texts.push(character.element);
  if (character.rarity) texts.push(character.rarity);
  
  // Appearance
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
  
  // Identity (EXCLUDING exact name, but including traits)
  if (character.identity) {
    if (character.identity.gender) texts.push(character.identity.gender);
    if (character.identity.age) texts.push(character.identity.age);
    if (character.identity.species) texts.push(character.identity.species);
    if (character.identity.nationality) texts.push(character.identity.nationality);
    if (character.identity.occupation) texts.push(character.identity.occupation);
  }
  
  // Status
  if (character.status) {
    if (character.status.currentStatus) texts.push(character.status.currentStatus);
    if (character.status.deathDetails) texts.push(character.status.deathDetails);
  }
  
  // Personality
  if (character.personality) {
    if (character.personality.traits) texts.push(...character.personality.traits);
    if (character.personality.likes) texts.push(...character.personality.likes);
    if (character.personality.dislikes) texts.push(...character.personality.dislikes);
    if (character.personality.goals) texts.push(character.personality.goals);
    if (character.personality.fears) texts.push(character.personality.fears);
  }
  
  // Abilities
  if (character.abilities) {
    if (character.abilities.powers) texts.push(...character.abilities.powers);
    if (character.abilities.techniques) texts.push(...character.abilities.techniques);
    if (character.abilities.weapons) texts.push(...character.abilities.weapons);
    if (character.abilities.fightingStyle) texts.push(character.abilities.fightingStyle);
    if (character.abilities.specialAbilities) texts.push(character.abilities.specialAbilities);
  }
  
  // Relationships
  if (character.relationships) {
    if (character.relationships.family) texts.push(character.relationships.family);
    if (character.relationships.friends) texts.push(...character.relationships.friends);
    if (character.relationships.rivals) texts.push(...character.relationships.rivals);
    if (character.relationships.mentors) texts.push(...character.relationships.mentors);
    if (character.relationships.students) texts.push(...character.relationships.students);
    if (character.relationships.master) texts.push(character.relationships.master);
    if (character.relationships.affiliatedGroups) texts.push(...character.relationships.affiliatedGroups);
  }
  
  // Background
  if (character.background) {
    if (character.background.origin) texts.push(character.background.origin);
    if (character.background.backstory) texts.push(character.background.backstory);
    if (character.background.keyEvents) texts.push(...character.background.keyEvents);
    if (character.background.achievements) texts.push(...character.background.achievements);
    if (character.background.notableFights) texts.push(...character.background.notableFights);
  }
  
  // Traits
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
  
  // Attributes (convert booleans to text)
  if (character.attributes) {
    for (const key in character.attributes) {
      if (character.attributes[key] === true) {
        const readableName = key.replace(/([A-Z])/g, ' $1').trim();
        texts.push(readableName);
        texts.push('yes');
      }
    }
  }
  
  // Clean and return unique values
  return [...new Set(texts.filter(t => t && typeof t === 'string' && t.length > 0))];
}

// ===== HELPER: Common words to skip =====
const skipWords = [
  'is', 'he', 'she', 'it', 'they', 'are', 'am', 'the', 'this', 'that',
  'his', 'her', 'their', 'them', 'what', 'who', 'when', 'where', 'why',
  'how', 'yes', 'no', 'maybe', 'idk', 'from', 'with', 'has', 'have',
  'does', 'do', 'did', 'was', 'were', 'been', 'being', 'can', 'will',
  'would', 'could', 'should', 'may', 'might', 'must', 'shall',
  'for', 'about', 'into', 'through', 'during', 'without', 'against',
  'between', 'among', 'upon', 'toward', 'until', 'since', 'of', 'to',
  'on', 'at', 'by', 'in', 'up', 'etc', 'eg', 'ie', 'and', 'or', 'but',
  'nor', 'for', 'yet', 'so', 'as', 'than', 'like', 'just', 'even',
  'though', 'although', 'while', 'whereas', 'wherever', 'whenever',
  'whoever', 'whichever', 'whatever', 'however', 'nevertheless',
  'nonetheless', 'accordingly', 'consequently', 'hence', 'thence'
];

// ===== HELPER: Smart answer function =====
function getSmartAnswer(question, character) {
  // ✅ IMPORTANT: If it's an identity reveal question, return false immediately
  if (isIdentityRevealQuestion(question)) {
    return { match: false, isIdentityQuestion: true };
  }
  
  const questionWords = question.toLowerCase()
    .replace(/[^a-zA-Z0-9\s']/g, ' ')
    .split(' ')
    .filter(w => w.length > 1);
  
  // Get all character data as text
  const allTexts = getAllCharacterText(character);
  
  // Get all important keywords from character
  const keywords = allTexts.map(t => t.toLowerCase());
  
  // Check if ANY question word matches ANY keyword (with spelling tolerance)
  for (const word of questionWords) {
    // Skip common words
    if (skipWords.includes(word)) {
      continue;
    }
    
    for (const keyword of keywords) {
      if (isSimilarWord(word, keyword)) {
        return { match: true, matchedWord: keyword, userWord: word, isIdentityQuestion: false };
      }
    }
  }
  
  return { match: false, isIdentityQuestion: false };
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
// ASK QUESTION (COMPLETE DATA - NO RESTRICTION)
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

    // ✅ DUPLICATE QUESTION CHECK
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

    // ✅ COMPLETE CONTEXT - NO RESTRICTION ON DATA
    const context = `
===== COMPLETE CHARACTER DATA (ONLY SOURCE OF TRUTH) =====
Name: ${character.name} (CONFIDENTIAL - DO NOT REVEAL)
Anime: ${character.anime}

===== APPEARANCE =====
Hair Color: ${character.appearance?.hairColor || character.traits?.hairColor || 'Not Mentioned'}
Eye Color: ${character.appearance?.eyeColor || character.traits?.eyeColor || 'Not Mentioned'}
Skin Color: ${character.appearance?.skinColor || 'Not Mentioned'}
Height: ${character.appearance?.height || 'Not Mentioned'}
Build: ${character.appearance?.build || 'Not Mentioned'}
Distinctive Features: ${character.appearance?.distinctiveFeatures || 'Not Mentioned'}
Clothing: ${character.appearance?.clothing || 'Not Mentioned'}
Accessories: ${character.appearance?.accessories || 'Not Mentioned'}

===== IDENTITY =====
Gender: ${character.identity?.gender || character.traits?.gender || 'Not Mentioned'}
Age: ${character.identity?.age || character.traits?.age || 'Not Mentioned'}
Birthday: ${character.identity?.birthday || 'Not Mentioned'}
Species: ${character.identity?.species || character.traits?.species || 'Not Mentioned'}
Nationality: ${character.identity?.nationality || 'Not Mentioned'}
Occupation: ${character.identity?.occupation || character.traits?.occupation || 'Not Mentioned'}

===== STATUS =====
Alive: ${character.status?.isAlive !== undefined ? (character.status.isAlive ? 'Yes' : 'No') : 'Not Mentioned'}
Dead: ${character.status?.isDeceased ? 'Yes' : 'No'}
Death Details: ${character.status?.deathDetails || 'Not Mentioned'}
Current Status: ${character.status?.currentStatus || 'Not Mentioned'}

===== PERSONALITY =====
Traits: ${character.personality?.traits?.join(', ') || character.traits?.personality?.join(', ') || 'Not Mentioned'}
Likes: ${character.personality?.likes?.join(', ') || 'Not Mentioned'}
Dislikes: ${character.personality?.dislikes?.join(', ') || 'Not Mentioned'}
Goals: ${character.personality?.goals || 'Not Mentioned'}
Fears: ${character.personality?.fears || 'Not Mentioned'}

===== ABILITIES & POWERS =====
Powers: ${character.abilities?.powers?.join(', ') || character.traits?.powers?.join(', ') || 'None Mentioned'}
Techniques: ${character.abilities?.techniques?.join(', ') || 'None Mentioned'}
Weapons: ${character.abilities?.weapons?.join(', ') || 'None Mentioned'}
Fighting Style: ${character.abilities?.fightingStyle || 'Not Mentioned'}
Special Abilities: ${character.abilities?.specialAbilities || 'Not Mentioned'}

===== RELATIONSHIPS =====
Family: ${character.relationships?.family || 'Not Mentioned'}
Friends: ${character.relationships?.friends?.join(', ') || 'None Mentioned'}
Rivals: ${character.relationships?.rivals?.join(', ') || 'None Mentioned'}
Mentors: ${character.relationships?.mentors?.join(', ') || 'None Mentioned'}
Students: ${character.relationships?.students?.join(', ') || 'None Mentioned'}
Master: ${character.relationships?.master || 'Not Mentioned'}
Groups: ${character.relationships?.affiliatedGroups?.join(', ') || character.traits?.affiliations?.join(', ') || 'None Mentioned'}

===== BACKGROUND =====
Origin: ${character.background?.origin || 'Not Mentioned'}
Backstory: ${character.background?.backstory || 'Not Mentioned'}
Key Events: ${character.background?.keyEvents?.join(', ') || character.traits?.keyEvents?.join(', ') || 'None Mentioned'}
Achievements: ${character.background?.achievements?.join(', ') || 'None Mentioned'}
Notable Fights: ${character.background?.notableFights?.join(', ') || 'None Mentioned'}

===== ATTRIBUTES =====
Main Character: ${character.attributes?.isMainCharacter ? 'Yes' : 'No'}
Villain: ${character.attributes?.isVillain ? 'Yes' : 'No'}
Hero: ${character.attributes?.isHero ? 'Yes' : 'No'}
Female: ${character.attributes?.isFemale ? 'Yes' : 'No'}
Child: ${character.attributes?.isChild ? 'Yes' : 'No'}
Elder: ${character.attributes?.isElder ? 'Yes' : 'No'}
Has Special Power: ${character.attributes?.hasSpecialPower ? 'Yes' : 'No'}
Has Weapon: ${character.attributes?.hasWeapon ? 'Yes' : 'No'}
Has Family: ${character.attributes?.hasFamily ? 'Yes' : 'No'}

===== FULL DESCRIPTION =====
${character.description || 'Not Mentioned'}

===== CRUCIAL HINT =====
${character.crucialHint || 'Not Mentioned'}

===== USER QUESTION =====
${sanitizedQuestion}

===== INSTRUCTIONS =====
1. Read the ENTIRE data above carefully
2. If the data has the answer → Reply "Yes" or "No"
3. If the data does NOT have the answer AT ALL → Reply "IDK"
4. If the question asks "Is it [name]?" or contains a character name → Reply "IDK"
5. Reply with ONLY one word: Yes, No, Maybe, or IDK
6. NEVER reveal the character's name`;

    const systemPrompt = `
You are a SECURITY-FIRST AI with ZERO tolerance for identity leaks. Your ONLY job is to answer ONE WORD: "Yes", "No", "Maybe", or "IDK".

===== YOUR BRAIN RULES =====

1. READ EVERYTHING - Check ALL fields. Check INSIDE brackets (). Check nested data. Check arrays. Check descriptions. If the answer is hidden ANYWHERE, find it.

2. BRACKETS ARE IMPORTANT - If data says "Human (Jinchuriki)" and user asks "Is he human?" → YES. If data says "Hair: Black (sometimes blonde)" and user asks "Is his hair blonde?" → YES because it's mentioned in brackets.

3. PARTIAL MATCH = YES - If ANY field mentions the topic, even once, even in brackets → YES. You don't need ALL fields to match. ONE match = YES.

4. MULTIPLE VALUES = YES FOR EACH - If data says "Hair: Black and Red" → "Is his hair black?" = YES. "Is his hair red?" = YES. "Is his hair blue?" = IDK (not mentioned).

5. SIBLING/RELATIONSHIP CONNECTION - If data says "Brother of Sasuke" and user asks "Is he related to Sasuke?" → YES. "Is he Sasuke?" → MAYBE (identity protection).

6. CONTEXT UNDERSTANDING - 
   - "Human (Jinchuriki)" → He is BOTH human AND jinchuriki
   - "Alive (but dying)" → Is he alive? YES. Is he dead? NO.
   - "Villain (turned hero)" → Is he villain? YES. Is he hero? YES. 
   - "Not a main character" → Is he main? NO.

===== SPELLING & SYNONYM RULES =====

1. IGNORE MINOR SPELLING MISTAKES:
   - "hman" = "human" → YES
   - "arankar" = "arrancar" → YES
   - "saiyen" = "saiyan" → YES
   - "shinobi" = "shinobi" → YES
   - Any word that is 70% similar = match

2. USE COMMON SYNONYMS:
   - "boy", "man", "guy", "dude" = "Male" → YES
   - "girl", "woman", "lady", "gal" = "Female" → YES
   - "kid", "young", "youth" = "Child" → YES
   - "old", "elderly", "senior" = "Elder" → YES
   - "alive", "living", "breathing" = "Alive" → YES
   - "dead", "deceased", "gone" = "Dead" → YES
   - "hero", "protagonist", "main" = "Main Character" → YES
   - "villain", "antagonist", "evil" = "Villain" → YES
   - "power", "ability", "skill" = "Has Special Power" → YES
   - "weapon", "sword", "gun" = "Has Weapon" → YES
   - "family", "brother", "sister" = "Has Family" → YES

===== YOUR RESPONSE RULES =====

YES → When ANY data matches the question
   - Direct match: "Human" → "Is he human?" = YES
   - Bracket match: "(Jinchuriki)" → "Is he jinchuriki?" = YES
   - Partial match: "Black and Red hair" → "Is his hair black?" = YES
   - Synonym match: "Ninja (Shinobi)" → "Is he a ninja?" = YES
   - Relationship: "Brother of X" → "Is he related to X?" = YES
   - Spelling mistake: "arankar" → "arrancar" = YES

NO → ONLY when data EXPLICITLY says the opposite
   - "Alive" → "Is he dead?" = NO
   - "Not a villain" → "Is he villain?" = NO
   - "Human" → "Is he a demon?" = NO (only if data says "not demon")

IDK → ONLY when topic is NOT mentioned ANYWHERE
   - Not in main text, not in brackets, not in nested fields
   - If data says "Unknown" → IDK for that topic
   - If question asks about something never mentioned → IDK

MAYBE → TWO situations ONLY:
   1. IDENTITY REVEAL QUESTIONS → "Is it Naruto?" = MAYBE
   2. NAME QUESTIONS → "Is his name Goku?" = MAYBE
   NEVER say Yes or No to name questions. ALWAYS Maybe.

===== IDENTITY PROTECTION (CRITICAL) =====

- ANY question with a name → ALWAYS "Maybe"
  Examples: "Is it Naruto?" "Is he Aizen?" "Is his name Goku?" "Is this character Luffy?" → ALL = Maybe

- ANY question trying to confirm identity → ALWAYS "Maybe"
  Examples: "Is this the main character?" "Is he the protagonist?" "Is he from Naruto?" → These are SAFE (answer normally). Only name-based questions get Maybe.

- PROTECT THE NAME AT ALL COSTS. Even if user says "Is it the guy who..." → read the description, answer the question, but NEVER say "Yes" to "Is it [name]?".

===== DEEP READING EXAMPLES =====

Data: "He is a Human (Jinchuriki) from Konoha. Has blonde hair and blue eyes."
Question: "Is he human?" → YES (matches Human)
Question: "Is he a jinchuriki?" → YES (matches bracket)
Question: "Is he from Konoha?" → YES (matches location)
Question: "Is his hair blonde?" → YES (matches hair)
Question: "Is his hair black?" → IDK (not mentioned)
Question: "Is it Naruto?" → MAYBE (identity protection)

Data: "He is a Shinobi (Ninja) and a member of Akatsuki"
Question: "Is he a ninja?" → YES (bracket match)
Question: "Is he in Akatsuki?" → YES (direct match)
Question: "Is he a samurai?" → IDK (not mentioned)
Question: "Is he a villain?" → IDK (not mentioned in data)

Data: "Human (Quincy) and Hollow"
Question: "Is he human?" → YES
Question: "Is he a Quincy?" → YES
Question: "Is he Hollow?" → YES
Question: "Is he a soul reaper?" → IDK (not mentioned)
Question: "Is he a soul?" → IDK (not mentioned)

Data: "Hair: Black (sometimes red in special form)"
Question: "Is his hair black?" → YES
Question: "Is his hair red?" → YES (mentioned in brackets)
Question: "Is his hair white?" → IDK (not mentioned)

===== FINAL REMINDERS =====

- If ANY part of data mentions the topic → YES
- If topic appears ANYWHERE (including brackets) → YES
- If topic has multiple values → YES for each mentioned value
- If topic has synonyms → YES (villain=antagonist=evil)
- If data has "Unknown" → IDK for that topic only
- If question asks name → ALWAYS MAYBE
- NEVER say the character's name. EVER.
- ONE WORD ONLY: Yes, No, Maybe, or IDK

YOU WILL BE TESTED. ANY MISTAKE = GAME OVER. THINK. READ EVERYTHING. PROTECT IDENTITY. ANSWER ACCURATELY.`;

    const messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: context }
    ];

    let answer = "IDK";
    let usedProvider = 'none';

    try {
      const result = await askAI(messages);
      answer = result.answer || 'IDK';
      usedProvider = result.provider || 'none';
    } catch (error) {
      return res.status(503).json({
        success: false,
        message: 'AI service temporarily unavailable. Please try again.'
      });
    }

    // ✅ FORCE PARSE ANSWER (FIXED: Removed local smart matching override)
    let finalAnswer = 'IDK';
    const lowerAnswer = answer.toLowerCase().trim();

    // ✅ CHECK IF IDENTITY REVEAL QUESTION (SECURITY LAYER 1)
    if (isIdentityRevealQuestion(sanitizedQuestion)) {
      finalAnswer = 'IDK';
    } else {
      // ✅ TRUST THE AI (The AI has full context and is smarter than local keyword matching)
      if (lowerAnswer === 'yes' || lowerAnswer.includes('yes')) {
        finalAnswer = 'Yes';
      } 
      else if (lowerAnswer === 'no' || lowerAnswer.includes('no') || lowerAnswer.includes('not') || lowerAnswer.includes('isn\'t') || lowerAnswer.includes('doesn\'t')) {
        finalAnswer = 'No';
      } 
      else if (lowerAnswer === 'maybe' || lowerAnswer.includes('maybe')) {
        finalAnswer = 'Maybe';
      } 
      else if (lowerAnswer === 'idk' || lowerAnswer.includes('dont know') || lowerAnswer.includes("don't know") || lowerAnswer.includes('not sure') || lowerAnswer.includes('unknown')) {
        finalAnswer = 'IDK';
      } 
      else {
        finalAnswer = 'IDK';
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
      
      // ===== REGULAR STATS =====
      user.stats.gamesPlayed += 1;
      user.stats.gamesWon += 1;
      user.stats.winStreak += 1;
      user.totalGuesses += 1;

      // ===== SEASON STATS =====
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

      // ===== ANIME GUESSES =====
      const anime = game.character.anime;
      const currentAnimeGuesses = user.animeGuesses?.get(anime) || 0;
      user.animeGuesses.set(anime, currentAnimeGuesses + 1);

      // ===== SHARDS =====
      user.shards += 10;

      // ===== CARD COLLECTION =====
      const character = game.character;
      const cardAdded = user.addCard(character);
      
      if (cardAdded) {
      } else {
      }

      // ============================================================
      // ✅ SEASON PASS PROGRESS
      // ============================================================
      if (user.seasonPass && user.seasonPass.active) {
        const activeSeason = await SeasonPass.getActiveSeason();
        
        if (activeSeason) {
          // Increment correct guesses
          user.seasonPass.correctGuesses = (user.seasonPass.correctGuesses || 0) + 1;
          
          // Calculate new tier
          const guessesPerTier = activeSeason.correctGuessesPerTier || 2;
          const newTier = Math.floor(user.seasonPass.correctGuesses / guessesPerTier) + 1;
          const finalTier = Math.min(newTier, activeSeason.totalTiers);
          
          const tierAdvanced = finalTier > (user.seasonPass.currentTier || 1);
          
          user.seasonPass.currentTier = finalTier;
          
          // Calculate progress percentage
          const progressInTier = user.seasonPass.correctGuesses % guessesPerTier;
          user.seasonPass.progress = Math.round((progressInTier / guessesPerTier) * 100);
          
          // Check if completed
          if (finalTier >= activeSeason.totalTiers && !user.seasonPass.isCompleted) {
            user.seasonPass.isCompleted = true;
            user.seasonPass.completedAt = new Date();
          }
          
          // Unlock new tiers
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

      // ============================================================
      // REFERRAL REWARDS
      // ============================================================
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

      // ============================================================
      // ACHIEVEMENTS
      // ============================================================
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

    if (game.user.toString() !== req.user._id.toString()) {
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