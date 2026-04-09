const router   = require('express').Router();
const supabase = require('../db/supabase');
const { optionalAuth } = require('../middleware/auth');
const { formatPost } = require('../utils/helpers');

router.get('/', optionalAuth, async (req, res) => {
  try {
    const limit = Math.min(20, parseInt(req.query.limit)||10);
    const { data:reels } = await supabase.from('posts')
      .select('*, users!user_id(id,username,full_name,avatar,verified,bio,followers_count)')
      .eq('type','reel').eq('is_deleted',false).order('likes_count',{ascending:false}).limit(limit);
    let likedSet = new Set();
    if(req.user && reels?.length){
      const { data:liked } = await supabase.from('likes').select('post_id').eq('user_id',req.user.id).in('post_id',reels.map(r=>r.id));
      likedSet = new Set((liked||[]).map(l=>l.post_id));
    }
    res.json({ success:true, reels:(reels||[]).map(r=>formatPost({...r,isLiked:likedSet.has(r.id)})) });
  } catch(e) { res.status(500).json({ success:false, message:e.message }); }
});

router.post('/:id/view', optionalAuth, async (req, res) => {
  try {
    const { data:p } = await supabase.from('posts').select('id,views_count').eq('id',req.params.id).single();
    if(p) await supabase.from('posts').update({ views_count:(p.views_count||0)+1 }).eq('id',p.id);
    res.json({ success:true });
  } catch(e) { res.status(500).json({ success:false, message:e.message }); }
});

module.exports = router;
