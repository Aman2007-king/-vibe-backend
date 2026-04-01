const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { protect, optionalAuth } = require('../middleware/auth');
const { upload } = require('../middleware/upload');
const { isUserOnline } = require('../socket/socketManager');

// GET user profile
router.get('/:username', optionalAuth, async (req, res) => {
  try {
    const user = await User.findOne({ username: req.params.username.toLowerCase() });
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
    const pub = user.toPublicJSON(req.user?._id); 
    pub.isOnline = isUserOnline(user._id);
    res.json({ success: true, user: pub });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// UPDATE user profile
router.put('/me', protect, upload.single('avatar'), async (req, res) => {
  try {
    const allowed = ['fullName','bio','website','location','isPrivate','accountType', 'profileTheme'];
    const updates = {};
    
    allowed.forEach(f => {
      if (req.body[f] !== undefined) updates[f] = req.body[f];
    });
    
    if (req.file) {
      const { handleAvatarUpload } = require('../middleware/upload');
      req.file = req.file;
      await new Promise((res, rej) => handleAvatarUpload(req, {}, e => e ? rej(e) : res()));
      if (req.avatarFilename) updates.avatar = req.avatarFilename;
    }
    
    const user = await User.findByIdAndUpdate(req.user._id, updates, { new: true, runValidators: true });
    res.json({ success: true, user: { ...user.toObject(), avatar: user.avatarUrl } });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// FOLLOW/UNFOLLOW user
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


// GET user followers
router.get('/:id/followers', optionalAuth, async (req, res) => {
  try {
    const user = await User.findById(req.params.id).populate('followers', 'username fullName avatar verified bio followersCount');
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
    res.json({
      success: true,
      followers: user.followers.map(u => ({
        ...u.toObject(),
        isOnline: isUserOnline(u._id),
        avatar: u.avatarUrl
      }))
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// GET user following
router.get('/:id/following', optionalAuth, async (req, res) => {
  try {
    const user = await User.findById(req.params.id).populate('following', 'username fullName avatar verified bio followersCount');
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
    res.json({
      success: true,
      following: user.following.map(u => ({
        ...u.toObject(),
        isOnline: isUserOnline(u._id),
        avatar: u.avatarUrl
      }))
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// GET user suggestions
router.get('/:id/suggestions', protect, async (req, res) => {
  try {
    const me = await User.findById(req.user._id).select('following');
    const exclude = [...(me.following||[]), req.user._id];
    const suggestions = await User.find({ _id: { $nin: exclude }, isActive: true })
      .select('username fullName avatar verified bio followersCount')
      .sort({ followersCount: -1 })
      .limit(10);
      
    res.json({
      success: true,
      suggestions: suggestions.map(u => ({ ...u.toObject(), avatar: u.avatarUrl }))
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

module.exports = router;
