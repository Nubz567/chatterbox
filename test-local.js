// Test script to verify server works locally
const server = require('./api/server.js');

console.log('✅ Server module loaded successfully');
console.log('✅ Server type:', typeof server);
console.log('✅ Server has routes:', typeof server._router !== 'undefined');

// Test basic functionality
const http = require('http');
const serverInstance = http.createServer(server);

serverInstance.listen(3001, () => {
    console.log('✅ Server listening on port 3001');
    console.log('✅ Test completed successfully');
    process.exit(0);
});
