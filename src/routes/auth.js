const router = require('express').Router();
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const { protect, generateToken } = require('../middleware/auth');
const { upload, handleAvatarUpload } = require('../middleware/upload');
 
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(422).json({ success: false, errors: errors.array() });
  next();
};
 
router.post('/register',
  upload.single('avatar'), handleAvatarUpload,
  [body('username').trim().isLength({ min:3, max:30 }).matches(/^[a-zA-Z0-9._]+$/), body('email').isEmail().normalizeEmail(), body('password').isLength({ min:6 }), body('fullName').trim().isLength({ min:1, max:60 })],
  validate,
  async (req, res) => {
    try {
      const { username, email, password, fullName, phone } = req.body;
      const [eu, ee] = await Promise.all([User.findOne({ username: username.toLowerCase() }), User.findOne({ email: email.toLowerCase() })]);
      if (eu) return res.status(409).json({ success: false, message: 'Username already taken.' });
if (ee) return res.status(409).json({ success: false, message: 'Email already registered.' });
      const user = await User.create({ username: username.toLowerCase(), email: email.toLowerCase(), password, fullName, phone, avatar: req.avatarFilename || '' });
      const token = generateToken(user._id);
      res.status(201).json({ success: true, message: 'Account created!', token, user: { id: user._id, username: user.username, fullName: user.fullName, email: user.email, avatar: user.avatarUrl, verified: user.verified } });
    } catch (err) { console.error(err); res.status(500).json({ success: false, message: 'Registration failed.' }); }
  }
);
 
router.post('/login',
  [body('identifier').trim().notEmpty(), body('password').notEmpty()],
  validate,
  async (req, res) => {
    try {
      const { identifier, password } = req.body;
      const isEmail = identifier.includes('@');
      const user = await User.findOne(isEmail ? { email: identifier.toLowerCase() } : { username: identifier.toLowerCase() }).select('+password');
      if (!user || !(await user.comparePassword(password))) return res.status(401).json({ success: false, message: 'Incorrect username or password.' });
      if (!user.isActive) return res.status(403).json({ success: false, message: 'Account deactivated.' });
      user.lastSeen = new Date();
      await user.save({ validateBeforeSave: false });
const token = generateToken(user._id);
      res.json({ success: true, message: 'Login successful!', token, user: { id: user._id, username: user.username, fullName: user.fullName, email: user.email, avatar: user.avatarUrl, verified: user.verified, bio: user.bio, followersCount: user.followersCount, followingCount: user.followingCount, postsCount: user.postsCount } });
    } catch (err) { console.error(err); res.status(500).json({ success: false, message: 'Login failed.' }); }
  }
);
 
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
 
module.exports = router;
