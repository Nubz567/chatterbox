// Minimal test for Vercel deployment
require('dotenv').config();

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const session = require('express-session');
const bcrypt = require('bcrypt');
const MongoStore = require('connect-mongo');

const app = express();
const server = http.createServer(app);

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
app.use(session({
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
}));

// Socket.IO setup
const io = socketIo(server, {
    cors: {
        origin: ["https://chatterbox-blond.vercel.app", "http://localhost:3000"],
        methods: ["GET", "POST"],
        credentials: true
    },
    transports: ['polling', 'websocket']
});

// Socket.IO connection handling
io.on('connection', (socket) => {
    console.log('Socket.IO client connected');
    socket.emit('test', { message: 'Socket.IO is working!' });
    
    socket.on('disconnect', () => {
        console.log('Socket.IO client disconnected');
    });
});

app.get('/', async (req, res) => {
  try {
    const dbStatus = mongoURI ? 'URI provided' : 'No URI';
    const connection = await connectToDatabase();
    const dbConnected = connection ? 'Connected' : 'Failed to connect';
    
    // Test session with MongoDB store
    req.session.test = 'session-working';
    const sessionWorking = req.session.test === 'session-working' ? 'Working' : 'Not working';
    
    // Test bcrypt
    const testPassword = 'test123';
    const hashedPassword = await bcrypt.hash(testPassword, 10);
    const bcryptWorking = await bcrypt.compare(testPassword, hashedPassword) ? 'Working' : 'Not working';
    
    res.json({ 
      message: 'Deployment test successful',
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
      mongoUri: dbStatus,
      database: dbConnected,
      session: sessionWorking,
      socketio: 'Configured',
      bcrypt: bcryptWorking,
      connectMongo: 'Configured'
    });
  } catch (error) {
    res.json({
      message: 'Deployment test with error',
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
      error: error.message
    });
  }
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok',
    environment: process.env.NODE_ENV || 'development'
  });
});

module.exports = app;
