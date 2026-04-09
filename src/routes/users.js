const router   = require('express').Router();
const supabase = require('../db/supabase');
const { protect, optionalAuth } = require('../middleware/auth');
const { upload, handleAvatarUpload } = require('../middleware/upload');
const { formatUser } = require('../utils/helpers');
const notify   = require('../utils/notify');
const { isUserOnline } = require('../socket/socketManager');

// ── UPDATE MY PROFILE ──────────────────────────────────
// MUST be before /:username to avoid matching "me" as username
router.put('/me', protect, upload.single('avatar'), handleAvatarUpload, async (req, res) => {
  try {
    const allowed = ['full_name', 'bio', 'website', 'location', 'is_private', 'account_type'];
    const updates = {};

    // Map frontend camelCase → Supabase snake_case
    if (req.body.fullName    !== undefined) updates.full_name    = req.body.fullName.trim();
    if (req.body.bio         !== undefined) updates.bio          = req.body.bio;
    if (req.body.website     !== undefined) updates.website      = req.body.website;
    if (req.body.location    !== undefined) updates.location     = req.body.location;
    if (req.body.isPrivate   !== undefined) updates.is_private   = req.body.isPrivate === 'true' || req.body.isPrivate === true;
    if (req.body.accountType !== undefined) updates.account_type = req.body.accountType;

    // Username change
    if (req.body.username) {
      const u = req.body.username.toLowerCase().trim();
      if (!/^[a-zA-Z0-9._]{3,30}$/.test(u)) {
        return res.status(400).json({ success: false, message: 'Invalid username format.' });
      }
      const { data: taken } = await supabase.from('users').select('id').eq('username', u).neq('id', req.user.id).maybeSingle();
      if (taken) return res.status(409).json({ success: false, message: 'Username already taken.' });
      updates.username = u;
    }

    if (req.avatarUrl) updates.avatar = req.avatarUrl;

    const { data: user, error } = await supabase
      .from('users')
      .update(updates)
      .eq('id', req.user.id)
      .select('*')
      .single();

    if (error) throw error;
    res.json({ success: true, user: formatUser(user) });
  } catch (err) {
    console.error('Update profile error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── SUGGESTIONS ────────────────────────────────────────
router.get('/suggestions/people', protect, async (req, res) => {
  try {
    // Get who I follow
    const { data: follows } = await supabase
      .from('follows')
      .select('following_id')
      .eq('follower_id', req.user.id);

    const exclude = (follows || []).map(f => f.following_id);
    exclude.push(req.user.id);

    const { data: users } = await supabase
      .from('users')
      .select('id, username, full_name, avatar, verified, bio, followers_count')
      .not('id', 'in', `(${exclude.join(',')})`)
      .eq('is_active', true)
      .order('followers_count', { ascending: false })
      .limit(10);

    res.json({
      success:     true,
      suggestions: (users || []).map(u => ({ ...formatUser(u), isOnline: isUserOnline(u.id) })),
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET USER PROFILE ────────────────────────────────────
router.get('/:username', optionalAuth, async (req, res) => {
  try {
    const { data: user } = await supabase
      .from('users')
      .select('*')
      .eq('username', req.params.username.toLowerCase())
      .maybeSingle();

    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

    let isFollowing = false;
    if (req.user) {
      const { data: follow } = await supabase
        .from('follows')
        .select('follower_id')
        .eq('follower_id', req.user.id)
        .eq('following_id', user.id)
        .maybeSingle();
      isFollowing = !!follow;
    }

    res.json({
      success: true,
      user: { ...formatUser(user), isFollowing, isOnline: isUserOnline(user.id) },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── FOLLOW / UNFOLLOW ──────────────────────────────────
router.post('/:id/follow', protect, async (req, res) => {
  try {
    if (req.params.id === req.user.id) {
      return res.status(400).json({ success: false, message: "You can't follow yourself." });
    }

    const { data: target } = await supabase.from('users').select('*').eq('id', req.params.id).maybeSingle();
    if (!target) return res.status(404).json({ success: false, message: 'User not found.' });

    const io = req.app.get('io');

    // Check if already following
    const { data: existing } = await supabase
      .from('follows')
      .select('follower_id')
      .eq('follower_id', req.user.id)
      .eq('following_id', target.id)
      .maybeSingle();

    if (existing) {
      // Unfollow
      await supabase.from('follows').delete().eq('follower_id', req.user.id).eq('following_id', target.id);
      await supabase.from('users').update({ followers_count: Math.max(0, (target.followers_count || 1) - 1) }).eq('id', target.id);
      await supabase.from('users').update({ following_count: Math.max(0, (req.user.following_count || 1) - 1) }).eq('id', req.user.id);

      const { data: updated } = await supabase.from('users').select('followers_count').eq('id', target.id).single();
      return res.json({ success: true, following: false, followersCount: updated.followers_count });
    }

    // Private account → follow request
    if (target.is_private) {
      const { data: alreadyReq } = await supabase
        .from('follow_requests')
        .select('id')
        .eq('from_user_id', req.user.id)
        .eq('to_user_id', target.id)
        .maybeSingle();

      if (!alreadyReq) {
        await supabase.from('follow_requests').insert({ from_user_id: req.user.id, to_user_id: target.id });
        await notify(io, { type: 'follow_request', recipientId: target.id, senderId: req.user.id, message: `${req.user.username} wants to follow you` });
      }
      return res.json({ success: true, requested: true, following: false, message: 'Follow request sent' });
    }

    // Public account → direct follow
    await supabase.from('follows').insert({ follower_id: req.user.id, following_id: target.id });
    await supabase.from('users').update({ followers_count: (target.followers_count || 0) + 1 }).eq('id', target.id);
    await supabase.from('users').update({ following_count: (req.user.following_count || 0) + 1 }).eq('id', req.user.id);

    await notify(io, { type: 'follow', recipientId: target.id, senderId: req.user.id, message: `${req.user.username} started following you` });
    io?.to('user:' + target.id).emit('new_follower', {
      from: { id: req.user.id, username: req.user.username, avatar: req.user.avatar },
    });

    const { data: updated } = await supabase.from('users').select('followers_count').eq('id', target.id).single();
    res.json({ success: true, following: true, followersCount: updated.followers_count });
  } catch (err) {
    console.error('Follow error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── ACCEPT / REJECT FOLLOW REQUEST ─────────────────────
router.post('/:id/follow-request/:action', protect, async (req, res) => {
  try {
    const { action } = req.params;
    if (!['accept', 'reject'].includes(action)) {
      return res.status(400).json({ success: false, message: 'Action must be accept or reject.' });
    }

    // Delete the request
    await supabase.from('follow_requests')
      .delete()
      .eq('from_user_id', req.params.id)
      .eq('to_user_id', req.user.id);

    if (action === 'accept') {
      // Create the follow
      await supabase.from('follows').insert({ follower_id: req.params.id, following_id: req.user.id });

      const { data: requester } = await supabase.from('users').select('*').eq('id', req.params.id).single();
      await supabase.from('users').update({ followers_count: (req.user.followers_count || 0) + 1 }).eq('id', req.user.id);
      await supabase.from('users').update({ following_count: (requester.following_count || 0) + 1 }).eq('id', req.params.id);

      const io = req.app.get('io');
      await notify(io, { type: 'follow_request_accepted', recipientId: req.params.id, senderId: req.user.id, message: `${req.user.username} accepted your follow request` });
    }

    res.json({ success: true, message: `Follow request ${action}ed` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── BLOCK / UNBLOCK ────────────────────────────────────
router.post('/:id/block', protect, async (req, res) => {
  try {
    if (req.params.id === req.user.id) {
      return res.status(400).json({ success: false, message: "Can't block yourself." });
    }

    const { data: existing } = await supabase
      .from('blocks')
      .select('id')
      .eq('blocker_id', req.user.id)
      .eq('blocked_id', req.params.id)
      .maybeSingle();

    if (existing) {
      await supabase.from('blocks').delete().eq('blocker_id', req.user.id).eq('blocked_id', req.params.id);
      return res.json({ success: true, blocked: false, message: 'User unblocked' });
    }

    await supabase.from('blocks').insert({ blocker_id: req.user.id, blocked_id: req.params.id });
    // Also remove follow relationship
    await supabase.from('follows').delete()
      .or(`and(follower_id.eq.${req.user.id},following_id.eq.${req.params.id}),and(follower_id.eq.${req.params.id},following_id.eq.${req.user.id})`);

    res.json({ success: true, blocked: true, message: 'User blocked' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET FOLLOWERS ──────────────────────────────────────
router.get('/:id/followers', optionalAuth, async (req, res) => {
  try {
    const { data: follows } = await supabase
      .from('follows')
      .select('follower:users!follower_id(id, username, full_name, avatar, verified, followers_count, bio)')
      .eq('following_id', req.params.id);

    const followers = (follows || []).map(f => ({
      ...formatUser(f.follower),
      isOnline: isUserOnline(f.follower.id),
    }));

    res.json({ success: true, followers });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET FOLLOWING ──────────────────────────────────────
router.get('/:id/following', optionalAuth, async (req, res) => {
  try {
    const { data: follows } = await supabase
      .from('follows')
      .select('following:users!following_id(id, username, full_name, avatar, verified, followers_count, bio)')
      .eq('follower_id', req.params.id);

    const following = (follows || []).map(f => ({
      ...formatUser(f.following),
      isOnline: isUserOnline(f.following.id),
    }));

    res.json({ success: true, following });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
