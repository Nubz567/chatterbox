require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const bcrypt = require('bcrypt');
const MongoStore = require('connect-mongo');
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
    io.on('connection', (socket) => {
        console.log('Socket.IO client connected:', socket.id);
        
        socket.emit('welcome', { message: 'Connected to Chatterbox server' });
        
        socket.on('ping', () => {
            socket.emit('pong', { timestamp: new Date().toISOString() });
        });
        
        socket.on('disconnect', () => {
            console.log('Socket.IO client disconnected:', socket.id);
        });
    });
    
    // Start server only in non-serverless environment
    const PORT = process.env.PORT || 3000;
    server.listen(PORT, () => {
        console.log(`Server listening on port ${PORT}`);
    });
}

// Simple routes first
app.get('/', (req, res) => {
    res.json({ 
        message: 'Chatterbox server is running',
        socketio: process.env.VERCEL ? 'serverless_mode' : 'enabled',
        bcrypt: 'enabled',
        sessionStore: 'mongodb'
    });
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

app.get('/ping', (req, res) => {
    res.json({ pong: true, timestamp: new Date().toISOString() });
});

// Test database connection
app.get('/test-db', async (req, res) => {
    try {
        const conn = await connectToDatabase();
        if (conn) {
            res.json({ success: true, message: 'Database connected successfully' });
        } else {
            res.status(500).json({ success: false, message: 'Database connection failed' });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: 'Database error', error: error.message });
    }
});

// Test session functionality
app.get('/test-session', (req, res) => {
    if (!req.session.visitCount) {
        req.session.visitCount = 0;
    }
    req.session.visitCount++;
    res.json({ 
        success: true, 
        message: 'Session working with MongoDB store',
        visitCount: req.session.visitCount,
        sessionId: req.sessionID,
        sessionStore: 'mongodb'
    });
});

// Test Socket.IO functionality
app.get('/test-socket', (req, res) => {
    if (io) {
        res.json({ 
            success: true, 
            message: 'Socket.IO server is running',
            connectedClients: io.engine.clientsCount || 0
        });
    } else {
        res.json({ 
            success: true, 
            message: 'Socket.IO in serverless mode',
            note: 'Real-time features may be limited in serverless environment'
        });
    }
});

// Test bcrypt functionality
app.get('/test-bcrypt', async (req, res) => {
    try {
        const testPassword = 'testpassword123';
        const saltRounds = 10;
        
        // Hash a password
        const hashedPassword = await bcrypt.hash(testPassword, saltRounds);
        
        // Verify the password
        const isMatch = await bcrypt.compare(testPassword, hashedPassword);
        
        res.json({ 
            success: true, 
            message: 'bcrypt working correctly',
            originalPassword: testPassword,
            hashedPassword: hashedPassword.substring(0, 20) + '...',
            passwordMatch: isMatch
        });
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            message: 'bcrypt error', 
            error: error.message 
        });
    }
});

// Test connect-mongo functionality
app.get('/test-connect-mongo', async (req, res) => {
    try {
        const conn = await connectToDatabase();
        if (conn) {
            res.json({ 
                success: true, 
                message: 'connect-mongo working correctly',
                database: 'connected',
                sessionStore: 'mongodb',
                note: 'Sessions will be stored in MongoDB'
            });
        } else {
            res.status(500).json({ 
                success: false, 
                message: 'Database connection failed for connect-mongo test' 
            });
        }
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            message: 'connect-mongo error', 
            error: error.message 
        });
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