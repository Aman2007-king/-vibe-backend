const router = require('express').Router();
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const { protect, generateToken } = require('../middleware/auth');
const { upload, handleAvatarUpload } = require('../middleware/upload');

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(422).json({ success: false, errors: errors.array() });
  next();
};

// ═══════════════════════════════════════════════════
// REGISTRATION (UNTOUCHED)
// ═══════════════════════════════════════════════════
router.post('/register',
  upload.single('avatar'), handleAvatarUpload,
  [body('username').trim().isLength({ min:3, max:30 }).matches(/^[a-zA-Z0-9._]+$/), body('email').isEmail().normalizeEmail(), body('password').isLength({ min:6 }), body('fullName').trim().isLength({ min:1, max:60 })],
  validate,
  async (req, res) => {
    try {
      const { username, email, password, fullName, phone } = req.body;
      const [eu, ee] = await Promise.all([
        User.findOne({ username: username.toLowerCase() }), 
        User.findOne({ email: email.toLowerCase() })
      ]);
      if (eu) return res.status(409).json({ success: false, message: 'Username already taken.' });
      if (ee) return res.status(409).json({ success: false, message: 'Email already registered.' });
      
      const user = await User.create({ 
        username: username.toLowerCase(), 
        email: email.toLowerCase(), 
        password, 
        fullName, 
        phone, 
        avatar: req.avatarFilename || '' 
      });
      
      const token = generateToken(user._id);
      res.status(201).json({ 
        success: true, 
        message: 'Account created!', 
        token, 
        user: { id: user._id, username: user.username, fullName: user.fullName, email: user.email, avatar: user.avatarUrl, verified: user.verified } 
      });
    } catch (err) { console.error(err); res.status(500).json({ success: false, message: 'Registration failed.' }); }
  }
);

// ═══════════════════════════════════════════════════
// LOGIN (UPDATED FOR 2FA & SESSIONS ONLY)
// ═══════════════════════════════════════════════════
router.post('/login',
  [body('identifier').trim().notEmpty(), body('password').notEmpty()],
  validate,
  async (req, res) => {
    try {
      const { identifier, password, twoFactorToken } = req.body;
      const isEmail = identifier.includes('@');
      const user = await User.findOne(isEmail ? { email: identifier.toLowerCase() } : { username: identifier.toLowerCase() }).select('+password +twoFactorEnabled +twoFactorSecret');
      
      if (!user || !(await user.comparePassword(password))) return res.status(401).json({ success: false, message: 'Incorrect username or password.' });
      if (!user.isActive) return res.status(403).json({ success: false, message: 'Account deactivated.' });

      // 2FA Security Check
      if (user.twoFactorEnabled) {
        if (!twoFactorToken) return res.status(400).json({ success: false, message: '2FA token required', requires2FA: true });
        const verified = speakeasy.totp.verify({ secret: user.twoFactorSecret, encoding: 'base32', token: twoFactorToken });
        if (!verified) return res.status(400).json({ success: false, message: 'Invalid 2FA token' });
      }

      // Session Management Track
      const newSession = {
        sessionId: Math.random().toString(36).substring(7),
        device: req.headers['user-agent'] || 'Unknown Device',
        ip: req.ip,
        lastActive: new Date()
      };
      await User.findByIdAndUpdate(user._id, { $push: { loginSessions: newSession } });

      user.lastSeen = new Date();
      await user.save({ validateBeforeSave: false });
      const token = generateToken(user._id);
      
      res.json({ 
        success: true, 
        message: 'Login successful!', 
        token, 
        user: { id: user._id, username: user.username, fullName: user.fullName, email: user.email, avatar: user.avatarUrl, verified: user.verified, bio: user.bio, followersCount: user.followersCount, followingCount: user.followingCount, postsCount: user.postsCount } 
      });
    } catch (err) { console.error(err); res.status(500).json({ success: false, message: 'Login failed.' }); }
  }
);

// ═══════════════════════════════════════════════════
// CORE UTILITIES (UNTOUCHED)
// ═══════════════════════════════════════════════════
router.get('/me', protect, async (req, res) => {
  const user = await User.findById(req.user._id);
  res.json({ success: true, user: user.toPublicJSON() });
});

router.post('/logout', protect, async (req, res) => {
  await User.findByIdAndUpdate(req.user._id, { lastSeen: new Date() });
  res.json({ success: true, message: 'Logged out.' });
});

router.get('/check-username/:username', async (req, res) => {
  const exists = await User.findOne({ username: req.params.username.toLowerCase() });
  res.json({ success: true, available: !exists });
});

// ═══════════════════════════════════════════════════
// NEW ADVANCED SECURITY FEATURES
// ═══════════════════════════════════════════════════
router.post('/2fa/setup', protect, async (req, res) => {
  try {
    const secret = speakeasy.generateSecret({ name: `Vibe (${req.user.email})` });
    await User.findByIdAndUpdate(req.user._id, { tempTwoFactorSecret: secret.base32 });
    const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url);
    res.json({ success: true, qrCodeUrl, secret: secret.base32 });
  } catch (err) { res.status(500).json({ success: false, message: 'Failed to setup 2FA' }); }
});

router.post('/2fa/enable', protect, async (req, res) => {
  try {
    const { token } = req.body;
    const user = await User.findById(req.user._id).select('+tempTwoFactorSecret');
    if (!user.tempTwoFactorSecret) return res.status(400).json({ success: false, message: '2FA not setup' });
    const verified = speakeasy.totp.verify({ secret: user.tempTwoFactorSecret, encoding: 'base32', token });
    if (!verified) return res.status(400).json({ success: false, message: 'Invalid token' });
    await User.findByIdAndUpdate(req.user._id, { twoFactorEnabled: true, twoFactorSecret: user.tempTwoFactorSecret, tempTwoFactorSecret: undefined });
    res.json({ success: true, message: '2FA enabled successfully' });
  } catch (err) { res.status(500).json({ success: false, message: 'Failed to enable 2FA' }); }
});

router.get('/sessions', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('loginSessions');
    res.json({ success: true, sessions: user.loginSessions || [] });
  } catch (err) { res.status(500).json({ success: false, message: 'Failed to fetch sessions' }); }
});

router.delete('/sessions/:sessionId', protect, async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.user._id, { $pull: { loginSessions: { sessionId: req.params.sessionId } } });
    res.json({ success: true, message: 'Session terminated' });
  } catch (err) { res.status(500).json({ success: false, message: 'Failed to terminate session' }); }
});

// ═══════════════════════════════════════════════════
// COMPLETE DEMO SEEDING LOGIC (RESTORED AS REQUESTED)
// ═══════════════════════════════════════════════════
router.post('/seed-demo', async (req, res) => {
  try {
    const Post = require('../models/Post');
    const { Comment, Group } = require('../models/index');
    const existingCount = await User.countDocuments();
    if (existingCount > 0) return res.json({ success: true, message: `Already seeded!`, alreadySeeded: true });

    const AVATARS = ['https://i.pravatar.cc/150?img=1','https://i.pravatar.cc/150?img=5'];
    const IMGS = ['https://picsum.photos/seed/p1/600/600','https://picsum.photos/seed/p2/600/600'];
    const DEMO_USERS = [
      { username: 'alex.travels', fullName: 'Alex Johnson', email: 'alex@vibe.app', password: 'password123', bio: '📸 Photographer', verified: true },
      { username: 'demo', fullName: 'Demo User', email: 'demo@vibe.app', password: 'demo', bio: 'Testing Vibe! 👋', verified: false }
    ];

    const hashedUsers = await Promise.all(DEMO_USERS.map(async (u, i) => ({
      ...u,
      password: await bcrypt.hash(u.password, 12),
      avatar: AVATARS[i % AVATARS.length],
      postsCount: 10, followersCount: 100, followingCount: 50,
    })));
    const users = await User.insertMany(hashedUsers);

    const posts = [];
    for (let i = 0; i < 5; i++) {
      posts.push({
        user: users[0]._id, type: 'post',
        media: [{ url: IMGS[i % IMGS.length], type: 'image', width: 600, height: 600 }],
        caption: 'Vibe check! #travel',
        likesCount: 50, commentsCount: 5, createdAt: new Date()
      });
    }
    await Post.insertMany(posts);

    res.json({ success: true, message: '🎉 Demo data seeded!', data: { users: users.length, posts: posts.length } });
  } catch (err) { console.error('Seed error:', err); res.status(500).json({ success: false, message: err.message }); }
});

module.exports = router;
