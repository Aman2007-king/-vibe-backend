const express     = require('express');
app.set('trust proxy', 1);
const cors        = require('cors');
const path        = require('path');
require('dotenv').config();
const http        = require('http');
const { Server }  = require('socket.io');
const mongoose    = require('mongoose');
const helmet      = require('helmet');
const compression = require('compression');
const morgan      = require('morgan');
const rateLimit   = require('express-rate-limit');
 
const { initSocket }  = require('./socket/socketManager');
const authRoutes      = require('./routes/auth');
const userRoutes      = require('./routes/users');
const postRoutes      = require('./routes/posts');
const reelRoutes      = require('./routes/reels');
const storyRoutes     = require('./routes/stories');
const commentRoutes   = require('./routes/comments');
const messageRoutes   = require('./routes/messages');
const notifRoutes     = require('./routes/notifications');
const searchRoutes    = require('./routes/search');
const groupRoutes     = require('./routes/groups');
const exploreRoutes   = require('./routes/explore');
 
const app    = express();
const server = http.createServer(app);
 
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET','POST'], credentials: true },
  maxHttpBufferSize: 50 * 1024 * 1024,
});
app.set('io', io);
 
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(compression());
app.use(morgan('dev'));
// In src/server.js — replace your cors() call:
app.use(cors({
  origin: function(origin, callback) {
    const allowed = [
      'https://vibe-frontend-ecru.vercel.app',
      process.env.CLIENT_URL,
      'http://localhost:3000',
      'http://localhost:5500',
    ].filter(Boolean);
    if (!origin || allowed.includes(origin) || origin.includes('.vercel.app') || origin.includes('.glitch.me')) {
      callback(null, true);
    } else {
      callback(null, true);
    }
  },
  credentials: true,
  methods: ['GET','POST','PUT','DELETE','PATCH','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
}));
app.options('*', cors());

// Also update CLIENT_URL in Render env vars to:
// https://vibe-frontend-ecru.vercel.app
app.use(express.json({ limit: '50mb' }));
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Only 5 attempts allowed!
  message: "Too many login attempts. Please try again in 15 minutes."
});
app.use('/api/auth/login', loginLimiter);
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));
 
const limiter = rateLimit({ windowMs: 15*60*1000, max: 200 });
app.use('/api/', limiter);
 
app.use('/api/auth',          authRoutes);
app.use('/api/users',         userRoutes);
app.use('/api/posts',         postRoutes);
app.use('/api/reels',         reelRoutes);
app.use('/api/stories',       storyRoutes);
app.use('/api/comments',      commentRoutes);
app.use('/api/messages',      messageRoutes);
app.use('/api/notifications', notifRoutes);
app.use('/api/search',        searchRoutes);
app.use('/api/groups',        groupRoutes);
app.use('/api/explore',       exploreRoutes);
 
app.get('/api/health', (req, res) => {
  res.json({ success: true, status: 'OK', uptime: process.uptime(), timestamp: new Date().toISOString(), connections: io.engine.clientsCount });
});
 
app.use((err, req, res, next) => {
  console.error('Error:', err.stack);
  res.status(err.status || 500).json({ success: false, message: err.message || 'Internal Server Error' });
});
 
app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Route not found' });
});

const PORT = process.env.PORT || 3000;
mongoose.connect(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
.then(() => {
  console.log('✅ MongoDB connected');
  initSocket(io);
  server.listen(PORT, () => {
    console.log('🚀 Vibe server running on port', PORT);
    console.log('📡 Socket.io ready');
  });
})
.catch(err => {
  console.error('❌ MongoDB error:', err);
  process.exit(1);
});
 
module.exports = { app, server, io };
 
