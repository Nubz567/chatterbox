// Minimal test for Vercel deployment
const express = require('express');
const app = express();

app.get('/', (req, res) => {
  res.json({ 
    message: 'Deployment test successful',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

module.exports = app;
