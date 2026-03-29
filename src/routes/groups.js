const express = require('express');
const router = express.Router();
const { Group } = require('../models/index');
const { protect, optionalAuth } = require('../middleware/auth');

// GET groups
router.get('/', optionalAuth, async (req, res) => {
  try {
    const { page = 1, limit = 12 } = req.query;
    const groups = await Group.find({ 
      isActive: true, 
      privacy: { $ne: 'secret' } 
    })
      .populate('admin', 'username avatar')
      .sort({ membersCount: -1 })
      .skip((page-1)*limit)
      .limit(+limit);
      
    res.json({ 
      success: true, 
      groups: groups.map(g => ({ 
        ...g.toObject(), 
        isMember: req.user ? g.members.some(m => m.toString() === req.user._id.toString()) : false 
      })) 
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// JOIN/LEAVE group
router.post('/:id/join', protect, async (req, res) => {
  try {
    const group = await Group.findById(req.params.id);
    if (!group) return res.status(404).json({ success: false, message: 'Group not found.' });
    
    const isMember = group.members.some(m => m.toString() === req.user._id.toString());
    
    if (isMember) {
      group.members.pull(req.user._id);
      group.membersCount = Math.max(0, group.membersCount-1);
    } else {
      if (group.privacy === 'private') {
        group.pendingMembers.push(req.user._id);
        await group.save();
        return res.json({ success: true, status: 'pending' });
      }
      group.members.push(req.user._id);
      group.membersCount++;
    }
    
    await group.save();
    res.json({ success: true, joined: !isMember, membersCount: group.membersCount });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// CREATE group
router.post('/', protect, async (req, res) => {
  try {
    const { name, description, privacy, category } = req.body;
    const group = await Group.create({ 
      name, 
      description, 
      privacy, 
      category, 
      admin: req.user._id, 
      members: [req.user._id], 
      membersCount: 1 
    });
    
    res.status(201).json({ success: true, group });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

module.exports = router;
