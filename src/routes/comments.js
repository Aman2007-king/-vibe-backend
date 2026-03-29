const express = require('express');
const router = express.Router();
const { Comment, Notification } = require('../models/index');
const Post = require('../models/Post');
const { protect, optionalAuth } = require('../middleware/auth');

// GET post comments
router.get('/:postId', optionalAuth, async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const comments = await Comment.find({ post: req.params.postId, parent: null, isDeleted: false })
      .populate('user', 'username avatar verified')
      .sort({ createdAt: -1 })
      .skip((page-1)*limit)
      .limit(+limit);
    res.json({ success: true, comments });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// CREATE comment
router.post('/:postId', protect, async (req, res) => {
  try {
    const { text, parentId } = req.body;
    if (!text?.trim()) return res.status(400).json({ success: false, message: 'Comment text required.' });
    
    const post = await Post.findById(req.params.postId).select('user commentsDisabled');
    if (!post) return res.status(404).json({ success: false, message: 'Post not found.' });
    if (post.commentsDisabled) return res.status(403).json({ success: false, message: 'Comments disabled.' });
    
    const comment = await Comment.create({ 
      post: post._id, 
      user: req.user._id, 
      text: text.trim(), 
      parent: parentId || null 
    });
    
    await Post.findByIdAndUpdate(post._id, { $inc: { commentsCount: 1 } });
    
    if (parentId) {
      await Comment.findByIdAndUpdate(parentId, { 
        $push: { replies: comment._id }, 
        $inc: { repliesCount: 1 } 
      });
    }
    
    const populated = await comment.populate('user', 'username avatar verified');
    req.app.get('io').emit('comment_added', { postId: post._id, comment: populated });
    
    if (post.user.toString() !== req.user._id.toString()) {
      const notif = await Notification.create({
        recipient: post.user,
        sender: req.user._id,
        type: 'comment',
        post: post._id,
        message: req.user.username + ' commented: "' + text.slice(0,40) + '"'
      });
      
      const pop = await notif.populate('sender', 'username avatar');
      req.app.get('io').to('user:' + post.user).emit('notification', pop);
    }
    
    res.status(201).json({ success: true, comment: populated });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// LIKE/UNLIKE comment
router.post('/:id/like', protect, async (req, res) => {
  try {
    const comment = await Comment.findById(req.params.id);
    if (!comment) return res.status(404).json({ success: false, message: 'Comment not found.' });
    
    const liked = comment.likes.some(id => id.toString() === req.user._id.toString());
    
    if (liked) {
      comment.likes.pull(req.user._id);
      comment.likesCount--;
    } else {
      comment.likes.push(req.user._id);
      comment.likesCount++;
    }
    
    await comment.save();
    res.json({ success: true, liked: !liked, likesCount: comment.likesCount });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// DELETE comment
router.delete('/:id', protect, async (req, res) => {
  try {
    const comment = await Comment.findById(req.params.id);
    if (!comment) return res.status(404).json({ success: false, message: 'Comment not found.' });
    
    if (comment.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Not authorized.' });
    }
    
    comment.isDeleted = true;
    await comment.save();
    await Post.findByIdAndUpdate(comment.post, { $inc: { commentsCount: -1 } });
    
    req.app.get('io').emit('comment_deleted', { 
      postId: comment.post, 
      commentId: comment._id 
    });
    
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

module.exports = router;
