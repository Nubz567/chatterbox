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
    if (req.session.user && req.session.user.email) {
        res.sendFile(path.join(__dirname, '../public', 'groups.html'));
    } else {
        res.redirect('/login');
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