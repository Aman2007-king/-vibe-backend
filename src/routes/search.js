const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Post = require('../models/Post');
const { optionalAuth } = require('../middleware/auth');

// SEARCH
router.get('/', optionalAuth, async (req, res) => {
  try {
    const { q, type = 'all' } = req.query;
    if (!q?.trim()) return res.json({ success: true, users: [], posts: [], hashtags: [] });
    
    const results = {};
    
    if (type === 'all' || type === 'users') {
      results.users = await User.find({ 
        $or: [
          { username: { $regex: q, $options: 'i' } },
          { fullName: { $regex: q, $options: 'i' } }
        ], 
        isActive: true 
      })
        .select('username fullName avatar verified bio followersCount')
        .limit(10);
        
      results.users = results.users.map(u => ({ 
        ...u.toObject(), 
        avatar: u.avatarUrl 
      }));
    }
    
    if (type === 'all' || type === 'posts') {
      results.posts = await Post.find({ 
        caption: { $regex: q, $options: 'i' }, 
        isDeleted: false 
      })
        .populate('user', 'username avatar verified')
        .sort({ engagementScore: -1 })
        .limit(20);
        
      results.posts = results.posts.map(p => ({ 
        ...p.toObject(), 
        media: p.mediaUrls 
      }));
    }
    
    res.json({ success: true, ...results });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

module.exports = router;
