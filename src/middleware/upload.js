const multer   = require('multer');
const path     = require('path');
const { v4: uuidv4 } = require('uuid');
const supabase = require('../db/supabase');

const BUCKET = 'media';

// Memory storage — no disk writes
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 100 * 1024 * 1024 }, // 100MB
  fileFilter: (req, file, cb) => {
    const ok = file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/');
    ok ? cb(null, true) : cb(new Error('Only images and videos are allowed.'));
  },
});

// Upload buffer → Supabase Storage → return public URL
async function uploadToSupabase(buffer, mimetype, originalname, folder = 'posts') {
  const ext  = path.extname(originalname).toLowerCase().replace('.', '') || 
               (mimetype.startsWith('video/') ? 'mp4' : 'jpg');
  const name = `${folder}/${Date.now()}_${uuidv4()}.${ext}`;

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(name, buffer, { contentType: mimetype, upsert: false });

  if (error) throw new Error('Upload failed: ' + error.message);

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(name);
  return {
    url:  data.publicUrl,
    path: name,
    type: mimetype.startsWith('video/') ? 'video' : 'image',
  };
}

// Delete from Supabase Storage
async function deleteFromSupabase(filePath) {
  if (!filePath) return;
  try { await supabase.storage.from(BUCKET).remove([filePath]); } catch {}
}

// Middleware: single avatar → req.avatarUrl, req.avatarPath
const handleAvatarUpload = async (req, res, next) => {
  if (!req.file) return next();
  try {
    const result   = await uploadToSupabase(req.file.buffer, req.file.mimetype, req.file.originalname, 'avatars');
    req.avatarUrl  = result.url;
    req.avatarPath = result.path;
    next();
  } catch (err) { next(err); }
};

// Middleware: multiple post files → req.processedMedia[]
const handlePostUpload = async (req, res, next) => {
  const files = req.files || (req.file ? [req.file] : []);
  if (!files.length) return next();
  try {
    req.processedMedia = await Promise.all(
      files.map(f => uploadToSupabase(f.buffer, f.mimetype, f.originalname, 'posts'))
    );
    next();
  } catch (err) { next(err); }
};

// Middleware: single story → req.storyMedia
const handleStoryUpload = async (req, res, next) => {
  if (!req.file) return next();
  try {
    req.storyMedia = await uploadToSupabase(req.file.buffer, req.file.mimetype, req.file.originalname, 'stories');
    next();
  } catch (err) { next(err); }
};

module.exports = { upload, handleAvatarUpload, handlePostUpload, handleStoryUpload, uploadToSupabase, deleteFromSupabase };
