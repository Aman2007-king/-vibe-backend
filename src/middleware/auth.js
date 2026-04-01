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

  const speakeasy = require('speakeasy');
const nodemailer = require('nodemailer');

// Session Management
const createSession = async (userId, req) => {
  const session = {
    sessionId: require('crypto').randomBytes(32).toString('hex'),
    userAgent: req.get('User-Agent') || '',
    ip: req.ip,
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days
  };
  
  await User.findByIdAndUpdate(userId, {
    $push: { loginSessions: session }
  });
  
  return session.sessionId;
};

// Enhanced 2FA Setup
const setupTwoFactor = async (userId) => {
  const secret = speakeasy.generateSecret({
    name: `Vibe:${userId}`,
    issuer: 'Vibe Social'
  });
  
  await User.findByIdAndUpdate(userId, {
    twoFactorSecret: secret.base32
  });
  
  return secret;
};

// Verify 2FA Token
const verifyTwoFactor = (secret, token) => {
  return speakeasy.totp.verify({
    secret: secret,
    encoding: 'base32',
    token: token,
    window: 2
  });
};

// Generate Backup Codes
const generateBackupCodes = () => {
  return Array.from({ length: 10 }, () => 
    require('crypto').randomBytes(4).toString('hex')
  );
};

module.exports = {
  protect,
  optionalAuth,
  generateToken,
  createSession,
  setupTwoFactor,
  verifyTwoFactor,
  generateBackupCodes
};


 
