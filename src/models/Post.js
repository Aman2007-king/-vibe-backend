const mongoose = require('mongoose');

const mediaSchema = new mongoose.Schema({
  url: { type: String, required: true },
  type: { type: String, enum: ['image','video'], required: true },
  width: Number, 
  height: Number, 
  duration: Number, 
  thumbnail: String, 
  altText: String, 
  size: Number,
}, { _id: false });

const postSchema = new mongoose.Schema({
  user: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true 
  },
  type: { 
    type: String, 
    enum: ['post','reel','story','carousel'], 
    default: 'post' 
  },
  media: [mediaSchema],
  caption: { 
    type: String, 
    maxlength: 2200, 
    default: '' 
  },
  location: { 
    type: String, 
    maxlength: 100 
  },
  tags: [{ 
    type: String 
  }],
  mentions: [{
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User' 
  }],
  audio: { 
    title: String, 
    artist: String, 
    url: String, 
    cover: String 
  },
  likes: [{
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User' 
  }],
  likesCount: { 
    type: Number, 
    default: 0 
  },
  commentsCount: { 
    type: Number, 
    default: 0 
  },
  sharesCount: { 
    type: Number, 
    default: 0 
  },
  savesCount: { 
    type: Number, 
    default: 0 
  },
  viewsCount: { 
    type: Number, 
    default: 0 
  },
  expiresAt: Date,
  viewers: [{
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User' 
  }],
  viewersCount: { 
    type: Number, 
    default: 0 
  },
  commentsDisabled: { 
    type: Boolean, 
    default: false 
  },
  likesHidden: { 
    type: Boolean, 
    default: false 
  },
  isArchived: { 
    type: Boolean, 
    default: false 
  },
  isDeleted: { 
    type: Boolean, 
    default: false 
  },
  engagementScore: { 
    type: Number, 
    default: 0 
  },
  createdAt: { 
    type: Date, 
    default: Date.now 
  },
}, { 
  timestamps: true, 
  toJSON: { virtuals: true }, 
  toObject: { virtuals: true } 
});

// Indexes for performance
postSchema.index({ user: 1, createdAt: -1 });
postSchema.index({ type: 1, createdAt: -1 });
postSchema.index({ tags: 1 });
postSchema.index({ caption: 'text', tags: 'text' });
postSchema.index({ engagementScore: -1, createdAt: -1 });
postSchema.index({ engagementScore: -1 });
postSchema.index({ isDeleted: 1, createdAt: -1 });
postSchema.index({ viewsCount: -1 });

postSchema.virtual('mediaUrls').get(function () {
  const base = process.env.SERVER_URL || 'http://localhost:3000';
  return (this.media || []).map(m => ({
    ...m,
    url: m.url.startsWith('http') ? m.url : base + '/uploads/posts/' + m.url,
    thumbnail: m.thumbnail ? (m.thumbnail.startsWith('http') ? m.thumbnail : base + '/uploads/posts/' + m.thumbnail) : null,
  }));
});

postSchema.pre('save', function (next) {
  this.engagementScore = (this.likesCount * 1) + (this.commentsCount * 3) + (this.sharesCount * 2) + (this.savesCount * 2);
  next();
});

postSchema.methods.isLikedBy = function (uid) { 
  return this.likes.some(id => id.toString() === uid.toString()); 
};

module.exports = mongoose.model('Post', postSchema);
