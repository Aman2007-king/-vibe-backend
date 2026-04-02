require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const path = require('path');
const rateLimit = require('express-rate-limit');

const { initSocket } = require('./socket/socketManager');
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const postRoutes = require('./routes/posts');
const reelRoutes = require('./routes/reels');
const storyRoutes = require('./routes/stories');
const commentRoutes = require('./routes/comments');
const messageRoutes = require('./routes/messages');
const notifRoutes = require('./routes/notifications');
const searchRoutes = require('./routes/search');
const groupRoutes = require('./routes/groups');
const exploreRoutes = require('./routes/explore');

const logger = require('./utils/logger');

const app = express();
const server = http.createServer(app);

// 1. BASIC MIDDLEWARE (Must come first)
app.use(helmet({ 
  crossOriginResourcePolicy: { policy: 'cross-origin' } 
}));
app.use(cors({ 
  origin: process.env.CLIENT_URL || '*', 
  credentials: true, 
  methods: ['GET','POST','PUT','DELETE','PATCH'] 
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(compression());
app.use(morgan('combined', { stream: { write: (message) => logger.info(message.trim()) } }));

// 2. SOCKET.IO SETUP
const io = new Server(server, {
  cors: { 
    origin: process.env.CLIENT_URL || '*', 
    methods: ['GET','POST'], 
    credentials: true 
  },
  maxHttpBufferSize: 50 * 1024 * 1024,
});
app.set('io', io);

// 3. SECURITY MIDDLEWARE IMPORTS
const { 
  csrfProtection, 
  authLimiter, 
  apiLimiter, 
  advancedXSS 
} = require('./middleware/security');

// Apply security logic
app.use(advancedXSS);
// Note: If Login fails with 403, comment out csrfProtection temporarily to test
app.use(csrfProtection); 

// 4. LOCAL RATE LIMITERS (Renamed to avoid SyntaxError)
const localGeneralLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, 
  max: 200,
  message: { success: false, message: 'Too many requests, try again later.' },
  standardHeaders: true,
  legacyHeaders: false
});

const localAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { success: false, message: 'Too many login attempts, try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true
});

// Apply local limiters
app.use('/api/', localGeneralLimiter);
app.use('/api/auth/login', localAuthLimiter);
app.use('/api/auth/register', localAuthLimiter);

// 5. STATIC FILES
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// 6. ROUTES
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/posts', postRoutes);
app.use('/api/reels', reelRoutes);
app.use('/api/stories', storyRoutes);
app.use('/api/comments', commentRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/notifications', notifRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/groups', groupRoutes);
app.use('/api/explore', exploreRoutes);

// 7. HEALTH CHECK
app.get('/api/health', async (req, res) => {
  try {
    const dbState = mongoose.connection.readyState;
    const dbStatus = dbState === 1 ? 'connected' : dbState === 2 ? 'connecting' : 'disconnected';
    res.json({ 
      success: true, 
      status: 'OK', 
      uptime: process.uptime(), 
      database: dbStatus,
      version: '1.0.0'
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 8. ERROR HANDLING
app.use((err, req, res, next) => {
  logger.error('Error:', err.stack);
  res.status(err.status || 500).json({ 
    success: false, 
    message: err.message || 'Internal Server Error' 
  });
});

app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Route not found' });
});

// 9. DATABASE & SERVER START
const PORT = process.env.PORT || 3000;
mongoose.connect(process.env.MONGODB_URI)
.then(() => {
  logger.info('✅ MongoDB connected');
  initSocket(io);
  server.listen(PORT, () => {
    logger.info(`🚀 Vibe server running on port ${PORT}`);
  });
})
.catch(err => {
  logger.error('❌ MongoDB connection error:', err);
  process.exit(1);
});

module.exports = { app, server, io };
      
