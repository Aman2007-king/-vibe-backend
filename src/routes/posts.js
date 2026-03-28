const router = require('express').Router();
const Post   = require('../models/Post');
const User   = require('../models/User');
const { Notification } = require('../models/index');
const { protect, optionalAuth } = require('../middleware/auth');
const { upload, handlePostUpload } = require('../middleware/upload');
 
const notifyAndEmit = async (io, type, recipientId, senderId, extras = {}) => {
  if (recipientId.toString() === senderId.toString()) return;
  const notif = await Notification.create({ recipient: recipientId, sender: senderId, type, ...extras });
  const populated = await notif.populate('sender', 'username avatar verified');
  io.to('user:' + recipientId).emit('notification', populated);
};
 
router.post('/', protect, upload.array('media', 10), handlePostUpload, async (req, res) => {
  try {
    const { caption, location, tags, type = 'post', audio } = req.body;
    const media = req.processedMedia || [];
    if (!media.length) return res.status(400).json({ success: false, message: 'At least one photo or video is required.' });
    const hashtags = (caption?.match(/#[a-zA-Z0-9_]+/g) || []).map(t => t.toLowerCase());
    const post = await Post.create({ user: req.user._id, type, media, caption: caption || '', location, tags: hashtags, audio: audio ? JSON.parse(audio) : undefined });
    await User.findByIdAndUpdate(req.user._id, { $inc: { [type === 'reel' ? 'reelsCount' : 'postsCount']: 1 } });
const populated = await post.populate('user', 'username fullName avatar verified');
    const io = req.app.get('io');
    const fullUser = await User.findById(req.user._id).select('followers');
    fullUser.followers.forEach(fid => io.to('user:' + fid).emit('feed_new_post', populated));
    io.emit('explore_new_post', populated);
    res.status(201).json({ success: true, post: { ...populated.toObject(), media: populated.mediaUrls } });
  } catch (err) { console.error(err); res.status(500).json({ success: false, message: 'Failed to create post.' }); }
});
 
router.get('/feed', protect, async (req, res) => {
  try {
    const { page = 1, limit = 12 } = req.query;
    const user = await User.findById(req.user._id).select('following');
    const followingIds = [...(user.following || []), req.user._id];
    const [followingPosts, recommendedPosts] = await Promise.all([
      Post.find({ user: { $in: followingIds }, type: { $in: ['post','reel','carousel'] }, isDeleted: false }).populate('user', 'username fullName avatar verified').sort({ createdAt: -1 }).skip((page-1)*limit).limit(Math.floor(limit*0.7)),
      Post.find({ user: { $nin: followingIds }, type: { $in: ['post','reel','carousel'] }, isDeleted: false, engagementScore: { $gt: 0 } }).populate('user', 'username fullName avatar verified').sort({ engagementScore: -1, createdAt: -1 }).limit(Math.ceil(limit*0.3)),
    ]);
    const merged = [...followingPosts];
    recommendedPosts.forEach((rp, i) => merged.splice(Math.min(i*3+2, merged.length), 0, rp));
    const savedPosts = req.user.savedPosts || [];
    const enriched = merged.map(p => { const obj = p.toObject(); obj.isLiked = p.likes?.some(id => id.toString() === req.user._id.toString()) || false; obj.isSaved = savedPosts.some(id => id.toString() === p._id.toString()); obj.media = p.mediaUrls; return obj; });
    res.json({ success: true, posts: enriched, page: +page, hasMore: followingPosts.length === Math.floor(limit*0.7) });
  } catch (err) { console.error(err); res.status(500).json({ success: false, message: 'Failed to load feed.' }); }
});
 
router.get('/user/:userId', optionalAuth, async (req, res) => {
  try {
    const { page = 1, limit = 12, type } = req.query;
    const filter = { user: req.params.userId, isDeleted: false };
    if (type) filter.type = type;
    const posts = await Post.find(filter).populate('user', 'username avatar verified').sort({ createdAt: -1 }).skip((page-1)*limit).limit(+limit);
    res.json({ success: true, posts: posts.map(p => ({ ...p.toObject(), media: p.mediaUrls, isLiked: req.user ? p.likes.some(id => id.toString() === req.user._id.toString()) : false })) });
  } catch (err) { res.status(500).json({ success: false, message: 'Failed to load posts.' }); }
});
 
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id).populate('user', 'username fullName avatar verified bio');
    if (!post || post.isDeleted) return res.status(404).json({ success: false, message: 'Post not found.' });
    const obj = post.toObject(); obj.isLiked = req.user ? post.likes.some(id => id.toString() === req.user._id.toString()) : false; obj.isSaved = req.user ? (req.user.savedPosts||[]).some(id => id.toString() === post._id.toString()) : false; obj.media = post.mediaUrls;
    res.json({ success: true, post: obj });
  } catch (err) { res.status(500).json({ success: false, message: 'Failed to load post.' }); }
});
 
router.post('/:id/like', protect, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id).select('likes likesCount user');
    if (!post) return res.status(404).json({ success: false, message: 'Post not found.' });
    const uid = req.user._id;
    const alreadyLiked = post.likes.some(id => id.toString() === uid.toString());
    if (alreadyLiked) { post.likes.pull(uid); post.likesCount = Math.max(0, post.likesCount-1); }
    else { post.likes.push(uid); post.likesCount += 1; const io = req.app.get('io'); await notifyAndEmit(io, 'like', post.user, uid, { post: post._id, message: req.user.username + ' liked your photo' }); }
    await post.save();
    req.app.get('io').emit('post_like_update', { postId: post._id, likesCount: post.likesCount, liked: !alreadyLiked, byUserId: uid });
    res.json({ success: true, liked: !alreadyLiked, likesCount: post.likesCount });
  } catch (err) { res.status(500).json({ success: false, message: 'Failed to update like.' }); }
});
 
router.post('/:id/save', protect, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id).select('_id savesCount');
    if (!post) return res.status(404).json({ success: false, message: 'Post not found.' });
    const user = await User.findById(req.user._id).select('savedPosts');
    const alreadySaved = user.savedPosts.some(id => id.toString() === post._id.toString());
    if (alreadySaved) { user.savedPosts.pull(post._id); post.savesCount = Math.max(0, post.savesCount-1); }
    else { user.savedPosts.push(post._id); post.savesCount += 1; }
    await Promise.all([user.save(), post.save()]);
    res.json({ success: true, saved: !alreadySaved, savesCount: post.savesCount });
  } catch (err) { res.status(500).json({ success: false, message: 'Failed to save post.' }); }
});
 
router.delete('/:id', protect, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ success: false, message: 'Post not found.' });
    if (post.user.toString() !== req.user._id.toString()) return res.status(403).json({ success: false, message: 'Not authorized.' });
    post.isDeleted = true; await post.save();
    await User.findByIdAndUpdate(req.user._id, { $inc: { postsCount: -1 } });
    req.app.get('io').emit('post_deleted', { postId: post._id });
    res.json({ success: true, message: 'Post deleted.' });
  } catch (err) { res.status(500).json({ success: false, message: 'Failed to delete post.' }); }
});
 
router.put('/:id', protect, async (req, res) => {
  try {
    const { caption, location, commentsDisabled, likesHidden } = req.body;
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ success: false, message: 'Post not found.' });
    if (post.user.toString() !== req.user._id.toString()) return res.status(403).json({ success: false, message: 'Not authorized.' });
    if (caption !== undefined) post.caption = caption;
    if (location !== undefined) post.location = location;
    if (commentsDisabled !== undefined) post.commentsDisabled = commentsDisabled;
    if (likesHidden !== undefined) post.likesHidden = likesHidden;
    await post.save();
    res.json({ success: true, post });
  } catch (err) { res.status(500).json({ success: false, message: 'Failed to edit post.' }); }
});
 
module.exports = router;
 
