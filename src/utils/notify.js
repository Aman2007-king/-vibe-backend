const supabase = require('../db/supabase');

// Create a notification in Supabase and emit via Socket.io
const notify = async (io, { type, recipientId, senderId, postId, message }) => {
  if (!recipientId || recipientId === senderId) return;
  try {
    const { data: notif } = await supabase
      .from('notifications')
      .insert({ type, recipient_id: recipientId, sender_id: senderId, post_id: postId || null, message, is_read: false })
      .select(`*, sender:users!sender_id(id, username, full_name, avatar, verified)`)
      .single();

    if (notif && io) {
      io.to('user:' + recipientId).emit('notification', {
        id:        notif.id,
        type:      notif.type,
        message:   notif.message,
        sender:    notif.sender,
        postId:    notif.post_id,
        createdAt: notif.created_at,
      });
    }
  } catch (err) {
    console.error('Notify error:', err.message);
  }
};

module.exports = notify;
