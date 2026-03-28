const jwt  = require('jsonwebtoken');
const User = require('../models/User');
 
const onlineUsers  = new Map();
const typingTimers = new Map();
 
function initSocket(io) {
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.replace('Bearer ', '');
      if (!token) return next(new Error('Authentication required'));
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id).select('-password');
      if (!user) return next(new Error('User not found'));
      socket.user = user;
      next();
    } catch (err) {
      next(new Error('Invalid token'));
    }
  });
 
  io.on('connection', (socket) => {
    const userId = socket.user._id.toString();
    console.log('🟢', socket.user.username, 'connected');

if (!onlineUsers.has(userId)) onlineUsers.set(userId, new Set());
    onlineUsers.get(userId).add(socket.id);
    socket.join('user:' + userId);
    notifyFollowersOnline(io, socket.user, true);
    io.emit('online_count', onlineUsers.size);
 
    socket.on('new_post', async (data) => {
      const followers = socket.user.followers || [];
      followers.forEach(fid => {
        io.to('user:' + fid).emit('feed_new_post', { post: data.post, fromUser: { id: userId, username: socket.user.username, avatar: socket.user.avatar } });
      });
      socket.broadcast.emit('explore_new_post', data.post);
    });
 
    socket.on('post_like', (data) => {
      io.emit('post_like_update', { postId: data.postId, likesCount: data.likesCount, liked: data.liked, byUser: { id: userId, username: socket.user.username } });
      if (data.postOwnerId && data.postOwnerId !== userId) {
        io.to('user:' + data.postOwnerId).emit('notification', { type: 'like', fromUser: { id: userId, username: socket.user.username, avatar: socket.user.avatar }, postId: data.postId, message: socket.user.username + ' liked your photo', ts: Date.now() });
      }
 });
      socket.broadcast.emit('explore_new_post', data.post);
    });
 
    socket.on('post_like', (data) => {
      io.emit('post_like_update', { postId: data.postId, likesCount: data.likesCount, liked: data.liked, byUser: { id: userId, username: socket.user.username } });
      if (data.postOwnerId && data.postOwnerId !== userId) {
        io.to('user:' + data.postOwnerId).emit('notification', { type: 'like', fromUser: { id: userId, username: socket.user.username, avatar: socket.user.avatar }, postId: data.postId, message: socket.user.username + ' liked your photo', ts: Date.now() });
      }
    });
 
    socket.on('new_comment', (data) => {
      io.emit('comment_added', { postId: data.postId, comment: { ...data.comment, user: { id: userId, username: socket.user.username, avatar: socket.user.avatar }, ts: Date.now() } });
      if (data.postOwnerId && data.postOwnerId !== userId) {
        io.to('user:' + data.postOwnerId).emit('notification', { type: 'comment', fromUser: { id: userId, username: socket.user.username, avatar: socket.user.avatar }, postId: data.postId, message: socket.user.username + ' commented: "' + (data.comment.text || '').slice(0,40) + '"', ts: Date.now() });
      }
    });
 
    socket.on('join_conversation', (conversationId) => socket.join('conv:' + conversationId));
    socket.on('leave_conversation', (conversationId) => socket.leave('conv:' + conversationId));
 
    socket.on('send_message', (data) => {
      const msgPayload = { ...data.message, senderId: userId, senderUsername: socket.user.username, senderAvatar: socket.user.avatar, ts: Date.now(), status: 'delivered' };
      io.to('conv:' + data.conversationId).emit('new_message', { conversationId: data.conversationId, message: msgPayload });
      if (data.recipientId) {
        io.to('user:' + data.recipientId).emit('dm_notification', { conversationId: data.conversationId, from: { id: userId, username: socket.user.username, avatar: socket.user.avatar }, preview: data.message.text ? data.message.text.slice(0,50) : '📷 Photo', ts: Date.now() });
      }
    });
 
    socket.on('message_seen', (data) => {
      io.to('conv:' + data.conversationId).emit('messages_read', { conversationId: data.conversationId, readBy: userId, readAt: Date.now() });
    });
 
    socket.on('typing_start', (data) => {
      socket.to('conv:' + data.conversationId).emit('user_typing', { conversationId: data.conversationId, user: { id: userId, username: socket.user.username }, isTyping: true });
      const key = data.conversationId + ':' + userId;
      clearTimeout(typingTimers.get(key));
      typingTimers.set(key, setTimeout(() => {
socket.to('conv:' + data.conversationId).emit('user_typing', { conversationId: data.conversationId, user: { id: userId, username: socket.user.username }, isTyping: false });
      }, 5000));
    });
 
    socket.on('typing_stop', (data) => {
      const key = data.conversationId + ':' + userId;
      clearTimeout(typingTimers.get(key));
      socket.to('conv:' + data.conversationId).emit('user_typing', { conversationId: data.conversationId, user: { id: userId, username: socket.user.username }, isTyping: false });
    });
 
    socket.on('follow_user', (data) => {
      io.to('user:' + data.targetUserId).emit('new_follower', { from: { id: userId, username: socket.user.username, avatar: socket.user.avatar }, ts: Date.now() });
      io.to('user:' + data.targetUserId).emit('notification', { type: 'follow', fromUser: { id: userId, username: socket.user.username, avatar: socket.user.avatar }, message: socket.user.username + ' started following you', ts: Date.now() });
    });
 
    socket.on('story_view', (data) => {
      io.to('user:' + data.storyOwnerId).emit('story_viewed', { storyId: data.storyId, viewedBy: { id: userId, username: socket.user.username, avatar: socket.user.avatar }, ts: Date.now() });
 });
 
    socket.on('go_live', (data) => {
      socket.broadcast.emit('user_went_live', { user: { id: userId, username: socket.user.username, avatar: socket.user.avatar }, roomId: data.roomId, ts: Date.now() });
    });
 
    socket.on('disconnect', () => {
      console.log('🔴', socket.user.username, 'disconnected');
      const sockets = onlineUsers.get(userId);
      if (sockets) {
        sockets.delete(socket.id);
        if (sockets.size === 0) {
          onlineUsers.delete(userId);
          notifyFollowersOnline(io, socket.user, false);
          User.findByIdAndUpdate(userId, { lastSeen: new Date() }).catch(() => {});
        }
      }
      io.emit('online_count', onlineUsers.size);
    });
 
  console.log('📡 Socket.io engine initialized');
}
 
async function notifyFollowersOnline(io, user, isOnline) {
  (user.followers || []).forEach(fid => {
    io.to('user:' + fid).emit('friend_online_status', { userId: user._id.toString(), username: user.username, isOnline, lastSeen: isOnline ? null : new Date() });
  });
}
 
function isUserOnline(userId) { return onlineUsers.has(userId.toString()); }
 
module.exports = { initSocket, isUserOnline };
