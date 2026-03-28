# 🚀 VIBE SOCIAL — Complete Backend

A production-ready Node.js + Express + Socket.io + MongoDB backend
that powers a full Instagram + Facebook clone with **true real-time** features.

---

## 📁 Project Structure

```
vibe-backend/
├── src/
│   ├── server.js              ← Main entry point
│   ├── socket/
│   │   └── socketManager.js   ← ALL real-time events
│   ├── models/
│   │   ├── User.js            ← User schema + methods
│   │   ├── Post.js            ← Posts/Reels/Stories schema
│   │   └── index.js           ← Comment, Message, Notif, Group, Story
│   ├── routes/
│   │   ├── auth.js            ← Register, Login, Me
│   │   ├── posts.js           ← Feed, Create, Like, Save
│   │   └── allRoutes.js       ← Users, Comments, DMs, Stories, Search...
│   ├── middleware/
│   │   ├── auth.js            ← JWT protect middleware
│   │   └── upload.js          ← Multer + Sharp image processing
│   └── utils/
│       └── seed.js            ← Demo data seeder
├── uploads/                   ← Media storage (auto-created)
├── .env.example               ← Environment variables template
├── package.json
└── README.md
```

---

## ⚡ Quick Start (Local)

### 1. Install Node.js (v18+)
Download from https://nodejs.org

### 2. Install MongoDB
**Option A — MongoDB Atlas (FREE cloud database, recommended):**
1. Go to https://cloud.mongodb.com
2. Create free account → New Project → Build a Database (FREE tier)
3. Create a user, whitelist your IP (or 0.0.0.0/0 for anywhere)
4. Click "Connect" → "Connect your application" → copy the URI

**Option B — Local MongoDB:**
Download from https://www.mongodb.com/try/download/community

### 3. Clone & Setup
```bash
# Navigate to the vibe-backend folder
cd vibe-backend

# Install all dependencies
npm install

# Copy environment file
cp .env.example .env

# Edit .env — add your MongoDB URI and a secret key
# MONGODB_URI=mongodb+srv://...   ← from Atlas
# JWT_SECRET=any_long_random_string_here_32chars_min
```

### 4. Seed Demo Data
```bash
npm run seed
```
This creates 7 demo users, 40 posts, comments, and groups.

### 5. Start the Server
```bash
# Development (auto-restarts on file changes)
npm run dev

# Production
npm start
```

Server runs at: **http://localhost:5000**

---

## 🌍 Deploy to Production (FREE)

### Option A: Railway (Easiest — 1 click)
1. Push code to GitHub
2. Go to https://railway.app → New Project → Deploy from GitHub
3. Add environment variables in Railway dashboard
4. Railway auto-detects Node.js and deploys!
5. Get your live URL: `https://vibe-backend-xxx.railway.app`

### Option B: Render (Free tier)
1. Push to GitHub
2. Go to https://render.com → New Web Service
3. Connect GitHub repo
4. Build command: `npm install`
5. Start command: `npm start`
6. Add env vars → Deploy

### Option C: DigitalOcean / AWS / VPS
```bash
# On your server (Ubuntu):
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs
npm install -g pm2

git clone your-repo
cd vibe-backend
npm install
cp .env.example .env
# Edit .env with your values
npm run seed

# Start with PM2 (keeps running after logout)
pm2 start src/server.js --name vibe-backend
pm2 save
pm2 startup
```

---

## 🔌 API Reference

### Auth
| Method | Endpoint              | Description         | Auth |
|--------|-----------------------|---------------------|------|
| POST   | /api/auth/register    | Create account      | ❌   |
| POST   | /api/auth/login       | Login               | ❌   |
| GET    | /api/auth/me          | Get current user    | ✅   |
| POST   | /api/auth/logout      | Logout              | ✅   |
| GET    | /api/auth/check-username/:u | Check if available | ❌ |

### Posts
| Method | Endpoint                  | Description          |
|--------|---------------------------|----------------------|
| GET    | /api/posts/feed           | Personalized feed    |
| POST   | /api/posts                | Create post/reel     |
| GET    | /api/posts/:id            | Get single post      |
| POST   | /api/posts/:id/like       | Like/unlike          |
| POST   | /api/posts/:id/save       | Save/unsave          |
| DELETE | /api/posts/:id            | Delete post          |
| PUT    | /api/posts/:id            | Edit caption         |
| GET    | /api/posts/user/:userId   | User's posts         |

### Users
| Method | Endpoint                  | Description          |
|--------|---------------------------|----------------------|
| GET    | /api/users/:username      | Get profile          |
| PUT    | /api/users/me             | Update profile       |
| POST   | /api/users/:id/follow     | Follow/unfollow      |
| GET    | /api/users/:id/followers  | Get followers list   |
| GET    | /api/users/:id/following  | Get following list   |
| GET    | /api/users/:id/suggestions| Suggested users      |

### Comments
| Method | Endpoint                  | Description          |
|--------|---------------------------|----------------------|
| GET    | /api/comments/:postId     | Get comments         |
| POST   | /api/comments/:postId     | Add comment          |
| POST   | /api/comments/:id/like    | Like comment         |
| DELETE | /api/comments/:id         | Delete comment       |

### Messages
| Method | Endpoint                          | Description            |
|--------|-----------------------------------|------------------------|
| GET    | /api/messages/conversations       | Get all conversations  |
| POST   | /api/messages/conversations       | Start conversation     |
| GET    | /api/messages/:conversationId     | Get messages           |
| POST   | /api/messages/:conversationId     | Send message           |

### Stories
| Method | Endpoint              | Description         |
|--------|-----------------------|---------------------|
| GET    | /api/stories/feed     | Stories from following |
| POST   | /api/stories          | Create story        |
| POST   | /api/stories/:id/view | Mark as viewed      |

### Other
| Method | Endpoint              | Description         |
|--------|-----------------------|---------------------|
| GET    | /api/explore          | Algorithm feed      |
| GET    | /api/reels            | Reels feed          |
| GET    | /api/search?q=        | Search users/posts  |
| GET    | /api/notifications    | Get notifications   |
| PUT    | /api/notifications/read-all | Mark all read |
| GET    | /api/groups           | Get groups          |
| POST   | /api/groups/:id/join  | Join/leave group    |

---

## 📡 Socket.io Real-Time Events

### Client → Server (emit these from frontend)
```javascript
socket.emit('new_post',         { post, followers })
socket.emit('post_like',        { postId, likesCount, postOwnerId, postThumb })
socket.emit('new_comment',      { postId, comment, postOwnerId, postThumb })
socket.emit('join_conversation',  conversationId)
socket.emit('send_message',     { conversationId, message, recipientId })
socket.emit('typing_start',     { conversationId })
socket.emit('typing_stop',      { conversationId })
socket.emit('message_seen',     { conversationId })
socket.emit('follow_user',      { targetUserId })
socket.emit('story_view',       { storyId, storyOwnerId })
socket.emit('go_live',          { roomId })
```

### Server → Client (listen for these in frontend)
```javascript
socket.on('feed_new_post',      (post) => ...)        // New post in feed
socket.on('explore_new_post',   (post) => ...)        // New post in explore
socket.on('post_like_update',   (data) => ...)        // Like count changed
socket.on('comment_added',      (data) => ...)        // New comment
socket.on('new_message',        (data) => ...)        // DM received
socket.on('dm_notification',    (data) => ...)        // DM badge
socket.on('user_typing',        (data) => ...)        // Typing indicator
socket.on('messages_read',      (data) => ...)        // Read receipts
socket.on('notification',       (notif) => ...)       // Any notification
socket.on('new_story',          (story) => ...)       // New story
socket.on('friend_online_status',(data) => ...)       // Online/offline
socket.on('new_follower',       (data) => ...)        // Got a new follower
socket.on('online_count',       (count) => ...)       // Total online users
socket.on('story_viewed',       (data) => ...)        // Who viewed your story
socket.on('user_went_live',     (data) => ...)        // Someone went live
```

### Frontend Socket.io Connection Example
```javascript
import { io } from 'socket.io-client';

const socket = io('https://your-backend-url.com', {
  auth: { token: localStorage.getItem('vibe_token') },
  transports: ['websocket', 'polling'],
});

socket.on('connect', () => console.log('🟢 Connected!'));
socket.on('notification', (n) => showNotification(n));
socket.on('new_message', (d) => addMessageToChat(d));
socket.on('post_like_update', (d) => updateLikeCount(d));
```

---

## 🔒 Security Features
- ✅ Passwords hashed with bcrypt (salt rounds: 12)
- ✅ JWT authentication (30 day expiry)
- ✅ Rate limiting (100 req/15min, 20 auth/15min)
- ✅ Helmet.js security headers
- ✅ CORS configured
- ✅ Input validation with express-validator
- ✅ File type validation for uploads
- ✅ Image compression with Sharp
- ✅ MongoDB injection protection via Mongoose

---

## 🧪 Test Accounts (after seeding)
| Username      | Password     |
|---------------|--------------|
| demo          | demo         |
| alex.travels  | password123  |
| sara_art      | password123  |
| mike_lens     | password123  |

---

## 📦 Tech Stack
- **Runtime:** Node.js 18+
- **Framework:** Express.js 4
- **Real-time:** Socket.io 4
- **Database:** MongoDB + Mongoose
- **Auth:** JWT + bcryptjs
- **File uploads:** Multer + Sharp
- **Security:** Helmet + express-rate-limit
- **Validation:** express-validator
