const router   = require('express').Router();
const supabase = require('../db/supabase');
const { optionalAuth } = require('../middleware/auth');
const { formatPost } = require('../utils/helpers');

router.get('/', optionalAuth, async (req, res) => {
  try {
    const limit  = Math.min(30, parseInt(req.query.limit)||30);
    const page   = Math.max(1, parseInt(req.query.page)||1);
    const offset = (page-1)*limit;
    let excludeIds = [];
    if(req.user){
      const { data:f } = await supabase.from('follows').select('following_id').eq('follower_id',req.user.id);
      excludeIds = [...(f||[]).map(x=>x.following_id), req.user.id];
    }
    let query = supabase.from('posts')
      .select('*, users!user_id(id,username,full_name,avatar,verified)')
      .in('type',['post','reel']).eq('is_deleted',false)
      .order('likes_count',{ascending:false}).range(offset, offset+limit-1);
    if(excludeIds.length) query = query.not('user_id','in',`(${excludeIds.join(',')})`);
    const { data:posts } = await query;
    res.json({ success:true, posts:(posts||[]).map(p=>formatPost(p)) });
  } catch(e) { res.status(500).json({ success:false, message:e.message }); }
});

module.exports = router;
