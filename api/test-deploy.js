// Minimal test for Vercel deployment
require('dotenv').config();

const express = require('express');
const app = express();

app.get('/', (req, res) => {
  res.json({ 
    message: 'Deployment test successful',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    mongoUri: process.env.MONGODB_URI ? 'Set' : 'Not set'
  });
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok',
    environment: process.env.NODE_ENV || 'development'
  });
});

module.exports = app;
