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
router.post('/:id/follow', protect, async (req, res) => {
  try {
    if (req.params.id === req.user._id.toString()) {
      return res.status(400).json({ success: false, message: "Can't follow yourself." });
    }
    
    const [target, me] = await Promise.all([
      User.findById(req.params.id),
      User.findById(req.user._id)
    ]);
    
    if (!target) return res.status(404).json({ success: false, message: 'User not found.' });
    
    const already = me.following.some(id => id.toString() === target._id.toString());
    
    if (already) {
      me.following.pull(target._id);
      target.followers.pull(me._id);
      me.followingCount = Math.max(0, me.followingCount-1);
      target.followersCount = Math.max(0, target.followersCount-1);
    } else {
      me.following.push(target._id);
      target.followers.push(me._id);
      me.followingCount++;
      target.followersCount++;
      
      const notif = await Notification.create({
        recipient: target._id,
        sender: me._id,
        type: 'follow',
        message: me.username + ' started following you'
      });
      
      const pop = await notif.populate('sender', 'username avatar verified');
      req.app.get('io').to('user:' + target._id).emit('notification', pop);
      req.app.get('io').to('user:' + target._id).emit('new_follower', {
        from: { id: me._id, username: me.username, avatar: me.avatarUrl }
      });
    }
    
    await Promise.all([
      me.save({ validateBeforeSave: false }),
      target.save({ validateBeforeSave: false })
    ]);
    
    res.json({ success: true, following: !already, followersCount: target.followersCount });
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
