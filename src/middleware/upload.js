const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuid } = require('uuid');

const UPLOAD_DIR = path.join(__dirname, '../../uploads');
const SUB_DIRS = ['avatars', 'posts', 'stories', 'reels', 'thumbnails', 'messages'];

// Ensure upload directories exist
SUB_DIRS.forEach(dir => {
  const p = path.join(UPLOAD_DIR, dir);
  if (!fs.existsSync(p)) {
    fs.mkdirSync(p, { recursive: true });
  }
});

// Multer storage configuration
const storage = multer.memoryStorage();

// File filter for uploads
const fileFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|gif|webp|mp4|mov|avi|webm|heic/;
  const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
  const isValidExt = allowedTypes.test(ext);
  const isValidMime = allowedTypes.test(file.mimetype);
  
  if (isValidExt || isValidMime) {
    cb(null, true);
  } else {
    cb(new Error('File type not supported. Allowed types: jpeg, jpg, png, gif, webp, mp4, mov, avi, webm, heic'));
  }
};

// Main upload middleware
const upload = multer({ 
  storage, 
  fileFilter, 
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
});

// Handle post media uploads
const handlePostUpload = async (req, res, next) => {
  if (!req.files && !req.file) return next();
  
  try {
    const files = req.files || (req.file ? [req.file] : []);
    const processed = [];
    
    for (const file of files) {
      const isVideo = file.mimetype.startsWith('video/');
      const filename = uuid() + (isVideo ? '.mp4' : '.jpg');
      const filepath = path.join(UPLOAD_DIR, 'posts', filename);
      
      fs.writeFileSync(filepath, file.buffer);
      processed.push({ 
        url: filename, 
        type: isVideo ? 'video' : 'image', 
        size: file.size 
      });
    }
    
    req.processedMedia = processed;
    next();
  } catch (err) {
    next(new Error('Failed to process uploaded media: ' + err.message));
  }
};

// Handle avatar uploads
const handleAvatarUpload = async (req, res, next) => {
  if (!req.file) return next();
  
  try {
    const filename = uuid() + '.jpg';
    const filepath = path.join(UPLOAD_DIR, 'avatars', filename);
    
    fs.writeFileSync(filepath, req.file.buffer);
    req.avatarFilename = filename;
    next();
  } catch (err) {
    next(new Error('Failed to process avatar upload: ' + err.message));
  }
};

// Handle story uploads
const handleStoryUpload = async (req, res, next) => {
  if (!req.file) return next();
  
  try {
    const isVideo = req.file.mimetype.startsWith('video/');
    const filename = uuid() + (isVideo ? '.mp4' : '.jpg');
    const filepath = path.join(UPLOAD_DIR, 'stories', filename);
    
    fs.writeFileSync(filepath, req.file.buffer);
    req.storyFilename = filename;
    req.storyIsVideo = isVideo;
    next();
  } catch (err) {
    next(new Error('Failed to process story upload: ' + err.message));
  }
};

module.exports = { 
  upload, 
  handlePostUpload, 
  handleAvatarUpload, 
  handleStoryUpload 
};
