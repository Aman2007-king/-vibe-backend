const router = require('express').Router();
const { body, validationResult } = require('express-validator');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const admin = require('firebase-admin');
const supabase = require('../db/supabase');

// Init Firebase Admin once (in server.js, but shown here for clarity)
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  });
}

const genToken = (id) => jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '30d' });

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(422).json({ success: false, message: errors.array()[0].msg });
  next();
};

// ── GOOGLE AUTH (Firebase) ─────────────────────────────────
// Frontend sends the Firebase ID token → backend verifies → creates/finds user
router.post('/google', async (req, res) => {
  try {
    const { idToken } = req.body;
    if (!idToken) return res.status(400).json({ success: false, message: 'ID token required' });

    // Verify Firebase token
    const decoded = await admin.auth().verifyIdToken(idToken);
    const { uid, email, name, picture } = decoded;

    // Check if user exists
    let { data: user } = await supabase
      .from('users')
      .select('*')
      .eq('firebase_uid', uid)
      .single();

    if (!user) {
      // Auto-create user on first Google login
      const baseUsername = (email.split('@')[0]).replace(/[^a-zA-Z0-9._]/g, '').toLowerCase();
      let username = baseUsername;
      let suffix = 1;

      // Ensure unique username
      while (true) {
        const { data: existing } = await supabase.from('users').select('id').eq('username', username).single();
        if (!existing) break;
        username = baseUsername + suffix++;
      }

      const { data: newUser, error } = await supabase.from('users').insert({
        firebase_uid: uid,
        email: email.toLowerCase(),
        full_name: name || username,
        username,
        avatar: picture || '',
        verified: false,
      }).select().single();

      if (error) throw error;
      user = newUser;
    }

    const token = genToken(user.id);
    res.json({
      success: true,
      message: 'Welcome, ' + (user.full_name?.split(' ')[0] || user.username) + '!',
      token,
      user: formatUser(user),
    });
  } catch (err) {
    console.error('Google auth error:', err);
    res.status(401).json({ success: false, message: 'Google authentication failed.' });
  }
});

// ── REGISTER (email/password) ─────────────────────────────
router.post('/register',
  [
    body('username').trim().isLength({ min:3, max:30 }).matches(/^[a-zA-Z0-9._]+$/),
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min:6 }),
    body('fullName').trim().isLength({ min:1, max:60 }),
  ],
  validate,
  async (req, res) => {
    try {
      const { username, email, password, fullName, phone } = req.body;

      // Check uniqueness
      const { data: existing } = await supabase.from('users')
        .select('id, username, email')
        .or(`username.eq.${username.toLowerCase()},email.eq.${email.toLowerCase()}`);

      if (existing?.length) {
        const taken = existing[0];
        if (taken.username === username.toLowerCase()) return res.status(409).json({ success:false, message:'Username already taken.' });
        return res.status(409).json({ success:false, message:'Email already registered.' });
      }

      const hashed = await bcrypt.hash(password, 12);
      const { data: user, error } = await supabase.from('users').insert({
        username: username.toLowerCase().trim(),
        email: email.toLowerCase().trim(),
        password: hashed,
        full_name: fullName.trim(),
        phone: phone || '',
      }).select().single();

      if (error) throw error;

      const token = genToken(user.id);
      res.status(201).json({ success:true, message:'Welcome to Vibe!', token, user: formatUser(user) });
    } catch (err) {
      console.error('Register error:', err);
      res.status(500).json({ success:false, message:'Registration failed.' });
    }
  }
);

// ── LOGIN ─────────────────────────────────────────────────
router.post('/login',
  [body('identifier').trim().notEmpty(), body('password').notEmpty()],
  validate,
  async (req, res) => {
    try {
      const { identifier, password } = req.body;
      const isEmail = identifier.includes('@');

      const { data: user } = await supabase.from('users')
        .select('*')
        .eq(isEmail ? 'email' : 'username', identifier.toLowerCase().trim())
        .single();

      if (!user || !user.password) return res.status(401).json({ success:false, message:'Incorrect username or password.' });
      if (!await bcrypt.compare(password, user.password)) return res.status(401).json({ success:false, message:'Incorrect username or password.' });
      if (!user.is_active) return res.status(403).json({ success:false, message:'Account deactivated.' });

      await supabase.from('users').update({ last_seen: new Date() }).eq('id', user.id);
      const token = genToken(user.id);
      res.json({ success:true, message:'Welcome back, ' + user.full_name.split(' ')[0] + '!', token, user: formatUser(user) });
    } catch (err) {
      res.status(500).json({ success:false, message:'Login failed.' });
    }
  }
);
const admin = require('firebase-admin');

// Init Firebase Admin (only once)
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId:   process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  });
}

// ── GOOGLE AUTH ──────────────────────────────────────────────
router.post('/google', async (req, res) => {
  try {
    const { idToken } = req.body;
    if (!idToken) return res.status(400).json({ success: false, message: 'ID token required' });

    // Verify the Firebase token
    const decoded = await admin.auth().verifyIdToken(idToken);
    const { uid, email, name, picture } = decoded;

    // Check if user already exists
    let user = await User.findOne({ firebaseUid: uid });

    if (!user) {
      // Also check by email (in case they registered with email before)
      user = await User.findOne({ email: email?.toLowerCase() });

      if (user) {
        // Link existing account to Google
        user.firebaseUid = uid;
        if (!user.avatar && picture) user.avatar = picture;
        await user.save({ validateBeforeSave: false });
      } else {
        // Brand new user — create account automatically
        let baseUsername = (email.split('@')[0])
          .replace(/[^a-zA-Z0-9._]/g, '')
          .toLowerCase()
          .slice(0, 25);
        if (!baseUsername) baseUsername = 'user';

        // Make username unique
        let username = baseUsername;
        let counter = 1;
        while (await User.findOne({ username })) {
          username = baseUsername + counter++;
        }

        user = await User.create({
          firebaseUid: uid,
          username,
          email:    email?.toLowerCase() || '',
          password: Math.random().toString(36) + Math.random().toString(36), // random, never used
          fullName: name || username,
          avatar:   picture || '',
          verified: false,
        });
      }
    }

    // Update last seen
    user.lastSeen = new Date();
    await user.save({ validateBeforeSave: false });

    const token = generateToken(user._id);
    res.json({
      success: true,
      message: 'Welcome, ' + (user.fullName?.split(' ')[0] || user.username) + '!',
      token,
      user: {
        id:             user._id,
        username:       user.username,
        fullName:       user.fullName,
        email:          user.email,
        avatar:         user.avatarUrl || picture || '',
        bio:            user.bio || '',
        verified:       user.verified,
        followersCount: user.followersCount || 0,
        followingCount: user.followingCount || 0,
        postsCount:     user.postsCount || 0,
      }
    });

  } catch (err) {
    console.error('Google auth error:', err.message);
    if (err.code === 'auth/argument-error' || err.code === 'auth/invalid-id-token') {
      return res.status(401).json({ success: false, message: 'Invalid Google token. Please try again.' });
    }
    res.status(500).json({ success: false, message: 'Google sign-in failed: ' + err.message });
  }
});
// ── GET ME ────────────────────────────────────────────────
router.get('/me', require('../middleware/auth').protect, async (req, res) => {
  const { data: user } = await supabase.from('users').select('*').eq('id', req.user.id).single();
  if (!user) return res.status(404).json({ success:false, message:'User not found.' });
  res.json({ success:true, user: formatUser(user) });
});

router.post('/logout', require('../middleware/auth').protect, async (req, res) => {
  await supabase.from('users').update({ last_seen: new Date() }).eq('id', req.user.id);
  res.json({ success:true, message:'Logged out successfully.' });
});

function formatUser(u) {
  return {
    id: u.id, username: u.username, fullName: u.full_name,
    email: u.email, avatar: u.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(u.full_name)}&background=random`,
    bio: u.bio || '', website: u.website || '', location: u.location || '',
    verified: u.verified, isPrivate: u.is_private,
    followersCount: u.followers_count, followingCount: u.following_count, postsCount: u.posts_count,
  };
}

module.exports = router;
