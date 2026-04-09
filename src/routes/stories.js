const router   = require('express').Router();
const supabase = require('../db/supabase');
const { protect } = require('../middleware/auth');
const { upload, handleStoryUpload } = require('../middleware/upload');

router.get('/feed', protect, async (req, res) => {
  try {
    const { data:follows } = await supabase.from('follows').select('following_id').eq('follower_id',req.user.id);
    const userIds = [...(follows||[]).map(f=>f.following_id), req.user.id];
    const { data:stories } = await supabase.from('stories')
      .select('*, users!user_id(id,username,full_name,avatar,verified)')
      .in('user_id',userIds).eq('is_deleted',false)
      .gt('expires_at',new Date().toISOString()).order('created_at',{ascending:false});
    const grouped = {};
    (stories||[]).forEach(s=>{
      const uid=s.user_id;
      if(!grouped[uid]) grouped[uid]={ user:{ id:s.users?.id, username:s.users?.username, fullName:s.users?.full_name, avatar:s.users?.avatar||'', verified:s.users?.verified||false }, stories:[], hasUnread:false };
      grouped[uid].stories.push({ ...s, media:s.media||{} });
      const viewed=(s.viewers||[]).some(v=>v.user_id===req.user.id);
      if(!viewed) grouped[uid].hasUnread=true;
    });
    res.json({ success:true, storyGroups:Object.values(grouped) });
  } catch(e) { res.status(500).json({ success:false, message:e.message }); }
});

router.post('/', protect, upload.single('media'), handleStoryUpload, async (req, res) => {
  try {
    if(!req.storyMedia) return res.status(400).json({ success:false, message:'Media required.' });
    const { data:story, error } = await supabase.from('stories').insert({
      user_id:req.user.id, media:req.storyMedia,
      text:req.body.text||'', location:req.body.location||'', audience:req.body.audience||'all',
      expires_at:new Date(Date.now()+24*60*60*1000).toISOString()
    }).select('*, users!user_id(id,username,full_name,avatar,verified)').single();
    if(error) throw error;
    const io=req.app.get('io');
    const { data:follows } = await supabase.from('follows').select('follower_id').eq('following_id',req.user.id);
    (follows||[]).forEach(f=>io?.to('user:'+f.follower_id).emit('new_story',story));
    res.status(201).json({ success:true, story });
  } catch(e) { res.status(500).json({ success:false, message:e.message }); }
});

router.post('/:id/view', protect, async (req, res) => {
  try {
    const { data:story } = await supabase.from('stories').select('id,viewers,viewers_count,user_id').eq('id',req.params.id).single();
    if(!story) return res.status(404).json({ success:false, message:'Story not found.' });
    const viewers=story.viewers||[];
    if(!viewers.some(v=>v.user_id===req.user.id)){
      viewers.push({ user_id:req.user.id, viewed_at:new Date().toISOString() });
      await supabase.from('stories').update({ viewers, viewers_count:(story.viewers_count||0)+1 }).eq('id',story.id);
      req.app.get('io')?.to('user:'+story.user_id).emit('story_viewed',{ storyId:story.id, viewedBy:{ id:req.user.id, username:req.user.username, avatar:req.user.avatar||'' } });
    }
    res.json({ success:true });
  } catch(e) { res.status(500).json({ success:false, message:e.message }); }
});

router.delete('/:id', protect, async (req, res) => {
  try {
    const { data:story } = await supabase.from('stories').select('id,user_id').eq('id',req.params.id).single();
    if(!story) return res.status(404).json({ success:false, message:'Story not found.' });
    if(story.user_id!==req.user.id) return res.status(403).json({ success:false, message:'Not authorized.' });
    await supabase.from('stories').update({ is_deleted:true }).eq('id',story.id);
    res.json({ success:true, message:'Story deleted.' });
  } catch(e) { res.status(500).json({ success:false, message:e.message }); }
});

module.exports = router;
