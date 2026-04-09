const router   = require('express').Router();
const supabase = require('../db/supabase');
const { protect, optionalAuth } = require('../middleware/auth');
const notify   = require('../utils/notify');

router.get('/:postId', optionalAuth, async (req, res) => {
  try {
    const limit  = Math.min(50, parseInt(req.query.limit) || 20);
    const page   = Math.max(1, parseInt(req.query.page) || 1);
    const { data } = await supabase
      .from('comments')
      .select('*, users!user_id(id, username, full_name, avatar, verified)')
      .eq('post_id', req.params.postId)
      .eq('is_deleted', false)
      .is('parent_id', null)
      .order('created_at', { ascending: false })
      .range((page-1)*limit, page*limit-1);
    res.json({ success: true, comments: (data||[]).map(c => ({
      id: c.id, _id: c.id, text: c.text, likesCount: c.likes_count||0, repliesCount: c.replies_count||0, createdAt: c.created_at,
      user: { id: c.users?.id, _id: c.users?.id, username: c.users?.username, fullName: c.users?.full_name, avatar: c.users?.avatar||`https://ui-avatars.com/api/?name=${encodeURIComponent(c.users?.full_name||'U')}&background=0095f6&color=fff`, verified: c.users?.verified||false },
    })) });
  } catch(e) { res.status(500).json({ success:false, message:e.message }); }
});

router.post('/:postId', protect, async (req, res) => {
  try {
    const { text, parentId } = req.body;
    if (!text?.trim()) return res.status(400).json({ success:false, message:'Comment text required.' });
    const { data: post } = await supabase.from('posts').select('id,user_id,comments_disabled,comments_count').eq('id',req.params.postId).single();
    if (!post) return res.status(404).json({ success:false, message:'Post not found.' });
    if (post.comments_disabled) return res.status(403).json({ success:false, message:'Comments disabled.' });
    const { data: comment, error } = await supabase.from('comments')
      .insert({ post_id:req.params.postId, user_id:req.user.id, text:text.trim(), parent_id:parentId||null })
      .select('*, users!user_id(id,username,full_name,avatar,verified)').single();
    if (error) throw error;
    await supabase.from('posts').update({ comments_count:(post.comments_count||0)+1 }).eq('id',post.id);
    if (parentId) {
      const { data:p } = await supabase.from('comments').select('replies_count').eq('id',parentId).single();
      if(p) await supabase.from('comments').update({ replies_count:(p.replies_count||0)+1 }).eq('id',parentId);
    }
    const io = req.app.get('io');
    if (post.user_id !== req.user.id) await notify(io,{ type:'comment', recipientId:post.user_id, senderId:req.user.id, postId:post.id, message:`${req.user.username} commented: "${text.slice(0,50)}"` });
    io?.emit('comment_added',{ postId:req.params.postId, comment });
    res.status(201).json({ success:true, comment:{ id:comment.id, _id:comment.id, text:comment.text, likesCount:0, createdAt:comment.created_at, user:{ id:req.user.id, _id:req.user.id, username:req.user.username, fullName:req.user.full_name, avatar:req.user.avatar||'', verified:req.user.verified } } });
  } catch(e) { res.status(500).json({ success:false, message:e.message }); }
});

router.post('/:id/like', protect, async (req, res) => {
  try {
    const { data:c } = await supabase.from('comments').select('id,likes_count').eq('id',req.params.id).single();
    if(!c) return res.status(404).json({ success:false, message:'Not found.' });
    const { data:ex } = await supabase.from('comment_likes').select('id').eq('user_id',req.user.id).eq('comment_id',c.id).maybeSingle();
    let liked, count;
    if(ex){ await supabase.from('comment_likes').delete().eq('user_id',req.user.id).eq('comment_id',c.id); count=Math.max(0,(c.likes_count||1)-1); liked=false; }
    else { await supabase.from('comment_likes').insert({user_id:req.user.id,comment_id:c.id}); count=(c.likes_count||0)+1; liked=true; }
    await supabase.from('comments').update({likes_count:count}).eq('id',c.id);
    res.json({ success:true, liked, likesCount:count });
  } catch(e) { res.status(500).json({ success:false, message:e.message }); }
});

router.delete('/:id', protect, async (req, res) => {
  try {
    const { data:c } = await supabase.from('comments').select('id,user_id,post_id').eq('id',req.params.id).single();
    if(!c) return res.status(404).json({ success:false, message:'Not found.' });
    if(c.user_id!==req.user.id) return res.status(403).json({ success:false, message:'Not authorized.' });
    await supabase.from('comments').update({is_deleted:true}).eq('id',c.id);
    const { data:p } = await supabase.from('posts').select('comments_count').eq('id',c.post_id).single();
    if(p) await supabase.from('posts').update({comments_count:Math.max(0,(p.comments_count||1)-1)}).eq('id',c.post_id);
    res.json({ success:true, message:'Comment deleted.' });
  } catch(e) { res.status(500).json({ success:false, message:e.message }); }
});

module.exports = router;
