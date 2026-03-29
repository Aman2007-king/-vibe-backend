const express = require('express');
const router = express.Router();
const { Story } = require('../models/index');
const User = require('../models/User');
const { protect, optionalAuth } = require('../middleware/auth');
const { upload, handleStoryUpload } = require('../middleware/upload');

// GET stories feed
router.get('/feed', protect, async (req, res) => {
  try {
    const me = await User.findById(req.user._id).select('following');
    const ids = [...(me.following||[]), req.user._id];
    
    const stories = await Story.find({ 
      user: { $in: ids }, 
      isDeleted: false, 
      expiresAt: { $gt: new Date() } 
    })
      .populate('user', 'username avatar verified')
      .sort({ createdAt: -1 });
      
    const grouped = {};
    stories.forEach(s => {
      const uid = s.user._id.toString();
      if (!grouped[uid]) {
        grouped[uid] = { user: s.user, stories: [], hasUnread: false };
      }
      
      const seen = s.viewers?.some(v => v.user?.toString() === req.user._id.toString());
      grouped[uid].stories.push({ ...s.toObject(), seen });
      if (!seen) grouped[uid].hasUnread = true;
    });
    
    res.json({ success: true, storyGroups: Object.values(grouped) });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// CREATE story
router.post('/', protect, upload.single('media'), handleStoryUpload, async (req, res) => {
  try {
    if (!req.storyFilename) return res.status(400).json({ success: false, message: 'Media required.' });
    
    const { text, location, audience } = req.body;
    const story = await Story.create({ 
      user: req.user._id, 
      media: { 
        url: req.storyFilename, 
        type: req.storyIsVideo ? 'video' : 'image' 
      }, 
      text, 
      location, 
      audience: audience || 'all' 
    });
    
    await User.findByIdAndUpdate(req.user._id, { $inc: { storiesCount: 1 } });
    const populated = await story.populate('user', 'username avatar verified');
    
    const fullUser = await User.findById(req.user._id).select('followers');
    fullUser.followers.forEach(fid => {
      req.app.get('io').to('user:' + fid).emit('new_story', populated);
    });
    
    res.status(201).json({ success: true, story: populated });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// VIEW story
router.post('/:id/view', protect, async (req, res) => {
  try {
    const story = await Story.findById(req.params.id);
    if (!story) return res.status(404).json({ success: false, message: 'Story not found.' });
    
    const alreadyViewed = story.viewers?.some(v => v.user?.toString() === req.user._id.toString());
    
    if (!alreadyViewed) {
      story.viewers.push({ user: req.user._id, viewedAt: new Date() });
      story.viewersCount++;
      await story.save();
      
      req.app.get('io').to('user:' + story.user).emit('story_viewed', {
        storyId: story._id,
        viewedBy: { 
          id: req.user._id, 
          username: req.user.username, 
          avatar: req.user.avatarUrl 
        }
      });
    }
    
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

module.exports = router;
