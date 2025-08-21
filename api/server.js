require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const bcrypt = require('bcrypt');
const MongoStore = require('connect-mongo');
const path = require('path');
const app = express();

// MongoDB Connection
const mongoURI = process.env.MONGODB_URI;
let cachedConnection = global.mongoose_connection;
if (!cachedConnection) {
    cachedConnection = global.mongoose_connection = { conn: null, promise: null };
}

async function connectToDatabase() {
    if (cachedConnection.conn) {
        return cachedConnection.conn;
    }
    if (!cachedConnection.promise) {
        cachedConnection.promise = mongoose.connect(mongoURI, {
            bufferCommands: false,
            serverSelectionTimeoutMS: 5000,
        }).catch(err => {
            console.error('MongoDB connection error:', err);
            cachedConnection.promise = null;
            throw err;
        });
    }
    try {
        cachedConnection.conn = await cachedConnection.promise;
        return cachedConnection.conn;
    } catch (e) {
        cachedConnection.promise = null;
        console.error('Database connection failed:', e);
        throw e;
    }
}

// Mongoose Models
const userSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    username: { type: String, required: true, unique: true },
    hashedPassword: { type: String, required: true },
});
const User = mongoose.model('User', userSchema);

const groupSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    adminEmail: { type: String, required: true },
    joinCode: { type: String, required: true, unique: true },
    members: [{ type: String }],
    archivedDueToUserDeletion: { type: Boolean, default: false }
});
const Group = mongoose.model('Group', groupSchema);

const messageSchema = new mongoose.Schema({
    groupId: { type: String, required: true },
    user: { type: String, required: true },
    email: { type: String, required: true },
    text: { type: String, required: true },
    timestamp: { type: Date, default: Date.now }
});
 
// Add indexes for better query performance
messageSchema.index({ groupId: 1, timestamp: 1 });
messageSchema.index({ groupId: 1 });

const Message = mongoose.model('Message', messageSchema);

// Session configuration with MongoDB store
const sessionMiddleware = session({
    secret: process.env.SESSION_SECRET || 'default-secret',
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
        mongoUrl: mongoURI,
        collectionName: 'sessions',
        ttl: 14 * 24 * 60 * 60 // 14 days
  }),
  cookie: { 
        secure: false, // Set to false for Vercel compatibility
        httpOnly: true,
        sameSite: 'lax', // Simplified for Vercel
        maxAge: 1000 * 60 * 60 * 24 * 7 // 7 days
    }
});

// Basic middleware
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(sessionMiddleware);

// Serve static files from the "public" directory
app.use(express.static(path.join(__dirname, '../public')));

// Routes
app.get('/', (req, res) => {
  res.redirect('/login');
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
        database: mongoURI ? 'configured' : 'not configured',
        session: 'enabled',
        sessionStore: 'mongodb',
        bcrypt: 'enabled'
  });
});

// Session test endpoint
app.get('/test-session', (req, res) => {
    res.json({
        sessionId: req.sessionID,
        sessionData: req.session,
        user: req.session.user,
        hasUser: !!(req.session.user && req.session.user.email),
        cookie: req.headers.cookie
    });
});

// User API endpoint
app.get('/api/user', (req, res) => {
  if (!req.session.user || !req.session.user.email) {
        return res.status(401).json({ error: 'User not authenticated' });
    }
        res.json({
            email: req.session.user.email,
            username: req.session.user.username
    });
});

// Change username endpoint
app.post('/api/user/change-username', async (req, res) => {
    try {
        await connectToDatabase();
        
    if (!req.session.user || !req.session.user.email) {
            return res.status(401).json({ success: false, message: 'User not authenticated' });
        }

        const { newUsername } = req.body;

        if (!newUsername) {
            return res.status(400).json({ success: false, message: 'New username is required' });
        }

        if (newUsername.length < 3 || newUsername.length > 20) {
            return res.status(400).json({ success: false, message: 'Username must be 3-20 characters' });
        }

        if (!/^[a-zA-Z0-9_]+$/.test(newUsername)) {
            return res.status(400).json({ success: false, message: 'Username can only contain letters, numbers, and underscores' });
        }

        // Check if username is already taken
        const existingUser = await User.findOne({ username: newUsername.toLowerCase() });
        if (existingUser && existingUser.email !== req.session.user.email) {
            return res.status(400).json({ success: false, message: 'Username already taken' });
        }

        // Update the user's username
        const updatedUser = await User.findOneAndUpdate(
            { email: req.session.user.email },
            { username: newUsername },
            { new: true }
        );

        if (!updatedUser) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        // Update session with new username
        req.session.user.username = newUsername;

        console.log(`Username changed for user ${req.session.user.email} to ${newUsername}`);

        res.json({ 
            success: true, 
            message: 'Username changed successfully',
            username: newUsername
        });

    } catch (error) {
        console.error('Error changing username:', error);
        res.status(500).json({ success: false, message: 'Server error while changing username' });
    }
});

// Simple test endpoint
app.get('/test', (req, res) => {
        res.json({
        message: 'Server is working',
        timestamp: new Date().toISOString(),
        mongoURI: mongoURI ? 'configured' : 'not configured'
    });
});

// Login routes
app.get('/login', (req, res) => {
    console.log('Login page requested. Session data:', req.session);
    console.log('User in session:', req.session.user);
    
    if (req.session.user && req.session.user.email) {
        console.log('User already logged in, redirecting to groups');
        res.redirect('/groups');
            } else {
        console.log('No user session, showing login page');
        res.sendFile(path.join(__dirname, '../public', 'login.html'));
    }
});

app.post('/login', async (req, res) => {
  try {
    await connectToDatabase();
  const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Missing email or password' });
    }

    const user = await User.findOne({ email: email });

    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

        const passwordsMatch = await bcrypt.compare(password, user.hashedPassword);

        if (passwordsMatch) {
          req.session.user = { email: user.email, username: user.username };
            console.log('Session set for user:', user.email);
      return res.status(200).json({ success: true, message: 'Login successful', redirectTo: '/groups' });
        } else {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
        }
  } catch (error) {
        console.error('Login error:', error);
        return res.status(500).json({ success: false, message: 'Server error during login.' });
    }
});

// Registration routes
app.get('/register', (req, res) => {
  res.sendFile(path.join(__dirname, '../public', 'register.html'));
});

app.post('/register', async (req, res) => {
  try {
    await connectToDatabase();
  const { email, username, password, confirmPassword } = req.body;
  const saltRounds = 10;

  if (!email || !username || !password || !confirmPassword) {
    return res.status(400).json({ success: false, message: 'Missing fields', field: 'all'});
  }
  if (password !== confirmPassword) {
    return res.status(400).json({ success: false, message: 'Passwords do not match', field: 'confirmPassword'});
  }
  if (username.length < 3 || username.length > 20) {
    return res.status(400).json({ success: false, message: 'Username must be 3-20 characters', field: 'username'});
  }
  if (!/^[a-zA-Z0-9_]+$/.test(username)) {
    return res.status(400).json({ success: false, message: 'Username can only contain letters, numbers, and underscores', field: 'username'});
  }

  if (await User.findOne({ email: email })) {
    return res.status(400).json({ success: false, message: 'Email already registered', field: 'email'});
  }
  if (await User.findOne({ username: username.toLowerCase() })) {
    return res.status(400).json({ success: false, message: 'Username already taken', field: 'username'});
  }

    const hashedPassword = await bcrypt.hash(password, saltRounds);
    const newUser = new User({ email, username, hashedPassword });
    await newUser.save();
    
      res.status(201).json({ success: true, message: 'Registration successful! Please log in.', redirectTo: '/login'});

  } catch (error) {
    console.error("Error during registration:", error);
    res.status(500).json({ success: false, message: 'An error occurred during registration. Please try again.' });
  }
});

// Change password routes
app.get('/change-password', (req, res) => {
    if (req.session.user && req.session.user.email) {
        res.sendFile(path.join(__dirname, '../public', 'change-password.html'));
    } else {
        res.redirect('/login');
    }
});

app.post('/change-password', async (req, res) => {
    try {
        await connectToDatabase();
        
        if (!req.session.user || !req.session.user.email) {
            return res.status(401).json({ success: false, message: 'User not authenticated' });
        }

        const { currentPassword, newPassword, confirmPassword } = req.body;

        if (!currentPassword || !newPassword || !confirmPassword) {
            return res.status(400).json({ success: false, message: 'All fields are required' });
        }

        if (newPassword !== confirmPassword) {
            return res.status(400).json({ success: false, message: 'New passwords do not match' });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({ success: false, message: 'New password must be at least 6 characters' });
        }

        // Verify current password
        const user = await User.findOne({ email: req.session.user.email });
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        const currentPasswordValid = await bcrypt.compare(currentPassword, user.hashedPassword);
        if (!currentPasswordValid) {
            return res.status(401).json({ success: false, message: 'Current password is incorrect' });
        }

        // Hash and update new password
        const saltRounds = 10;
        const hashedNewPassword = await bcrypt.hash(newPassword, saltRounds);
        
        await User.findOneAndUpdate(
            { email: req.session.user.email },
            { hashedPassword: hashedNewPassword }
        );

        console.log(`Password changed for user ${req.session.user.email}`);

        res.json({ 
            success: true, 
            message: 'Password changed successfully',
            redirectTo: '/groups'
        });

    } catch (error) {
        console.error('Error changing password:', error);
        res.status(500).json({ success: false, message: 'Server error while changing password' });
    }
});

// Delete account routes
app.get('/delete-account', (req, res) => {
    if (req.session.user && req.session.user.email) {
        res.sendFile(path.join(__dirname, '../public', 'delete-account.html'));
    } else {
        res.redirect('/login');
    }
});

app.post('/delete-account', async (req, res) => {
    try {
        await connectToDatabase();
        
        if (!req.session.user || !req.session.user.email) {
            return res.status(401).json({ success: false, message: 'User not authenticated' });
        }

        const { password, confirmDelete } = req.body;

        if (!password || !confirmDelete) {
            return res.status(400).json({ success: false, message: 'Password and confirmation are required' });
        }

        if (confirmDelete !== 'DELETE') {
            return res.status(400).json({ success: false, message: 'Please type DELETE to confirm account deletion' });
        }

        // Verify password
        const user = await User.findOne({ email: req.session.user.email });
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        const passwordValid = await bcrypt.compare(password, user.hashedPassword);
        if (!passwordValid) {
            return res.status(401).json({ success: false, message: 'Password is incorrect' });
        }

        // Delete user's groups and messages
        await Group.deleteMany({ creator: req.session.user.email });
        await Message.deleteMany({ senderEmail: req.session.user.email });

        // Delete the user
        await User.findOneAndDelete({ email: req.session.user.email });

        // Destroy session
        req.session.destroy((err) => {
            if (err) {
                console.error('Session destruction error:', err);
            }
            console.log(`Account deleted for user ${req.session.user.email}`);
            res.clearCookie('connect.sid');
            res.json({ 
                success: true, 
                message: 'Account deleted successfully',
                redirectTo: '/login'
            });
        });

    } catch (error) {
        console.error('Error deleting account:', error);
        res.status(500).json({ success: false, message: 'Server error while deleting account' });
    }
});

// Logout route
app.post('/logout', (req, res) => {
    if (req.session.user) {
        const userEmail = req.session.user.email;
        req.session.destroy((err) => {
            if (err) {
                console.error('Session destruction error:', err);
                res.status(500).json({ success: false, message: 'Logout failed, please clear your cookies.', redirectTo: '/login' });
                return;
            }
            console.log(`User ${userEmail} logged out.`);
            res.clearCookie('connect.sid');
            res.status(200).json({ success: true, message: 'Logged out successfully', redirectTo: '/login' });
        });
    } else {
        res.status(200).json({ success: true, message: 'No active session, already logged out', redirectTo: '/login' });
    }
});

// Groups routes
app.get('/groups', (req, res) => {
    console.log('Groups page requested. Session data:', req.session);
    console.log('User in session:', req.session.user);
    
    if (req.session.user && req.session.user.email) {
        console.log('User authenticated, showing groups page');
        res.sendFile(path.join(__dirname, '../public', 'groups.html'));
    } else {
        console.log('No user session, redirecting to login');
        res.redirect('/login');
    }
});

// API routes for groups
async function generateJoinCode(length = 6) {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    const existingGroup = await Group.findOne({ joinCode: result });
    if (existingGroup) {
        console.log(`Generated duplicate join code ${result}, regenerating.`);
        return generateJoinCode(length);
    }
    console.log(`Generated unique join code: ${result}`);
    return result;
}

function generateUniqueId() {
    return Date.now().toString(36) + Math.random().toString(36).substring(2);
}

app.post('/api/groups/create', async (req, res) => {
    try {
        await connectToDatabase();
    if (!req.session.user || !req.session.user.email) {
        return res.status(401).json({ error: 'User not authenticated' });
    }

    const { name } = req.body;
    if (!name || name.trim() === '') {
        return res.status(400).json({ error: 'Group name is required' });
    }

    const adminEmail = req.session.user.email;
        const groupId = generateUniqueId();
        const joinCode = await generateJoinCode();

    try {
        const newGroup = new Group({
                id: groupId,
        name: name.trim(),
        adminEmail: adminEmail,
        joinCode: joinCode,
                members: [adminEmail]
        });

            const savedGroup = await newGroup.save();
        console.log(`Group created: ${savedGroup.name} (ID: ${savedGroup.id}), Code: ${savedGroup.joinCode} by ${adminEmail}`);
        res.status(201).json({ 
                id: savedGroup.id,
            name: savedGroup.name,
            adminEmail: savedGroup.adminEmail,
            joinCode: savedGroup.joinCode,
            members: savedGroup.members
        });
    } catch (error) {
        console.error('Error creating group:', error);
            if (error.code === 11000) {
            return res.status(400).json({ error: 'Failed to generate unique join code. Please try again.' });
        }
            res.status(500).json({ error: 'An error occurred while creating the group.' });
        }
    } catch (error) {
        console.error("Error during group creation:", error);
        res.status(500).json({ error: 'An error occurred while creating the group.' });
    }
});

app.post('/api/groups/join', async (req, res) => {
    try {
        await connectToDatabase();
    if (!req.session.user || !req.session.user.email) {
        return res.status(401).json({ error: 'User not authenticated' });
    }

    const { joinCode } = req.body;
    if (!joinCode || joinCode.trim() === '') {
        return res.status(400).json({ error: 'Join code is required' });
    }

    const userEmail = req.session.user.email;
    
    try {
        const targetGroup = await Group.findOne({ joinCode: joinCode.trim() });

    if (!targetGroup) {
        return res.status(404).json({ error: 'Group not found with this join code' });
    }

        if (targetGroup.archivedDueToUserDeletion) {
            targetGroup.archivedDueToUserDeletion = false;
            console.log(`Group "${targetGroup.name}" (ID: ${targetGroup._id}) was archived and is now restored by user ${userEmail} joining with code.`);
        }

    if (targetGroup.members.includes(userEmail)) {
             await targetGroup.save(); 
        return res.status(400).json({ error: 'User is already a member of this group', group: targetGroup });
    }

    targetGroup.members.push(userEmail);
            await targetGroup.save();

        console.log(`User ${userEmail} joined group: ${targetGroup.name} (ID: ${targetGroup.id})`);
        res.status(200).json({
                id: targetGroup.id,
            name: targetGroup.name,
            adminEmail: targetGroup.adminEmail,
            joinCode: targetGroup.joinCode,
            members: targetGroup.members
        });
    } catch (error) {
        console.error('Error joining group:', error);
            res.status(500).json({ error: 'An error occurred while joining the group.' });
        }
    } catch (error) {
        console.error("Error during group joining:", error);
        res.status(500).json({ error: 'An error occurred while joining the group.' });
    }
});

app.get('/api/user/groups', async (req, res) => {
    try {
        await connectToDatabase();
    if (!req.session.user || !req.session.user.email) {
        return res.status(401).json({ error: 'User not authenticated' });
    }
    const userEmail = req.session.user.email;
    
    try {
        const memberOfGroups = await Group.find({
            members: userEmail,
                archivedDueToUserDeletion: { $ne: true }
        });
        
    res.status(200).json(memberOfGroups);

    } catch (error) {
        console.error('Error fetching user groups:', error);
            res.status(500).json({ error: 'An error occurred while fetching your groups.' });
        }
    } catch (error) {
        console.error("Error during fetching user groups:", error);
        res.status(500).json({ error: 'An error occurred while fetching your groups.' });
    }
});

app.delete('/api/groups/:groupId', async (req, res) => {
    try {
        await connectToDatabase();
    if (!req.session.user || !req.session.user.email) {
        return res.status(401).json({ error: 'User not authenticated' });
    }

    const { groupId } = req.params;
        const userEmail = req.session.user.email;
    
        const group = await Group.findOne({ id: groupId });
    if (!group) {
        return res.status(404).json({ error: 'Group not found' });
    }

        if (group.adminEmail !== userEmail) {
            return res.status(403).json({ error: 'Only the group admin can delete the group' });
        }

        await Group.deleteOne({ id: groupId });
        console.log(`Group ${groupId} deleted by admin ${userEmail}`);
        res.status(200).json({ success: true, message: 'Group deleted successfully' });

    } catch (error) {
        console.error('Error deleting group:', error);
        res.status(500).json({ error: 'An error occurred while deleting the group.' });
    }
});

app.post('/api/groups/:groupId/leave', async (req, res) => {
    try {
        await connectToDatabase();
    if (!req.session.user || !req.session.user.email) {
        return res.status(401).json({ error: 'User not authenticated' });
    }

    const { groupId } = req.params;
        const userEmail = req.session.user.email;
    
        const group = await Group.findOne({ id: groupId });
        if (!group) {
            return res.status(404).json({ error: 'Group not found' });
        }

        if (!group.members.includes(userEmail)) {
            return res.status(400).json({ error: 'User is not a member of this group' });
        }

        if (group.adminEmail === userEmail) {
            return res.status(400).json({ error: 'Group admin cannot leave the group. Please delete the group instead.' });
        }

        group.members = group.members.filter(member => member !== userEmail);
        await group.save();

        console.log(`User ${userEmail} left group ${groupId}`);
        res.status(200).json({ success: true, message: 'Left group successfully' });

    } catch (error) {
        console.error('Error leaving group:', error);
        res.status(500).json({ error: 'An error occurred while leaving the group.' });
    }
});

// Chat route
app.get('/chat', async (req, res) => {
    try {
        await connectToDatabase();
        const { groupId, groupName } = req.query;

    if (!req.session.user || !req.session.user.email) {
            return res.redirect('/login');
    }

        if (!groupId) {
            return res.redirect('/groups?error=No+group+selected');
        }
    
        const group = await Group.findOne({ id: groupId });

        if (!group) {
            return res.redirect('/groups?error=Group+not+found');
        }

        if (!group.members.includes(req.session.user.email)) {
            return res.redirect('/groups?error=Not+a+member+of+this+group');
        }

        req.session.currentGroup = { id: groupId, name: groupName || group.name };
        req.session.save((err) => {
            if (err) {
                console.error('Error saving session:', err);
                return res.status(500).send('Error preparing chat session.');
            }
            res.sendFile(path.join(__dirname, '../public', 'chat.html'));
        });
    } catch (error) {
        console.error('Error loading chat page:', error);
        res.status(500).send('Error loading chat page. <a href="/groups">Go back to groups</a>');
    }
});

const MAX_MESSAGES = 100;

// API endpoint to send a message
app.post('/api/chat/send', async (req, res) => {
    try {
        console.log('=== CHAT SEND REQUEST ===');
        console.log('Session:', req.session);
        console.log('Body:', req.body);
        console.log('User in session:', req.session.user);
        
        if (!req.session.user || !req.session.user.email) {
            console.log('ERROR: User not authenticated');
            return res.status(401).json({ error: 'Not authenticated' });
        }

        const { message, groupId } = req.body;
        console.log('Message data:', { message: message?.substring(0, 50), groupId });
        
        if (!message || !groupId) {
            console.log('ERROR: Missing required fields');
            return res.status(400).json({ error: 'Message and groupId are required' });
        }

        // Verify user is member of the group
        console.log('Looking up group:', groupId);
        const group = await Group.findOne({ id: groupId });
        console.log('Group found:', !!group);
        if (group) {
            console.log('Group members:', group.members);
            console.log('User email:', req.session.user.email);
            console.log('User is member:', group.members.includes(req.session.user.email));
        }
        
        if (!group || !group.members.includes(req.session.user.email)) {
            console.log('ERROR: Not a member of this group');
            return res.status(403).json({ error: 'Not a member of this group' });
        }

        const messageData = {
            id: Date.now().toString(),
            user: req.session.user.username,
            email: req.session.user.email,
            text: message,
            timestamp: new Date(),
            groupId: groupId
        };

        console.log('Message data created:', messageData);

        // Save message to database
        const newMessage = new Message({
            groupId: groupId,
            user: req.session.user.username,
            email: req.session.user.email,
            text: message,
            timestamp: new Date()
        });

        console.log('Saving message to database:', {
            groupId: groupId,
            user: req.session.user.username,
            email: req.session.user.email,
            text: message.substring(0, 50)
        });

        await newMessage.save();
        console.log('Message saved to database with ID:', newMessage._id);

        // Keep only the last MAX_MESSAGES messages by deleting older ones
        const messageCount = await Message.countDocuments({ groupId: groupId });
        if (messageCount > MAX_MESSAGES) {
            const messagesToDelete = await Message.find({ groupId: groupId })
                .sort({ timestamp: 1 })
                .limit(messageCount - MAX_MESSAGES);
            
            if (messagesToDelete.length > 0) {
                await Message.deleteMany({ _id: { $in: messagesToDelete.map(m => m._id) } });
                console.log(`Deleted ${messagesToDelete.length} old messages`);
            }
        }

        // Transform the saved message for client compatibility
        const responseMessage = {
            id: newMessage._id.toString(),
            user: newMessage.user,
            email: newMessage.email,
            text: newMessage.text,
            timestamp: newMessage.timestamp,
            groupId: newMessage.groupId
        };

        console.log('Sending response:', { success: true, message: responseMessage });
        res.json({ success: true, message: responseMessage });
    } catch (error) {
        console.error('ERROR sending message:', error);
        res.status(500).json({ error: 'Failed to send message' });
    }
});

// API endpoint to get messages
app.get('/api/chat/messages/:groupId', async (req, res) => {
    try {
        console.log('=== GET MESSAGES REQUEST ===');
        console.log('Session:', req.session);
        console.log('Params:', req.params);
        console.log('User in session:', req.session.user);
        
        if (!req.session.user || !req.session.user.email) {
            console.log('ERROR: User not authenticated');
            return res.status(401).json({ error: 'Not authenticated' });
        }

        const { groupId } = req.params;
        console.log('Requested groupId:', groupId);

        // Verify user is member of the group
        console.log('Looking up group:', groupId);
        const group = await Group.findOne({ id: groupId });
        console.log('Group found:', !!group);
        if (group) {
            console.log('Group members:', group.members);
            console.log('User email:', req.session.user.email);
            console.log('User is member:', group.members.includes(req.session.user.email));
        }
        
        if (!group || !group.members.includes(req.session.user.email)) {
            console.log('ERROR: Not a member of this group');
            return res.status(403).json({ error: 'Not a member of this group' });
        }

        // Fetch messages from database with optimized query
        console.log('Fetching messages from database for groupId:', groupId);
        const messages = await Message.find({ groupId: groupId })
            .select('_id user email text timestamp groupId')
            .sort({ timestamp: 1 })
            .limit(MAX_MESSAGES)
            .lean();
        
        console.log(`Found ${messages.length} messages in database for group ${groupId}`);
        
        // Transform messages to include 'id' field for client compatibility
        const transformedMessages = messages.map(m => ({
            id: m._id.toString(),
            user: m.user,
            email: m.email,
            text: m.text,
            timestamp: m.timestamp,
            groupId: m.groupId
        }));
        
        console.log('Transformed messages:', transformedMessages.map(m => ({ 
            id: m.id, 
            user: m.user, 
            text: m.text?.substring(0, 30),
            groupId: m.groupId,
            timestamp: m.timestamp
        })));
        
        res.json({ messages: transformedMessages });
    } catch (error) {
        console.error('ERROR getting messages:', error);
        res.status(500).json({ error: 'Failed to get messages' });
    }
});

// API endpoint to get online users
app.get('/api/chat/users/:groupId', async (req, res) => {
    try {
        if (!req.session.user || !req.session.user.email) {
            return res.status(401).json({ error: 'Not authenticated' });
        }

        const { groupId } = req.params;

        // Verify user is member of the group
        console.log('Looking up group for users:', groupId);
        const group = await Group.findOne({ id: groupId });
        console.log('Group found for users:', !!group);
        if (group) {
            console.log('Group members for users:', group.members);
            console.log('User email for users:', req.session.user.email);
            console.log('User is member for users:', group.members.includes(req.session.user.email));
        }
        
        if (!group || !group.members.includes(req.session.user.email)) {
            console.log('ERROR: Not a member of this group (users)');
            return res.status(403).json({ error: 'Not a member of this group' });
        }

        // For now, return all group members as "online"
        // In a real app, you'd track actual online status
        console.log('Getting user details for members:', group.members);
        
        // Only fetch username and email fields to reduce data transfer
        const userDetails = await User.find({ email: { $in: group.members } }, 'email username').lean();
        console.log('Found user details:', userDetails.map(u => ({ email: u.email, username: u.username })));
        
        const users = group.members.map(email => {
            const userDetail = userDetails.find(u => u.email === email);
            return {
                email: email,
                username: userDetail ? userDetail.username : email.split('@')[0], // Fallback to email prefix
                online: true
            };
        });

        console.log('Returning users:', users);
        res.json({ users });
    } catch (error) {
        console.error('Error getting users:', error);
        res.status(500).json({ error: 'Failed to get users' });
    }
});

// Error handling
app.use((err, req, res, next) => {
    console.error('Express error:', err);
    res.status(500).json({ 
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
    });
});

app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// Export for Vercel
module.exports = app;