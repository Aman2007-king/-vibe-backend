const errorHandler = (err, req, res, next) => {
  console.error('Error:', err.message);
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ success: false, message: 'File too large. Max 100MB.' });
  res.status(err.status || 500).json({ success: false, message: err.message || 'Something went wrong.' });
};

module.exports = errorHandler;
