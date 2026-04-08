VIBE BACKEND — UPGRADED FOR REAL PLATFORM
==========================================
Replace these files in your Glitch project.
All other files (package.json, server.js, socket, models, middleware) stay the same.
Only replace: src/routes/auth.js  AND  src/utils/seed.js  (add seed endpoint to auth)


=== src/routes/auth.js ===
(REPLACE ENTIRE FILE)

const router = require('express').Router();
const { body, validationResult } = require('express-validator');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Post = require('../models/Post');
const { Comment, Group } = require('../models/index');
const { protect, generateToken } = require('../middleware/auth');
const { upload, handleAvatarUpload } = require('../middleware/upload');

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(422).json({ success: false, message: errors.array()[0].msg });
  next();
};

// ── REGISTER ──────────────────────────────────────────────────
router.post('/register',
  upload.single('avatar'), handleAvatarUpload,
  [
    body('username').trim().isLength({ min:3, max:30 }).withMessage('Username must be 3-30 chars').matches(/^[a-zA-Z0-9._]+$/).withMessage('Username: letters, numbers, _ . only'),
    body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
    body('password').isLength({ min:6 }).withMessage('Password must be 6+ characters'),
    body('fullName').trim().isLength({ min:1, max:60 }).withMessage('Full name required'),
  ],
  validate,
  async (req, res) => {
    try {
      const { username, email, password, fullName, phone } = req.body;
      const [eu, ee] = await Promise.all([
        User.findOne({ username: username.toLowerCase().trim() }),
        User.findOne({ email: email.toLowerCase().trim() })
      ]);
      if (eu) return res.status(409).json({ success: false, message: 'Username already taken. Try another.' });
      if (ee) return res.status(409).json({ success: false, message: 'Email already registered. Try logging in.' });
      const user = await User.create({
        username: username.toLowerCase().trim(),
        email: email.toLowerCase().trim(),
        password,
        fullName: fullName.trim(),
        phone: phone || '',
        avatar: req.avatarFilename || ''
      });
      const token = generateToken(user._id);
      res.status(201).json({
        success: true,
        message: 'Welcome to Vibe!',
        token,
        user: {
          id: user._id,
          username: user.username,
          fullName: user.fullName,
          email: user.email,
          avatar: user.avatarUrl,
          bio: user.bio || '',
          verified: user.verified,
          followersCount: 0,
          followingCount: 0,
          postsCount: 0
        }
      });
    } catch (err) {
      console.error('Register error:', err);
      if (err.code === 11000) {
        const field = Object.keys(err.keyPattern || {})[0] || 'field';
        return res.status(409).json({ success: false, message: field + ' already exists.' });
      }
      res.status(500).json({ success: false, message: 'Registration failed. Please try again.' });
    }
  }
);

// ── LOGIN ─────────────────────────────────────────────────────
router.post('/login',
  [
    body('identifier').trim().notEmpty().withMessage('Username or email required'),
    body('password').notEmpty().withMessage('Password required'),
  ],
  validate,
  async (req, res) => {
    try {
      const { identifier, password } = req.body;
      const isEmail = identifier.includes('@');
      const user = await User.findOne(
        isEmail ? { email: identifier.toLowerCase().trim() } : { username: identifier.toLowerCase().trim() }
      ).select('+password');
      if (!user || !(await user.comparePassword(password))) {
        return res.status(401).json({ success: false, message: 'Incorrect username or password.' });
      }
      if (!user.isActive) return res.status(403).json({ success: false, message: 'Account deactivated.' });
      user.lastSeen = new Date();
      await user.save({ validateBeforeSave: false });
      const token = generateToken(user._id);
      res.json({
        success: true,
        message: 'Welcome back, ' + user.fullName.split(' ')[0] + '!',
        token,
        user: {
          id: user._id,
          username: user.username,
          fullName: user.fullName,
          email: user.email,
          avatar: user.avatarUrl,
          bio: user.bio || '',
          website: user.website || '',
          location: user.location || '',
          verified: user.verified,
          isPrivate: user.isPrivate,
          followersCount: user.followersCount,
          followingCount: user.followingCount,
          postsCount: user.postsCount
        }
      });
    } catch (err) {
      console.error('Login error:', err);
      res.status(500).json({ success: false, message: 'Login failed. Please try again.' });
    }
  }
);

// ── GET ME ────────────────────────────────────────────────────
router.get('/me', protect, async (req, res) => {
  const user = await User.findById(req.user._id);
  if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
  user.lastSeen = new Date();
  await user.save({ validateBeforeSave: false });
  res.json({ success: true, user: user.toPublicJSON(user._id) });
});

// ── LOGOUT ────────────────────────────────────────────────────
router.post('/logout', protect, async (req, res) => {
  await User.findByIdAndUpdate(req.user._id, { lastSeen: new Date() });
  res.json({ success: true, message: 'Logged out successfully.' });
});

// ── CHECK USERNAME ────────────────────────────────────────────
router.get('/check-username/:username', async (req, res) => {
  const u = req.params.username.toLowerCase().trim();
  if (u.length < 3 || !/^[a-zA-Z0-9._]+$/.test(u)) return res.json({ success: true, available: false, message: 'Invalid format' });
  const exists = await User.findOne({ username: u });
  res.json({ success: true, available: !exists, message: exists ? 'Username taken' : 'Username available!' });
});

// ── SEED DEMO DATA ────────────────────────────────────────────
// Call POST /api/auth/seed-demo once to populate your database
router.post('/seed-demo', async (req, res) => {
  try {
    const count = await User.countDocuments();
    if (count > 0) {
      return res.json({ success: true, alreadySeeded: true, message: 'Database already has ' + count + ' users.' });
    }

    const AVATARS = [
      'https://i.pravatar.cc/150?img=1',
      'https://i.pravatar.cc/150?img=5',
      'https://i.pravatar.cc/150?img=3',
      'https://i.pravatar.cc/150?img=9',
      'https://i.pravatar.cc/150?img=7',
      'https://i.pravatar.cc/150?img=10',
      'https://i.pravatar.cc/150?img=8',
    ];
    const IMGS = [
      'https://picsum.photos/seed/p1/600/600',
      'https://picsum.photos/seed/p2/600/600',
      'https://picsum.photos/seed/p3/600/600',
      'https://picsum.photos/seed/p4/600/600',
      'https://picsum.photos/seed/p5/600/600',
      'https://picsum.photos/seed/p6/600/600',
    ];
    const CAPTIONS = [
      'Golden hour never gets old 🌅 #photography #nature',
      'Exploring hidden gems ✈️ #adventure #travel',
      'This view is unreal 😍 #wanderlust',
      'Weekend energy 🎉 #vibes #lifestyle',
      'Making memories that last forever 💫',
      'Chasing sunsets 🌅 #travel',
    ];
    const LOCATIONS = ['Paris 🗼', 'Tokyo 🏯', 'New York 🗽', 'Bali 🌺', 'London 🎡', 'Mumbai 🌊'];

    const DEMO_USERS = [
      { username: 'alex.travels', fullName: 'Alex Johnson',  email: 'alex@vibe.app',  password: 'password123', bio: '📸 Photographer | 🌍 Explorer', verified: true  },
      { username: 'sara_art',     fullName: 'Sara Williams', email: 'sara@vibe.app',  password: 'password123', bio: 'Artist & dreamer 🎨',           verified: false },
      { username: 'mike_lens',    fullName: 'Mike Chen',     email: 'mike@vibe.app',  password: 'password123', bio: 'Street photography 🏙️',         verified: true  },
      { username: 'luna_vibes',   fullName: 'Luna Reyes',    email: 'luna@vibe.app',  password: 'password123', bio: 'Living my best life ✨',          verified: false },
      { username: 'jay_fit',      fullName: 'Jay Kumar',     email: 'jay@vibe.app',   password: 'password123', bio: 'Fitness coach 💪',               verified: true  },
      { username: 'nadia_eats',   fullName: 'Nadia Patel',   email: 'nadia@vibe.app', password: 'password123', bio: 'Food blogger 🍜',               verified: false },
      { username: 'demo',         fullName: 'Demo User',     email: 'demo@vibe.app',  password: 'demo',        bio: 'Testing Vibe! 👋',              verified: false },
    ];

    const hashed = await Promise.all(DEMO_USERS.map(async (u, i) => ({
      ...u,
      password: await bcrypt.hash(u.password, 12),
      avatar: AVATARS[i],
      postsCount:      Math.floor(Math.random() * 200) + 50,
      followersCount:  Math.floor(Math.random() * 10000) + 100,
      followingCount:  Math.floor(Math.random() * 500) + 50,
    })));

    const users = await User.insertMany(hashed);

    // Follow relationships
    for (let i = 0; i < users.length - 1; i++) {
      for (let j = i + 1; j < users.length; j++) {
        if (Math.random() > 0.3) {
          users[i].following.push(users[j]._id);
          users[j].followers.push(users[i]._id);
        }
      }
    }
    await Promise.all(users.map(u => u.save({ validateBeforeSave: false })));

    // Posts
    const posts = [];
    for (let i = 0; i < 40; i++) {
      const user = users[i % (users.length - 1)];
      const isReel = Math.random() > 0.65;
      posts.push({
        user: user._id,
        type: isReel ? 'reel' : 'post',
        media: [{ url: IMGS[i % IMGS.length], type: 'image', width: 600, height: 600 }],
        caption: CAPTIONS[i % CAPTIONS.length],
        location: LOCATIONS[i % LOCATIONS.length],
        tags: ['vibe', 'photography', 'travel'].slice(0, Math.floor(Math.random() * 3) + 1),
        likes: users.slice(0, Math.floor(Math.random() * users.length)).map(u => u._id),
        likesCount:    Math.floor(Math.random() * 3000) + 100,
        commentsCount: Math.floor(Math.random() * 200) + 5,
        savesCount:    Math.floor(Math.random() * 500),
        viewsCount:    isReel ? Math.floor(Math.random() * 100000) + 1000 : 0,
        engagementScore: Math.floor(Math.random() * 5000) + 100,
        audio: isReel ? { title: 'Original Audio', artist: user.username } : undefined,
        createdAt: new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000),
      });
    }
    await Post.insertMany(posts);

    // Groups
    await Group.insertMany([
      { name: 'Photography Lovers', description: 'A community for photography enthusiasts worldwide.', privacy: 'public', category: 'Photography', admin: users[0]._id, members: [users[0]._id, users[1]._id], membersCount: 2 },
      { name: 'Travel & Adventure',  description: 'Share your travel stories and tips.',               privacy: 'public', category: 'Travel',       admin: users[1]._id, members: [users[1]._id, users[2]._id], membersCount: 2 },
      { name: 'Foodies United',      description: 'For people who live to eat great food.',             privacy: 'public', category: 'Food',          admin: users[2]._id, members: [users[2]._id],               membersCount: 1 },
      { name: 'Fitness & Wellness',  description: 'Health, fitness and wellness community.',            privacy: 'public', category: 'Fitness',       admin: users[4]._id, members: [users[4]._id],               membersCount: 1 },
    ]);

    res.json({
      success: true,
      message: '🎉 Demo data seeded successfully!',
      stats: { users: users.length, posts: 40, groups: 4 },
      testLogins: [
        { username: 'demo',         password: 'demo',        note: 'Main demo account' },
        { username: 'alex.travels', password: 'password123', note: 'Verified photographer' },
        { username: 'sara_art',     password: 'password123', note: 'Artist account' },
      ]
    });
  } catch (err) {
    console.error('Seed error:', err);
    res.status(500).json({ success: false, message: 'Seed failed: ' + err.message });
  }
});

module.exports = router;
