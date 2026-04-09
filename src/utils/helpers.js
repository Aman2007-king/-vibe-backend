// Format a Supabase user row into the public API shape
const formatUser = (u) => ({
  id:             u.id,
  username:       u.username,
  fullName:       u.full_name,
  email:          u.email,
  avatar:         u.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(u.full_name || 'U')}&background=0095f6&color=fff&size=150`,
  bio:            u.bio            || '',
  website:        u.website        || '',
  location:       u.location       || '',
  verified:       u.verified       || false,
  isPrivate:      u.is_private     || false,
  accountType:    u.account_type   || 'personal',
  followersCount: u.followers_count || 0,
  followingCount: u.following_count || 0,
  postsCount:     u.posts_count     || 0,
  reelsCount:     u.reels_count     || 0,
  lastSeen:       u.last_seen,
  createdAt:      u.created_at,
});

// Format a Supabase post row into the public API shape
const formatPost = (p, userId = null) => {
  const user = p.user || p.users || {};
  return {
    _id:           p.id,
    id:            p.id,
    user: {
      id:       user.id       || p.user_id,
      _id:      user.id       || p.user_id,
      username: user.username || '',
      fullName: user.full_name || '',
      avatar:   user.avatar   || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.full_name || 'U')}&background=0095f6&color=fff`,
      verified: user.verified || false,
    },
    type:          p.type          || 'post',
    caption:       p.caption       || '',
    location:      p.location      || '',
    tags:          p.tags          || [],
    media:         Array.isArray(p.media) ? p.media : [],
    mediaUrls:     Array.isArray(p.media) ? p.media : [],
    likesCount:    p.likes_count   || 0,
    commentsCount: p.comments_count || 0,
    savesCount:    p.saves_count   || 0,
    viewsCount:    p.views_count   || 0,
    isLiked:       p.isLiked       || false,
    isSaved:       p.isSaved       || false,
    commentsDisabled: p.comments_disabled || false,
    likesHidden:   p.likes_hidden  || false,
    audio:         p.audio         || null,
    createdAt:     p.created_at,
  };
};

// Format notification row
const formatNotif = (n) => ({
  id:        n.id,
  _id:       n.id,
  type:      n.type,
  message:   n.message || '',
  isRead:    n.is_read || false,
  createdAt: n.created_at,
  sender:    n.sender   || n.users  || {},
  post:      n.post     || n.posts  || null,
});

module.exports = { formatUser, formatPost, formatNotif };
