const express = require('express');
const router = express.Router();
const { Conversation, Message } = require('../models/index');
const { protect, optionalAuth } = require('../middleware/auth');
const { isUserOnline } = require('../socket/socketManager');
const { upload, handlePostUpload } = require('../middleware/upload');

// GET conversations
router.get('/conversations', protect, async (req, res) => {
  try {
    const convs = await Conversation.find({ participants: req.user._id })
      .populate('participants', 'username fullName avatar verified')
      .sort({ 'lastMessage.ts': -1 });
      
    const result = convs.map(c => {
      const other = c.participants.find(p => p._id.toString() !== req.user._id.toString());
      return {
        id: c._id,
        isGroup: c.isGroup,
        groupName: c.groupName,
        partner: other ? { 
          ...other.toObject(), 
          avatar: other.avatarUrl 
          isOnline: isUserOnline(other._id) 
        } : null,
        lastMessage: c.lastMessage,
        unreadCount: c.unreadCounts?.get(req.user._id.toString()) || 0
      };
    });
    
    res.json({ success: true, conversations: result });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// CREATE conversation
router.post('/conversations', protect, async (req, res) => {
  try {
    const { userId } = req.body;
    let conv = await Conversation.findOne({ 
      participants: { $all: [req.user._id, userId], $size: 2 }, 
      isGroup: false 
    });
    
    if (!conv) {
      conv = await Conversation.create({ participants: [req.user._id, userId] });
    }
    
    await conv.populate('participants', 'username fullName avatar verified');
    res.json({ success: true, conversation: conv });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// GET messages
router.get('/:conversationId', protect, async (req, res) => {
  try {
    const { page = 1, limit = 30 } = req.query;
    const msgs = await Message.find({ 
      conversation: req.params.conversationId, 
      isDeleted: false 
    })
      .populate('sender', 'username avatar verified')
      .sort({ createdAt: -1 })
      .skip((page-1)*limit)
      .limit(+limit);
      
    await Conversation.findByIdAndUpdate(req.params.conversationId, { 
      $set: { ['unreadCounts.' + req.user._id]: 0 } 
    });
    
    res.json({ success: true, messages: msgs.reverse(), page: +page });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// SEND message
router.post('/:conversationId', protect, upload.single('media'), handlePostUpload, async (req, res) => {
  try {
    const { text, type = 'text', replyTo } = req.body;
    const conv = await Conversation.findById(req.params.conversationId);
    
    if (!conv) return res.status(404).json({ success: false, message: 'Conversation not found.' });
    
    const media = req.processedMedia?.[0];
    const msg = await Message.create({ 
      conversation: conv._id, 
      sender: req.user._id, 
      type, 
      text: text?.trim(), 
      media, 
      replyTo,
      deliveredTo: conv.participants.filter(p => p.toString() !== req.user._id.toString())
    });
    
    const updates = { 
      lastMessage: { 
        text: text || (media ? '📷 Media' : ''), 
        type, 
        senderId: req.user._id, 
        ts: new Date() 
      } 
    };
    
    conv.participants.forEach(pid => {
      if (pid.toString() !== req.user._id.toString()) {
        updates['unreadCounts.' + pid] = (conv.unreadCounts?.get(pid.toString()) || 0) + 1;
      }
    });
    
    await Conversation.findByIdAndUpdate(conv._id, { $set: updates });
    const populated = await msg.populate('sender', 'username avatar verified');
    
    const io = req.app.get('io');
    io.to('conv:' + conv._id).emit('new_message', { 
      conversationId: conv._id, 
      message: populated 
    });
    
    conv.participants.forEach(pid => {
      if (pid.toString() !== req.user._id.toString()) {
        io.to('user:' + pid).emit('dm_notification', {
          conversationId: conv._id,
          from: { 
            id: req.user._id, 
            username: req.user.username, 
            avatar: req.user.avatarUrl 
          },
          preview: text || '📷 Media',
          ts: Date.now()
        });
      }
    });
    
    res.status(201).json({ success: true, message: populated });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

module.exports = router;
