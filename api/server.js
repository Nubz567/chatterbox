require('dotenv').config();

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const session = require('express-session');
const bcrypt = require('bcrypt');
const mongoose = require('mongoose');
const MongoStore = require('connect-mongo');

const app = express();
const server = http.createServer(app);

// MongoDB Connection
const mongoURI = process.env.MONGODB_URI;
if (!mongoURI) {
    console.error('MONGODB_URI is not defined');
}

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

// Socket.IO setup
const io = socketIo(server, {
    cors: {
        origin: ["https://chatterbox-blond.vercel.app", "http://localhost:3000"],
        methods: ["GET", "POST"],
        credentials: true
    },
    transports: ['polling', 'websocket']
});

// Session configuration
const sessionMiddleware = session({
    secret: process.env.SESSION_SECRET || 'default-secret',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
        clientPromise: connectToDatabase().then(conn => conn?.connection?.getClient()),
        collectionName: 'sessions',
        ttl: 14 * 24 * 60 * 60
    }),
    cookie: { 
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
        maxAge: 1000 * 60 * 60 * 24 * 7
    }
});

app.use(sessionMiddleware);
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
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
        serverless: !!process.env.VERCEL
    });
});

app.get('/ping', (req, res) => {
    res.json({ pong: true, timestamp: new Date().toISOString() });
});

app.get('/test', (req, res) => {
    res.json({
        message: 'Deployment test successful',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development',
        serverless: !!process.env.VERCEL
    });
});

app.get('/debug', (req, res) => {
    res.sendFile(path.join(__dirname, '../public', 'debug.html'));
});

app.get('/login', (req, res) => {
    if (req.session.user && req.session.user.email) {
        res.redirect('/groups');
    } else {
        res.sendFile(path.join(__dirname, '../public', 'login.html'));
    }
});

app.get('/groups', (req, res) => {
    if (req.session.user && req.session.user.email) {
        res.sendFile(path.join(__dirname, '../public', 'groups.html'));
    } else {
        res.redirect('/login');
    }
});

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
        res.status(500).send('Error loading chat page.');
    }
});

// API Routes
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
            return res.status(200).json({ success: true, message: 'Login successful', redirectTo: '/groups' });
        } else {
            return res.status(401).json({ success: false, message: 'Invalid credentials' });
        }
    } catch (error) {
        console.error('Login error:', error);
        return res.status(500).json({ success: false, message: 'Server error during login.' });
    }
});

app.post('/register', async (req, res) => {
    try {
        await connectToDatabase();
        const { email, username, password, confirmPassword } = req.body;

        if (!email || !username || !password || !confirmPassword) {
            return res.status(400).json({ success: false, message: 'Missing fields' });
        }
        if (password !== confirmPassword) {
            return res.status(400).json({ success: false, message: 'Passwords do not match' });
        }

        const existingUser = await User.findOne({ email: email });
        if (existingUser) {
            return res.status(400).json({ success: false, message: 'Email already registered' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({ email, username, hashedPassword });
        await newUser.save();
        
        res.status(201).json({ success: true, message: 'Registration successful! Please log in.', redirectTo: '/login' });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ success: false, message: 'Error during registration.' });
    }
});

app.post('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error('Session destruction error:', err);
            res.status(500).json({ success: false, message: 'Logout failed.' });
        } else {
            res.clearCookie('connect.sid');
            res.status(200).json({ success: true, message: 'Logged out successfully', redirectTo: '/login' });
        }
    });
});

// Socket.IO middleware
io.engine.use(sessionMiddleware);

// Socket.IO connection handling
io.on('connection', async (socket) => {
    try {
        await connectToDatabase();
        const session = socket.request.session;

        session.reload((err) => {
            if (err) {
                console.error('Socket session reload error:', err);
                socket.emit('auth_error', 'Server error while connecting.');
                return socket.disconnect(true);
            }

            let userEmail = 'Anonymous';
            let username = 'Anonymous';
            let currentGroupId = null;

            if (session && session.user && session.user.email && session.currentGroup && session.currentGroup.id) {
                userEmail = session.user.email;
                username = session.user.username;
                currentGroupId = session.currentGroup.id;

                socket.join(currentGroupId);
                socket.emit('user_identity', { 
                    email: userEmail, 
                    username: username, 
                    groupName: session.currentGroup.name, 
                    groupId: currentGroupId 
                });

                if (!groupActiveUsers[currentGroupId]) {
                    groupActiveUsers[currentGroupId] = new Map();
                }
                if (!groupActiveUsers[currentGroupId].has(userEmail)) {
                    groupActiveUsers[currentGroupId].set(userEmail, username);
                    const userListArray = Array.from(groupActiveUsers[currentGroupId], 
                        ([email, uname]) => ({ email: email, username: uname }));
                    io.to(currentGroupId).emit('update userlist', userListArray);
                }

                if (!groupMessageHistories[currentGroupId]) {
                    groupMessageHistories[currentGroupId] = [];
                }
                socket.emit('load history', groupMessageHistories[currentGroupId]);
            } else {
                socket.emit('auth_error', 'No valid group session. Please select a group.');
                return socket.disconnect(true);
            }

            // Chat message handling
            socket.on('chat message', (msg) => {
                if (username !== 'Anonymous' && currentGroupId) {
                    const messageData = {
                        user: username,
                        email: userEmail,
                        text: msg,
                        timestamp: new Date(),
                        groupId: currentGroupId
                    };
                    
                    if (!groupMessageHistories[currentGroupId]) {
                        groupMessageHistories[currentGroupId] = [];
                    }
                    groupMessageHistories[currentGroupId].push(messageData);
                    if (groupMessageHistories[currentGroupId].length > MAX_HISTORY_LENGTH) {
                        groupMessageHistories[currentGroupId].shift();
                    }

                    io.to(currentGroupId).emit('chat message', messageData);
                } else {
                    socket.emit('auth_error', 'Cannot send message without valid group session.');
                }
            });

            socket.on('disconnect', () => {
                if (userEmail !== 'Anonymous' && currentGroupId && groupActiveUsers[currentGroupId]) {
                    groupActiveUsers[currentGroupId].delete(userEmail);
                    const userListArray = Array.from(groupActiveUsers[currentGroupId], 
                        ([email, uname]) => ({ email: email, username: uname }));
                    io.to(currentGroupId).emit('update userlist', userListArray);
                }
            });
        });
    } catch (error) {
        console.error('Socket connection error:', error);
        socket.emit('auth_error', 'Server error occurred.');
        socket.disconnect(true);
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