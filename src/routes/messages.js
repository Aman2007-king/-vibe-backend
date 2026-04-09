const router   = require('express').Router();
const supabase = require('../db/supabase');
const { protect } = require('../middleware/auth');
const { formatUser } = require('../utils/helpers');
const { isUserOnline } = require('../socket/socketManager');

router.get('/conversations', protect, async (req, res) => {
  try {
    const { data: myConvs } = await supabase
      .from('conversation_participants').select('conversation_id').eq('user_id', req.user.id);
    const convIds = (myConvs||[]).map(c=>c.conversation_id);
    if(!convIds.length) return res.json({ success:true, conversations:[] });

    const { data: convs } = await supabase.from('conversations')
      .select('*').in('id', convIds).order('updated_at',{ascending:false}).limit(30);

    const { data: allParticipants } = await supabase.from('conversation_participants')
      .select('conversation_id, users!user_id(id,username,full_name,avatar,verified,last_seen)')
      .in('conversation_id', convIds);

    const formatted = (convs||[]).map(c => {
      const participants = (allParticipants||[]).filter(p=>p.conversation_id===c.id);
      const partnerRow   = participants.find(p=>p.users?.id!==req.user.id);
      const partner      = partnerRow?.users;
      if(!partner) return null;
      return {
        id: c.id,
        partner: { ...formatUser(partner), isOnline: isUserOnline(partner.id) },
        lastMessage: c.last_message,
        unreadCount: (c.unread_counts||{})[req.user.id] || 0,
        updatedAt: c.updated_at,
      };
    }).filter(Boolean);

    res.json({ success:true, conversations: formatted });
  } catch(e) { res.status(500).json({ success:false, message:e.message }); }
});

router.post('/conversations', protect, async (req, res) => {
  try {
    const { userId } = req.body;
    if(!userId) return res.status(400).json({ success:false, message:'userId required.' });
    if(userId===req.user.id) return res.status(400).json({ success:false, message:"Can't message yourself." });
    const { data: other } = await supabase.from('users').select('id').eq('id',userId).maybeSingle();
    if(!other) return res.status(404).json({ success:false, message:'User not found.' });

    // Find existing DM
    const { data: existing } = await supabase.rpc('find_direct_conversation',{ user_a:req.user.id, user_b:userId });
    if(existing?.[0]) return res.json({ success:true, conversation:{ id:existing[0].id } });

    const { data:conv } = await supabase.from('conversations').insert({ is_group:false, unread_counts:{} }).select().single();
    await supabase.from('conversation_participants').insert([
      { conversation_id:conv.id, user_id:req.user.id },
      { conversation_id:conv.id, user_id:userId },
    ]);
    res.json({ success:true, conversation:{ id:conv.id } });
  } catch(e) { res.status(500).json({ success:false, message:e.message }); }
});

router.get('/:conversationId', protect, async (req, res) => {
  try {
    const { data:p } = await supabase.from('conversation_participants')
      .select('user_id').eq('conversation_id',req.params.conversationId).eq('user_id',req.user.id).maybeSingle();
    if(!p) return res.status(404).json({ success:false, message:'Conversation not found.' });

    const limit = Math.min(50, parseInt(req.query.limit)||30);
    const { data: messages } = await supabase.from('messages')
      .select('*, sender:users!sender_id(id,username,full_name,avatar)')
      .eq('conversation_id',req.params.conversationId).eq('is_deleted',false)
      .order('created_at',{ascending:false}).limit(limit);

    // Mark as read
    const { data:conv } = await supabase.from('conversations').select('unread_counts').eq('id',req.params.conversationId).single();
    if(conv){ const counts=conv.unread_counts||{}; counts[req.user.id]=0; await supabase.from('conversations').update({unread_counts:counts}).eq('id',req.params.conversationId); }

    res.json({ success:true, messages: (messages||[]).reverse().map(m=>({
      id:m.id, _id:m.id, text:m.text, type:m.type, createdAt:m.created_at,
      sender:{ id:m.sender?.id, _id:m.sender?.id, username:m.sender?.username, fullName:m.sender?.full_name, avatar:m.sender?.avatar||'' }
    })) });
  } catch(e) { res.status(500).json({ success:false, message:e.message }); }
});

router.post('/:conversationId', protect, async (req, res) => {
  try {
    const { data:participant } = await supabase.from('conversation_participants')
      .select('user_id').eq('conversation_id',req.params.conversationId).eq('user_id',req.user.id).maybeSingle();
    if(!participant) return res.status(404).json({ success:false, message:'Conversation not found.' });

    const { text, type='text' } = req.body;
    if(!text?.trim()) return res.status(400).json({ success:false, message:'Message text required.' });

    const { data:message, error } = await supabase.from('messages')
      .insert({ conversation_id:req.params.conversationId, sender_id:req.user.id, type, text:text.trim() })
      .select('*, sender:users!sender_id(id,username,full_name,avatar)').single();
    if(error) throw error;

    const { data:allP } = await supabase.from('conversation_participants').select('user_id').eq('conversation_id',req.params.conversationId);
    const { data:conv } = await supabase.from('conversations').select('unread_counts').eq('id',req.params.conversationId).single();
    const counts = conv?.unread_counts || {};
    (allP||[]).forEach(p=>{ if(p.user_id!==req.user.id) counts[p.user_id]=(counts[p.user_id]||0)+1; });
    await supabase.from('conversations').update({
      last_message:{ text:text.trim(), type, sender_id:req.user.id, ts:new Date().toISOString() },
      unread_counts:counts, updated_at:new Date().toISOString()
    }).eq('id',req.params.conversationId);

    const formatted = {
      id:message.id, _id:message.id, text:message.text, type:message.type, createdAt:message.created_at,
      sender:{ id:req.user.id, _id:req.user.id, username:req.user.username, fullName:req.user.full_name, avatar:req.user.avatar||'' }
    };

    // Only emit to RECIPIENT — sender gets it via HTTP response
    const io        = req.app.get('io');
    const recipient = (allP||[]).find(p=>p.user_id!==req.user.id);
    if(recipient){
      io?.to('user:'+recipient.user_id).emit('new_message',{ conversationId:req.params.conversationId, message:formatted });
      io?.to('user:'+recipient.user_id).emit('dm_notification',{ conversationId:req.params.conversationId, from:{ id:req.user.id, username:req.user.username, avatar:req.user.avatar||'' }, preview:text.trim().slice(0,50), ts:Date.now() });
    }

    res.status(201).json({ success:true, message:formatted });
  } catch(e) { console.error('Send message error:',e); res.status(500).json({ success:false, message:e.message }); }
});

module.exports = router;
