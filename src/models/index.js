const mongoose = require('mongoose');
 
const commentSchema = new mongoose.Schema({
  post:     { type: mongoose.Schema.Types.ObjectId, ref: 'Post', required: true },
  user:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  text:     { type: String, required: true, maxlength: 2200 },
  likes:    [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  likesCount: { type: Number, default: 0 },
  parent:   { type: mongoose.Schema.Types.ObjectId, ref: 'Comment', default: null },
  replies:  [{ type: mongoose.Schema.Types.ObjectId, ref: 'Comment' }],
  repliesCount: { type: Number, default: 0 },
  mentions: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  isDeleted:{ type: Boolean, default: false },
}, { timestamps: true });
 
commentSchema.index({ post: 1, createdAt: -1 });
 
const conversationSchema = new mongoose.Schema({
  participants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  isGroup:   { type: Boolean, default: false },
  groupName: String,
  groupAdmin:{ type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  lastMessage: { text: String, type: String, senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, ts: Date },
  unreadCounts: { type: Map, of: Number, default: {} },
  mutedBy:   [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  deletedFor:[{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
}, { timestamps: true });
 
conversationSchema.index({ participants: 1 });
 
const messageSchema = new mongoose.Schema({
  conversation: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', required: true },
  sender:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type:     { type: String, enum: ['text','image','video','audio','file','sticker','post_share','reel_share','story_reply','gif'], default: 'text' },
  text:     { type: String, maxlength: 10000 },
  media:    { url: String, thumbnail: String, duration: Number, size: Number },
  replyTo:  { type: mongoose.Schema.Types.ObjectId, ref: 'Message' },
  sharedPost:{ type: mongoose.Schema.Types.ObjectId, ref: 'Post' },
  reactions:[{ user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, emoji: String }],
  seenBy:   [{ user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, seenAt: Date }],
  deliveredTo:[{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  deletedFor:[{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  isDeleted:{ type: Boolean, default: false },
}, { timestamps: true });
 
messageSchema.index({ conversation: 1, createdAt: -1 });
 
const notificationSchema = new mongoose.Schema({
  recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  sender:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type:      { type: String, enum: ['like','comment','follow','mention','tag','story_like','story_view','reel_like','reel_comment','dm','live','group_invite','post_share'], required: true },
  post:      { type: mongoose.Schema.Types.ObjectId, ref: 'Post' },
  comment:   { type: mongoose.Schema.Types.ObjectId, ref: 'Comment' },
  message:   String,
  isRead:    { type: Boolean, default: false },
  readAt:    Date,
}, { timestamps: true });
 
notificationSchema.index({ recipient: 1, isRead: 1, createdAt: -1 });
 
const groupSchema = new mongoose.Schema({
  name:        { type: String, required: true, maxlength: 100 },
  description: { type: String, maxlength: 1000 },
  cover:       { type: String, default: '' },
  admin:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  moderators:  [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  members:     [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  membersCount:{ type: Number, default: 0 },
  privacy:     { type: String, enum: ['public','private','secret'], default: 'public' },
  category:    String,
  tags:        [String],
pendingMembers:[{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  isActive:    { type: Boolean, default: true },
}, { timestamps: true });
 
const storySchema = new mongoose.Schema({
  user:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  media:    { url: String, type: { type: String, enum: ['image','video'] }, thumbnail: String, duration: Number },
  text:     String,
  location: String,
  music:    { title: String, artist: String, url: String },
  audience: { type: String, enum: ['all','close_friends'], default: 'all' },
  viewers:  [{ user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, viewedAt: Date }],
  viewersCount: { type: Number, default: 0 },
  reactions:    [{ user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, emoji: String }],
  replies:      [{ user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, text: String, ts: Date }],
  expiresAt:    { type: Date, default: () => new Date(Date.now() + 24*60*60*1000) },
  isDeleted:    { type: Boolean, default: false },
}, { timestamps: true });
 
storySchema.index({ user: 1, createdAt: -1 });
storySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
 
module.exports = {
  Comment:      mongoose.model('Comment', commentSchema),
  Conversation: mongoose.model('Conversation', conversationSchema),
  Message:      mongoose.model('Message', messageSchema),
  Notification: mongoose.model('Notification', notificationSchema),
  Group:        mongoose.model('Group', groupSchema),
  Story:        mongoose.model('Story', storySchema),
};
 
