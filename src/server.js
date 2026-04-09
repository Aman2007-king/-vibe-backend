require('dotenv').config();
const express     = require('express');
const http        = require('http');
const { Server }  = require('socket.io');
const cors        = require('cors');
const helmet      = require('helmet');
const compression = require('compression');
const morgan      = require('morgan');
const path        = require('path');
const rateLimit   = require('express-rate-limit');

const supabase = require('./db/supabase');
const { initSocket } = require('./socket/socketManager');
const errorHandler   = require('./middleware/error');

// Routes
const authRoutes  = require('./routes/auth');
const postRoutes  = require('./routes/posts');
const {
  userRoutes, commentRoutes, messageRoutes, storyRoutes,
  notifRoutes, searchRoutes, exploreRoutes, reelRoutes, groupRoutes,
} = require('./routes/allRoutes');

const app    = express();
const server = http.createServer(app);

// ── SOCKET.IO ──────────────────────────────────────────
const ALLOWED_ORIGINS = (process.env.CLIENT_URL || '*').split(',').map(s => s.trim());

const io = new Server(server, {
  cors: { origin: ALLOWED_ORIGINS, methods: ['GET', 'POST'], credentials: true },
  maxHttpBufferSize: 50 * 1024 * 1024,
});
app.set('io', io);

// ── MIDDLEWARE ─────────────────────────────────────────
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(compression());
if (process.env.NODE_ENV !== 'production') app.use(morgan('dev'));

app.use(cors({
  origin: ALLOWED_ORIGINS,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ── RATE LIMITING ──────────────────────────────────────
app.use('/api/', rateLimit({ windowMs: 15 * 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false }));
app.use('/api/auth/', rateLimit({ windowMs: 15 * 60 * 1000, max: 20, message: { success: false, message: 'Too many requests, please wait.' } }));

// ── ROUTES ─────────────────────────────────────────────
app.use('/api/auth',          authRoutes);
app.use('/api/users',         userRoutes);
app.use('/api/posts',         postRoutes);
app.use('/api/comments',      commentRoutes);
app.use('/api/messages',      messageRoutes);
app.use('/api/stories',       storyRoutes);
app.use('/api/notifications', notifRoutes);
app.use('/api/search',        searchRoutes);
app.use('/api/explore',       exploreRoutes);
app.use('/api/reels',         reelRoutes);
app.use('/api/groups',        groupRoutes);

// ── HEALTH CHECK ───────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ success: true, status: 'OK', uptime: process.uptime(), timestamp: new Date().toISOString(), connections: io.engine.clientsCount });
});

// ── 404 ────────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ success: false, message: 'Route not found' }));

// ── ERROR HANDLER ──────────────────────────────────────
app.use(errorHandler);

// ── START SERVER ───────────────────────────────────────
const PORT = process.env.PORT || 3000;

supabase.from('users').select('count').limit(1)
  .then(({ error }) => {
    if (error) {
      console.error('❌ Supabase connection failed:', error.message);
      process.exit(1);
    }
    console.log('✅ Supabase connected');
    initSocket(io);
    server.listen(PORT, () => {
      console.log(`🚀 Vibe backend running on port ${PORT}`);
      console.log(`📡 Socket.io ready`);
      console.log(`🌍 Allowed origins: ${ALLOWED_ORIGINS.join(', ')}`);
    });
  });

module.exports = { app, server, io };
