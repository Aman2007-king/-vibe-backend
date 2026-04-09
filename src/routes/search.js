const router   = require('express').Router();
const supabase = require('../db/supabase');
const { optionalAuth } = require('../middleware/auth');
const { formatUser, formatPost } = require('../utils/helpers');

router.get('/', optionalAuth, async (req, res) => {
  try {
    const q = (req.query.q||'').trim();
    if(!q) return res.json({ success:true, users:[], posts:[] });
    const [{ data:users },{ data:posts }] = await Promise.all([
      supabase.from('users').select('id,username,full_name,avatar,verified,bio,followers_count').or(`username.ilike.%${q}%,full_name.ilike.%${q}%`).eq('is_active',true).limit(10),
      supabase.from('posts').select('*, users!user_id(id,username,full_name,avatar,verified)').or(`caption.ilike.%${q}%,location.ilike.%${q}%`).eq('is_deleted',false).order('likes_count',{ascending:false}).limit(15),
    ]);
    res.json({ success:true, users:(users||[]).map(formatUser), posts:(posts||[]).map(p=>formatPost(p)) });
  } catch(e) { res.status(500).json({ success:false, message:e.message }); }
});

module.exports = router;
