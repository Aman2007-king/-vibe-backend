const supabase = require('../db/supabase');
const { protect, optionalAuth } = require('../middleware/auth');
const { upload, handleStoryUpload } = require('../middleware/upload');
const { formatPost, formatNotif, formatUser } = require('../utils/helpers');
const notify   = require('../utils/notify');
const { isUserOnline } = require('../socket/socketManager');

// ═══════════════════════════════════════════════════════
// COMMENTS
// ═══════════════════════════════════════════════════════
const router_comments = require('express').Router();

router_comments.get('/:postId', optionalAuth, async (req, res) => {
  try {
    const limit  = Math.min(50, parseInt(req.query.limit) || 20);
    const page   = Math.max(1,  parseInt(req.query.page)  || 1);
    const offset = (page - 1) * limit;

    const { data: comments } = await supabase
      .from('comments')
      .select(`*, users!user_id(id, username, full_name, avatar, verified)`)
      .eq('post_id', req.params.postId)
      .eq('is_deleted', false)
      .is('parent_id', null)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    res.json({
      success:  true,
      comments: (comments || []).map(c => ({
        id: c.id, _id: c.id,
        text:      c.text,
        likesCount: c.likes_count || 0,
        repliesCount: c.replies_count || 0,
        createdAt: c.created_at,
        user: {
          id:       c.users?.id,
          username: c.users?.username,
          fullName: c.users?.full_name,
          avatar:   c.users?.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(c.users?.full_name || 'U')}&background=0095f6&color=fff`,
          verified: c.users?.verified || false,
        },
      })),
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router_comments.post('/:postId', protect, async (req, res) => {
  try {
    const { text, parentId } = req.body;
    if (!text?.trim()) return res.status(400).json({ success: false, message: 'Comment text required.' });

    const { data: post } = await supabase.from('posts').select('id, user_id, comments_disabled, comments_count').eq('id', req.params.postId).single();
    if (!post) return res.status(404).json({ success: false, message: 'Post not found.' });
    if (post.comments_disabled) return res.status(403).json({ success: false, message: 'Comments are disabled on this post.' });

    const { data: comment, error } = await supabase
      .from('comments')
      .insert({ post_id: req.params.postId, user_id: req.user.id, text: text.trim(), parent_id: parentId || null })
      .select(`*, users!user_id(id, username, full_name, avatar, verified)`)
      .single();

    if (error) throw error;

    await supabase.from('posts').update({ comments_count: (post.comments_count || 0) + 1 }).eq('id', post.id);
    if (parentId) {
      await supabase.from('comments').update({ replies_count: supabase.rpc ? undefined : 1 }).eq('id', parentId);
      // Simple increment
      const { data: parent } = await supabase.from('comments').select('replies_count').eq('id', parentId).single();
      if (parent) await supabase.from('comments').update({ replies_count: (parent.replies_count || 0) + 1 }).eq('id', parentId);
    }

    const io = req.app.get('io');
    if (post.user_id !== req.user.id) {
      await notify(io, { type: 'comment', recipientId: post.user_id, senderId: req.user.id, postId: post.id, message: `${req.user.username} commented: "${text.slice(0, 50)}"` });
    }
    io?.emit('comment_added', { postId: req.params.postId, comment });

    res.status(201).json({
      success: true,
      comment: {
        id: comment.id, _id: comment.id,
        text: comment.text,
        likesCount: 0,
        createdAt: comment.created_at,
        user: { id: req.user.id, username: req.user.username, fullName: req.user.full_name, avatar: req.user.avatar || '', verified: req.user.verified },
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router_comments.post('/:id/like', protect, async (req, res) => {
  try {
    const { data: comment } = await supabase.from('comments').select('id, likes_count').eq('id', req.params.id).single();
    if (!comment) return res.status(404).json({ success: false, message: 'Comment not found.' });

    const { data: existing } = await supabase.from('comment_likes').select('id')
      .eq('user_id', req.user.id).eq('comment_id', comment.id).maybeSingle();

    let liked, newCount;
    if (existing) {
      await supabase.from('comment_likes').delete().eq('user_id', req.user.id).eq('comment_id', comment.id);
      newCount = Math.max(0, (comment.likes_count || 1) - 1);
      liked    = false;
    } else {
      await supabase.from('comment_likes').insert({ user_id: req.user.id, comment_id: comment.id });
      newCount = (comment.likes_count || 0) + 1;
      liked    = true;
    }
    await supabase.from('comments').update({ likes_count: newCount }).eq('id', comment.id);
    res.json({ success: true, liked, likesCount: newCount });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router_comments.delete('/:id', protect, async (req, res) => {
  try {
    const { data: comment } = await supabase.from('comments').select('id, user_id, post_id').eq('id', req.params.id).single();
    if (!comment) return res.status(404).json({ success: false, message: 'Comment not found.' });
    if (comment.user_id !== req.user.id) return res.status(403).json({ success: false, message: 'Not authorized.' });
    await supabase.from('comments').update({ is_deleted: true }).eq('id', comment.id);
    const { data: post } = await supabase.from('posts').select('comments_count').eq('id', comment.post_id).single();
    if (post) await supabase.from('posts').update({ comments_count: Math.max(0, (post.comments_count || 1) - 1) }).eq('id', comment.post_id);
    res.json({ success: true, message: 'Comment deleted.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ═══════════════════════════════════════════════════════
// MESSAGES
// ═══════════════════════════════════════════════════════
const router_messages = require('express').Router();

router_messages.get('/conversations', protect, async (req, res) => {
  try {
    const { data: convs } = await supabase
      .from('conversations')
      .select(`
        *,
        conversation_participants!inner(user_id),
        participants:conversation_participants(user:users(id, username, full_name, avatar, verified, last_seen))
      `)
      .eq('conversation_participants.user_id', req.user.id)
      .order('updated_at', { ascending: false })
      .limit(30);

    const formatted = (convs || []).map(c => {
      const partner = c.participants?.find(p => p.user?.id !== req.user.id)?.user;
      return {
        id:          c.id,
        partner:     partner ? { ...formatUser(partner), isOnline: isUserOnline(partner.id) } : null,
        lastMessage: c.last_message,
        unreadCount: c.unread_counts?.[req.user.id] || 0,
        updatedAt:   c.updated_at,
      };
    }).filter(c => c.partner);

    res.json({ success: true, conversations: formatted });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router_messages.post('/conversations', protect, async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ success: false, message: 'userId required.' });
    if (userId === req.user.id) return res.status(400).json({ success: false, message: "Can't message yourself." });

    const { data: other } = await supabase.from('users').select('id').eq('id', userId).maybeSingle();
    if (!other) return res.status(404).json({ success: false, message: 'User not found.' });

    // Check for existing direct conversation
    const { data: existing } = await supabase.rpc('find_direct_conversation', {
      user_a: req.user.id,
      user_b: userId,
    });

    if (existing?.[0]) {
      return res.json({ success: true, conversation: { id: existing[0].id } });
    }

    // Create new conversation + add participants
    const { data: conv } = await supabase.from('conversations').insert({ is_group: false }).select().single();
    await supabase.from('conversation_participants').insert([
      { conversation_id: conv.id, user_id: req.user.id },
      { conversation_id: conv.id, user_id: userId },
    ]);

    res.json({ success: true, conversation: { id: conv.id } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router_messages.get('/:conversationId', protect, async (req, res) => {
  try {
    // Verify participant
    const { data: participant } = await supabase
      .from('conversation_participants')
      .select('user_id')
      .eq('conversation_id', req.params.conversationId)
      .eq('user_id', req.user.id)
      .maybeSingle();

    if (!participant) return res.status(404).json({ success: false, message: 'Conversation not found.' });

    const limit  = Math.min(50, parseInt(req.query.limit) || 30);
    const { data: messages } = await supabase
      .from('messages')
      .select(`*, sender:users!sender_id(id, username, full_name, avatar)`)
      .eq('conversation_id', req.params.conversationId)
      .eq('is_deleted', false)
      .order('created_at', { ascending: false })
      .limit(limit);

    // Mark as read — update unread_counts
    const { data: conv } = await supabase.from('conversations').select('unread_counts').eq('id', req.params.conversationId).single();
    if (conv) {
      const counts = conv.unread_counts || {};
      counts[req.user.id] = 0;
      await supabase.from('conversations').update({ unread_counts: counts }).eq('id', req.params.conversationId);
    }

    res.json({ success: true, messages: (messages || []).reverse() });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router_messages.post('/:conversationId', protect, async (req, res) => {
  try {
    const { data: participant } = await supabase
      .from('conversation_participants')
      .select('user_id')
      .eq('conversation_id', req.params.conversationId)
      .eq('user_id', req.user.id)
      .maybeSingle();
    if (!participant) return res.status(404).json({ success: false, message: 'Conversation not found.' });

    const { text, type = 'text' } = req.body;
    if (!text?.trim()) return res.status(400).json({ success: false, message: 'Message text required.' });

    // Save message to Supabase
    const { data: message, error } = await supabase
      .from('messages')
      .insert({
        conversation_id: req.params.conversationId,
        sender_id: req.user.id,
        type,
        text: text.trim(),
      })
      .select(`
        id, conversation_id, type, text, is_deleted, created_at,
        sender:users!sender_id(id, username, full_name, avatar)
      `)
      .single();

    if (error) throw error;

    // Format message for frontend (match what frontend expects)
    const formatted = {
      id:             message.id,
      _id:            message.id,
      conversationId: message.conversation_id,
      type:           message.type,
      text:           message.text,
      createdAt:      message.created_at,
      sender: {
        id:       message.sender?.id,
        _id:      message.sender?.id,
        username: message.sender?.username,
        fullName: message.sender?.full_name,
        avatar:   message.sender?.avatar || '',
      },
    };

    // Update conversation last_message + unread counts
    const { data: allParticipants } = await supabase
      .from('conversation_participants')
      .select('user_id')
      .eq('conversation_id', req.params.conversationId);

    const { data: conv } = await supabase
      .from('conversations')
      .select('unread_counts')
      .eq('id', req.params.conversationId)
      .single();

    const counts = conv?.unread_counts || {};
    (allParticipants || []).forEach(p => {
      if (p.user_id !== req.user.id) {
        counts[p.user_id] = (counts[p.user_id] || 0) + 1;
      }
    });

    await supabase.from('conversations').update({
      last_message:  { text: text.trim(), type, sender_id: req.user.id, ts: new Date().toISOString() },
      unread_counts: counts,
      updated_at:    new Date().toISOString(),
    }).eq('id', req.params.conversationId);

    // ✅ FIX: Only emit to RECIPIENT — NOT to the full conversation room
    // The sender already has the message from the HTTP response
    // Emitting to 'conv:id' sends to everyone including sender = duplicate
    const io        = req.app.get('io');
    const recipient = (allParticipants || []).find(p => p.user_id !== req.user.id);

    if (recipient) {
      // Send full message to recipient's user room so they receive it
      io?.to('user:' + recipient.user_id).emit('new_message', {
        conversationId: req.params.conversationId,
        message:        formatted,
      });

      // Also send DM notification (badge + toast)
      io?.to('user:' + recipient.user_id).emit('dm_notification', {
        conversationId: req.params.conversationId,
        from:    { id: req.user.id, username: req.user.username, avatar: req.user.avatar || '' },
        preview: text.trim().slice(0, 50),
        ts:      Date.now(),
      });
    }

    // Return message to sender via HTTP — sender appends it to UI themselves
    res.status(201).json({ success: true, message: formatted });
  } catch (err) {
    console.error('Send message error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ═══════════════════════════════════════════════════════
// STORIES
// ═══════════════════════════════════════════════════════
const router_stories = require('express').Router();

router_stories.get('/feed', protect, async (req, res) => {
  try {
    const { data: follows } = await supabase.from('follows').select('following_id').eq('follower_id', req.user.id);
    const userIds = [(follows || []).map(f => f.following_id), req.user.id].flat();

    const { data: stories } = await supabase
      .from('stories')
      .select(`*, users!user_id(id, username, full_name, avatar, verified)`)
      .in('user_id', userIds)
      .eq('is_deleted', false)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false });

    // Group by user
    const grouped = {};
    (stories || []).forEach(s => {
      const uid = s.user_id;
      if (!grouped[uid]) grouped[uid] = { user: s.users, stories: [], hasUnread: false };
      grouped[uid].stories.push(s);
      const viewed = s.viewers?.some(v => v.user_id === req.user.id);
      if (!viewed) grouped[uid].hasUnread = true;
    });

    res.json({ success: true, storyGroups: Object.values(grouped) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router_stories.post('/', protect, upload.single('media'), handleStoryUpload, async (req, res) => {
  try {
    if (!req.storyMedia) return res.status(400).json({ success: false, message: 'Media required for story.' });

    const { data: story } = await supabase
      .from('stories')
      .insert({
        user_id:    req.user.id,
        media:      req.storyMedia,
        text:       req.body.text     || '',
        location:   req.body.location || '',
        audience:   req.body.audience || 'all',
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      })
      .select(`*, users!user_id(id, username, full_name, avatar, verified)`)
      .single();

    const io = req.app.get('io');
    const { data: follows } = await supabase.from('follows').select('follower_id').eq('following_id', req.user.id);
    (follows || []).forEach(f => io?.to('user:' + f.follower_id).emit('new_story', story));

    res.status(201).json({ success: true, story });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router_stories.post('/:id/view', protect, async (req, res) => {
  try {
    const { data: story } = await supabase.from('stories').select('id, viewers, viewers_count, user_id').eq('id', req.params.id).single();
    if (!story) return res.status(404).json({ success: false, message: 'Story not found.' });

    const viewers    = story.viewers || [];
    const alreadySeen = viewers.some(v => v.user_id === req.user.id);
    if (!alreadySeen) {
      viewers.push({ user_id: req.user.id, viewed_at: new Date().toISOString() });
      await supabase.from('stories').update({ viewers, viewers_count: (story.viewers_count || 0) + 1 }).eq('id', story.id);
      req.app.get('io')?.to('user:' + story.user_id).emit('story_viewed', {
        storyId:  story.id,
        viewedBy: { id: req.user.id, username: req.user.username, avatar: req.user.avatar },
      });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router_stories.delete('/:id', protect, async (req, res) => {
  try {
    const { data: story } = await supabase.from('stories').select('id, user_id').eq('id', req.params.id).single();
    if (!story) return res.status(404).json({ success: false, message: 'Story not found.' });
    if (story.user_id !== req.user.id) return res.status(403).json({ success: false, message: 'Not authorized.' });
    await supabase.from('stories').update({ is_deleted: true }).eq('id', story.id);
    res.json({ success: true, message: 'Story deleted.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ═══════════════════════════════════════════════════════
// NOTIFICATIONS
// ═══════════════════════════════════════════════════════
const router_notifs = require('express').Router();

router_notifs.get('/', protect, async (req, res) => {
  try {
    const limit = Math.min(50, parseInt(req.query.limit) || 30);
    const { data: notifs } = await supabase
      .from('notifications')
      .select(`*, sender:users!sender_id(id, username, full_name, avatar, verified), post:posts!post_id(id, media, caption)`)
      .eq('recipient_id', req.user.id)
      .order('created_at', { ascending: false })
      .limit(limit);

    // Mark all as read
    await supabase.from('notifications').update({ is_read: true, read_at: new Date().toISOString() })
      .eq('recipient_id', req.user.id).eq('is_read', false);

    res.json({ success: true, notifications: (notifs || []).map(n => ({
      id:        n.id,
      _id:       n.id,
      type:      n.type,
      message:   n.message,
      isRead:    n.is_read,
      createdAt: n.created_at,
      sender:    n.sender ? { ...n.sender, avatar: n.sender.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(n.sender.full_name || 'U')}&background=0095f6&color=fff` } : null,
      post:      n.post || null,
    })) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router_notifs.get('/unread-count', protect, async (req, res) => {
  try {
    const { count } = await supabase.from('notifications').select('*', { count: 'exact', head: true })
      .eq('recipient_id', req.user.id).eq('is_read', false);
    res.json({ success: true, count: count || 0 });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ═══════════════════════════════════════════════════════
// SEARCH
// ═══════════════════════════════════════════════════════
const router_search = require('express').Router();

router_search.get('/', optionalAuth, async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q) return res.json({ success: true, users: [], posts: [] });

    const [{ data: users }, { data: posts }] = await Promise.all([
      supabase.from('users').select('id, username, full_name, avatar, verified, bio, followers_count')
        .or(`username.ilike.%${q}%,full_name.ilike.%${q}%`)
        .eq('is_active', true).limit(10),

      supabase.from('posts').select(`*, users!user_id(id, username, full_name, avatar, verified)`)
        .or(`caption.ilike.%${q}%,location.ilike.%${q}%`)
        .eq('is_deleted', false).order('likes_count', { ascending: false }).limit(15),
    ]);

    res.json({
      success: true,
      users:   (users || []).map(u => formatUser(u)),
      posts:   (posts || []).map(p => formatPost(p)),
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ═══════════════════════════════════════════════════════
// EXPLORE
// ═══════════════════════════════════════════════════════
const router_explore = require('express').Router();

router_explore.get('/', optionalAuth, async (req, res) => {
  try {
    const page   = Math.max(1, parseInt(req.query.page) || 1);
    const limit  = Math.min(30, parseInt(req.query.limit) || 30);
    const offset = (page - 1) * limit;

    let excludeIds = [];
    if (req.user) {
      const { data: follows } = await supabase.from('follows').select('following_id').eq('follower_id', req.user.id);
      excludeIds = (follows || []).map(f => f.following_id);
      excludeIds.push(req.user.id);
    }

    let query = supabase
      .from('posts')
      .select(`*, users!user_id(id, username, full_name, avatar, verified)`)
      .in('type', ['post', 'reel'])
      .eq('is_deleted', false)
      .order('likes_count', { ascending: false })
      .range(offset, offset + limit - 1);

    if (excludeIds.length) {
      query = query.not('user_id', 'in', `(${excludeIds.join(',')})`);
    }

    const { data: posts } = await query;
    res.json({ success: true, posts: (posts || []).map(p => formatPost(p)) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ═══════════════════════════════════════════════════════
// REELS
// ═══════════════════════════════════════════════════════
const router_reels = require('express').Router();

router_reels.get('/', optionalAuth, async (req, res) => {
  try {
    const limit = Math.min(20, parseInt(req.query.limit) || 10);
    const { data: reels } = await supabase
      .from('posts')
      .select(`*, users!user_id(id, username, full_name, avatar, verified, bio, followers_count)`)
      .eq('type', 'reel')
      .eq('is_deleted', false)
      .order('likes_count', { ascending: false })
      .limit(limit);

    let likedSet = new Set();
    if (req.user && reels?.length) {
      const { data: liked } = await supabase.from('likes').select('post_id')
        .eq('user_id', req.user.id).in('post_id', reels.map(r => r.id));
      likedSet = new Set((liked || []).map(l => l.post_id));
    }

    res.json({
      success: true,
      reels: (reels || []).map(r => formatPost({ ...r, isLiked: likedSet.has(r.id) })),
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router_reels.post('/:id/view', optionalAuth, async (req, res) => {
  try {
    const { data: post } = await supabase.from('posts').select('id, views_count').eq('id', req.params.id).single();
    if (post) await supabase.from('posts').update({ views_count: (post.views_count || 0) + 1 }).eq('id', post.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ═══════════════════════════════════════════════════════
// GROUPS
// ═══════════════════════════════════════════════════════
const router_groups = require('express').Router();

router_groups.get('/', optionalAuth, async (req, res) => {
  try {
    const page   = Math.max(1, parseInt(req.query.page) || 1);
    const limit  = Math.min(20, parseInt(req.query.limit) || 12);
    const offset = (page - 1) * limit;

    const { data: groups } = await supabase
      .from('groups')
      .select(`*, admin:users!admin_id(id, username, avatar)`)
      .eq('is_active', true)
      .neq('privacy', 'secret')
      .order('members_count', { ascending: false })
      .range(offset, offset + limit - 1);

    let memberGroupIds = new Set();
    if (req.user) {
      const { data: memberships } = await supabase.from('group_members').select('group_id').eq('user_id', req.user.id);
      memberGroupIds = new Set((memberships || []).map(m => m.group_id));
    }

    res.json({
      success: true,
      groups: (groups || []).map(g => ({
        ...g,
        isMember: memberGroupIds.has(g.id),
      })),
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router_groups.post('/', protect, async (req, res) => {
  try {
    const { name, description, privacy = 'public', category } = req.body;
    if (!name?.trim()) return res.status(400).json({ success: false, message: 'Group name required.' });

    const { data: group } = await supabase
      .from('groups')
      .insert({ name: name.trim(), description: description?.trim() || '', privacy, category: category || '', admin_id: req.user.id, members_count: 1 })
      .select().single();

    // Add creator as member
    await supabase.from('group_members').insert({ group_id: group.id, user_id: req.user.id, role: 'admin' });

    res.status(201).json({ success: true, group });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router_groups.post('/:id/join', protect, async (req, res) => {
  try {
    const { data: group } = await supabase.from('groups').select('*').eq('id', req.params.id).single();
    if (!group) return res.status(404).json({ success: false, message: 'Group not found.' });

    const { data: member } = await supabase.from('group_members').select('id')
      .eq('group_id', group.id).eq('user_id', req.user.id).maybeSingle();

    if (member) {
      // Leave group
      await supabase.from('group_members').delete().eq('group_id', group.id).eq('user_id', req.user.id);
      await supabase.from('groups').update({ members_count: Math.max(0, (group.members_count || 1) - 1) }).eq('id', group.id);
      return res.json({ success: true, joined: false, membersCount: Math.max(0, (group.members_count || 1) - 1) });
    }

    if (group.privacy === 'private') {
      // Pending request
      await supabase.from('group_members').insert({ group_id: group.id, user_id: req.user.id, role: 'pending' });
      return res.json({ success: true, status: 'pending', message: 'Join request sent' });
    }

    await supabase.from('group_members').insert({ group_id: group.id, user_id: req.user.id, role: 'member' });
    const newCount = (group.members_count || 0) + 1;
    await supabase.from('groups').update({ members_count: newCount }).eq('id', group.id);
    res.json({ success: true, joined: true, membersCount: newCount });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = {
  userRoutes:    require('./users'),
  commentRoutes: router_comments,
  messageRoutes: router_messages,
  storyRoutes:   router_stories,
  notifRoutes:   router_notifs,
  searchRoutes:  router_search,
  exploreRoutes: router_explore,
  reelRoutes:    router_reels,
  groupRoutes:   router_groups,
};
