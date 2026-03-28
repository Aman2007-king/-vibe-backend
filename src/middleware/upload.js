const multer = require('multer');
const path   = require('path');
const fs     = require('fs');
const { v4: uuid } = require('uuid');
 
const UPLOAD_DIR = path.join(__dirname, '../../uploads');
['avatars','posts','stories','reels','thumbnails','messages'].forEach(dir => {
  const p = path.join(UPLOAD_DIR, dir);
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
});
 
const storage = multer.memoryStorage();
const fileFilter = (req, file, cb) => {
  const allowed = /jpeg|jpg|png|gif|webp|mp4|mov|avi|webm|heic/;
  const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
  if (allowed.test(ext) || allowed.test(file.mimetype)) cb(null, true);
  else cb(new Error('File type not supported'));
};
 
const upload = multer({ storage, fileFilter, limits: { fileSize: 50 * 1024 * 1024 } });
 
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
      processed.push({ url: filename, type: isVideo ? 'video' : 'image', size: file.size });
    }
    req.processedMedia = processed;
    next();
  } catch (err) { next(err); }
};
 
const handleAvatarUpload = async (req, res, next) => {
  if (!req.file) return next();
  try {
    const filename = uuid() + '.jpg';
    fs.writeFileSync(path.join(UPLOAD_DIR, 'avatars', filename), req.file.buffer);
    req.avatarFilename = filename;
    next();
  } catch (err) { next(err); }
};
 
const handleStoryUpload = async (req, res, next) => {
  if (!req.file) return next();
  try {
    const isVideo = req.file.mimetype.startsWith('video/');
const filename = uuid() + (isVideo ? '.mp4' : '.jpg');
    fs.writeFileSync(path.join(__dirname, '../../uploads/stories', filename), req.file.buffer);
    req.storyFilename = filename;
    req.storyIsVideo  = isVideo;
    next();
  } catch (err) { next(err); }
};
 
module.exports = { upload, handlePostUpload, handleAvatarUpload, handleStoryUpload };
 
