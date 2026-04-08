const router  = require('express').Router();
const multer  = require('multer');
const { v4: uuidv4 } = require('uuid');
const supabase = require('../db/supabase');
const { protect, optionalAuth } = require('../middleware/auth');

// ── Multer — memory storage (no disk, goes straight to Supabase) ──
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB max per file
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/')) cb(null, true);
    else cb(new Error('Only images and videos are allowed.'));
  },
});

// ── Upload a single file buffer → Supabase Storage → returns public URL ──
async function uploadToSupabase(file) {
  const ext  = file.originalname.split('.').pop().toLowerCase();
  const name = `${Date.now()}_${uuidv4()}.${ext}`;
  const folder = file.mimetype.startsWith('video/') ? 'videos' : 'images';
  const path = `posts/${folder}/${name}`;

  const { error } = await supabase.storage
    .from('media')                         // your Supabase bucket name
    .upload(path, file.buffer, {
      contentType: file.mimetype,
      upsert: false,
    });

  if (error) throw new Error('Storage upload failed: ' + error.message);

  const { data } = supabase.storage.from('media').getPublicUrl(path);
  return {
    url:  data.publicUrl,
    type: file.mimetype.startsWith('video/') ? 'video' : 'image',
    path,                                  // kept so you can delete it later
  };
}

// ── Notify + emit helper ──────────────────────────────────────────────────
async function notifyAndEmit(io, type, recipientId, senderId, extras = {}) {
  if (recipientId === senderId) return;
  const { data: notif } = await supabase
    .from('notifications')
    .insert({ type, recipient_id: recipientId, sender_id: senderId, ...extras })
    .select(`*, sender:users!sender_id(username, avatar, verified)`)
    .single();
  if (notif) io.to('user:' + recipientId).emit('notification', notif);
}

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/posts  — create post / reel / story
// ═══════════════════════════════════════════════════════════════════════════
router.post('/', protect, upload.array('media', 10), async (req, res) => {
  try {
    const { caption = '', location = '', type = 'post', audio } = req.body;

    if (!req.files || !req.files.length) {
      return res.status(400).json({ success: false, message: 'At least one photo or video is required.' });
    }

    // Upload all files in parallel to Supabase Storage
    const mediaItems = await Promise.all(req.files.map(uploadToSupabase));

    // Extract hashtags from caption
    const tags = (caption.match(/#[a-zA-Z0-9_]+/g) || []).map(t => t.toLowerCase());

    const { data: post, error } = await supabase
      .from('posts')
      .insert({
        user_id:  req.user.id,
        type,
        caption,
        location,
        tags,
        media:    mediaItems,            // stored as JSONB
        audio:    audio ? JSON.parse(audio) : null,
        expires_at: type === 'story'
          ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
          : null,
      })
      .select(`*, user:users!user_id(id, username, full_name, avatar, verified)`)
      .single();

    if (error) throw error;

    // Increment user post/reel count
    const countCol = type === 'reel' ? 'reels_count' : 'posts_count';
    await supabase.rpc('increment_user_count', { user_id: req.user.id, col: countCol });
    // ☝ Or use a plain update:
    // await supabase.from('users').update({ posts_count: req.user.posts_count + 1 }).eq('id', req.user.id);

    // Real-time: notify followers + broadcast to explore
    const io = req.app.get('io');
    const { data: followRows } = await supabase
      .from('follows')
      .select('follower_id')
      .eq('following_id', req.user.id);

    (followRows || []).forEach(({ follower_id }) =>
      io.to('user:' + follower_id).emit('feed_new_post', post)
    );
    io.emit('explore_new_post', post);

    res.status(201).json({ success: true, post });
  } catch (err) {
    console.error('Create post error:', err);
    res.status(500).json({ success: false, message: 'Failed to create post.' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/posts/feed
// ═══════════════════════════════════════════════════════════════════════════
router.get('/feed', protect, async (req, res) => {
  try {
    const page  = parseInt(req.query.page)  || 1;
    const limit = parseInt(req.query.limit) || 12;
    const offset = (page - 1) * limit;

    // Who the logged-in user follows
    const { data: followRows } = await supabase
      .from('follows')
      .select('following_id')
      .eq('follower_id', req.user.id);

    const followingIds = (followRows || []).map(r => r.following_id);
    followingIds.push(req.user.id);  // include own posts

    const followingLimit    = Math.floor(limit * 0.7);
    const recommendedLimit  = Math.ceil(limit  * 0.3);

    // Posts from people the user follows
    const { data: followingPosts } = await supabase
      .from('posts')
      .select(`*, user:users!user_id(id, username, full_name, avatar, verified)`)
      .in('user_id', followingIds)
      .in('type', ['post', 'reel', 'carousel'])
      .eq('is_deleted', false)
      .order('created_at', { ascending: false })
      .range(offset, offset + followingLimit - 1);

    // Recommended posts (not from following, sorted by engagement)
    const { data: recommendedPosts } = await supabase
      .from('posts')
      .select(`*, user:users!user_id(id, username, full_name, avatar, verified)`)
      .not('user_id', 'in', `(${followingIds.join(',')})`)
      .in('type', ['post', 'reel', 'carousel'])
      .eq('is_deleted', false)
      .order('likes_count', { ascending: false })
      .limit(recommendedLimit);

    // Interleave: every ~3 following posts insert 1 recommended
    const merged = [...(followingPosts || [])];
    (recommendedPosts || []).forEach((rp, i) =>
      merged.splice(Math.min(i * 3 + 2, merged.length), 0, rp)
    );

    // Fetch this user's likes and saves to mark isLiked / isSaved
    const postIds = merged.map(p => p.id);

    const [{ data: likedRows }, { data: savedRows }] = await Promise.all([
      supabase.from('likes').select('post_id').eq('user_id', req.user.id).in('post_id', postIds),
      supabase.from('saved_posts').select('post_id').eq('user_id', req.user.id).in('post_id', postIds),
    ]);

    const likedSet = new Set((likedRows || []).map(r => r.post_id));
    const savedSet = new Set((savedRows || []).map(r => r.post_id));

    const enriched = merged.map(p => ({
      ...p,
      isLiked: likedSet.has(p.id),
      isSaved: savedSet.has(p.id),
    }));

    res.json({
      success: true,
      posts:   enriched,
      page,
      hasMore: (followingPosts || []).length === followingLimit,
    });
  } catch (err) {
    console.error('Feed error:', err);
    res.status(500).json({ success: false, message: 'Failed to load feed.' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/posts/user/:userId
// ═══════════════════════════════════════════════════════════════════════════
router.get('/user/:userId', optionalAuth, async (req, res) => {
  try {
    const page   = parseInt(req.query.page)  || 1;
    const limit  = parseInt(req.query.limit) || 12;
    const offset = (page - 1) * limit;

    let query = supabase
      .from('posts')
      .select(`*, user:users!user_id(id, username, avatar, verified)`)
      .eq('user_id', req.params.userId)
      .eq('is_deleted', false)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (req.query.type) query = query.eq('type', req.query.type);

    const { data: posts, error } = await query;
    if (error) throw error;

    // Mark liked if authenticated
    let likedSet = new Set();
    if (req.user && posts?.length) {
      const { data: likedRows } = await supabase
        .from('likes').select('post_id')
        .eq('user_id', req.user.id)
        .in('post_id', posts.map(p => p.id));
      likedSet = new Set((likedRows || []).map(r => r.post_id));
    }

    res.json({
      success: true,
      posts: (posts || []).map(p => ({ ...p, isLiked: likedSet.has(p.id) })),
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to load posts.' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/posts/:id
// ═══════════════════════════════════════════════════════════════════════════
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const { data: post, error } = await supabase
      .from('posts')
      .select(`*, user:users!user_id(id, username, full_name, avatar, verified, bio)`)
      .eq('id', req.params.id)
      .eq('is_deleted', false)
      .single();

    if (error || !post) return res.status(404).json({ success: false, message: 'Post not found.' });

    let isLiked = false, isSaved = false;
    if (req.user) {
      const [{ data: like }, { data: save }] = await Promise.all([
        supabase.from('likes').select('post_id').eq('user_id', req.user.id).eq('post_id', post.id).maybeSingle(),
        supabase.from('saved_posts').select('post_id').eq('user_id', req.user.id).eq('post_id', post.id).maybeSingle(),
      ]);
      isLiked = !!like;
      isSaved = !!save;
    }

    res.json({ success: true, post: { ...post, isLiked, isSaved } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to load post.' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/posts/:id/like  — toggle like
// ═══════════════════════════════════════════════════════════════════════════
router.post('/:id/like', protect, async (req, res) => {
  try {
    const postId = req.params.id;
    const userId = req.user.id;

    // Check if already liked
    const { data: existing } = await supabase
      .from('likes')
      .select('post_id')
      .eq('user_id', userId)
      .eq('post_id', postId)
      .maybeSingle();

    let liked, likesCount;

    if (existing) {
      // Unlike
      await supabase.from('likes').delete().eq('user_id', userId).eq('post_id', postId);
      const { data: post } = await supabase
        .from('posts')
        .update({ likes_count: supabase.rpc('greatest', { a: 0, b: -1 }) })
        // simpler alternative below:
        .eq('id', postId)
        .select('likes_count, user_id')
        .single();

      // Decrement safely
      await supabase.rpc('decrement_likes', { post_id: postId });
      const { data: updated } = await supabase.from('posts').select('likes_count, user_id').eq('id', postId).single();
      liked = false;
      likesCount = updated.likes_count;
    } else {
      // Like
      await supabase.from('likes').insert({ user_id: userId, post_id: postId });
      await supabase.rpc('increment_likes', { post_id: postId });
      const { data: updated } = await supabase.from('posts').select('likes_count, user_id').eq('id', postId).single();
      liked = true;
      likesCount = updated.likes_count;

      // Notify post owner
      const io = req.app.get('io');
      await notifyAndEmit(io, 'like', updated.user_id, userId, {
        post_id: postId,
        message: req.user.username + ' liked your photo',
      });
    }

    // Broadcast live like count to all connected clients
    req.app.get('io').emit('post_like_update', { postId, likesCount, liked, byUserId: userId });

    res.json({ success: true, liked, likesCount });
  } catch (err) {
    console.error('Like error:', err);
    res.status(500).json({ success: false, message: 'Failed to update like.' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/posts/:id/save  — toggle save
// ═══════════════════════════════════════════════════════════════════════════
router.post('/:id/save', protect, async (req, res) => {
  try {
    const postId = req.params.id;
    const userId = req.user.id;

    const { data: existing } = await supabase
      .from('saved_posts')
      .select('post_id')
      .eq('user_id', userId)
      .eq('post_id', postId)
      .maybeSingle();

    let saved;
    if (existing) {
      await supabase.from('saved_posts').delete().eq('user_id', userId).eq('post_id', postId);
      await supabase.rpc('decrement_saves', { post_id: postId });
      saved = false;
    } else {
      await supabase.from('saved_posts').insert({ user_id: userId, post_id: postId });
      await supabase.rpc('increment_saves', { post_id: postId });
      saved = true;
    }

    const { data: post } = await supabase.from('posts').select('saves_count').eq('id', postId).single();
    res.json({ success: true, saved, savesCount: post?.saves_count || 0 });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to save post.' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// DELETE /api/posts/:id
// ═══════════════════════════════════════════════════════════════════════════
router.delete('/:id', protect, async (req, res) => {
  try {
    const { data: post } = await supabase
      .from('posts')
      .select('id, user_id, media, type')
      .eq('id', req.params.id)
      .single();

    if (!post) return res.status(404).json({ success: false, message: 'Post not found.' });
    if (post.user_id !== req.user.id) return res.status(403).json({ success: false, message: 'Not authorized.' });

    // Soft-delete the post row
    await supabase.from('posts').update({ is_deleted: true }).eq('id', post.id);

    // Delete media files from Supabase Storage
    if (post.media?.length) {
      const paths = post.media.map(m => m.path).filter(Boolean);
      if (paths.length) await supabase.storage.from('media').remove(paths);
    }

    // Decrement user count
    const countCol = post.type === 'reel' ? 'reels_count' : 'posts_count';
    await supabase.rpc('decrement_user_count', { user_id: req.user.id, col: countCol });

    req.app.get('io').emit('post_deleted', { postId: post.id });
    res.json({ success: true, message: 'Post deleted.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to delete post.' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// PUT /api/posts/:id  — edit caption / settings
// ═══════════════════════════════════════════════════════════════════════════
router.put('/:id', protect, async (req, res) => {
  try {
    const { caption, location, commentsDisabled, likesHidden } = req.body;

    const { data: post } = await supabase
      .from('posts')
      .select('id, user_id')
      .eq('id', req.params.id)
      .single();

    if (!post) return res.status(404).json({ success: false, message: 'Post not found.' });
    if (post.user_id !== req.user.id) return res.status(403).json({ success: false, message: 'Not authorized.' });

    const updates = {};
    if (caption           !== undefined) updates.caption            = caption;
    if (location          !== undefined) updates.location           = location;
    if (commentsDisabled  !== undefined) updates.comments_disabled  = commentsDisabled;
    if (likesHidden       !== undefined) updates.likes_hidden       = likesHidden;

    const { data: updated, error } = await supabase
      .from('posts')
      .update(updates)
      .eq('id', post.id)
      .select()
      .single();

    if (error) throw error;
    res.json({ success: true, post: updated });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to edit post.' });
  }
});

module.exports = router;
