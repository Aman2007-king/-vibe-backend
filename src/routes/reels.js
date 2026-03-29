const express = require('express');
const router = express.Router();
const Post = require('../models/Post');
const User = require('../models/User');
const { optionalAuth } = require('../middleware/auth');

// GET reels
router.get('/', optionalAuth, async (req, res) => {
  try {
    const { page = 1, limit = 10, cursor } = req.query;
    const query = { type: 'reel', isDeleted: false };
    
    if (cursor) query._id = { $lt: cursor };
    
    const reels = await Post.find(query)
      .populate('user', 'username fullName avatar verified bio followersCount')
      .sort({ createdAt: -1 })
      .limit(+limit);
      
    res.json({ 
      success: true, 
      reels: reels.map(r => ({ 
        ...r.toObject(), 
        media: r.mediaUrls, 
        isLiked: req.user ? r.isLikedBy(req.user._id) : false 
      })), 
      nextCursor: reels[reels.length-1]?._id 
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// VIEW reel
router.post('/:id/view', optionalAuth, async (req, res) => {
  try {
    await Post.findByIdAndUpdate(req.params.id, { $inc: { viewsCount: 1 } });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

module.exports = router;
