require('dotenv').config();

const express     = require('express');
const http        = require('http');
const { Server }  = require('socket.io');
const cors        = require('cors');
const helmet      = require('helmet');
const compression = require('compression');
const path        = require('path');
const rateLimit   = require('express-rate-limit');

const supabase = require('./db/supabase');

const admin = require('firebase-admin');
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId:   process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey:  (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    }),
  });
}

const { initSocket } = require('./socket/socketManager');

const authRoutes    = require('./routes/auth');
const userRoutes    = require('./routes/users');
const postRoutes    = require('./routes/posts');
const commentRoutes = require('./routes/comments');
const messageRoutes = require('./routes/messages');
const storyRoutes   = require('./routes/stories');
const notifRoutes   = require('./routes/notifications');
const searchRoutes  = require('./routes/search');
const exploreRoutes = require('./routes/explore');
const reelRoutes    = require('./routes/reels');
const groupRoutes   = require('./routes/groups');

const app    = express();
const server = http.createServer(app);

const ORIGINS = (process.env.CLIENT_URL || '*').split(',').map(s => s.trim()).filter(Boolean);

const io = new Server(server, {
  cors: { origin: ORIGINS.includes('*') ? '*' : ORIGINS, methods: ['GET','POST'], credentials: true },
  maxHttpBufferSize: 100 * 1024 * 1024,
});
app.set('io', io);

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(compression());
app.use(cors({ origin: ORIGINS.includes('*') ? '*' : ORIGINS, credentials: true, methods: ['GET','POST','PUT','DELETE','PATCH','OPTIONS'] }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

app.use('/api/', rateLimit({ windowMs: 15*60*1000, max: 500, standardHeaders: true, legacyHeaders: false }));
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

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

app.get('/api/health', (req, res) => {
  res.json({ success: true, status: 'OK', uptime: process.uptime(), timestamp: new Date().toISOString(), connections: io.engine.clientsCount });
});

app.use((req, res) => res.status(404).json({ success: false, message: 'Route not found' }));

app.use((err, req, res, next) => {
  console.error('Server error:', err.message);
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ success: false, message: 'File too large. Max 100MB.' });
  res.status(err.status || 500).json({ success: false, message: err.message || 'Internal Server Error' });
});

const PORT = process.env.PORT || 3000;
supabase.from('users').select('count').limit(1).then(({ error }) => {
  if (error) { console.error('Supabase error:', error.message); process.exit(1); }
  console.log('✅ Supabase connected');
  initSocket(io);
  server.listen(PORT, () => console.log('🚀 Vibe running on port', PORT));
}).catch(err => { console.error('Startup error:', err.message); process.exit(1); });

module.exports = { app, server, io };
