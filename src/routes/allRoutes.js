const router_users    = require('express').Router();
const router_comments = require('express').Router();
const router_messages = require('express').Router();
const router_stories  = require('express').Router();
const router_notifs   = require('express').Router();
const router_search   = require('express').Router();
const router_groups   = require('express').Router();
const router_explore  = require('express').Router();
const router_reels    = require('express').Router();
 
const User   = require('../models/User');
const Post   = require('../models/Post');
const { Comment, Conversation, Message, Notification, Group, Story } = require('../models/index');
const { protect, optionalAuth } = require('../middleware/auth');
const { upload, handlePostUpload, handleStoryUpload } = require('../middleware/upload');
const { isUserOnline } = require('../socket/socketManager');
 
// ── USERS ────────────────────────────────────────────────────
router_users.get('/:username', optionalAuth, async (req, res) => {
  try {
    const user = await User.findOne({ username: req.params.username.toLowerCase() });
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
    const pub = user.toPublicJSON(req.user?._id); pub.isOnline = isUserOnline(user._id);
    res.json({ success: true, user: pub });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});
 
router_users.put('/me', protect, upload.single('avatar'), async (req, res) => {
  try {
    const allowed = ['fullName','bio','website','location','isPrivate','accountType'];
    const updates = {};
    allowed.forEach(f => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });
    if (req.file) { const { handleAvatarUpload } = require('../middleware/upload'); req.file = req.file; await new Promise((res, rej) => handleAvatarUpload(req, {}, e => e ? rej(e) : res())); if (req.avatarFilename) updates.avatar = req.avatarFilename; }
    const user = await User.findByIdAndUpdate(req.user._id, updates, { new: true, runValidators: true });
    res.json({ success: true, user: { ...user.toObject(), avatar: user.avatarUrl } });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});
 
// Enhanced follow system with privacy controls
router.post('/:id/follow', protect, async (req, res) => {
  try {
    if (req.params.id === req.user._id.toString()) {
      return res.status(400).json({ success: false, message: "Can't follow yourself." });
    }

    const [targetUser, currentUser] = await Promise.all([
      User.findById(req.params.id),
      User.findById(req.user._id)
    ]);

    if (!targetUser) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    // Check privacy settings
    if (targetUser.privacySettings.profileVisibility === 'private') {
      // Send follow request instead
      if (!targetUser.followRequests.includes(currentUser._id)) {
        targetUser.followRequests.push(currentUser._id);
        await targetUser.save({ validateBeforeSave: false });
        
        // Log activity
        currentUser.activityLog.push({
          action: 'sent_follow_request',
          target: targetUser._id,
          targetType: 'user'
        });
        await currentUser.save({ validateBeforeSave: false });
        
        // Send notification
        const io = req.app.get('io');
        const notification = await Notification.create({
          recipient: targetUser._id,
          sender: currentUser._id,
          type: 'follow_request',
          message: `${currentUser.username} wants to follow you`
        });
        const populatedNotif = await notification.populate('sender', 'username avatar');
        io.to('user:' + targetUser._id).emit('notification', populatedNotif);
        
        return res.json({ 
          success: true, 
          requested: true, 
          message: 'Follow request sent' 
        });
      } else {
        return res.json({ 
          success: true, 
          requested: true, 
          message: 'Follow request already sent' 
        });
      }
    }

    // Direct follow for public accounts
    const alreadyFollowing = currentUser.following.some(
      id => id.toString() === targetUser._id.toString()
    );

    if (alreadyFollowing) {
      // Unfollow
      currentUser.following.pull(targetUser._id);
      targetUser.followers.pull(currentUser._id);
      currentUser.followingCount = Math.max(0, currentUser.followingCount - 1);
      targetUser.followersCount = Math.max(0, targetUser.followersCount - 1);
    } else {
      // Follow
      currentUser.following.push(targetUser._id);
      targetUser.followers.push(currentUser._id);
      currentUser.followingCount++;
      targetUser.followersCount++;
      
      // Send notification
      const notification = await Notification.create({
        recipient: targetUser._id,
        sender: currentUser._id,
        type: 'follow',
        message: `${currentUser.username} started following you`
      });
      const populatedNotif = await notification.populate('sender', 'username avatar verified');
      const io = req.app.get('io');
      io.to('user:' + targetUser._id).emit('notification', populatedNotif);
      io.to('user:' + targetUser._id).emit('new_follower', {
        from: { 
          id: currentUser._id, 
          username: currentUser.username, 
          avatar: currentUser.avatarUrl 
        }
      });
    }

    await Promise.all([
      currentUser.save({ validateBeforeSave: false }),
      targetUser.save({ validateBeforeSave: false })
    ]);

    // Log activity
    currentUser.activityLog.push({
      action: alreadyFollowing ? 'unfollow' : 'follow',
      target: targetUser._id,
      targetType: 'user'
    });
    await currentUser.save({ validateBeforeSave: false });

    res.json({
      success: true,
      following: !alreadyFollowing,
      followersCount: targetUser.followersCount
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// Handle follow requests
router.post('/:id/follow-request/:action', protect, async (req, res) => {
  try {
    const { action } = req.params; // 'accept' or 'reject'
    const targetUser = await User.findById(req.user._id);
    const requestingUser = await User.findById(req.params.id);
    
    if (!targetUser || !requestingUser) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    
    // Remove from follow requests
    targetUser.followRequests.pull(requestingUser._id);
    
    if (action === 'accept') {
      // Add to followers
      targetUser.followers.push(requestingUser._id);
      requestingUser.following.push(targetUser._id);
      targetUser.followersCount++;
      requestingUser.followingCount++;
      
      // Send acceptance notification
      const notification = await Notification.create({
        recipient: requestingUser._id,
        sender: targetUser._id,
        type: 'follow_request_accepted',
        message: `${targetUser.username} accepted your follow request`
      });
      const io = req.app.get('io');
      const populatedNotif = await notification.populate('sender', 'username avatar');
      io.to('user:' + requestingUser._id).emit('notification', populatedNotif);
    }
    
    await Promise.all([
      targetUser.save({ validateBeforeSave: false }),
      requestingUser.save({ validateBeforeSave: false })
    ]);
    
    res.json({ 
      success: true, 
      message: `Follow request ${action}ed` 
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// Block/Unblock users
router.post('/:id/block', protect, async (req, res) => {
  try {
    const targetUserId = req.params.id;
    const currentUser = await User.findById(req.user._id);
    
    if (targetUserId === req.user._id.toString()) {
      return res.status(400).json({ success: false, message: "Can't block yourself" });
    }
    
    const isBlocked = currentUser.blockedUsers.includes(targetUserId);
    
    if (isBlocked) {
      // Unblock
      currentUser.blockedUsers.pull(targetUserId);
    } else {
      // Block
      currentUser.blockedUsers.push(targetUserId);
      // Also unfollow each other
      currentUser.following.pull(targetUserId);
      await User.findByIdAndUpdate(targetUserId, {
        $pull: { followers: currentUser._id }
      });
    }
    
    await currentUser.save({ validateBeforeSave: false });
    
    res.json({
      success: true,
      blocked: !isBlocked,
      message: isBlocked ? 'User unblocked' : 'User blocked'
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// Close Friends management
router.post('/close-friends/:id', protect, async (req, res) => {
  try {
    const targetUserId = req.params.id;
    const currentUser = await User.findById(req.user._id);
    
    const isCloseFriend = currentUser.closeFriends.includes(targetUserId);
    
    if (isCloseFriend) {
      currentUser.closeFriends.pull(targetUserId);
    } else {
      currentUser.closeFriends.push(targetUserId);
    }
    
    await currentUser.save({ validateBeforeSave: false });
    
    res.json({
      success: true,
      isCloseFriend: !isCloseFriend,
      message: isCloseFriend ? 'Removed from close friends' : 'Added to close friends'
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// Privacy settings update
router.put('/privacy-settings', protect, async (req, res) => {
  try {
    const { profileVisibility, storyVisibility, messagePermissions } = req.body;
    const user = await User.findByIdAndUpdate(
      req.user._id,
      {
        privacySettings: {
          profileVisibility: profileVisibility || 'public',
          storyVisibility: storyVisibility || 'public',
          messagePermissions: messagePermissions || 'everyone'
        }
      },
      { new: true }
    );
    
    res.json({
      success: true,
      privacySettings: user.privacySettings
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

 
router_users.get('/:id/followers', optionalAuth, async (req, res) => {
  try {
const user = await User.findById(req.params.id).populate('followers', 'username fullName avatar verified bio followersCount');
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
    res.json({ success: true, followers: user.followers.map(u => ({ ...u.toObject(), isOnline: isUserOnline(u._id), avatar: u.avatarUrl })) });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});
 
router_users.get('/:id/following', optionalAuth, async (req, res) => {
  try {
    const user = await User.findById(req.params.id).populate('following', 'username fullName avatar verified bio followersCount');
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
    res.json({ success: true, following: user.following.map(u => ({ ...u.toObject(), isOnline: isUserOnline(u._id), avatar: u.avatarUrl })) });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});
 
router_users.get('/:id/suggestions', protect, async (req, res) => {
  try {
    const me = await User.findById(req.user._id).select('following');
    const exclude = [...(me.following||[]), req.user._id];
    const suggestions = await User.find({ _id: { $nin: exclude }, isActive: true }).select('username fullName avatar verified bio followersCount').sort({ followersCount: -1 }).limit(10);
    res.json({ success: true, suggestions: suggestions.map(u => ({ ...u.toObject(), avatar: u.avatarUrl })) });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});
// ── COMMENTS ─────────────────────────────────────────────────
router_comments.get('/:postId', optionalAuth, async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const comments = await Comment.find({ post: req.params.postId, parent: null, isDeleted: false }).populate('user', 'username avatar verified').sort({ createdAt: -1 }).skip((page-1)*limit).limit(+limit);
    res.json({ success: true, comments });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});
 
router_comments.post('/:postId', protect, async (req, res) => {
  try {
    const { text, parentId } = req.body;
    if (!text?.trim()) return res.status(400).json({ success: false, message: 'Comment text required.' });
    const post = await Post.findById(req.params.postId).select('user commentsDisabled');
    if (!post) return res.status(404).json({ success: false, message: 'Post not found.' });
    if (post.commentsDisabled) return res.status(403).json({ success: false, message: 'Comments disabled.' });
    const comment = await Comment.create({ post: post._id, user: req.user._id, text: text.trim(), parent: parentId || null });
    await Post.findByIdAndUpdate(post._id, { $inc: { commentsCount: 1 } });
    if (parentId) await Comment.findByIdAndUpdate(parentId, { $push: { replies: comment._id }, $inc: { repliesCount: 1 } });
    const populated = await comment.populate('user', 'username avatar verified');
    req.app.get('io').emit('comment_added', { postId: post._id, comment: populated });
    if (post.user.toString() !== req.user._id.toString()) { const notif = await Notification.create({ recipient: post.user, sender: req.user._id, type: 'comment', post: post._id, message: req.user.username + ' commented: "' + text.slice(0,40) + '"' }); const pop = await notif.populate('sender', 'username avatar'); req.app.get('io').to('user:' + post.user).emit('notification', pop); }
    res.status(201).json({ success: true, comment: populated });
} catch (e) { res.status(500).json({ success: false, message: e.message }); }
});
 
router_comments.post('/:id/like', protect, async (req, res) => {
  try {
    const comment = await Comment.findById(req.params.id);
    if (!comment) return res.status(404).json({ success: false, message: 'Comment not found.' });
    const liked = comment.likes.some(id => id.toString() === req.user._id.toString());
    if (liked) { comment.likes.pull(req.user._id); comment.likesCount--; } else { comment.likes.push(req.user._id); comment.likesCount++; }
    await comment.save();
    res.json({ success: true, liked: !liked, likesCount: comment.likesCount });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});
 
router_comments.delete('/:id', protect, async (req, res) => {
  try {
    const comment = await Comment.findById(req.params.id);
    if (!comment) return res.status(404).json({ success: false, message: 'Comment not found.' });
    if (comment.user.toString() !== req.user._id.toString()) return res.status(403).json({ success: false, message: 'Not authorized.' });
    comment.isDeleted = true; await comment.save();
    await Post.findByIdAndUpdate(comment.post, { $inc: { commentsCount: -1 } });
    req.app.get('io').emit('comment_deleted', { postId: comment.post, commentId: comment._id });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});
 
// ── MESSAGES ─────────────────────────────────────────────────
router_messages.get('/conversations', protect, async (req, res) => {
  try {
    const convs = await Conversation.find({ participants: req.user._id }).populate('participants', 'username fullName avatar verified').sort({ 'lastMessage.ts': -1 });
    const result = convs.map(c => { const other = c.participants.find(p => p._id.toString() !== req.user._id.toString()); return { id: c._id, isGroup: c.isGroup, groupName: c.groupName, partner: other ? { ...other.toObject(), avatar: other.avatarUrl, isOnline: isUserOnline(other._id) } : null, lastMessage: c.lastMessage, unreadCount: c.unreadCounts?.get(req.user._id.toString()) || 0 }; });
    res.json({ success: true, conversations: result });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});
 
router_messages.post('/conversations', protect, async (req, res) => {
  try {
    const { userId } = req.body;
    let conv = await Conversation.findOne({ participants: { $all: [req.user._id, userId], $size: 2 }, isGroup: false });
    if (!conv) conv = await Conversation.create({ participants: [req.user._id, userId] });
    await conv.populate('participants', 'username fullName avatar verified');
    res.json({ success: true, conversation: conv });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});
 
router_messages.get('/:conversationId', protect, async (req, res) => {
  try {
    const { page = 1, limit = 30 } = req.query;
    const msgs = await Message.find({ conversation: req.params.conversationId, isDeleted: false }).populate('sender', 'username avatar verified').sort({ createdAt: -1 }).skip((page-1)*limit).limit(+limit);
    await Conversation.findByIdAndUpdate(req.params.conversationId, { $set: { ['unreadCounts.' + req.user._id]: 0 } });
    res.json({ success: true, messages: msgs.reverse(), page: +page });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});
 
router_messages.post('/:conversationId', protect, upload.single('media'), handlePostUpload, async (req, res) => {
  try {
    const { text, type = 'text', replyTo } = req.body;
    const conv = await Conversation.findById(req.params.conversationId);
    if (!conv) return res.status(404).json({ success: false, message: 'Conversation not found.' });
    const media = req.processedMedia?.[0];
    const msg = await Message.create({ conversation: conv._id, sender: req.user._id, type, text: text?.trim(), media, replyTo, deliveredTo: conv.participants.filter(p => p.toString() !== req.user._id.toString()) });
    const updates = { lastMessage: { text: text || (media ? '📷 Media' : ''), type, senderId: req.user._id, ts: new Date() } };
    conv.participants.forEach(pid => { if (pid.toString() !== req.user._id.toString()) updates['unreadCounts.' + pid] = (conv.unreadCounts?.get(pid.toString()) || 0) + 1; });
    await Conversation.findByIdAndUpdate(conv._id, { $set: updates });
    const populated = await msg.populate('sender', 'username avatar verified');
    const io = req.app.get('io');
    io.to('conv:' + conv._id).emit('new_message', { conversationId: conv._id, message: populated });
    conv.participants.forEach(pid => { if (pid.toString() !== req.user._id.toString()) io.to('user:' + pid).emit('dm_notification', { conversationId: conv._id, from: { id: req.user._id, username: req.user.username, avatar: req.user.avatarUrl }, preview: text || '📷 Media', ts: Date.now() }); });
    res.status(201).json({ success: true, message: populated });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});
 
// ── STORIES ──────────────────────────────────────────────────
router_stories.get('/feed', protect, async (req, res) => {
  try {
    const me = await User.findById(req.user._id).select('following');
    const ids = [...(me.following||[]), req.user._id];
    const stories = await Story.find({ user: { $in: ids }, isDeleted: false, expiresAt: { $gt: new Date() } }).populate('user', 'username avatar verified').sort({ createdAt: -1 });
    const grouped = {};
    stories.forEach(s => { const uid = s.user._id.toString(); if (!grouped[uid]) grouped[uid] = { user: s.user, stories: [], hasUnread: false }; const seen = s.viewers?.some(v => v.user?.toString() === req.user._id.toString()); grouped[uid].stories.push({ ...s.toObject(), seen }); if (!seen) grouped[uid].hasUnread = true; });
    res.json({ success: true, storyGroups: Object.values(grouped) });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});
 
router_stories.post('/', protect, upload.single('media'), handleStoryUpload, async (req, res) => {
  try {
    if (!req.storyFilename) return res.status(400).json({ success: false, message: 'Media required.' });
    const { text, location, audience } = req.body;
    const story = await Story.create({ user: req.user._id, media: { url: req.storyFilename, type: req.storyIsVideo ? 'video' : 'image' }, text, location, audience: audience || 'all' });
    await User.findByIdAndUpdate(req.user._id, { $inc: { storiesCount: 1 } });
    const populated = await story.populate('user', 'username avatar verified');
    const fullUser = await User.findById(req.user._id).select('followers');
    fullUser.followers.forEach(fid => req.app.get('io').to('user:' + fid).emit('new_story', populated));
    res.status(201).json({ success: true, story: populated });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});
 
router_stories.post('/:id/view', protect, async (req, res) => {
  try {
    const story = await Story.findById(req.params.id);
    if (!story) return res.status(404).json({ success: false, message: 'Story not found.' });
    const alreadyViewed = story.viewers?.some(v => v.user?.toString() === req.user._id.toString());
    if (!alreadyViewed) { story.viewers.push({ user: req.user._id, viewedAt: new Date() }); story.viewersCount++; await story.save(); req.app.get('io').to('user:' + story.user).emit('story_viewed', { storyId: story._id, viewedBy: { id: req.user._id, username: req.user.username, avatar: req.user.avatarUrl } }); }
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});
 
// ── NOTIFICATIONS ─────────────────────────────────────────────
router_notifs.get('/', protect, async (req, res) => {
  try {
    const { page = 1, limit = 30 } = req.query;
    const notifs = await Notification.find({ recipient: req.user._id }).populate('sender', 'username avatar verified').populate('post', 'media').sort({ createdAt: -1 }).skip((page-1)*limit).limit(+limit);
    const unreadCount = await Notification.countDocuments({ recipient: req.user._id, isRead: false });
    res.json({ success: true, notifications: notifs, unreadCount });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});
 
router_notifs.put('/read-all', protect, async (req, res) => {
  try {
    await Notification.updateMany({ recipient: req.user._id, isRead: false }, { isRead: true, readAt: new Date() });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});
 
// ── SEARCH ───────────────────────────────────────────────────
router_search.get('/', optionalAuth, async (req, res) => {
  try {
    const { q, type = 'all' } = req.query;
    if (!q?.trim()) return res.json({ success: true, users: [], posts: [], hashtags: [] });
    const results = {};
    if (type === 'all' || type === 'users') { results.users = await User.find({ $or: [{ username: { $regex: q, $options: 'i' } }, { fullName: { $regex: q, $options: 'i' } }], isActive: true }).select('username fullName avatar verified bio followersCount').limit(10); results.users = results.users.map(u => ({ ...u.toObject(), avatar: u.avatarUrl })); }
    if (type === 'all' || type === 'posts') { results.posts = await Post.find({ caption: { $regex: q, $options: 'i' }, isDeleted: false }).populate('user', 'username avatar verified').sort({ engagementScore: -1 }).limit(20); results.posts = results.posts.map(p => ({ ...p.toObject(), media: p.mediaUrls })); }
    res.json({ success: true, ...results });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});
 
// ── EXPLORE ──────────────────────────────────────────────────
router_explore.get('/', optionalAuth, async (req, res) => {
  try {
    const { page = 1, limit = 30 } = req.query;
    const exclude = req.user ? (await User.findById(req.user._id).select('following')).following : [];
    const posts = await Post.find({ user: req.user ? { $nin: [...exclude, req.user._id] } : {}, isDeleted: false, 'media.0': { $exists: true } }).populate('user', 'username avatar verified').sort({ engagementScore: -1, createdAt: -1 }).skip((page-1)*limit).limit(+limit);
    res.json({ success: true, posts: posts.map(p => ({ ...p.toObject(), media: p.mediaUrls })) });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});
 
// ── REELS ────────────────────────────────────────────────────
router_reels.get('/', optionalAuth, async (req, res) => {
  try {
    const { page = 1, limit = 10, cursor } = req.query;
    const query = { type: 'reel', isDeleted: false };
    if (cursor) query._id = { $lt: cursor };
    const reels = await Post.find(query).populate('user', 'username fullName avatar verified bio followersCount').sort({ createdAt: -1 }).limit(+limit);
    res.json({ success: true, reels: reels.map(r => ({ ...r.toObject(), media: r.mediaUrls, isLiked: req.user ? r.isLikedBy(req.user._id) : false })), nextCursor: reels[reels.length-1]?._id });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});
 
router_reels.post('/:id/view', optionalAuth, async (req, res) => {
  try { await Post.findByIdAndUpdate(req.params.id, { $inc: { viewsCount: 1 } }); res.json({ success: true }); }
  catch (e) { res.status(500).json({ success: false, message: e.message }); }
});
 
// ── GROUPS ───────────────────────────────────────────────────
router_groups.get('/', optionalAuth, async (req, res) => {
  try {
    const { page = 1, limit = 12 } = req.query;
    const groups = await Group.find({ isActive: true, privacy: { $ne: 'secret' } }).populate('admin', 'username avatar').sort({ membersCount: -1 }).skip((page-1)*limit).limit(+limit);
    res.json({ success: true, groups: groups.map(g => ({ ...g.toObject(), isMember: req.user ? g.members.some(m => m.toString() === req.user._id.toString()) : false })) });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});
 
router_groups.post('/:id/join', protect, async (req, res) => {
  try {
    const group = await Group.findById(req.params.id);
    if (!group) return res.status(404).json({ success: false, message: 'Group not found.' });
    const isMember = group.members.some(m => m.toString() === req.user._id.toString());
    if (isMember) { group.members.pull(req.user._id); group.membersCount = Math.max(0, group.membersCount-1); }
    else { if (group.privacy === 'private') { group.pendingMembers.push(req.user._id); await group.save(); return res.json({ success: true, status: 'pending' }); } group.members.push(req.user._id); group.membersCount++; }
    await group.save();
    res.json({ success: true, joined: !isMember, membersCount: group.membersCount });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});
 
router_groups.post('/', protect, async (req, res) => {
  try {
    const { name, description, privacy, category } = req.body;
    const group = await Group.create({ name, description, privacy, category, admin: req.user._id, members: [req.user._id], membersCount: 1 });
    res.status(201).json({ success: true, group });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});
 // Handle follow requests
router_users.post('/:id/follow-request/:action', protect, async (req, res) => {
  try {
    const { action } = req.params; // 'accept' or 'reject'
    const targetUser = await User.findById(req.user._id);
    const requestingUser = await User.findById(req.params.id);
    
    if (!targetUser || !requestingUser) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    
    // Remove from follow requests
    targetUser.followRequests.pull(requestingUser._id);
    
    if (action === 'accept') {
      // Add to followers
      targetUser.followers.push(requestingUser._id);
      requestingUser.following.push(targetUser._id);
      targetUser.followersCount++;
      requestingUser.followingCount++;
      
      // Send acceptance notification
      const notification = await Notification.create({
        recipient: requestingUser._id,
        sender: targetUser._id,
        type: 'follow_request_accepted',
        message: `${targetUser.username} accepted your follow request`
      });
      const io = req.app.get('io');
      const populatedNotif = await notification.populate('sender', 'username avatar');
      io.to('user:' + requestingUser._id).emit('notification', populatedNotif);
    }
    
    await Promise.all([
      targetUser.save({ validateBeforeSave: false }),
      requestingUser.save({ validateBeforeSave: false })
    ]);
    
    res.json({ 
      success: true, 
      message: `Follow request ${action}ed` 
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// Block/Unblock users
router_users.post('/:id/block', protect, async (req, res) => {
  try {
    const targetUserId = req.params.id;
    const currentUser = await User.findById(req.user._id);
    
    if (targetUserId === req.user._id.toString()) {
      return res.status(400).json({ success: false, message: "Can't block yourself" });
    }
    
    const isBlocked = currentUser.blockedUsers.includes(targetUserId);
    
    if (isBlocked) {
      // Unblock
      currentUser.blockedUsers.pull(targetUserId);
    } else {
      // Block
      currentUser.blockedUsers.push(targetUserId);
      // Also unfollow each other
      currentUser.following.pull(targetUserId);
      await User.findByIdAndUpdate(targetUserId, {
        $pull: { followers: currentUser._id }
      });
    }
    
    await currentUser.save({ validateBeforeSave: false });
    
    res.json({
      success: true,
      blocked: !isBlocked,
      message: isBlocked ? 'User unblocked' : 'User blocked'
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// Close Friends management
router_users.post('/close-friends/:id', protect, async (req, res) => {
  try {
    const targetUserId = req.params.id;
    const currentUser = await User.findById(req.user._id);
    
    const isCloseFriend = currentUser.closeFriends.includes(targetUserId);
    
    if (isCloseFriend) {
      currentUser.closeFriends.pull(targetUserId);
    } else {
      currentUser.closeFriends.push(targetUserId);
    }
    
    await currentUser.save({ validateBeforeSave: false });
    
    res.json({
      success: true,
      isCloseFriend: !isClosedFriend,
      message: isCloseFriend ? 'Removed from close friends' : 'Added to close friends'
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// Privacy settings update
router_users.put('/privacy-settings', protect, async (req, res) => {
  try {
    const { profileVisibility, storyVisibility, messagePermissions } = req.body;
    const user = await User.findByIdAndUpdate(
      req.user._id,
      {
        privacySettings: {
          profileVisibility: profileVisibility || 'public',
          storyVisibility: storyVisibility || 'public',
          messagePermissions: messagePermissions || 'everyone'
        }
      },
      { new: true }
    );
    
    res.json({
      success: true,
      privacySettings: user.privacySettings
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

module.exports = { userRoutes: router_users, commentRoutes: router_comments, messageRoutes: router_messages, storyRoutes: router_stories, notifRoutes: router_notifs, searchRoutes: router_search, exploreRoutes: router_explore, reelRoutes: router_reels, groupRoutes: router_groups };
