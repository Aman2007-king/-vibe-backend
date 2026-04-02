const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  username: {
    type: String, 
    required: true, 
    unique: true, 
    trim: true, 
    minlength: 3, 
    maxlength: 30, 
    match: [/^[a-zA-Z0-9._]+$/, 'Invalid username'], 
    lowercase: true 
  },
  email: {
    type: String, 
    required: true, 
    unique: true, 
    trim: true, 
    lowercase: true 
  },
  password: {
    type: String, 
    required: true, 
    minlength: 6, 
    select: false 
  },
  phone: { 
    type: String, 
    trim: true 
  },
  fullName: {
    type: String, 
    required: true, 
    trim: true, 
    maxlength: 60 
  },
  bio: {
    type: String, 
    maxlength: 150, 
    default: '' 
  },
  website: {
    type: String, 
    maxlength: 100 
  },
  avatar: {
    type: String, 
    default: '' 
  },
  coverPhoto: {
    type: String, 
    default: '' 
  },
  location: {
    type: String, 
    maxlength: 60 
  },
  verified: {
    type: Boolean, 
    default: false 
  },
  followers: [{
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User' 
  }],
  following: [{
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User' 
  }],
  followersCount: {
    type: Number, 
    default: 0 
  },
  followingCount: {
    type: Number, 
    default: 0 
  },
  blockedUsers: [{ 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User' 
  }],
  postsCount: {
    type: Number, 
    default: 0 
  },
  reelsCount: {
    type: Number, 
    default: 0 
  },
  storiesCount: {
    type: Number, 
    default: 0 
  },
  accountType: {
    type: String, 
    enum: ['personal','creator','business'], 
    default: 'personal' 
  },
  profileTheme: {
    type: String,
    enum: ['default', 'dark', 'light', 'blue', 'pink', 'purple'],
    default: 'default'
  },
  highlightReels: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Post'
  }],
  isPrivate: {
    type: Boolean, 
    default: false 
  },
  isActive: {
    type: Boolean, 
    default: true 
  },
  savedPosts: [{
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Post' 
  }],
  lastSeen: {
    type: Date, 
    default: Date.now 
  },
  followRequests: [{ 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User' 
  }],
  closeFriends: [{ 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User' 
  }],
  privacySettings: {
    profileVisibility: { 
      type: String, 
      enum: ['public', 'private', 'followers'], 
      default: 'public' 
    },
    storyVisibility: { 
      type: String, 
      enum: ['public', 'closeFriends', 'followers'], 
      default: 'public' 
    },
    messagePermissions: { 
      type: String, 
      enum: ['everyone', 'followers', 'following'], 
      default: 'everyone' 
    }
  },
  activityLog: [{
    action: String,
    target: { type: mongoose.Schema.Types.ObjectId },
    targetType: String,
    timestamp: { type: Date, default: Date.now }
  }],
  
  // ═══════════════════════════════════════════════════
  // ADVANCED SECURITY FIELDS
  // ═══════════════════════════════════════════════════
  twoFactorEnabled: { type: Boolean, default: false },
  twoFactorSecret: { type: String, select: false },
  tempTwoFactorSecret: { type: String, select: false }, // Added for the setup flow
  backupCodes: [{ type: String, select: false }],
  loginSessions: [{
    sessionId: String,
    userAgent: String,
    ip: String,
    createdAt: { type: Date, default: Date.now },
    expiresAt: Date,
    isActive: { type: Boolean, default: true }
  }],
  failedLoginAttempts: { type: Number, default: 0 },
  lockoutUntil: Date

}, { 
  timestamps: true, 
  toJSON: { virtuals: true }, 
  toObject: { virtuals: true } 
});

// Indexes for performance
userSchema.index({ username: 1 });
userSchema.index({ email: 1 });
userSchema.index({ fullName: 'text', username: 'text', bio: 'text' });
userSchema.index({ followersCount: -1 });
userSchema.index({ postsCount: -1 });
userSchema.index({ lastSeen: -1 });

userSchema.virtual('avatarUrl').get(function () {
  if (!this.avatar) return 'https://ui-avatars.com/api/?name=' + encodeURIComponent(this.fullName) + '&background=random';
  if (this.avatar.startsWith('http')) return this.avatar;
  return (process.env.SERVER_URL || 'http://localhost:3000') + '/uploads/avatars/' + this.avatar;
});

userSchema.virtual('stats').get(function() {
  return {
    posts: this.postsCount,
    reels: this.reelsCount,
    stories: this.storiesCount,
    followers: this.followersCount,
    following: this.followingCount
  };
});

userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

userSchema.methods.comparePassword = async function (candidate) {
  return bcrypt.compare(candidate, this.password);
};

userSchema.methods.isFollowing = function (uid) { 
  return this.following.some(id => id.toString() === uid.toString()); 
};

userSchema.methods.isFollowedBy = function (uid) { 
  return this.followers.some(id => id.toString() === uid.toString()); 
};

userSchema.methods.toPublicJSON = function (currentUserId) {
  return { 
    id: this._id, 
    username: this.username, 
    fullName: this.fullName, 
    bio: this.bio, 
    website: this.website, 
    avatar: this.avatarUrl, 
    coverPhoto: this.coverPhoto, 
    verified: this.verified, 
    isPrivate: this.isPrivate, 
    accountType: this.accountType, 
    profileTheme: this.profileTheme,
    followersCount: this.followersCount, 
    followingCount: this.followingCount, 
    postsCount: this.postsCount, 
    reelsCount: this.reelsCount, 
    location: this.location, 
    lastSeen: this.lastSeen, 
    createdAt: this.createdAt, 
    isFollowing: currentUserId ? this.isFollowedBy(currentUserId) : false, 
    isFollowedBy: currentUserId ? this.isFollowing(currentUserId) : false,
    stats: this.stats
  };
};

module.exports = mongoose.model('User', userSchema);
