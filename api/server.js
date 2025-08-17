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
        });
    }
    try {
        cachedConnection.conn = await cachedConnection.promise;
        return cachedConnection.conn;
    } catch (e) {
        cachedConnection.promise = null;
        console.error('Database connection failed:', e);
        return null;
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

// Global stores
const groupMessageHistories = {};
const groupActiveUsers = {};
const MAX_HISTORY_LENGTH = 100;

function generateUniqueId() {
    return Date.now().toString(36) + Math.random().toString(36).substring(2);
}

// Session configuration with MongoDB store
const sessionMiddleware = session({
    secret: process.env.SESSION_SECRET || 'default-secret',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
        clientPromise: connectToDatabase().then(conn => conn?.connection?.getClient()),
        collectionName: 'sessions',
        ttl: 14 * 24 * 60 * 60 // 14 days
    }),
    cookie: { 
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
        maxAge: 1000 * 60 * 60 * 24 * 7 // 7 days
    }
});

// Basic middleware
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(sessionMiddleware);

// Serve static files from the "public" directory
app.use(express.static(path.join(__dirname, '../public')));

// Socket.IO setup - Serverless compatible
let io = null;
if (!process.env.VERCEL) {
    // Only setup Socket.IO in non-serverless environment
    const http = require('http');
    const socketIo = require('socket.io');
    const server = http.createServer(app);
    
    io = socketIo(server, {
        cors: {
            origin: ["https://chatterbox-blond.vercel.app", "http://localhost:3000"],
            methods: ["GET", "POST"],
            credentials: true
        },
        transports: ['polling', 'websocket']
    });
    
    // Make Express session accessible to Socket.IO
    io.engine.use(sessionMiddleware);
    
    // Socket.IO connection handling
    io.on('connection', async (socket) => {
        try {
            await connectToDatabase();
            const session = socket.request.session;

            session.reload((err) => {
                if (err) {
                    console.error('Socket.IO session reload error:', err);
                    socket.emit('auth_error', 'A server error occurred while connecting to chat.');
                    return socket.disconnect(true);
                }

                let userEmail = 'Anonymous';
                let username = 'Anonymous';
                let currentGroupId = null;

                if (session && session.user && session.user.email && session.user.username && session.currentGroup && session.currentGroup.id) {
                    userEmail = session.user.email;
                    username = session.user.username;
                    currentGroupId = session.currentGroup.id;
                    const currentGroupName = session.currentGroup.name;

                    socket.join(currentGroupId);
                    console.log(`User ${username} (Email: ${userEmail}) connected to group room: ${currentGroupId} (${currentGroupName})`);

                    socket.emit('user_identity', { email: userEmail, username: username, groupName: currentGroupName, groupId: currentGroupId });

                    if (!groupActiveUsers[currentGroupId]) {
                        groupActiveUsers[currentGroupId] = new Map();
                    }
                    if (!groupActiveUsers[currentGroupId].has(userEmail)) {
                        groupActiveUsers[currentGroupId].set(userEmail, username);
                        const userListArray = Array.from(groupActiveUsers[currentGroupId], ([email, uname]) => ({ email: email, username: uname }));
                        console.log(`[SERVER] Emitting update userlist for group ${currentGroupId}:`, userListArray);
                        io.to(currentGroupId).emit('update userlist', userListArray);
                        console.log(`Active users in ${currentGroupId}:`, userListArray);
                    } else {
                        console.log(`[SERVER] User ${userEmail} already in group ${currentGroupId}, not adding again`);
                        const userListArray = Array.from(groupActiveUsers[currentGroupId], ([email, uname]) => ({ email: email, username: uname }));
                        console.log(`[SERVER] Emitting current userlist for group ${currentGroupId}:`, userListArray);
                        socket.emit('update userlist', userListArray);
                    }

                    if (!groupMessageHistories[currentGroupId]) {
                        groupMessageHistories[currentGroupId] = [];
                    }
                    socket.emit('load history', groupMessageHistories[currentGroupId]);
                    console.log(`Sent message history for group ${currentGroupId} to ${userEmail}`);
                } else {
                    console.log('Anonymous or no group context user connected to socket. Disconnecting.');
                    socket.emit('auth_error', 'No valid group session. Please select a group.');
                    return socket.disconnect(true);
                }

                socket.on('chat message', (msg) => {
                    if (username !== 'Anonymous' && currentGroupId) {
                        const messageData = {
                            user: username,
                            email: userEmail,
                            text: msg,
                            timestamp: new Date(),
                            groupId: currentGroupId
                        };
                        
                        if (!groupMessageHistories[currentGroupId]) groupMessageHistories[currentGroupId] = [];
                        groupMessageHistories[currentGroupId].push(messageData);
                        if (groupMessageHistories[currentGroupId].length > MAX_HISTORY_LENGTH) {
                            groupMessageHistories[currentGroupId].shift();
                        }

                        io.to(currentGroupId).emit('chat message', messageData);
                        socket.to(currentGroupId).emit('user_stopped_typing', { user: username });
                    } else {
                        socket.emit('auth_error', 'Cannot send message without valid group session.');
                    }
                });

                socket.on('disconnect', () => {
                    if (userEmail !== 'Anonymous' && currentGroupId && groupActiveUsers[currentGroupId] && groupActiveUsers[currentGroupId].has(userEmail)) {
                        console.log(`[SERVER] User ${username} (${userEmail}) disconnecting from group ${currentGroupId}`);
                        groupActiveUsers[currentGroupId].delete(userEmail);
                        const userListArray = Array.from(groupActiveUsers[currentGroupId], ([email, uname]) => ({ email: email, username: uname }));
                        console.log(`[SERVER] Emitting updated userlist after disconnect for group ${currentGroupId}:`, userListArray);
                        io.to(currentGroupId).emit('update userlist', userListArray);
                        console.log(`${username} (Email: ${userEmail}) disconnected from group ${currentGroupId}. Active users:`, userListArray);
                        socket.to(currentGroupId).emit('user_stopped_typing', { user: username });
                    }
                });
            });
        } catch (error) {
            console.error('An error occurred during socket connection setup:', error);
            socket.emit('auth_error', 'A server error occurred. Please try refreshing.');
            socket.disconnect(true);
        }
    });
    
    // Start server only in non-serverless environment
    const PORT = process.env.PORT || 3000;
    server.listen(PORT, () => {
        console.log(`Server listening on port ${PORT}`);
    });
}

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
        socketio: process.env.VERCEL ? 'serverless_mode' : 'enabled',
        bcrypt: 'enabled'
    });
});

// Login routes
app.get('/login', (req, res) => {
    if (req.session.user && req.session.user.email) {
        res.redirect('/groups');
    } else {
        res.sendFile(path.join(__dirname, '../public', 'login.html'));
    }
});

app.post('/login', async (req, res) => {
    try {
        await connectToDatabase();
        const { email, password } = req.body;
        console.log(`Login attempt for email: ${email}`);

        if (!email || !password) {
            console.log('Missing email or password in login attempt');
            return res.status(400).json({ success: false, message: 'Missing email or password' });
        }

        const user = await User.findOne({ email: email });
        console.log('Found user in database:', user ? {email: user.email, username: user.username} : null);

        if (!user) {
            console.log(`Invalid credentials (user not found) for ${email}`);
            return res.status(401).json({ success: false, message: 'Invalid credentials' });
        }

        const passwordsMatch = await bcrypt.compare(password, user.hashedPassword);
        console.log(`Password comparison result for ${email}: ${passwordsMatch}`);

        if (passwordsMatch) {
            req.session.user = { email: user.email, username: user.username };
            console.log(`User ${user.email} (Username: ${user.username}) logged in. Session data:`, req.session.user);
            return res.status(200).json({ success: true, message: 'Login successful', redirectTo: '/groups' });
        } else {
            console.log(`Invalid credentials (password mismatch) for ${email}`);
            return res.status(401).json({ success: false, message: 'Invalid credentials' });
        }
    } catch (error) {
        console.error('A critical error occurred during the login process:', error);
        return res.status(500).json({ success: false, message: 'A server error occurred during login. Please try again.' });
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
        console.log(`Registration attempt: Email: ${email}, Username: ${username}`);

        if (!email || !username || !password || !confirmPassword) {
            console.log('Registration failed: Missing fields');
            return res.status(400).json({ success: false, message: 'Missing fields', field: 'all'});
        }
        if (password !== confirmPassword) {
            console.log('Registration failed: Password mismatch');
            return res.status(400).json({ success: false, message: 'Passwords do not match', field: 'confirmPassword'});
        }
        if (username.length < 3 || username.length > 20) {
            console.log('Registration failed: Username length invalid');
            return res.status(400).json({ success: false, message: 'Username must be 3-20 characters', field: 'username'});
        }
        if (!/^[a-zA-Z0-9_]+$/.test(username)) {
            console.log('Registration failed: Username invalid characters');
            return res.status(400).json({ success: false, message: 'Username can only contain letters, numbers, and underscores', field: 'username'});
        }

        if (await User.findOne({ email: email })) {
            console.log(`Registration failed: Email ${email} already exists (in database)`);
            return res.status(400).json({ success: false, message: 'Email already registered', field: 'email'});
        }
        if (await User.findOne({ username: username.toLowerCase() })) {
            console.log(`Registration failed: Username ${username} already exists (in database)`);
            return res.status(400).json({ success: false, message: 'Username already taken', field: 'username'});
        }

        try {
            const hashedPassword = await bcrypt.hash(password, saltRounds);
            const newUser = new User({ email, username, hashedPassword });
            await newUser.save();
            
            console.log(`New user registered (in database): ${email}, Username: ${username}`);
            console.log('Current users (in database):', await User.find());
            
            res.status(201).json({ success: true, message: 'Registration successful! Please log in.', redirectTo: '/login'});

        } catch (error) {
            console.error("Error during registration hashing/storing:", error);
            res.status(500).json({ success: false, message: 'Error during registration process'});
        }
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
    if (req.session.user && req.session.user.email) {
        res.sendFile(path.join(__dirname, '../public', 'groups.html'));
    } else {
        res.redirect('/login');
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