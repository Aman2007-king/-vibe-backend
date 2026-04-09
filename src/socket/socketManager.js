const jwt      = require('jsonwebtoken');
const supabase = require('../db/supabase');

const onlineUsers  = new Map();
const typingTimers = new Map();

function initSocket(io) {
  // Auth middleware — uses Supabase NOT MongoDB
  io.use(async (socket, next) => {
    try {
      const token =
        socket.handshake.auth?.token ||
        socket.handshake.headers?.authorization?.replace('Bearer ', '');
      if (!token) return next(new Error('Authentication required'));

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const { data: user, error } = await supabase
        .from('users')
        .select('id, username, full_name, avatar, verified, is_active')
        .eq('id', decoded.id)
        .single();

      if (error || !user) return next(new Error('User not found'));
      if (!user.is_active) return next(new Error('Account deactivated'));
      socket.user = user;
      next();
    } catch (err) {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.user.id;
    console.log('🟢', socket.user.username, 'connected');

    // Track online
    if (!onlineUsers.has(userId)) onlineUsers.set(userId, new Set());
    onlineUsers.get(userId).add(socket.id);
    socket.join('user:' + userId);

    notifyFollowersOnlineStatus(io, socket.user, true);
    io.emit('online_count', onlineUsers.size);

    // ── NEW POST ───────────────────────────────────────
    socket.on('new_post', (data) => {
      socket.broadcast.emit('explore_new_post', data.post);
    });

    // ── POST LIKE ──────────────────────────────────────
    socket.on('post_like', (data) => {
      io.emit('post_like_update', {
        postId:     data.postId,
        likesCount: data.likesCount,
        liked:      data.liked,
        byUserId:   userId,
      });
    });

    // ── COMMENT ────────────────────────────────────────
    socket.on('new_comment', (data) => {
      io.emit('comment_added', {
        postId:  data.postId,
        comment: {
          ...data.comment,
          user: { id: userId, username: socket.user.username, avatar: socket.user.avatar },
        },
      });
    });

    // ── CONVERSATIONS ──────────────────────────────────
    socket.on('join_conversation',  (cid) => socket.join('conv:' + cid));
    socket.on('leave_conversation', (cid) => socket.leave('conv:' + cid));

    // ── TYPING ─────────────────────────────────────────
    socket.on('typing_start', (data) => {
      socket.to('conv:' + data.conversationId).emit('user_typing', {
        conversationId: data.conversationId,
        user: { id: userId, username: socket.user.username },
        isTyping: true,
      });
      const key = data.conversationId + ':' + userId;
      clearTimeout(typingTimers.get(key));
      typingTimers.set(key, setTimeout(() => {
        socket.to('conv:' + data.conversationId).emit('user_typing', {
          conversationId: data.conversationId,
          user: { id: userId, username: socket.user.username },
          isTyping: false,
        });
      }, 5000));
    });

    socket.on('typing_stop', (data) => {
      const key = data.conversationId + ':' + userId;
      clearTimeout(typingTimers.get(key));
      socket.to('conv:' + data.conversationId).emit('user_typing', {
        conversationId: data.conversationId,
        user: { id: userId, username: socket.user.username },
        isTyping: false,
      });
    });

    // ── FOLLOW ─────────────────────────────────────────
    socket.on('follow_user', (data) => {
      io.to('user:' + data.targetUserId).emit('new_follower', {
        from: { id: userId, username: socket.user.username, avatar: socket.user.avatar || '' },
        ts:   Date.now(),
      });
    });

    // ── STORY VIEW ─────────────────────────────────────
    socket.on('story_view', (data) => {
      io.to('user:' + data.storyOwnerId).emit('story_viewed', {
        storyId:  data.storyId,
        viewedBy: { id: userId, username: socket.user.username, avatar: socket.user.avatar || '' },
        ts:       Date.now(),
      });
    });

    // ── DISCONNECT ─────────────────────────────────────
    socket.on('disconnect', () => {
      console.log('🔴', socket.user.username, 'disconnected');
      const sockets = onlineUsers.get(userId);
      if (sockets) {
        sockets.delete(socket.id);
        if (sockets.size === 0) {
          onlineUsers.delete(userId);
          notifyFollowersOnlineStatus(io, socket.user, false);
          supabase.from('users')
            .update({ last_seen: new Date().toISOString() })
            .eq('id', userId)
            .then(() => {});
        }
      }
      io.emit('online_count', onlineUsers.size);
    });
  });

  console.log('📡 Socket.io initialized');
}

async function notifyFollowersOnlineStatus(io, user, isOnline) {
  try {
    const { data: follows } = await supabase
      .from('follows')
      .select('follower_id')
      .eq('following_id', user.id);

    (follows || []).forEach(f => {
      io.to('user:' + f.follower_id).emit('friend_online_status', {
        userId:   user.id,
        username: user.username,
        isOnline,
        lastSeen: isOnline ? null : new Date().toISOString(),
      });
    });
  } catch {}
}

function isUserOnline(userId) {
  if (!userId) return false;
  return onlineUsers.has(userId.toString());
}

module.exports = { initSocket, isUserOnline };
