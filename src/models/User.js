const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');

const userSchema = new mongoose.Schema({
  username:       { type: String, required: true, unique: true, trim: true, minlength: 3, maxlength: 30, match: [/^[a-zA-Z0-9._]+$/, 'Invalid username'], lowercase: true },
  email:          { type: String, required: true, unique: true, trim: true, lowercase: true },
  password:       { type: String, minlength: 6, select: false },
  firebaseUid:    { type: String, sparse: true, index: true },   // Google auth
  phone:          { type: String, trim: true, default: '' },
  fullName:       { type: String, required: true, trim: true, maxlength: 60 },
  bio:            { type: String, maxlength: 150, default: '' },
  website:        { type: String, maxlength: 100, default: '' },
  avatar:         { type: String, default: '' },
  coverPhoto:     { type: String, default: '' },
  location:       { type: String, maxlength: 60, default: '' },
  verified:       { type: Boolean, default: false },
  isPrivate:      { type: Boolean, default: false },
  isActive:       { type: Boolean, default: true },
  accountType:    { type: String, enum: ['personal','creator','business'], default: 'personal' },

  followers:      [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  following:      [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  followersCount: { type: Number, default: 0 },
  followingCount: { type: Number, default: 0 },
  postsCount:     { type: Number, default: 0 },
  reelsCount:     { type: Number, default: 0 },

  savedPosts:     [{ type: mongoose.Schema.Types.ObjectId, ref: 'Post' }],
  blockedUsers:   [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  closeFriends:   [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  followRequests: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

  lastSeen:       { type: Date, default: Date.now },
}, { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } });

// Indexes
userSchema.index({ username: 1 });
userSchema.index({ email: 1 });
userSchema.index({ fullName: 'text', username: 'text', bio: 'text' });

// Avatar URL virtual
userSchema.virtual('avatarUrl').get(function () {
  if (!this.avatar) return `https://ui-avatars.com/api/?name=${encodeURIComponent(this.fullName || 'U')}&background=0095f6&color=fff&size=150`;
  if (this.avatar.startsWith('http')) return this.avatar;
  return `${process.env.SERVER_URL || 'https://vibe-backend-416x.onrender.com'}/uploads/avatars/${this.avatar}`;
});

// Hash password before save
userSchema.pre('save', async function (next) {
  if (!this.isModified('password') || !this.password) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

userSchema.methods.comparePassword = async function (candidate) {
  if (!this.password) return false;
  return bcrypt.compare(candidate, this.password);
};

userSchema.methods.toPublicJSON = function (viewerId) {
  const obj = this.toObject();
  const isOwn = viewerId && viewerId.toString() === this._id.toString();
  return {
    id:             obj._id,
    username:       obj.username,
    fullName:       obj.fullName,
    email:          isOwn ? obj.email : undefined,
    bio:            obj.bio,
    website:        obj.website,
    location:       obj.location,
    avatar:         this.avatarUrl,
    coverPhoto:     obj.coverPhoto,
    verified:       obj.verified,
    isPrivate:      obj.isPrivate,
    accountType:    obj.accountType,
    followersCount: obj.followersCount,
    followingCount: obj.followingCount,
    postsCount:     obj.postsCount,
    reelsCount:     obj.reelsCount,
    isFollowing:    viewerId ? obj.followers.some(id => id.toString() === viewerId.toString()) : false,
    isFollowedBy:   viewerId ? obj.following.some(id => id.toString() === viewerId.toString()) : false,
    lastSeen:       obj.lastSeen,
    createdAt:      obj.createdAt,
  };
};

module.exports = mongoose.model('User', userSchema);
