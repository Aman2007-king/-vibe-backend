const router   = require('express').Router();
const supabase = require('../db/supabase');
const { protect, optionalAuth } = require('../middleware/auth');

router.get('/', optionalAuth, async (req, res) => {
  try {
    const limit  = Math.min(20, parseInt(req.query.limit)||12);
    const page   = Math.max(1, parseInt(req.query.page)||1);
    const { data:groups } = await supabase.from('groups')
      .select('*, admin:users!admin_id(id,username,avatar)')
      .eq('is_active',true).neq('privacy','secret')
      .order('members_count',{ascending:false}).range((page-1)*limit, page*limit-1);
    let memberIds = new Set();
    if(req.user){
      const { data:m } = await supabase.from('group_members').select('group_id').eq('user_id',req.user.id);
      memberIds = new Set((m||[]).map(x=>x.group_id));
    }
    res.json({ success:true, groups:(groups||[]).map(g=>({ ...g, isMember:memberIds.has(g.id) })) });
  } catch(e) { res.status(500).json({ success:false, message:e.message }); }
});

router.post('/', protect, async (req, res) => {
  try {
    const { name, description, privacy='public', category } = req.body;
    if(!name?.trim()) return res.status(400).json({ success:false, message:'Group name required.' });
    const { data:group } = await supabase.from('groups').insert({ name:name.trim(), description:description?.trim()||'', privacy, category:category||'', admin_id:req.user.id, members_count:1 }).select().single();
    await supabase.from('group_members').insert({ group_id:group.id, user_id:req.user.id, role:'admin' });
    res.status(201).json({ success:true, group });
  } catch(e) { res.status(500).json({ success:false, message:e.message }); }
});

router.post('/:id/join', protect, async (req, res) => {
  try {
    const { data:group } = await supabase.from('groups').select('*').eq('id',req.params.id).single();
    if(!group) return res.status(404).json({ success:false, message:'Group not found.' });
    const { data:member } = await supabase.from('group_members').select('id').eq('group_id',group.id).eq('user_id',req.user.id).maybeSingle();
    if(member){
      await supabase.from('group_members').delete().eq('group_id',group.id).eq('user_id',req.user.id);
      await supabase.from('groups').update({ members_count:Math.max(0,(group.members_count||1)-1) }).eq('id',group.id);
      return res.json({ success:true, joined:false, membersCount:Math.max(0,(group.members_count||1)-1) });
    }
    await supabase.from('group_members').insert({ group_id:group.id, user_id:req.user.id, role:'member' });
    const newCount=(group.members_count||0)+1;
    await supabase.from('groups').update({ members_count:newCount }).eq('id',group.id);
    res.json({ success:true, joined:true, membersCount:newCount });
  } catch(e) { res.status(500).json({ success:false, message:e.message }); }
});

module.exports = router;
