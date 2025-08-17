# Chatterbox - Real-time Chat Application

A real-time chat application built with Node.js, Express, Socket.IO, and MongoDB.

## Features

- Real-time messaging
- Group chat functionality
- User authentication
- Private messaging
- User management
- Responsive design

## Deployment on Vercel

### Prerequisites

1. **MongoDB Database**: You need a MongoDB database (MongoDB Atlas recommended)
2. **Environment Variables**: Set up the following environment variables in Vercel:
   - `MONGODB_URI`: Your MongoDB connection string
   - `SESSION_SECRET`: A secret key for session management
   - `NODE_ENV`: Set to "production"

### Deployment Steps

1. **Connect to Vercel**:
   - Install Vercel CLI: `npm i -g vercel`
   - Login: `vercel login`
   - Deploy: `vercel --prod`

2. **Set Environment Variables**:
   - Go to your Vercel dashboard
   - Navigate to your project settings
   - Add the environment variables listed above

3. **Verify Deployment**:
   - Check the health endpoint: `https://your-app.vercel.app/health`
   - Check the test endpoint: `https://your-app.vercel.app/test`

### Troubleshooting

If deployment fails:

1. **Check Build Logs**: Look at the Vercel build logs for specific errors
2. **Environment Variables**: Ensure all required environment variables are set
3. **Database Connection**: Verify your MongoDB URI is correct and accessible
4. **Dependencies**: Ensure all dependencies are properly listed in package.json

### Local Development

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Set Environment Variables**:
   Create a `.env` file with:
   ```
   MONGODB_URI=your_mongodb_connection_string
   SESSION_SECRET=your_session_secret
   NODE_ENV=development
   ```

3. **Start Development Server**:
   ```bash
   npm run dev
   ```

4. **Access the Application**:
   - Main app: http://localhost:3000
   - Debug page: http://localhost:3000/debug

## Project Structure

```
Chatterbox/
├── api/
│   ├── server.js          # Main server file
│   └── test.js           # Test endpoint
├── public/
│   ├── chat.html         # Chat interface
│   ├── client.js         # Client-side JavaScript
│   ├── style.css         # Styles
│   └── debug.html        # Debug interface
├── package.json
├── vercel.json           # Vercel configuration
└── README.md
```

## API Endpoints

- `GET /health` - Health check
- `GET /ping` - Simple ping test
- `GET /test` - Deployment test
- `GET /debug` - Debug interface
- `GET /chat` - Chat interface
- `GET /groups` - Groups management
- `GET /login` - Login page

## Socket.IO Events

- `chat message` - Send/receive chat messages
- `user_typing` - Typing indicators
- `update userlist` - User list updates
- `load history` - Load message history

## Support

If you encounter issues:

1. Check the debug page at `/debug`
2. Review the browser console for errors
3. Check the server logs in Vercel dashboard
4. Verify all environment variables are set correctly
