// Simple test endpoint for deployment verification
const express = require('express');
const app = express();

app.get('/test', (req, res) => {
  res.json({
    message: 'Deployment test successful',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

module.exports = app;
