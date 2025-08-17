require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
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

// Basic middleware
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Simple routes first
app.get('/', (req, res) => {
    res.json({ message: 'Chatterbox server is running' });
});

app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development',
        database: mongoURI ? 'configured' : 'not configured'
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