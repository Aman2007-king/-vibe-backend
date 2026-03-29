const express = require('express');
const router = express.Router();
const { Notification } = require('../models/index');
const { protect, optionalAuth } = require('../middleware/auth');

// GET notifications
router.get('/', protect, async (req, res) => {
  try {
    const { page = 1, limit = 30 } = req.query;
    const notifs = await Notification.find({ recipient: req.user._id })
      .populate('sender', 'username avatar verified')
      .populate('post', 'media')
      .sort({ createdAt: -1 })
      .skip((page-1)*limit)
      .limit(+limit);
      
    const unreadCount = await Notification.countDocuments({ 
      recipient: req.user._id, 
      isRead: false 
    });
    
    res.json({ success: true, notifications: notifs, unreadCount });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// MARK all notifications as read
router.put('/read-all', protect, async (req, res) => {
  try {
    await Notification.updateMany(
      { recipient: req.user._id, isRead: false }, 
      { isRead: true, readAt: new Date() }
    );
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

module.exports = router;
