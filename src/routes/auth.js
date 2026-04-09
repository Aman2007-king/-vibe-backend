const router   = require('express').Router();
const { body, validationResult } = require('express-validator');
const bcrypt   = require('bcryptjs');
const admin    = require('firebase-admin');
const supabase = require('../db/supabase');
const { generateToken } = require('../middleware/auth');
const { upload, handleAvatarUpload } = require('../middleware/upload');
const { formatUser } = require('../utils/helpers');

// ── Firebase Admin init (once) ─────────────────────────
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId:   process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey:  (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    }),
  });
}

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(422).json({ success: false, message: errors.array()[0].msg });
  next();
};

// ── GOOGLE SIGN IN ─────────────────────────────────────
router.post('/google', async (req, res) => {
  try {
    const { idToken } = req.body;
    if (!idToken) return res.status(400).json({ success: false, message: 'ID token required.' });

    const decoded = await admin.auth().verifyIdToken(idToken);
    const { uid, email, name, picture } = decoded;

    // Look up by firebase_uid first
    let { data: user } = await supabase
      .from('users')
      .select('*')
      .eq('firebase_uid', uid)
      .maybeSingle();

    // Fall back to email match (link existing account)
    if (!user && email) {
      const { data: byEmail } = await supabase
        .from('users')
        .select('*')
        .eq('email', email.toLowerCase())
        .maybeSingle();

      if (byEmail) {
        // Link firebase uid to existing account
        const { data: updated } = await supabase
          .from('users')
          .update({ firebase_uid: uid, avatar: byEmail.avatar || picture || '' })
          .eq('id', byEmail.id)
          .select('*')
          .single();
        user = updated;
      }
    }

    if (!user) {
      // Create brand-new account from Google profile
      let base = (email ? email.split('@')[0] : name || 'user')
        .replace(/[^a-zA-Z0-9._]/g, '')
        .toLowerCase()
        .slice(0, 25) || 'user';

      // Unique username
      let username = base;
      let counter  = 1;
      while (true) {
        const { data: exists } = await supabase.from('users').select('id').eq('username', username).maybeSingle();
        if (!exists) break;
        username = `${base}${counter++}`;
      }

      const { data: created, error: createErr } = await supabase
        .from('users')
        .insert({
          firebase_uid: uid,
          username,
          email:        email?.toLowerCase() || `${uid}@google.auth`,
          full_name:    name || username,
          avatar:       picture || '',
          verified:     false,
          is_active:    true,
          is_private:   false,
          followers_count: 0,
          following_count: 0,
          posts_count:     0,
        })
        .select('*')
        .single();

      if (createErr) throw createErr;
      user = created;
    }

    // Update last seen
    await supabase.from('users').update({ last_seen: new Date().toISOString() }).eq('id', user.id);

    const token = generateToken(user.id);
    res.json({ success: true, message: `Welcome, ${(user.full_name || user.username).split(' ')[0]}!`, token, user: formatUser(user) });
  } catch (err) {
    console.error('Google auth error:', err.message);
    res.status(401).json({ success: false, message: 'Google sign-in failed. Please try again.' });
  }
});

// ── REGISTER ───────────────────────────────────────────
router.post('/register',
  upload.single('avatar'), handleAvatarUpload,
  [
    body('username').trim().isLength({ min: 3, max: 30 }).matches(/^[a-zA-Z0-9._]+$/).withMessage('Username: 3-30 chars, letters/numbers/._'),
    body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
    body('password').isLength({ min: 6 }).withMessage('Password must be 6+ characters'),
    body('fullName').trim().isLength({ min: 1, max: 60 }).withMessage('Full name required'),
  ],
  validate,
  async (req, res) => {
    try {
      const { username, email, password, fullName, phone } = req.body;
      const u = username.toLowerCase().trim();
      const e = email.toLowerCase().trim();

      // Check uniqueness
      const { data: existing } = await supabase
        .from('users')
        .select('id, username, email')
        .or(`username.eq.${u},email.eq.${e}`);

      if (existing?.length) {
        const clash = existing[0];
        return res.status(409).json({
          success: false,
          message: clash.username === u ? 'Username already taken.' : 'Email already registered.',
        });
      }

      const hashed = await bcrypt.hash(password, 12);

      const { data: user, error } = await supabase
        .from('users')
        .insert({
          username:  u,
          email:     e,
          password:  hashed,
          full_name: fullName.trim(),
          phone:     phone || '',
          avatar:    req.avatarUrl || '',
          is_active: true,
          is_private: false,
          followers_count: 0,
          following_count: 0,
          posts_count: 0,
        })
        .select('*')
        .single();

      if (error) throw error;

      const token = generateToken(user.id);
      res.status(201).json({ success: true, message: 'Welcome to Vibe!', token, user: formatUser(user) });
    } catch (err) {
      console.error('Register error:', err);
      res.status(500).json({ success: false, message: 'Registration failed. Please try again.' });
    }
  }
);

// ── LOGIN ──────────────────────────────────────────────
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
      const field   = isEmail ? 'email' : 'username';

      const { data: user } = await supabase
        .from('users')
        .select('*')
        .eq(field, identifier.toLowerCase().trim())
        .maybeSingle();

      if (!user) return res.status(401).json({ success: false, message: 'Incorrect username or password.' });

      if (!user.password) {
        return res.status(401).json({ success: false, message: 'This account uses Google sign-in. Use the Google button.' });
      }

      const match = await bcrypt.compare(password, user.password);
      if (!match) return res.status(401).json({ success: false, message: 'Incorrect username or password.' });
      if (!user.is_active) return res.status(403).json({ success: false, message: 'Account deactivated.' });

      await supabase.from('users').update({ last_seen: new Date().toISOString() }).eq('id', user.id);

      const token = generateToken(user.id);
      res.json({
        success: true,
        message: `Welcome back, ${(user.full_name || user.username).split(' ')[0]}!`,
        token,
        user: formatUser(user),
      });
    } catch (err) {
      console.error('Login error:', err);
      res.status(500).json({ success: false, message: 'Login failed. Please try again.' });
    }
  }
);

// ── GET ME ─────────────────────────────────────────────
router.get('/me', require('../middleware/auth').protect, async (req, res) => {
  try {
    await supabase.from('users').update({ last_seen: new Date().toISOString() }).eq('id', req.user.id);
    res.json({ success: true, user: formatUser(req.user) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── LOGOUT ─────────────────────────────────────────────
router.post('/logout', require('../middleware/auth').protect, async (req, res) => {
  await supabase.from('users').update({ last_seen: new Date().toISOString() }).eq('id', req.user.id);
  res.json({ success: true, message: 'Logged out successfully.' });
});

// ── CHECK USERNAME ─────────────────────────────────────
router.get('/check-username/:username', async (req, res) => {
  try {
    const u = req.params.username.toLowerCase().trim();
    if (u.length < 3 || !/^[a-zA-Z0-9._]+$/.test(u)) {
      return res.json({ success: true, available: false, message: 'Invalid format' });
    }
    const { data } = await supabase.from('users').select('id').eq('username', u).maybeSingle();
    res.json({ success: true, available: !data, message: data ? 'Username taken' : 'Username available!' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
