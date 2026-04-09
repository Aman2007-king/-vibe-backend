const router   = require('express').Router();
const supabase = require('../db/supabase');
const { protect } = require('../middleware/auth');

router.get('/', protect, async (req, res) => {
  try {
    const limit = Math.min(50, parseInt(req.query.limit)||30);
    const { data } = await supabase.from('notifications')
      .select('*, sender:users!sender_id(id,username,full_name,avatar,verified), post:posts!post_id(id,media,caption)')
      .eq('recipient_id',req.user.id).order('created_at',{ascending:false}).limit(limit);
    await supabase.from('notifications').update({ is_read:true, read_at:new Date().toISOString() }).eq('recipient_id',req.user.id).eq('is_read',false);
    res.json({ success:true, notifications:(data||[]).map(n=>({
      id:n.id, _id:n.id, type:n.type, message:n.message, isRead:n.is_read, createdAt:n.created_at,
      sender: n.sender ? { id:n.sender.id, _id:n.sender.id, username:n.sender.username, fullName:n.sender.full_name, avatar:n.sender.avatar||`https://ui-avatars.com/api/?name=${encodeURIComponent(n.sender.full_name||'U')}&background=0095f6&color=fff`, verified:n.sender.verified||false } : null,
      post: n.post || null,
    })) });
  } catch(e) { res.status(500).json({ success:false, message:e.message }); }
});

router.get('/unread-count', protect, async (req, res) => {
  try {
    const { count } = await supabase.from('notifications').select('*',{count:'exact',head:true}).eq('recipient_id',req.user.id).eq('is_read',false);
    res.json({ success:true, count:count||0 });
  } catch(e) { res.status(500).json({ success:false, message:e.message }); }
});

module.exports = router;
