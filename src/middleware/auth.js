const jwt = require('jsonwebtoken');
const User = require('../models/User');

const protect = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.startsWith('Bearer ') 
      ? req.headers.authorization.split(' ')[1] 
      : null;
      
    if (!token) {
      return res.status(401).json({ 
        success: false, 
        message: 'Not authenticated. Please log in.' 
      });
    }
    
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select('-password');
    
    if (!user) {
      return res.status(401).json({ 
        success: false, 
        message: 'User no longer exists.' 
      });
    }
    
    if (!user.isActive) {
      return res.status(401).json({ 
        success: false, 
        message: 'Account is deactivated.' 
      });
    }
    
    req.user = user;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ 
        success: false, 
        message: 'Token expired. Please log in again.' 
      });
    }
    return res.status(401).json({ 
      success: false, 
      message: 'Invalid token.' 
    });
  }
};

const optionalAuth = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.startsWith('Bearer ') 
      ? req.headers.authorization.split(' ')[1] 
      : null;
      
    if (token) {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = await User.findById(decoded.id).select('-password');
    }
  } catch (_) {
    // Ignore invalid tokens for optional auth
  }
  next();
};

const generateToken = (userId) => 
  jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: '30d' });

// Add 2FA routes
router.post('/2fa/setup', protect, async (req, res) => {
  try {
    const secret = await setupTwoFactor(req.user._id);
    const qrCodeUrl = secret.otpauth_url;
    
    res.json({
      success: true,
      qrCodeUrl,
      secret: secret.base32
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to setup 2FA' });
  }
});

router.post('/2fa/enable', protect, async (req, res) => {
  try {
    const { token } = req.body;
    const user = await User.findById(req.user._id).select('+twoFactorSecret');
    
    if (!user.twoFactorSecret) {
      return res.status(400).json({ success: false, message: '2FA not setup' });
    }
    
    const verified = verifyTwoFactor(user.twoFactorSecret, token);
    if (!verified) {
      return res.status(400).json({ success: false, message: 'Invalid token' });
    }
    
    const backupCodes = generateBackupCodes();
    await User.findByIdAndUpdate(req.user._id, {
      twoFactorEnabled: true,
      backupCodes: backupCodes.map(code => 
        require('bcryptjs').hashSync(code, 12)
      )
    });
    
    res.json({
      success: true,
      message: '2FA enabled successfully',
      backupCodes
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to enable 2FA' });
  }
});

router.post('/2fa/login', async (req, res) => {
  try {
    const { identifier, password, twoFactorToken } = req.body;
    
    // Standard login verification first
    const isEmail = identifier.includes('@');
    const user = await User.findOne(
      isEmail ? { email: identifier.toLowerCase() } : { username: identifier.toLowerCase() }
    ).select('+password +twoFactorEnabled +twoFactorSecret');
    
    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ success: false, message: 'Incorrect credentials' });
    }
    
    // If 2FA is enabled, verify token
    if (user.twoFactorEnabled) {
      if (!twoFactorToken) {
        return res.status(400).json({ 
          success: false, 
          message: '2FA token required',
          requires2FA: true 
        });
      }
      
      const verified = verifyTwoFactor(user.twoFactorSecret, twoFactorToken);
      if (!verified) {
        return res.status(400).json({ success: false, message: 'Invalid 2FA token' });
      }
    }
    
    // Create session
    const sessionId = await createSession(user._id, req);
    const token = generateToken(user._id);
    
    res.json({
      success: true,
      token,
      sessionId,
      user: user.toPublicJSON()
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Login failed' });
  }
});

// Session Management Routes
router.get('/sessions', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('loginSessions');
    res.json({ success: true, sessions: user.loginSessions });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch sessions' });
  }
});

router.delete('/sessions/:sessionId', protect, async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.user._id, {
      $pull: { loginSessions: { sessionId: req.params.sessionId } }
    });
    res.json({ success: true, message: 'Session terminated' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to terminate session' });
  }
});
