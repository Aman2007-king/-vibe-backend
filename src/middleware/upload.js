const multer   = require('multer');
const path     = require('path');
const { v4: uuidv4 } = require('uuid');
const supabase = require('../db/supabase');

const BUCKET = 'media'; // your Supabase Storage bucket name

// Memory storage — files go to RAM, then straight to Supabase
const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  const allowed = /jpeg|jpg|png|gif|webp|mp4|mov|webm/;
  const ext  = allowed.test(path.extname(file.originalname).toLowerCase());
  const mime = file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/');
  if (ext && mime) cb(null, true);
  else cb(new Error('Only images and videos are allowed.'));
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
});

// Upload a buffer to Supabase Storage and return the public URL
async function uploadToSupabase(buffer, mimetype, folder = 'posts') {
  const ext  = mimetype.split('/')[1].replace('jpeg', 'jpg');
  const name = `${folder}/${Date.now()}_${uuidv4()}.${ext}`;

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(name, buffer, { contentType: mimetype, upsert: false });

  if (error) throw new Error('Storage upload failed: ' + error.message);

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(name);
  return { url: data.publicUrl, path: name };
}

// Delete file from Supabase Storage by path
async function deleteFromSupabase(filePath) {
  if (!filePath) return;
  await supabase.storage.from(BUCKET).remove([filePath]);
}

// Middleware: upload single avatar → req.avatarUrl, req.avatarPath
const handleAvatarUpload = async (req, res, next) => {
  if (!req.file) return next();
  try {
    const result    = await uploadToSupabase(req.file.buffer, req.file.mimetype, 'avatars');
    req.avatarUrl   = result.url;
    req.avatarPath  = result.path;
    next();
  } catch (err) {
    next(err);
  }
};

// Middleware: upload multiple post files → req.processedMedia[]
const handlePostUpload = async (req, res, next) => {
  const files = req.files || (req.file ? [req.file] : []);
  if (!files.length) return next();
  try {
    const results = await Promise.all(
      files.map(f => uploadToSupabase(f.buffer, f.mimetype, 'posts'))
    );
    req.processedMedia = results.map((r, i) => ({
      url:  r.url,
      path: r.path,
      type: files[i].mimetype.startsWith('video/') ? 'video' : 'image',
    }));
    next();
  } catch (err) {
    next(err);
  }
};

// Middleware: single story upload → req.storyMedia
const handleStoryUpload = async (req, res, next) => {
  if (!req.file) return next();
  try {
    const result   = await uploadToSupabase(req.file.buffer, req.file.mimetype, 'stories');
    req.storyMedia = {
      url:  result.url,
      path: result.path,
      type: req.file.mimetype.startsWith('video/') ? 'video' : 'image',
    };
    next();
  } catch (err) {
    next(err);
  }
};

module.exports = { upload, handleAvatarUpload, handlePostUpload, handleStoryUpload, uploadToSupabase, deleteFromSupabase };
