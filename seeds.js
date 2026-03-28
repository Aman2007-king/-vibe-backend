require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');
const User     = require('../models/User');
const Post     = require('../models/Post');
const { Comment, Group } = require('../models/index');
 
const DEMO_USERS = [
  { username: 'alex.travels', fullName: 'Alex Johnson',  email: 'alex@vibe.app',  password: 'password123', bio: '📸 Photographer | 🌍 Explorer', verified: true  },
  { username: 'sara_art',     fullName: 'Sara Williams', email: 'sara@vibe.app',  password: 'password123', bio: 'Artist & dreamer 🎨',         verified: false },
  { username: 'mike_lens',    fullName: 'Mike Chen',     email: 'mike@vibe.app',  password: 'password123', bio: 'Street photography 🏙️',       verified: true  },
  { username: 'luna_vibes',   fullName: 'Luna Reyes',    email: 'luna@vibe.app',  password: 'password123', bio: 'Living my best life ✨',      verified: false },
  { username: 'jay_fit',      fullName: 'Jay Kumar',     email: 'jay@vibe.app',   password: 'password123', bio: 'Fitness coach 💪',             verified: true  },
  { username: 'nadia_eats',   fullName: 'Nadia Patel',   email: 'nadia@vibe.app', password: 'password123', bio: 'Food blogger 🍜',             verified: false },
  { username: 'demo',         fullName: 'Demo User',     email: 'demo@vibe.app',  password: 'demo',        bio: 'Testing Vibe! 👋',            verified: false },
];
 
const IMGS = ['https://picsum.photos/seed/p1/600/600','https://picsum.photos/seed/p2/600/600','https://picsum.photos/seed/p3/600/600','https://picsum.photos/seed/p4/600/600','https://picsum.photos/seed/p5/600/600','https://picsum.photos/seed/p6/600/600'];
const CAPTIONS = ['Golden hour never gets old 🌅 #photography #nature','Exploring hidden gems ✈️ #adventure','This view is unreal 😍 #wanderlust','Weekend energy 🎉 #vibes','Making memories that last forever 💫','Chasing sunsets 🌅 #travel'];
const LOCATIONS = ['Paris 🗼','Tokyo 🏯','New York 🗽','Bali 🌺','London 🎡','Mumbai 🌊'];
const AVATARS = ['https://i.pravatar.cc/150?img=1','https://i.pravatar.cc/150?img=5','https://i.pravatar.cc/150?img=3','https://i.pravatar.cc/150?img=9','https://i.pravatar.cc/150?img=7','https://i.pravatar.cc/150?img=10','https://i.pravatar.cc/150?img=8'];
 
async function seed() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');
    await Promise.all([User.deleteMany(), Post.deleteMany(), Comment.deleteMany(), Group.deleteMany()]);
    console.log('🗑️  Cleared existing data');
 
    const hashedUsers = await Promise.all(DEMO_USERS.map(async (u, i) => ({ ...u, password: await bcrypt.hash(u.password, 12), avatar: AVATARS[i], postsCount: Math.floor(Math.random()*200)+50, followersCount: Math.floor(Math.random()*10000)+100, followingCount: Math.floor(Math.random()*500)+50 })));
    const users = await User.insertMany(hashedUsers);
    console.log('👥 Created', users.length, 'users');
 
    for (let i = 0; i < users.length-1; i++) {
      for (let j = i+1; j < users.length; j++) {
        if (Math.random() > 0.3) { users[i].following.push(users[j]._id); users[j].followers.push(users[i]._id); }
      }
    }
    await Promise.all(users.map(u => u.save({ validateBeforeSave: false })));
 
    const posts = [];
    for (let i = 0; i < 40; i++) {
      const user = users[i % (users.length-1)];
      const isReel = Math.random() > 0.65;
      posts.push({ user: user._id, type: isReel ? 'reel' : 'post', media: [{ url: IMGS[i % IMGS.length], type: 'image', width: 600, height: 600 }], caption: CAPTIONS[i % CAPTIONS.length], location: LOCATIONS[i % LOCATIONS.length], tags: ['#vibe','#photography','#travel'].slice(0, Math.floor(Math.random()*3)+1), likes: users.slice(0, Math.floor(Math.random()*users.length)).map(u => u._id), likesCount: Math.floor(Math.random()*3000)+100, commentsCount: Math.floor(Math.random()*200)+5, savesCount: Math.floor(Math.random()*500), viewsCount: isReel ? Math.floor(Math.random()*100000)+1000 : 0, engagementScore: Math.floor(Math.random()*5000)+100, audio: isReel ? { title: 'Original Audio', artist: user.username } : undefined, createdAt: new Date(Date.now()-Math.random()*7*24*60*60*1000) });
    }
    await Post.insertMany(posts);
    console.log('📸 Created 40 posts');
 
    const groups = [
      { name: 'Photography Lovers', description: 'A community for photography enthusiasts.', privacy: 'public', category: 'Photography', admin: users[0]._id, members: [users[0]._id, users[1]._id], membersCount: 2 },
      { name: 'Travel & Adventure',  description: 'Share your travel stories.',              privacy: 'public', category: 'Travel',      admin: users[1]._id, members: [users[1]._id, users[2]._id], membersCount: 2 },
      { name: 'Foodies United',      description: 'For people who live to eat.',             privacy: 'public', category: 'Food',        admin: users[2]._id, members: [users[2]._id],               membersCount: 1 },
    ];
    await Group.insertMany(groups);
    console.log('👥 Created groups');
 
    console.log('\n🎉 Seed complete!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Login: demo / demo');
    console.log('Login: alex.travels / password123');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    process.exit(0);
  } catch (err) {
    console.error('❌ Seed error:', err);
    process.exit(1);
  }
}
 
seed();
 
