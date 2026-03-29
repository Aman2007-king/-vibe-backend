const express = require('express');
const router = express.Router();
const Post = require('../models/Post');
const User = require('../models/User');
const { optionalAuth } = require('../middleware/auth');

// GET explore feed
router.get('/', optionalAuth, async (req, res) => {
  try {
    const { page = 1, limit = 30 } = req.query;
    let exclude = [];
    
    if (req.user) {
      const user = await User.findById(req.user._id).select('following');
      exclude = [...(user.following || []), req.user._id];
    }
    
    const posts = await Post.find({ 
      user: req.user ? { $nin: exclude } : {}, 
      isDeleted: false, 
      'media.0': { $exists: true } 
    })
      .populate('user', 'username avatar verified')
      .sort({ engagementScore: -1, createdAt: -1 })
      .skip((page-1)*limit)
      .limit(+limit);
      
    res.json({ 
      success: true, 
      posts: posts.map(p => ({ ...p.toObject(), media: p.mediaUrls })) 
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

module.exports = router;
