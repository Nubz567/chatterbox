// Minimal test for Vercel deployment
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

app.get('/', async (req, res) => {
  try {
    const dbStatus = mongoURI ? 'URI provided' : 'No URI';
    const connection = await connectToDatabase();
    const dbConnected = connection ? 'Connected' : 'Failed to connect';
    
    res.json({ 
      message: 'Deployment test successful',
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
      mongoUri: dbStatus,
      database: dbConnected
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
