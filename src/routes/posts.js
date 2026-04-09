const router   = require('express').Router();
const supabase = require('../db/supabase');
const { protect, optionalAuth } = require('../middleware/auth');
const { upload, handlePostUpload } = require('../middleware/upload');
const { formatPost } = require('../utils/helpers');
const notify   = require('../utils/notify');

// ── CREATE POST ────────────────────────────────────────
router.post('/', protect, upload.array('media', 10), handlePostUpload, async (req, res) => {
  try {
    const { caption = '', location = '', type = 'post', audio } = req.body;
    const media = req.processedMedia || [];

    if (!media.length) {
      return res.status(400).json({ success: false, message: 'At least one photo or video is required.' });
    }

    const tags     = (caption.match(/#[a-zA-Z0-9_]+/g) || []).map(t => t.toLowerCase());
    const expiresAt = type === 'story' ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() : null;

    const { data: post, error } = await supabase
      .from('posts')
      .insert({
        user_id:    req.user.id,
        type,
        media,
        caption,
        location,
        tags,
        audio:      audio ? JSON.parse(audio) : null,
        expires_at: expiresAt,
      })
      .select(`*, users!user_id(id, username, full_name, avatar, verified)`)
      .single();

    if (error) throw error;

    // Increment post count
    const countField = type === 'reel' ? 'reels_count' : 'posts_count';
    await supabase.from('users').update({ [countField]: (req.user[countField.replace('_count', '_count')] || 0) + 1 }).eq('id', req.user.id);

    // Real-time: notify followers
    const io = req.app.get('io');
    const { data: follows } = await supabase.from('follows').select('follower_id').eq('following_id', req.user.id);
    (follows || []).forEach(f => io?.to('user:' + f.follower_id).emit('feed_new_post', formatPost(post)));
    io?.emit('explore_new_post', formatPost(post));

    res.status(201).json({ success: true, post: formatPost(post) });
  } catch (err) {
    console.error('Create post error:', err);
    res.status(500).json({ success: false, message: 'Failed to create post.' });
  }
});

// ── FEED ───────────────────────────────────────────────
router.get('/feed', protect, async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(20, parseInt(req.query.limit) || 12);

    // Get following IDs
    const { data: follows } = await supabase
      .from('follows')
      .select('following_id')
      .eq('follower_id', req.user.id);

    const followingIds = (follows || []).map(f => f.following_id);
    followingIds.push(req.user.id);

    const followingLimit   = Math.floor(limit * 0.7);
    const recommendedLimit = Math.ceil(limit  * 0.3);
    const offset           = (page - 1) * followingLimit;

    // Posts from following
    const { data: followingPosts } = await supabase
      .from('posts')
      .select(`*, users!user_id(id, username, full_name, avatar, verified)`)
      .in('user_id', followingIds)
      .in('type', ['post', 'reel', 'carousel'])
      .eq('is_deleted', false)
      .order('created_at', { ascending: false })
      .range(offset, offset + followingLimit - 1);

    // Recommended (not from following)
    const { data: recommended } = await supabase
      .from('posts')
      .select(`*, users!user_id(id, username, full_name, avatar, verified)`)
      .not('user_id', 'in', `(${followingIds.join(',')})`)
      .in('type', ['post', 'reel', 'carousel'])
      .eq('is_deleted', false)
      .order('likes_count', { ascending: false })
      .limit(recommendedLimit);

    // Interleave
    const merged = [...(followingPosts || [])];
    (recommended || []).forEach((rp, i) => merged.splice(Math.min(i * 3 + 2, merged.length), 0, rp));

    // Get my likes and saves
    const ids = merged.map(p => p.id);
    const [{ data: likedRows }, { data: savedRows }] = await Promise.all([
      supabase.from('likes').select('post_id').eq('user_id', req.user.id).in('post_id', ids),
      supabase.from('saved_posts').select('post_id').eq('user_id', req.user.id).in('post_id', ids),
    ]);

    const likedSet = new Set((likedRows || []).map(r => r.post_id));
    const savedSet = new Set((savedRows || []).map(r => r.post_id));

    const enriched = merged.map(p => formatPost({ ...p, isLiked: likedSet.has(p.id), isSaved: savedSet.has(p.id) }));

    res.json({ success: true, posts: enriched, page, hasMore: (followingPosts || []).length === followingLimit });
  } catch (err) {
    console.error('Feed error:', err);
    res.status(500).json({ success: false, message: 'Failed to load feed.' });
  }
});

// ── SAVED POSTS ────────────────────────────────────────
router.get('/saved', protect, async (req, res) => {
  try {
    const { data: saved } = await supabase
      .from('saved_posts')
      .select(`posts(*, users!user_id(id, username, full_name, avatar, verified))`)
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false });

    res.json({
      success: true,
      posts: (saved || []).filter(s => s.posts && !s.posts.is_deleted)
        .map(s => formatPost({ ...s.posts, isLiked: false, isSaved: true })),
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── USER POSTS ─────────────────────────────────────────
router.get('/user/:userId', optionalAuth, async (req, res) => {
  try {
    const page   = Math.max(1, parseInt(req.query.page)  || 1);
    const limit  = Math.min(30, parseInt(req.query.limit) || 12);
    const offset = (page - 1) * limit;

    let query = supabase
      .from('posts')
      .select(`*, users!user_id(id, username, full_name, avatar, verified)`)
      .eq('user_id', req.params.userId)
      .eq('is_deleted', false)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (req.query.type) query = query.eq('type', req.query.type);

    const { data: posts } = await query;

    let likedSet = new Set();
    if (req.user && posts?.length) {
      const { data: liked } = await supabase
        .from('likes')
        .select('post_id')
        .eq('user_id', req.user.id)
        .in('post_id', posts.map(p => p.id));
      likedSet = new Set((liked || []).map(r => r.post_id));
    }

    res.json({
      success: true,
      posts: (posts || []).map(p => formatPost({ ...p, isLiked: likedSet.has(p.id) })),
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── SINGLE POST ────────────────────────────────────────
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const { data: post } = await supabase
      .from('posts')
      .select(`*, users!user_id(id, username, full_name, avatar, verified, bio)`)
      .eq('id', req.params.id)
      .eq('is_deleted', false)
      .maybeSingle();

    if (!post) return res.status(404).json({ success: false, message: 'Post not found.' });

    let isLiked = false, isSaved = false;
    if (req.user) {
      const [{ data: like }, { data: save }] = await Promise.all([
        supabase.from('likes').select('post_id').eq('user_id', req.user.id).eq('post_id', post.id).maybeSingle(),
        supabase.from('saved_posts').select('post_id').eq('user_id', req.user.id).eq('post_id', post.id).maybeSingle(),
      ]);
      isLiked = !!like;
      isSaved = !!save;
    }

    res.json({ success: true, post: formatPost({ ...post, isLiked, isSaved }) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── LIKE / UNLIKE ──────────────────────────────────────
router.post('/:id/like', protect, async (req, res) => {
  try {
    const { data: post } = await supabase.from('posts').select('id, likes_count, user_id').eq('id', req.params.id).single();
    if (!post) return res.status(404).json({ success: false, message: 'Post not found.' });

    const { data: existing } = await supabase.from('likes').select('post_id')
      .eq('user_id', req.user.id).eq('post_id', post.id).maybeSingle();

    let liked, newCount;
    if (existing) {
      await supabase.from('likes').delete().eq('user_id', req.user.id).eq('post_id', post.id);
      newCount = Math.max(0, (post.likes_count || 1) - 1);
      await supabase.from('posts').update({ likes_count: newCount }).eq('id', post.id);
      liked = false;
    } else {
      await supabase.from('likes').insert({ user_id: req.user.id, post_id: post.id });
      newCount = (post.likes_count || 0) + 1;
      await supabase.from('posts').update({ likes_count: newCount }).eq('id', post.id);
      liked = true;
      const io = req.app.get('io');
      await notify(io, { type: 'like', recipientId: post.user_id, senderId: req.user.id, postId: post.id, message: `${req.user.username} liked your photo` });
    }

    req.app.get('io')?.emit('post_like_update', { postId: post.id, likesCount: newCount, liked, byUserId: req.user.id });
    res.json({ success: true, liked, likesCount: newCount });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── SAVE / UNSAVE ──────────────────────────────────────
router.post('/:id/save', protect, async (req, res) => {
  try {
    const { data: post } = await supabase.from('posts').select('id, saves_count').eq('id', req.params.id).single();
    if (!post) return res.status(404).json({ success: false, message: 'Post not found.' });

    const { data: existing } = await supabase.from('saved_posts').select('post_id')
      .eq('user_id', req.user.id).eq('post_id', post.id).maybeSingle();

    let saved, newCount;
    if (existing) {
      await supabase.from('saved_posts').delete().eq('user_id', req.user.id).eq('post_id', post.id);
      newCount = Math.max(0, (post.saves_count || 1) - 1);
      saved = false;
    } else {
      await supabase.from('saved_posts').insert({ user_id: req.user.id, post_id: post.id });
      newCount = (post.saves_count || 0) + 1;
      saved = true;
    }
    await supabase.from('posts').update({ saves_count: newCount }).eq('id', post.id);
    res.json({ success: true, saved, savesCount: newCount });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── DELETE POST ────────────────────────────────────────
router.delete('/:id', protect, async (req, res) => {
  try {
    const { data: post } = await supabase.from('posts').select('id, user_id, type').eq('id', req.params.id).single();
    if (!post) return res.status(404).json({ success: false, message: 'Post not found.' });
    if (post.user_id !== req.user.id) return res.status(403).json({ success: false, message: 'Not authorized.' });

    await supabase.from('posts').update({ is_deleted: true }).eq('id', post.id);
    const countField = post.type === 'reel' ? 'reels_count' : 'posts_count';
    await supabase.from('users').update({ [countField]: Math.max(0, (req.user[countField] || 1) - 1) }).eq('id', req.user.id);

    req.app.get('io')?.emit('post_deleted', { postId: post.id });
    res.json({ success: true, message: 'Post deleted.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── EDIT POST ──────────────────────────────────────────
router.put('/:id', protect, async (req, res) => {
  try {
    const { data: post } = await supabase.from('posts').select('id, user_id').eq('id', req.params.id).single();
    if (!post) return res.status(404).json({ success: false, message: 'Post not found.' });
    if (post.user_id !== req.user.id) return res.status(403).json({ success: false, message: 'Not authorized.' });

    const updates = {};
    if (req.body.caption          !== undefined) updates.caption           = req.body.caption;
    if (req.body.location         !== undefined) updates.location          = req.body.location;
    if (req.body.commentsDisabled !== undefined) updates.comments_disabled = req.body.commentsDisabled;
    if (req.body.likesHidden      !== undefined) updates.likes_hidden      = req.body.likesHidden;

    const { data: updated } = await supabase.from('posts').update(updates).eq('id', post.id)
      .select(`*, users!user_id(id, username, full_name, avatar, verified)`).single();

    res.json({ success: true, post: formatPost(updated) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
