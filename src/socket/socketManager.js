const jwt      = require('jsonwebtoken');
const supabase = require('../db/supabase');

const onlineUsers  = new Map(); // userId → Set of socketIds
const typingTimers = new Map();

function initSocket(io) {
  // Auth middleware
  io.use(async (socket, next) => {
    try {
      const token =
        socket.handshake.auth?.token ||
        socket.handshake.headers?.authorization?.replace('Bearer ', '');
      if (!token) return next(new Error('Authentication required'));

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const { data: user } = await supabase
        .from('users')
        .select('id, username, full_name, avatar, verified, followers_count')
        .eq('id', decoded.id)
        .single();

      if (!user) return next(new Error('User not found'));
      socket.user = user;
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.user.id;
    console.log('🟢', socket.user.username, 'connected');

    // Track socket
    if (!onlineUsers.has(userId)) onlineUsers.set(userId, new Set());
    onlineUsers.get(userId).add(socket.id);
    socket.join('user:' + userId);

    // Notify followers this user is online
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

    SOCKET.on('new_message', d => {
  // Only process messages from OTHER people — sender already sees their own
  const senderId = d.message?.sender?.id || d.message?.sender?._id || d.message?.senderId || '';
  const myId     = CU?._id || CU?.id || '';
  if(senderId === myId) return; // ignore own messages echoed back

  if(activeChatId === d.conversationId){
    appendChatMsg(d.message, false);
  } else {
    // Show badge notification
    ['sb-msg-badge','tb-msg-badge','bn-msg-badge'].forEach(id=>{
      const el=$(id); if(el) el.style.display='flex';
    });
  }
});
    // ── NEW COMMENT ────────────────────────────────────
    socket.on('new_comment', (data) => {
      io.emit('comment_added', {
        postId:  data.postId,
        comment: { ...data.comment, user: { id: userId, username: socket.user.username, avatar: socket.user.avatar } },
      });
    });

    // ── MESSAGES ───────────────────────────────────────
    socket.on('join_conversation', (conversationId) => {
      socket.join('conv:' + conversationId);
    });
    socket.on('leave_conversation', (conversationId) => {
      socket.leave('conv:' + conversationId);
    });

    socket.on('send_message', (data) => {
      const payload = {
        ...data.message,
        senderId:       userId,
        senderUsername: socket.user.username,
        senderAvatar:   socket.user.avatar,
        ts:             Date.now(),
        status:         'delivered',
      };
      io.to('conv:' + data.conversationId).emit('new_message', {
        conversationId: data.conversationId,
        message:        payload,
      });
      if (data.recipientId) {
        io.to('user:' + data.recipientId).emit('dm_notification', {
          conversationId: data.conversationId,
          from:    { id: userId, username: socket.user.username, avatar: socket.user.avatar },
          preview: data.message.text ? data.message.text.slice(0, 50) : '📷 Photo',
          ts:      Date.now(),
        });
      }
    });

    socket.on('message_seen', (data) => {
      io.to('conv:' + data.conversationId).emit('messages_read', {
        conversationId: data.conversationId,
        readBy:         userId,
        readAt:         Date.now(),
      });
    });

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

    // ── FOLLOW EVENT ───────────────────────────────────
    socket.on('follow_user', (data) => {
      io.to('user:' + data.targetUserId).emit('new_follower', {
        from: { id: userId, username: socket.user.username, avatar: socket.user.avatar },
        ts:   Date.now(),
      });
    });

    // ── STORY VIEW ─────────────────────────────────────
    socket.on('story_view', (data) => {
      io.to('user:' + data.storyOwnerId).emit('story_viewed', {
        storyId:  data.storyId,
        viewedBy: { id: userId, username: socket.user.username, avatar: socket.user.avatar },
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
          // Update last_seen in Supabase
          supabase.from('users').update({ last_seen: new Date().toISOString() }).eq('id', userId).then(() => {});
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
        lastSeen: isOnline ? null : new Date(),
      });
    });
  } catch {}
}

function isUserOnline(userId) {
  return onlineUsers.has(userId?.toString());
}

module.exports = { initSocket, isUserOnline };
