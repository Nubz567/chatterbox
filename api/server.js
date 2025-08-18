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

        console.log(`User ${userEmail} joined group: ${targetGroup.name} (ID: ${targetGroup._id})`);
        res.status(200).json({
                id: targetGroup._id,
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