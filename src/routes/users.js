const express = require('express');
const router  = express.Router();
const User    = require('../models/User');
const { Notification } = require('../models/index'); // ✅ FIX: was missing, caused crashes on follow
const { protect, optionalAuth } = require('../middleware/auth');
const { upload, handleAvatarUpload } = require('../middleware/upload');
const { isUserOnline } = require('../socket/socketManager');

// ═══════════════════════════════════════════════════════
// IMPORTANT: specific routes MUST come before /:username
// otherwise 'me', 'close-friends' etc get matched as usernames
// ═══════════════════════════════════════════════════════

// ── UPDATE MY PROFILE ──────────────────────────────────
router.put('/me', protect, upload.single('avatar'), async (req, res) => {
  try {
    const allowed = ['fullName', 'bio', 'website', 'location', 'isPrivate', 'accountType', 'username'];
    const updates = {};
    allowed.forEach(f => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });

    // Handle avatar upload
    if (req.file) {
      await new Promise((resolve, reject) =>
        handleAvatarUpload(req, {}, e => e ? reject(e) : resolve())
      );
      if (req.avatarFilename) updates.avatar = req.avatarFilename;
    }

    // If username is being changed, check it's not taken
    if (updates.username) {
      updates.username = updates.username.toLowerCase().trim();
      const existing = await User.findOne({ username: updates.username, _id: { $ne: req.user._id } });
      if (existing) return res.status(409).json({ success: false, message: 'Username already taken.' });
    }

    const user = await User.findByIdAndUpdate(req.user._id, updates, { new: true, runValidators: true });
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

    res.json({ success: true, user: { ...user.toObject(), avatar: user.avatarUrl } });
  } catch (e) {
    console.error('Update profile error:', e);
    res.status(500).json({ success: false, message: e.message });
  }
});

// ── PRIVACY SETTINGS ───────────────────────────────────
router.put('/privacy-settings', protect, async (req, res) => {
  try {
    const { profileVisibility, storyVisibility, messagePermissions } = req.body;
    const user = await User.findByIdAndUpdate(
      req.user._id,
      {
        privacySettings: {
          profileVisibility:  profileVisibility  || 'public',
          storyVisibility:    storyVisibility    || 'public',
          messagePermissions: messagePermissions || 'everyone',
        }
      },
      { new: true }
    );
    res.json({ success: true, privacySettings: user.privacySettings });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ── CLOSE FRIENDS ───────────────────────────────────────
router.post('/close-friends/:id', protect, async (req, res) => {
  try {
    const currentUser = await User.findById(req.user._id);
    if (!currentUser) return res.status(404).json({ success: false, message: 'User not found.' });

    const targetUserId = req.params.id;
    const isCloseFriend = currentUser.closeFriends?.includes(targetUserId);

    if (isCloseFriend) {
      currentUser.closeFriends.pull(targetUserId);
    } else {
      if (!currentUser.closeFriends) currentUser.closeFriends = [];
      currentUser.closeFriends.push(targetUserId);
    }

    await currentUser.save({ validateBeforeSave: false });
    res.json({
      success: true,
      isCloseFriend: !isCloseFriend,
      message: isCloseFriend ? 'Removed from close friends' : 'Added to close friends',
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ── SUGGESTIONS ─────────────────────────────────────────
router.get('/suggestions/people', protect, async (req, res) => {
  try {
    const me = await User.findById(req.user._id).select('following');
    const exclude = [...(me.following || []), req.user._id];
    const suggestions = await User.find({ _id: { $nin: exclude }, isActive: true })
      .select('username fullName avatar verified bio followersCount')
      .sort({ followersCount: -1 })
      .limit(10);
    res.json({
      success: true,
      suggestions: suggestions.map(u => ({ ...u.toObject(), avatar: u.avatarUrl })),
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ═══════════════════════════════════════════════════════
// Routes with :id or :username param — AFTER specific routes
// ═══════════════════════════════════════════════════════

// ── GET USER PROFILE ────────────────────────────────────
router.get('/:username', optionalAuth, async (req, res) => {
  try {
    const user = await User.findOne({ username: req.params.username.toLowerCase() });
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
    const pub = user.toPublicJSON ? user.toPublicJSON(req.user?._id) : user.toObject();
    pub.isOnline = isUserOnline(user._id);
    pub.avatar = user.avatarUrl;
    res.json({ success: true, user: pub });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ── FOLLOW / UNFOLLOW ───────────────────────────────────
router.post('/:id/follow', protect, async (req, res) => {
  try {
    if (req.params.id === req.user._id.toString()) {
      return res.status(400).json({ success: false, message: "Can't follow yourself." });
    }

    const [targetUser, currentUser] = await Promise.all([
      User.findById(req.params.id),
      User.findById(req.user._id),
    ]);

    if (!targetUser) return res.status(404).json({ success: false, message: 'User not found.' });
    if (!currentUser) return res.status(404).json({ success: false, message: 'Your account not found.' });

    const io = req.app.get('io');

    // Private account → send follow request instead
    if (targetUser.privacySettings?.profileVisibility === 'private') {
      const alreadyRequested = targetUser.followRequests?.includes(currentUser._id);
      if (!alreadyRequested) {
        if (!targetUser.followRequests) targetUser.followRequests = [];
        targetUser.followRequests.push(currentUser._id);
        await targetUser.save({ validateBeforeSave: false });

        // Notify target
        try {
          const notif = await Notification.create({
            recipient: targetUser._id,
            sender:    currentUser._id,
            type:      'follow_request',
            message:   `${currentUser.username} wants to follow you`,
          });
          const populated = await notif.populate('sender', 'username avatar');
          io?.to('user:' + targetUser._id).emit('notification', populated);
        } catch (ne) { console.error('Notif error:', ne.message); }
      }
      return res.json({ success: true, requested: true, message: 'Follow request sent' });
    }

    // Public account → direct follow/unfollow
    const alreadyFollowing = currentUser.following?.some(
      id => id.toString() === targetUser._id.toString()
    );

    if (alreadyFollowing) {
      // Unfollow
      currentUser.following.pull(targetUser._id);
      targetUser.followers.pull(currentUser._id);
      currentUser.followingCount = Math.max(0, (currentUser.followingCount || 1) - 1);
      targetUser.followersCount  = Math.max(0, (targetUser.followersCount  || 1) - 1);
    } else {
      // Follow
      if (!currentUser.following) currentUser.following = [];
      if (!targetUser.followers)  targetUser.followers  = [];
      currentUser.following.push(targetUser._id);
      targetUser.followers.push(currentUser._id);
      currentUser.followingCount = (currentUser.followingCount || 0) + 1;
      targetUser.followersCount  = (targetUser.followersCount  || 0) + 1;

      // Notify target
      try {
        const notif = await Notification.create({
          recipient: targetUser._id,
          sender:    currentUser._id,
          type:      'follow',
          message:   `${currentUser.username} started following you`,
        });
        const populated = await notif.populate('sender', 'username avatar verified');
        io?.to('user:' + targetUser._id).emit('notification', populated);
        io?.to('user:' + targetUser._id).emit('new_follower', {
          from: { id: currentUser._id, username: currentUser.username, avatar: currentUser.avatarUrl },
        });
      } catch (ne) { console.error('Notif error:', ne.message); }
    }

    await Promise.all([
      currentUser.save({ validateBeforeSave: false }),
      targetUser.save({ validateBeforeSave: false }),
    ]);

    res.json({
      success:        true,
      following:      !alreadyFollowing,
      followersCount: targetUser.followersCount,
    });
  } catch (e) {
    console.error('Follow error:', e);
    res.status(500).json({ success: false, message: e.message });
  }
});

// ── ACCEPT / REJECT FOLLOW REQUEST ─────────────────────
router.post('/:id/follow-request/:action', protect, async (req, res) => {
  try {
    const { action } = req.params; // 'accept' or 'reject'
    if (!['accept', 'reject'].includes(action)) {
      return res.status(400).json({ success: false, message: 'Action must be accept or reject.' });
    }

    const [targetUser, requestingUser] = await Promise.all([
      User.findById(req.user._id),
      User.findById(req.params.id),
    ]);

    if (!targetUser || !requestingUser) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    // Remove from pending requests
    targetUser.followRequests?.pull(requestingUser._id);

    if (action === 'accept') {
      if (!targetUser.followers)  targetUser.followers  = [];
      if (!requestingUser.following) requestingUser.following = [];
      targetUser.followers.push(requestingUser._id);
      requestingUser.following.push(targetUser._id);
      targetUser.followersCount  = (targetUser.followersCount  || 0) + 1;
      requestingUser.followingCount = (requestingUser.followingCount || 0) + 1;

      // Notify requester
      try {
        const notif = await Notification.create({
          recipient: requestingUser._id,
          sender:    targetUser._id,
          type:      'follow_request_accepted',
          message:   `${targetUser.username} accepted your follow request`,
        });
        const io = req.app.get('io');
        const populated = await notif.populate('sender', 'username avatar');
        io?.to('user:' + requestingUser._id).emit('notification', populated);
      } catch (ne) { console.error('Notif error:', ne.message); }
    }

    await Promise.all([
      targetUser.save({ validateBeforeSave: false }),
      requestingUser.save({ validateBeforeSave: false }),
    ]);

    res.json({ success: true, message: `Follow request ${action}ed` });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ── BLOCK / UNBLOCK ─────────────────────────────────────
router.post('/:id/block', protect, async (req, res) => {
  try {
    const targetUserId = req.params.id;
    if (targetUserId === req.user._id.toString()) {
      return res.status(400).json({ success: false, message: "Can't block yourself." });
    }

    const currentUser = await User.findById(req.user._id);
    if (!currentUser) return res.status(404).json({ success: false, message: 'User not found.' });

    const isBlocked = currentUser.blockedUsers?.includes(targetUserId);

    if (isBlocked) {
      currentUser.blockedUsers.pull(targetUserId);
    } else {
      if (!currentUser.blockedUsers) currentUser.blockedUsers = [];
      currentUser.blockedUsers.push(targetUserId);
      // Also unfollow both ways
      currentUser.following.pull(targetUserId);
      currentUser.followingCount = Math.max(0, (currentUser.followingCount || 1) - 1);
      await User.findByIdAndUpdate(targetUserId, {
        $pull: { followers: currentUser._id },
        $inc:  { followersCount: -1 },
      });
    }

    await currentUser.save({ validateBeforeSave: false });
    res.json({
      success: true,
      blocked: !isBlocked,
      message: isBlocked ? 'User unblocked' : 'User blocked',
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ── GET FOLLOWERS LIST ──────────────────────────────────
router.get('/:id/followers', optionalAuth, async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
      .populate('followers', 'username fullName avatar verified bio followersCount');
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

    const isFollowingMe = req.user
      ? user.followers.map(f => f._id.toString()).includes(req.user._id.toString())
      : false;

    res.json({
      success:   true,
      followers: user.followers.map(u => ({
        ...u.toObject(),
        avatar:   u.avatarUrl,
        isOnline: isUserOnline(u._id),
      })),
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ── GET FOLLOWING LIST ──────────────────────────────────
router.get('/:id/following', optionalAuth, async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
      .populate('following', 'username fullName avatar verified bio followersCount');
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

    res.json({
      success:   true,
      following: user.following.map(u => ({
        ...u.toObject(),
        avatar:   u.avatarUrl,
        isOnline: isUserOnline(u._id),
      })),
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ── SUGGESTIONS (alternative route with :id param) ─────
router.get('/:id/suggestions', protect, async (req, res) => {
  try {
    const me = await User.findById(req.user._id).select('following');
    const exclude = [...(me.following || []), req.user._id];
    const suggestions = await User.find({ _id: { $nin: exclude }, isActive: true })
      .select('username fullName avatar verified bio followersCount')
      .sort({ followersCount: -1 })
      .limit(10);
    res.json({
      success:     true,
      suggestions: suggestions.map(u => ({ ...u.toObject(), avatar: u.avatarUrl })),
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

module.exports = router;
