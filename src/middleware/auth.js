const jwt = require('jsonwebtoken');
const supabase = require('../db/supabase');

const protect = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.startsWith('Bearer ') 
      ? req.headers.authorization.split(' ')[1] : null;
    if (!token) return res.status(401).json({ success:false, message:'Not authenticated.' });
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const { data: user } = await supabase.from('users').select('*').eq('id', decoded.id).single();
    if (!user) return res.status(401).json({ success:false, message:'User not found.' });
    req.user = user;
    next();
  } catch {
    res.status(401).json({ success:false, message:'Invalid token.' });
  }
};

const generateToken = (id) => require('jsonwebtoken').sign({ id }, process.env.JWT_SECRET, { expiresIn:'30d' });

module.exports = { protect, generateToken };
