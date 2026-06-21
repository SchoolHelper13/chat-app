const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static('public'));

// ==================== MONGODB ====================
mongoose.connect(process.env.MONGODB_URI, {
  serverSelectionTimeoutMS: 30000,   // Wait up to 30 seconds to connect
  socketTimeoutMS: 60000,            // Allow up to 60 seconds for operations
  maxPoolSize: 10,
})
  .then(() => console.log('✅ Connected to MongoDB Atlas'))
  .catch(err => console.error('MongoDB connection error:', err));




// ==================== SEED ADMIN ====================
async function createAdminIfNotExists() {
  const admin = await User.findOne({ username: 'admin' });
  if (!admin) {
    await new User({
      username: 'admin',
      password: 'admin123',
      profile: {
        bio: 'Administrator',
        avatar: 'https://ui-avatars.com/api/?name=Admin&background=ef4444&color=fff'
      },
      status: 'approved',
      isAdmin: true
    }).save();
    console.log('Admin created (admin / admin123)');
  }
}
createAdminIfNotExists();

// ==================== AUTH ROUTES ====================
app.post('/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password)
      return res.status(400).json({ error: 'Username and password required' });

    const existing = await User.findOne({ username });
    if (existing)
      return res.status(400).json({ error: 'Username already taken' });

    const user = new User({
      username,
      password,
      profile: {
        bio: '',
        avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(username)}&background=6366f1&color=fff`
      },
      status: 'pending'
    });
    await user.save();
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password)
      return res.status(400).json({ error: 'Username and password required' });

    const user = await User.findOne({ username });
    if (!user || user.password !== password)
      return res.status(401).json({ error: 'Invalid credentials' });

    if (user.status === 'pending')
      return res.status(403).json({ error: 'Your account is pending admin approval' });
    if (user.status === 'banned')
      return res.status(403).json({ error: 'Your account has been banned' });
    if (user.status === 'declined')
      return res.status(403).json({ error: 'Your account was declined' });

    res.json({ success: true, username: user.username, isAdmin: user.isAdmin });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/verify-session/:username', async (req, res) => {
  try {
    const user = await User.findOne({ username: req.params.username });
    if (!user) return res.json({ valid: false, reason: 'not_found' });
    if (user.status === 'banned') return res.json({ valid: false, reason: 'banned' });
    if (user.status === 'declined') return res.json({ valid: false, reason: 'declined' });
    if (user.status === 'pending') return res.json({ valid: false, reason: 'pending' });
    res.json({ valid: true, isAdmin: user.isAdmin });
  } catch (err) {
    res.status(500).json({ valid: false, reason: 'server_error' });
  }
});

// ==================== PROFILE ROUTES ====================
app.get('/profile/:username', async (req, res) => {
  try {
    const user = await User.findOne({ username: req.params.username });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ username: user.username, profile: user.profile, isAdmin: user.isAdmin });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/profile', async (req, res) => {
  try {
    const { username, bio, avatar } = req.body;
    await User.findOneAndUpdate({ username }, { 'profile.bio': bio, 'profile.avatar': avatar });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ==================== ADMIN ROUTES ====================
app.get('/pending-users', async (req, res) => {
  const users = await User.find({ status: 'pending' }).select('username profile');
  res.json(users);
});

app.get('/approved-users', async (req, res) => {
  const users = await User.find({ status: 'approved', isAdmin: false }).select('username profile');
  res.json(users);
});

app.get('/banned-users', async (req, res) => {
  const users = await User.find({ status: 'banned' }).select('username profile');
  res.json(users);
});

app.post('/approve-user', async (req, res) => {
  await User.findOneAndUpdate({ username: req.body.username }, { status: 'approved' });
  res.json({ success: true });
});

app.post('/decline-user', async (req, res) => {
  await User.findOneAndUpdate({ username: req.body.username }, { status: 'declined' });
  res.json({ success: true });
});

app.post('/ban-user', async (req, res) => {
  await User.findOneAndUpdate({ username: req.body.username }, { status: 'banned' });
  res.json({ success: true });
});

app.post('/unban-user', async (req, res) => {
  await User.findOneAndUpdate({ username: req.body.username }, { status: 'approved' });
  res.json({ success: true });
});

app.post('/change-admin-password', async (req, res) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword) return res.status(400).json({ error: 'New password required' });

    const admin = await User.findOne({ username: 'admin' });
    if (!admin) return res.status(404).json({ error: 'Admin not found' });

    admin.password = newPassword;
    await admin.save();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ==================== CONVERSATION ROUTES ====================
app.get('/conversations/:username', async (req, res) => {
  try {
    const convs = await Conversation.find({ participants: req.params.username }).select('-messages');
    res.json(convs);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/conversations', async (req, res) => {
  try {
    const { type, name, participants } = req.body;
    if (!type || !participants || participants.length === 0)
      return res.status(400).json({ error: 'Invalid conversation data' });

    if (type === 'solo') {
      const existing = await Conversation.findOne({
        type: 'solo',
        participants: { $all: participants, $size: 2 }
      });
      if (existing) return res.json(existing);
    }

    // Save creator when creating a group
    const conv = new Conversation({
      type,
      name: name || null,
      creator: type === 'group' ? participants[0] : null,
      participants,
      messages: []
    });
    await conv.save();
    res.json(conv);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/messages/:convId', async (req, res) => {
  try {
    const conv = await Conversation.findById(req.params.convId).select('messages');
    res.json(conv ? conv.messages : []);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ==================== GROUP MANAGEMENT ROUTES ====================
app.post('/group/add-member', async (req, res) => {
  try {
    const { convId, username, requester } = req.body;

    const conv = await Conversation.findById(convId);
    if (!conv || conv.creator !== requester) {
      return res.status(403).json({ error: 'Only the group creator can add members' });
    }

    if (conv.participants.includes(username)) {
      return res.status(400).json({ error: 'User is already in the group' });
    }

    conv.participants.push(username);
    await conv.save();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/group/remove-member', async (req, res) => {
  try {
    const { convId, username, requester } = req.body;

    const conv = await Conversation.findById(convId);
    if (!conv || conv.creator !== requester) {
      return res.status(403).json({ error: 'Only the group creator can remove members' });
    }

    if (username === conv.creator) {
      return res.status(400).json({ error: 'You cannot remove the group creator' });
    }

    conv.participants = conv.participants.filter(p => p !== username);
    await conv.save();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ==================== GROUP MANAGEMENT ROUTES ====================

// Add member to group (only creator)
app.post('/group/add-member', async (req, res) => {
  try {
    const { convId, username, requester } = req.body;

    const conv = await Conversation.findById(convId);
    if (!conv || conv.creator !== requester) {
      return res.status(403).json({ error: 'Only the group creator can add members' });
    }

    if (conv.participants.includes(username)) {
      return res.status(400).json({ error: 'User is already in the group' });
    }

    conv.participants.push(username);
    await conv.save();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Remove member from group (only creator)
app.post('/group/remove-member', async (req, res) => {
  try {
    const { convId, username, requester } = req.body;

    const conv = await Conversation.findById(convId);
    if (!conv || conv.creator !== requester) {
      return res.status(403).json({ error: 'Only the group creator can remove members' });
    }

    if (username === conv.creator) {
      return res.status(400).json({ error: 'You cannot remove the group creator' });
    }

    conv.participants = conv.participants.filter(p => p !== username);
    await conv.save();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Change group name (only creator)
app.post('/group/change-name', async (req, res) => {
  try {
    const { convId, newName, requester } = req.body;

    const conv = await Conversation.findById(convId);
    if (!conv || conv.creator !== requester) {
      return res.status(403).json({ error: 'Only the group creator can change the name' });
    }

    conv.name = newName;
    await conv.save();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Leave group (any member can leave)
app.post('/group/leave', async (req, res) => {
  try {
    const { convId, username } = req.body;

    const conv = await Conversation.findById(convId);
    if (!conv) return res.status(404).json({ error: 'Group not found' });

    if (username === conv.creator) {
      return res.status(400).json({ error: 'The creator cannot leave. Delete the group instead.' });
    }

    conv.participants = conv.participants.filter(p => p !== username);
    await conv.save();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete group (only creator)
app.post('/group/delete', async (req, res) => {
  try {
    const { convId, requester } = req.body;

    const conv = await Conversation.findById(convId);
    if (!conv || conv.creator !== requester) {
      return res.status(403).json({ error: 'Only the group creator can delete the group' });
    }

    await Conversation.findByIdAndDelete(convId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});
// Leave group (any member can leave)
app.post('/group/leave', async (req, res) => {
  try {
    const { convId, username } = req.body;

    const conv = await Conversation.findById(convId);
    if (!conv) return res.status(404).json({ error: 'Group not found' });

    if (username === conv.creator) {
      return res.status(400).json({ error: 'The creator cannot leave. Please delete the group instead.' });
    }

    conv.participants = conv.participants.filter(p => p !== username);
    await conv.save();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ==================== SOCKET.IO ====================
const connectedUsers = new Map();

io.on('connection', (socket) => {
  socket.on('authenticate', ({ username }) => {
    socket.username = username;
    connectedUsers.set(username, socket);
  });

  socket.on('join_conversation', async ({ convId }) => {
    try {
      const conv = await Conversation.findById(convId).select('participants');
      if (conv && conv.participants.includes(socket.username)) {
        socket.join(convId);
      }
    } catch (err) {
      console.error('join_conversation error:', err);
    }
  });

  socket.on('leave_conversation', ({ convId }) => {
    socket.leave(convId);
  });

  socket.on('send_message', async ({ convId, content }) => {
    try {
      if (!content || !content.trim()) return;
      const conv = await Conversation.findById(convId);
      if (!conv || !conv.participants.includes(socket.username)) return;

      const message = { sender: socket.username, content: content.trim(), timestamp: new Date() };
      conv.messages.push(message);
      await conv.save();

      io.to(convId).emit('new_message', { ...message, convId });
    } catch (err) {
      console.error('send_message error:', err);
    }
  });

  // Voice calling
  socket.on('call-user', ({ to, offer }) => {
    const target = connectedUsers.get(to);
    if (target) target.emit('incoming-call', { from: socket.username, offer });
  });

  socket.on('answer-call', ({ to, answer }) => {
    const target = connectedUsers.get(to);
    if (target) target.emit('call-accepted', { from: socket.username, answer });
  });

  socket.on('ice-candidate', ({ to, candidate }) => {
    const target = connectedUsers.get(to);
    if (target) target.emit('ice-candidate', { from: socket.username, candidate });
  });

  socket.on('end-call', ({ to }) => {
    const target = connectedUsers.get(to);
    if (target) target.emit('call-ended', { from: socket.username });
  });

  socket.on('decline-call', ({ to }) => {
    const target = connectedUsers.get(to);
    if (target) target.emit('call-declined', { from: socket.username });
  });

  socket.on('disconnect', () => {
    if (socket.username) {
      connectedUsers.delete(socket.username);
    }
  });
});

// ==================== START ====================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});