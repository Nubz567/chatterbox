require('dotenv').config(); // Load environment variables from .env file

// Trigger a new deployment
console.log('Server is starting up...');

// Temporarily log the URI (be careful not to expose the full password if sharing logs)
console.log('MONGODB_URI loaded:', process.env.MONGODB_URI ? process.env.MONGODB_URI.replace(/:(.*?)(@)/, ':***$2') : 'URI is NOT set');

console.log('MONGODB_URI being used:', process.env.MONGODB_URI ? 'URI is set' : 'URI is NOT set'); // Keep the existing log too

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const session = require('express-session');
const bcrypt = require('bcrypt');
const mongoose = require('mongoose'); // Require Mongoose
const MongoStore = require('connect-mongo');

// --- NEW: Serverless-Compatible MongoDB Connection ---
const mongoURI = process.env.MONGODB_URI;
if (!mongoURI) {
    throw new Error('FATAL ERROR: MONGODB_URI is not defined in environment variables.');
}

// Using a global variable to cache the connection promise.
// This is the recommended pattern for serverless environments.
let cachedConnection = global.mongoose_connection;

if (!cachedConnection) {
    cachedConnection = global.mongoose_connection = { conn: null, promise: null };
}

async function connectToDatabase() {
    if (cachedConnection.conn) {
        console.log('Using cached database connection.');
        return cachedConnection.conn;
    }

    if (!cachedConnection.promise) {
        console.log('Creating new database connection promise.');
        cachedConnection.promise = mongoose.connect(mongoURI, {
            bufferCommands: false, // Recommended for serverless
            serverSelectionTimeoutMS: 5000,
        }).then(mongooseInstance => {
            console.log('Mongoose connection promise resolved.');
            return mongooseInstance;
        });
    }

    try {
        console.log('Awaiting database connection promise.');
        cachedConnection.conn = await cachedConnection.promise;
        return cachedConnection.conn;
    } catch (e) {
        cachedConnection.promise = null; // On error, reset the promise to allow retry
        console.error('An error occurred while connecting to MongoDB', e);
        throw new Error('Database connection failed.');
    }
}
// --- END NEW CONNECTION LOGIC ---

// --- Mongoose Schemas and Models ---
const userSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    username: { type: String, required: true, unique: true },
    hashedPassword: { type: String, required: true },
    // You could add other fields here like creation date, profile picture, etc.
});

const User = mongoose.model('User', userSchema);

const groupSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true }, // Keep the string ID for now, but Mongoose adds _id automatically
    name: { type: String, required: true },
    adminEmail: { type: String, required: true }, // Storing admin email, could reference User ID
    joinCode: { type: String, required: true, unique: true },
    members: [{ type: String }], // Array of user emails, could reference User IDs
    archivedDueToUserDeletion: { type: Boolean, default: false }
    // You could add message history here directly, or keep it separate
    // For now, let's keep groupMessageHistories separate as it's in-memory
});

const Group = mongoose.model('Group', groupSchema);

// --- End Mongoose Schemas and Models ---

// --- Global-like constants and in-memory stores ---
const MAX_HISTORY_LENGTH = 100;
// const messageHistory = []; // Will become group-specific
// const activeUsers = new Set(); // Will become group-specific

const groupMessageHistories = {}; // { groupId: [messages] }
const groupActiveUsers = {};    // { groupId: Set(userEmail) }

// --- NEW: In-memory store for Groups ---
// const groups = {}; // THIS IS DEPRECATED AND REMOVED. DATABASE IS THE SOURCE OF TRUTH.
                 // Example group: { id: 'uuid', name: 'Cool Group', adminEmail: 'user@example.com', joinCode: 'XYZ123', members: ['user@example.com'] }

// Helper function to generate unique IDs (simple version for now)
function generateUniqueId() {
    return Date.now().toString(36) + Math.random().toString(36).substring(2);
}
// --- End NEW ---

// --- IN-MEMORY USER STORE (FOR DEVELOPMENT ONLY) ---
// REPLACE THIS ENTIRE BLOCK with Mongoose operations
/*
const users = [
  { 
    email: 'user1@example.com', 
    username: 'UserOne',
    hashedPassword: 'YOUR_FIRST_GENERATED_HASH_HERE'
  },
  { 
    email: 'user2@example.com', 
    username: 'UserTwo',
    hashedPassword: 'YOUR_SECOND_GENERATED_HASH_HERE'
  }
  // Add more users if you want, each with a pre-hashed password
];
*/

const app = express();
app.set('trust proxy', 1);

const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "https://chatterbox-blond.vercel.app", // Explicitly allow your frontend URL
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ['websocket'] // Force WebSocket transport only
});

const PORT = process.env.PORT || 3000;

// --- Session Configuration ---

// Configure MongoDB store for sessions
const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET || 'your default secret key for chatterbox', // Use environment variable for secret
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    clientPromise: connectToDatabase().then(mongooseInstance => mongooseInstance.connection.getClient()),
    collectionName: 'sessions', // Name of the collection to store sessions
    ttl: 14 * 24 * 60 * 60 // Session TTL in seconds (e.g., 14 days)
  }),
  cookie: { 
    secure: process.env.NODE_ENV === 'production', // Use secure cookies in production (HTTPS)
    httpOnly: true, // Prevent client-side JS from accessing the cookie
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax', // Necessary for cross-site requests if API is on a different subdomain/domain. 'lax' is fine for same-site.
    maxAge: 1000 * 60 * 60 * 24 * 7 // Cookie expiration time (e.g., 7 days)
  }
});

app.use(sessionMiddleware);

// Middleware to parse URL-encoded data (for form submissions)
app.use(express.urlencoded({ extended: false }));
app.use(express.json()); // <-- ADDED: Middleware to parse JSON request bodies for API routes

// Serve static files from the "public" directory
app.use(express.static(path.join(__dirname, '../public')));

// Example of setting CSP headers
app.use((req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' data:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';"
  );
  next();
});

// Redirect root to /login
app.get('/', (req, res) => {
  res.redirect('/login');
});

// Serve login.html at the /login route, or redirect to groups if already logged in
app.get('/login', (req, res) => {
  if (req.session.user && req.session.user.email) {
    res.redirect('/groups');
  } else {
    res.sendFile(path.join(__dirname, '../public', 'login.html'));
  }
});

// Serve chat.html (previously index.html) on the /chat route
app.get('/chat', async (req, res) => {
  const { groupId, groupName } = req.query;

  if (!req.session.user || !req.session.user.email) {
    return res.redirect('/login'); // Redirect to login if not authenticated
  }

  if (!groupId) {
    return res.redirect('/groups?error=No+group+selected');
  }

  const group = await Group.findOne({ id: groupId });

  if (!group) {
    return res.redirect('/groups?error=Group+not+found');
  }

  if (!group.members.includes(req.session.user.email)) {
    return res.redirect('/groups?error=Not+a+member+of+this+group');
  }

  req.session.currentGroup = { id: groupId, name: groupName || group.name };
  res.sendFile(path.join(__dirname, '../public', 'chat.html'));
});

// --- NEW: Route for Groups Page ---
app.get('/groups', (req, res) => {
    if (req.session.user && req.session.user.email) {
        res.sendFile(path.join(__dirname, '../public', 'groups.html'));
    } else {
        res.redirect('/login'); // If not logged in, redirect to login
    }
});
// --- End NEW ---

// --- NEW: Route for Change Password Page ---
app.get('/change-password', (req, res) => {
    console.log('Accessed /change-password GET route');
    if (req.session.user && req.session.user.email) {
        res.sendFile(path.join(__dirname, '../public', 'change-password.html'));
    } else {
        res.redirect('/login'); // If not logged in, redirect to login
    }
});

// --- NEW: Route for Delete Account Confirmation Page ---
app.get('/delete-account', (req, res) => {
    console.log('Accessed /delete-account GET route'); // For debugging
    if (req.session.user && req.session.user.email) {
        res.sendFile(path.join(__dirname, '../public', 'delete-account.html'));
    } else {
        res.redirect('/login'); // If not logged in, redirect to login
    }
});

// --- NEW: Handle Change Password Form Submission ---
app.post('/change-password', async (req, res) => {
    if (!req.session.user || !req.session.user.email) {
        return res.status(401).json({ success: false, message: 'Not logged in. Please log in again.' });
    }

    const { currentPassword, newPassword, confirmNewPassword } = req.body;
    const userEmail = req.session.user.email;

    // Basic validation
    if (!currentPassword || !newPassword || !confirmNewPassword) {
        return res.status(400).json({ success: false, message: 'All fields are required.' });
    }
    if (newPassword !== confirmNewPassword) {
        return res.status(400).json({ success: false, message: 'New passwords do not match.' });
    }

    const user = await User.findOne({ email: userEmail });
    if (!user) {
        return res.status(404).json({ success: false, message: 'User not found. Please log in again.' });
    }

    try {
        const isMatch = await bcrypt.compare(currentPassword, user.hashedPassword);
        if (!isMatch) {
            return res.status(400).json({ success: false, message: 'Incorrect current password.' });
        }

        const saltRounds = 10; // Same as in registration
        const newHashedPassword = await bcrypt.hash(newPassword, saltRounds);

        // Update the user's password in our in-memory store
        user.hashedPassword = newHashedPassword;
        await user.save();
        console.log(`Password changed successfully for user: ${userEmail}`);
        
        return res.status(200).json({ success: true, message: 'Password changed successfully! You can now log in with your new password.' });

    } catch (error) {
        console.error("Error during password change:", error);
        return res.status(500).json({ success: false, message: 'An error occurred while updating your password. Please try again.' });
    }
});
// --- End NEW ---

// --- NEW: Handle Account Deletion --- 
app.post('/delete-account', async (req, res) => {
    if (!req.session.user || !req.session.user.email) {
        // If this fails, it returns a 401 status
        return res.status(401).json({ success: false, message: 'Not logged in. Please log in again.' });
    }

    const { password } = req.body;
    const userEmail = req.session.user.email;
    console.log(`Attempting to delete account for: ${userEmail} with password: ${password ? 'provided' : 'MISSING'}`);

    // 2. Check if password was provided in the request
    if (!password) {
        // If this fails, it returns a 400 status
        return res.status(400).json({ success: false, message: 'Password is required to delete your account.' });
    }

    const user = await User.findOne({ email: userEmail });
    // 3. Check if user exists in the array
    if (!user) {
        // If this fails, it returns a 404 status
        return res.status(404).json({ success: false, message: 'User not found. Please log in again.' });
    }

    try {
        // 4. Compare the provided password with the stored hash
        const isMatch = await bcrypt.compare(password, user.hashedPassword);
        console.log(`Password match for ${userEmail}: ${isMatch}`);
        if (!isMatch) {
            // If passwords don't match, it returns a 400 status
            return res.status(400).json({ success: false, message: 'Incorrect password.' });
        }

        // If all above checks pass, it should reach here:
        await User.deleteOne({ email: userEmail }); // Correctly use deleteOne, .remove() is deprecated
        console.log(`Account deleted successfully for user: ${userEmail}`);
        
        // --- NEW: Mark groups associated with the deleted user by querying the database ---
        const userGroups = await Group.find({ members: userEmail });

        for (const group of userGroups) {
            const wasAdmin = group.adminEmail === userEmail;

            // Mark the group as archived
            group.archivedDueToUserDeletion = true;
            console.log(`Group "${group.name}" (ID: ${group.id}) marked as archived due to deletion of user ${userEmail}.`);

            // Remove the user from the members list
            const memberIndex = group.members.indexOf(userEmail);
            if (memberIndex > -1) {
                group.members.splice(memberIndex, 1);
                console.log(`User ${userEmail} removed from members list of group "${group.name}" (ID: ${group.id}).`);
            }
            
            // If the admin was deleted, the group is now admin-less but archived.
            // This is sufficient based on the requirement to hide it until a join code is used.
            await group.save(); // Save the changes to the group
        }
        // --- End NEW ---

        req.session.destroy((err) => {
            if (err) {
                console.error('Session destruction error during account deletion:', err);
                return res.status(500).json({ success: false, message: 'Account deleted, but an error occurred during logout. Please clear your cookies.'});
            }
            res.clearCookie('connect.sid');
            return res.status(200).json({ success: true, message: 'Account deleted successfully. You have been logged out.' });
        });

    } catch (error) {
        // 5. Catch any errors during bcrypt.compare or other operations
        console.error("Error during account deletion processing:", error);
        return res.status(500).json({ success: false, message: 'An error occurred while deleting your account. Please try again.' });
    }
});
// --- End NEW ---

// --- NEW: API endpoint to get current user data ---
app.get('/api/user', (req, res) => {
    if (req.session.user && req.session.user.email) {
        // Only return non-sensitive user data
        res.json({
            email: req.session.user.email,
            username: req.session.user.username
            // Add any other data you want to expose about the user
        });
    } else {
        res.status(401).json({ error: 'Not authenticated' });
    }
});
// --- End NEW ---

// --- NEW: API Endpoint to Change Username ---
app.post('/api/user/change-username', async (req, res) => {
    if (!req.session.user || !req.session.user.email) {
        return res.status(401).json({ success: false, message: 'Not authenticated. Please log in again.' });
    }

    const { newUsername } = req.body;
    const userEmail = req.session.user.email;

    // Validate newUsername
    if (!newUsername || newUsername.trim() === '') {
        return res.status(400).json({ success: false, message: 'New username cannot be empty.' });
    }
    if (newUsername.length < 3 || newUsername.length > 20) {
        return res.status(400).json({ success: false, message: 'Username must be between 3 and 20 characters.' });
    }
    if (!/^[a-zA-Z0-9_]+$/.test(newUsername)) {
        return res.status(400).json({ success: false, message: 'Username can only contain letters, numbers, and underscores.' });
    }

    // Check for username uniqueness (excluding the current user themselves)
    const conflictingUser = await User.findOne({ username: newUsername.toLowerCase(), email: { $ne: userEmail } });
    if (conflictingUser) {
        return res.status(400).json({ success: false, message: 'This username is already taken. Please choose another.' });
    }

    const userToUpdate = await User.findOne({ email: userEmail });
    if (!userToUpdate) {
        // This should ideally not happen if session is valid
        return res.status(404).json({ success: false, message: 'Current user not found in database.' });
    }

    const oldUsername = userToUpdate.username;
    userToUpdate.username = newUsername;
    await userToUpdate.save();
    req.session.user.username = newUsername; // Update session

    console.log(`User ${userEmail} changed username from "${oldUsername}" to "${newUsername}"`);

    // Propagate username change to message histories
    console.log('[Server INFO] Starting propagation to groupMessageHistories...');
    for (const groupId in groupMessageHistories) {
        if (groupMessageHistories.hasOwnProperty(groupId)) {
            console.log(`[Server INFO] Processing history for group ${groupId}`)
            groupMessageHistories[groupId].forEach(message => {
                if (message.email === userEmail) {
                    message.user = newUsername;
                }
            });
        }
    }
    console.log('[Server INFO] Finished propagation to groupMessageHistories.');

    // Propagate username change to active user lists and notify clients
    console.log('[Server INFO] Starting propagation to groupActiveUsers and emitting updates...');
    for (const groupId in groupActiveUsers) {
        if (groupActiveUsers.hasOwnProperty(groupId)) {
            console.log(`[Server INFO] Processing active users for group ${groupId}`);
            if (groupActiveUsers[groupId].has(userEmail)) {
                groupActiveUsers[groupId].set(userEmail, newUsername); // Update the username in the Map
                console.log(`[Server INFO] Updated username in active list for ${userEmail} in group ${groupId}`);
                
                const userListArray = Array.from(groupActiveUsers[groupId],
                    ([email, uname]) => ({ email: email, username: uname }));
                
                try {
                    io.to(groupId).emit('update userlist', userListArray); // Notify clients in this group
                    console.log(`[Server INFO] Emitted 'update userlist' to group ${groupId}`);
                } catch (socketError) {
                    console.error(`[Server ERROR] Failed to emit 'update userlist' to group ${groupId}:`, socketError);
                }
            } else {
                console.log(`[Server INFO] User ${userEmail} not in active list for group ${groupId}, no update needed.`);
            }
        }
    }
    console.log('[Server INFO] Finished propagation to groupActiveUsers and emitting updates.');

    return res.status(200).json({ 
        success: true, 
        message: 'Username changed successfully!', 
        newUsername: newUsername 
    });
});
// --- End NEW ---

// Handle login attempts
app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  console.log(`Login attempt for email: ${email}`); // Log the email

  if (email && password) {
    const user = await User.findOne({ email: email });
    console.log('Found user in database:', user ? {email: user.email, username: user.username} : null); // Log if user is found

    if (user) {
      try {
        const passwordsMatch = await bcrypt.compare(password, user.hashedPassword);
        console.log(`Password comparison result for ${email}: ${passwordsMatch}`); // Log password comparison result

        if (passwordsMatch) {
          req.session.user = { email: user.email, username: user.username };
          console.log(`User ${user.email} (Username: ${user.username}) logged in. Session data:`, req.session.user); // Updated log for clarity
          // Send a JSON response instead of redirect for easier debugging from client-side
          // res.redirect('/groups'); 
          res.status(200).json({ success: true, message: 'Login successful', redirectTo: '/groups' });
        } else {
          console.log(`Invalid credentials (password mismatch) for ${email}`); // Added log
          // res.redirect('/?error=invalid_credentials');
          res.status(401).json({ success: false, message: 'Invalid credentials' });
        }
      } catch (compareError) {
        console.error(`Error during password comparison for ${email}:`, compareError); // Added log
        // res.redirect('/?error=login_error');
        res.status(500).json({ success: false, message: 'Login error' });
      }
    } else {
      console.log(`Invalid credentials (user not found) for ${email}`); // Added log
      // res.redirect('/?error=invalid_credentials');
      res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
  } else {
    console.log('Missing email or password in login attempt'); // Added log
    // res.redirect('/?error=missing_email_or_password');
    res.status(400).json({ success: false, message: 'Missing email or password' });
  }
});

// --- Logout Route ---
app.post('/logout', (req, res) => {
  if (req.session.user) {
    const userEmail = req.session.user.email;
    req.session.destroy((err) => {
      if (err) {
        console.error('Session destruction error:', err);
        // Fallback to still try and redirect client
        res.status(500).json({ success: false, message: 'Logout failed, please clear your cookies.', redirectTo: '/login' });
        return;
      }
      console.log(`User ${userEmail} logged out.`);
      res.clearCookie('connect.sid');
      res.status(200).json({ success: true, message: 'Logged out successfully', redirectTo: '/login' });
    });
  } else {
    // If no session, just send a success response with redirect info
    res.status(200).json({ success: true, message: 'No active session, already logged out', redirectTo: '/login' });
  }
});

// --- NEW: Registration Routes ---
app.get('/register', (req, res) => {
  res.sendFile(path.join(__dirname, '../public', 'register.html'));
});

app.post('/register', async (req, res) => {
  const { email, username, password, confirmPassword } = req.body;
  const saltRounds = 10;
  console.log(`Registration attempt: Email: ${email}, Username: ${username}`); // Added log

  if (!email || !username || !password || !confirmPassword) {
    console.log('Registration failed: Missing fields'); // Added log
    return res.status(400).json({ success: false, message: 'Missing fields', field: 'all'});
    // return res.redirect('/register?error=missing_fields');
  }
  if (password !== confirmPassword) {
    console.log('Registration failed: Password mismatch'); // Added log
    return res.status(400).json({ success: false, message: 'Passwords do not match', field: 'confirmPassword'});
    // return res.redirect('/register?error=password_mismatch');
  }
  if (username.length < 3 || username.length > 20) {
    console.log('Registration failed: Username length invalid'); // Added log
    return res.status(400).json({ success: false, message: 'Username must be 3-20 characters', field: 'username'});
    // return res.redirect('/register?error=username_length');
  }
  if (!/^[a-zA-Z0-9_]+$/.test(username)) {
    console.log('Registration failed: Username invalid characters'); // Added log
    return res.status(400).json({ success: false, message: 'Username can only contain letters, numbers, and underscores', field: 'username'});
    // return res.redirect('/register?error=username_invalid_chars');
  }

  // THIS CHECK IS AGAINST THE IN-MEMORY ARRAY, WHICH IS THE PROBLEM ON SERVERLESS
  if (await User.findOne({ email: email })) {
    console.log(`Registration failed: Email ${email} already exists (in database)`); // Added log
    return res.status(400).json({ success: false, message: 'Email already registered', field: 'email'});
    // return res.redirect('/register?error=email_exists');
  }
  if (await User.findOne({ username: username.toLowerCase() })) {
    console.log(`Registration failed: Username ${username} already exists (in database)`); // Added log
    return res.status(400).json({ success: false, message: 'Username already taken', field: 'username'});
    // return res.redirect('/register?error=username_exists');
  }

  try {
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    // THIS PUSH IS TO THE IN-MEMORY ARRAY
    const newUser = new User({ email, username, hashedPassword });
    await newUser.save();
    
    console.log(`New user registered (in database): ${email}, Username: ${username}`);
    console.log('Current users (in database):', await User.find());
    
    // res.redirect('/?success=registered');
    res.status(201).json({ success: true, message: 'Registration successful! Please log in.', redirectTo: '/login'});

  } catch (error) {
    console.error("Error during registration hashing/storing:", error);
    // res.redirect('/register?error=registration_failed');
    res.status(500).json({ success: false, message: 'Error during registration process'});
  }
});

// --- NEW: API Endpoints for Groups ---

// Helper function to generate a simple join code
async function generateJoinCode(length = 6) { // Marked async as it will check DB
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    // Ensure uniqueness against the database
    const existingGroup = await Group.findOne({ joinCode: result });
    if (existingGroup) {
        console.log(`Generated duplicate join code ${result}, regenerating.`);
        return generateJoinCode(length); // Recurse if not unique
    }
    console.log(`Generated unique join code: ${result}`);
    return result;
}

app.post('/api/groups/create', async (req, res) => { // Marked async
    if (!req.session.user || !req.session.user.email) {
        return res.status(401).json({ error: 'User not authenticated' });
    }

    const { name } = req.body;
    if (!name || name.trim() === '') {
        return res.status(400).json({ error: 'Group name is required' });
    }

    const adminEmail = req.session.user.email;
    // Generate a unique ID (Mongoose will add _id, we can use that or keep this) - let's keep for now if frontend uses 'id'
    const groupId = generateUniqueId(); // Use Mongoose _id instead
    const joinCode = await generateJoinCode(); // Await join code generation

    try {
        const newGroup = new Group({
            id: groupId, // Mongoose provides _id
        name: name.trim(),
        adminEmail: adminEmail,
        joinCode: joinCode,
        members: [adminEmail] // Creator is the first member
        });

        const savedGroup = await newGroup.save(); // Save to database
        console.log(`Group created: ${savedGroup.name} (ID: ${savedGroup.id}), Code: ${savedGroup.joinCode} by ${adminEmail}`);
        // Return the saved group object, including the Mongoose-generated _id
        res.status(201).json({ 
            id: savedGroup.id, // Use _id as the group ID for the frontend
            name: savedGroup.name,
            adminEmail: savedGroup.adminEmail,
            joinCode: savedGroup.joinCode,
            members: savedGroup.members
        });
    } catch (error) {
        console.error('Error creating group:', error);
        // Handle potential duplicate join code error if generateJoinCode didn't catch it (Mongoose unique index)
        if (error.code === 11000) { // MongoDB duplicate key error code
            return res.status(400).json({ error: 'Failed to generate unique join code. Please try again.' });
        }
        res.status(500).json({ error: 'An error occurred while creating the group.' });
    }
});

app.post('/api/groups/join', async (req, res) => { // Marked async
    if (!req.session.user || !req.session.user.email) {
        return res.status(401).json({ error: 'User not authenticated' });
    }

    const { joinCode } = req.body;
    if (!joinCode || joinCode.trim() === '') {
        return res.status(400).json({ error: 'Join code is required' });
    }

    const userEmail = req.session.user.email;
    
    try {
        // Find the group by join code
        const targetGroup = await Group.findOne({ joinCode: joinCode.trim() });

    if (!targetGroup) {
        return res.status(404).json({ error: 'Group not found with this join code' });
    }

        // --- NEW: If group was archived, unarchive it upon successful join via code ---
        if (targetGroup.archivedDueToUserDeletion) {
            targetGroup.archivedDueToUserDeletion = false;
            console.log(`Group "${targetGroup.name}" (ID: ${targetGroup._id}) was archived and is now restored by user ${userEmail} joining with code.`);
        }
        // --- End NEW ---

    if (targetGroup.members.includes(userEmail)) {
            // Save the group even if the user is already a member, in case it was archived and just unarchived
             await targetGroup.save(); 
        return res.status(400).json({ error: 'User is already a member of this group', group: targetGroup });
    }

    targetGroup.members.push(userEmail);
        await targetGroup.save(); // Save the updated group to database

        console.log(`User ${userEmail} joined group: ${targetGroup.name} (ID: ${targetGroup._id})`);
        res.status(200).json({
            id: targetGroup._id, // Use _id for the frontend
            name: targetGroup.name,
            adminEmail: targetGroup.adminEmail,
            joinCode: targetGroup.joinCode,
            members: targetGroup.members
        });
    } catch (error) {
        console.error('Error joining group:', error);
        res.status(500).json({ error: 'An error occurred while joining the group.' });
    }
});

app.get('/api/user/groups', async (req, res) => { // Marked async
    if (!req.session.user || !req.session.user.email) {
        return res.status(401).json({ error: 'User not authenticated' });
    }
    const userEmail = req.session.user.email;
    
    try {
        // Find all groups where the user is a member and the group is not archived
        const memberOfGroups = await Group.find({
            members: userEmail,
            archivedDueToUserDeletion: { $ne: true } // Only include groups not archived
        });
        
        // Map to the desired structure if needed, or just return the Mongoose documents
        // Returning Mongoose docs is usually fine, they behave like objects
    res.status(200).json(memberOfGroups);

    } catch (error) {
        console.error('Error fetching user groups:', error);
        res.status(500).json({ error: 'An error occurred while fetching your groups.' });
    }
});

app.get('/api/groups/:groupId/members', async (req, res) => { // Marked async
    if (!req.session.user || !req.session.user.email) {
        return res.status(401).json({ error: 'User not authenticated' });
    }

    const userEmail = req.session.user.email;
    const { groupId } = req.params;
    
    try {
        // Find the group by its Mongoose _id
        const group = await Group.findById(groupId);

    if (!group) {
        return res.status(404).json({ error: 'Group not found' });
    }

    if (!group.members.includes(userEmail)) {
        return res.status(403).json({ error: 'User is not a member of this group' });
    }

    // For privacy, you might only want to return emails or basic info, not full user objects if they existed
        // If you need usernames, you'd need to fetch User documents based on these emails
    res.status(200).json(group.members);
    } catch (error) {
        console.error('Error fetching group members:', error);
         // Handle potential invalid ObjectId format error
        if (error.kind === 'ObjectId') {
             return res.status(400).json({ error: 'Invalid group ID format.' });
        }
        res.status(500).json({ error: 'An error occurred while fetching group members.' });
    }
});

// --- NEW: API Endpoint for Leaving a Group ---
app.post('/api/groups/:groupId/leave', async (req, res) => { // Marked async
    if (!req.session.user || !req.session.user.email) {
        return res.status(401).json({ error: 'User not authenticated' });
    }

    const userEmail = req.session.user.email;
    const { groupId } = req.params;
    
    try {
        // Find the group by its Mongoose _id
        const group = await Group.findById(groupId);

        if (!group) {
            return res.status(404).json({ error: 'Group not found' });
        }

        const memberIndex = group.members.indexOf(userEmail);
        if (memberIndex === -1) {
            return res.status(400).json({ error: 'User is not a member of this group' });
        }

        group.members.splice(memberIndex, 1);
        await group.save(); // Save the updated group to database

        console.log(`User ${userEmail} left group: ${group.name} (ID: ${group._id})`);

        // Optional: Handle if admin leaves and group becomes empty
        if (group.adminEmail === userEmail && group.members.length === 0) {
            console.log(`Admin ${userEmail} left group ${group.name} and it is now empty. Deleting group.`);
            await Group.deleteOne({ _id: groupId }); // Delete empty group if admin leaves
            console.log(`Group ${group.name} (ID: ${groupId}) was empty after admin left and has been deleted.`);
        } else if (group.adminEmail === userEmail) {
             console.log(`Admin ${userEmail} left group ${group.name}. Group is not empty, remains without admin management.`);
             // You might want to reassign admin here in a real app
        }

        res.status(200).json({ message: `Successfully left group "${group.name}".` });
    } catch (error) {
        console.error('Error leaving group:', error);
         // Handle potential invalid ObjectId format error
        if (error.kind === 'ObjectId') {
             return res.status(400).json({ error: 'Invalid group ID format.' });
        }
        res.status(500).json({ error: 'An error occurred while leaving the group.' });
    }
});

// --- NEW: API Endpoint for Deleting a Group (Admin Only) ---
app.delete('/api/groups/:groupId/delete', async (req, res) => { // Marked async
    if (!req.session.user || !req.session.user.email) {
        return res.status(401).json({ success: false, message: 'User not authenticated' });
    }

    const userEmail = req.session.user.email;
    const { groupId } = req.params;
    
    try {
        // Find the group by its Mongoose _id
        const group = await Group.findById(groupId);

        if (!group) {
            return res.status(404).json({ success: false, message: 'Group not found' });
        }

        // Authorization: Only the group admin can delete the group
        if (group.adminEmail !== userEmail) {
            return res.status(403).json({ success: false, message: 'You are not authorized to delete this group.' });
        }

        const groupName = group.name;

        // Proceed with deletion from database
        await Group.deleteOne({ _id: groupId });
        // In a real app, you might also want to remove messages associated with this group
        // and update user documents to remove references to this group if any existed.

        // delete groupMessageHistories[groupId]; // Keep in-memory history independent for now
        // delete groupActiveUsers[groupId]; // Keep in-memory active users independent for now

        console.log(`Group "${groupName}" (ID: ${groupId}) deleted by admin ${userEmail}.`);

        // Optional: Notify connected clients that this group has been deleted
        // This allows clients to react, e.g., redirect if they were in that group's chat
        io.to(groupId).emit('group_deleted', { groupId: groupId, groupName: groupName, message: `Group "${groupName}" has been deleted by the admin.` });

        return res.status(200).json({ success: true, message: `Group "${groupName}" deleted successfully.` });

    } catch (error) {
        console.error('Error deleting group:', error);
         // Handle potential invalid ObjectId format error
        if (error.kind === 'ObjectId') {
             return res.status(400).json({ success: false, message: 'Invalid group ID format.' });
        }
        res.status(500).json({ success: false, message: 'An error occurred while deleting the group.' });
    }
});
// --- End NEW API Endpoints ---

// Make Express session accessible to Socket.IO
io.engine.use(sessionMiddleware);

// const privateChatRooms = {}; // This might need to be re-evaluated in context of groups

io.on('connection', async (socket) => { // Marked async for User lookup
  const session = socket.request.session;
  let userEmail = 'Anonymous'; // Keep email for unique ID
  let username = 'Anonymous';  // Add username for display
  let currentGroupId = null;

  if (session && session.user && session.user.email && session.user.username && session.currentGroup && session.currentGroup.id) {
    userEmail = session.user.email;
    username = session.user.username; // Get username from session
    currentGroupId = session.currentGroup.id;
    const currentGroupName = session.currentGroup.name;

    socket.join(currentGroupId);
    console.log(`User ${username} (Email: ${userEmail}) connected to group room: ${currentGroupId} (${currentGroupName})`);

    // Emit username along with email and group info
    socket.emit('user_identity', { email: userEmail, username: username, groupName: currentGroupName, groupId: currentGroupId });

    if (!groupActiveUsers[currentGroupId]) {
        groupActiveUsers[currentGroupId] = new Map(); // Change to Map: email -> username
    }
    if (!groupActiveUsers[currentGroupId].has(userEmail)) {
      groupActiveUsers[currentGroupId].set(userEmail, username);
      
      console.log('[SERVER] groupActiveUsers[currentGroupId] before Array.from:', groupActiveUsers[currentGroupId]);

      const userListArray = Array.from(groupActiveUsers[currentGroupId],
        ([email, uname]) => ({ email: email, username: uname }));
      io.to(currentGroupId).emit('update userlist', userListArray);
      console.log(`Active users in ${currentGroupId}:`, userListArray);
    }

    // Ensure group-specific message history array exists
    if (!groupMessageHistories[currentGroupId]) {
        groupMessageHistories[currentGroupId] = [];
    }
    socket.emit('load history', groupMessageHistories[currentGroupId]);
    console.log(`Sent message history for group ${currentGroupId} to ${userEmail}`);

  } else {
    console.log('Anonymous or no group context user connected to socket. Disconnecting.');
    socket.emit('auth_error', 'No valid group session. Please select a group.');
    socket.disconnect(true);
    return; // Stop further processing for this connection
  }

  // --- Handle Start Private Chat --- (Needs to be group-aware or re-evaluated)
  socket.on('start_private_chat', async (data) => {
    const initiatorEmail = userEmail;
    const initiatorUsername = username; 
    const targetEmail = data.targetUserEmail;

    if (initiatorEmail === 'Anonymous' || targetEmail === 'Anonymous') {
      socket.emit('private_chat_failed', { error: 'Login required for PM.' });
      return;
    }

    const targetUser = await User.findOne({ email: targetEmail });
    const targetUsernameForDisplay = targetUser ? targetUser.username : targetEmail;

    let targetSocketId = null;
    const socketsInGroup = io.sockets.adapter.rooms.get(currentGroupId);
    if (socketsInGroup) {
        for (const socketIdInRoom of socketsInGroup) {
            const s = io.sockets.sockets.get(socketIdInRoom);
            if (s && s.request.session && s.request.session.user && s.request.session.user.email === targetEmail) {
                targetSocketId = socketIdInRoom;
                break;
            }
        }
    }

    if (!targetSocketId) {
      socket.emit('private_chat_failed', { error: `${targetEmail} is not online in this group.` });
      return;
    }

    const roomName = [initiatorEmail, targetEmail].sort().join('_pm_in_group_') + `_${currentGroupId}`;
    socket.join(roomName);
    const targetSocketInstance = io.sockets.sockets.get(targetSocketId);
    if (targetSocketInstance) {
      targetSocketInstance.join(roomName);
      console.log(`${initiatorUsername} and ${targetUsernameForDisplay} joined PM room: ${roomName} within group ${currentGroupId}`);
      
      socket.emit('private_chat_initiated', { 
        email: targetEmail, 
        username: targetUsernameForDisplay, 
        roomName: roomName 
      });
      targetSocketInstance.emit('private_chat_initiated', { 
        email: initiatorEmail, 
        username: initiatorUsername, 
        roomName: roomName 
      });
    } else {
      socket.emit('private_chat_failed', { error: `Could not establish PM with ${targetEmail}.` });
    }
  });

  // --- Typing Indicator Logic (broadcast to current group room) ---
  socket.on('typing_start', () => {
    if (username !== 'Anonymous' && currentGroupId) {
      socket.to(currentGroupId).emit('user_typing', { user: username });
    }
  });

  socket.on('typing_stop', () => {
    if (username !== 'Anonymous' && currentGroupId) {
      socket.to(currentGroupId).emit('user_stopped_typing', { user: username });
    }
  });

  socket.on('chat message', (msg) => {
    if (username !== 'Anonymous' && currentGroupId) {
      const messageData = {
        user: username, 
        email: userEmail, 
        text: msg,
        timestamp: new Date(),
        groupId: currentGroupId
      };
      
      if (!groupMessageHistories[currentGroupId]) groupMessageHistories[currentGroupId] = [];
      groupMessageHistories[currentGroupId].push(messageData);
      if (groupMessageHistories[currentGroupId].length > MAX_HISTORY_LENGTH) {
        groupMessageHistories[currentGroupId].shift();
      }

      io.to(currentGroupId).emit('chat message', messageData);
      socket.to(currentGroupId).emit('user_stopped_typing', { user: username }); 
    } else {
      socket.emit('auth_error', 'Cannot send message without valid group session.');
    }
  });

  // --- Handle Sending Private Messages (broadcast to specific PM room) ---
  socket.on('send_private_message', (data) => {
    if (username === 'Anonymous' || !currentGroupId) { 
      socket.emit('auth_error', 'Cannot send PM without valid group session.');
      return;
    }
    if (!data.roomName || !data.text) return;

    const messageData = {
      user: username, 
      email: userEmail, 
      text: data.text,
      timestamp: Date.now(),
      roomName: data.roomName,
      groupId: currentGroupId
    };
    io.to(data.roomName).emit('receive_private_message', messageData);
  });

  socket.on('disconnect', () => {
    if (userEmail !== 'Anonymous' && currentGroupId && groupActiveUsers[currentGroupId] && groupActiveUsers[currentGroupId].has(userEmail)) {
      groupActiveUsers[currentGroupId].delete(userEmail);
      
      console.log('[SERVER] groupActiveUsers[currentGroupId] on disconnect before Array.from:', groupActiveUsers[currentGroupId]);

      const userListArray = Array.from(groupActiveUsers[currentGroupId],
        ([email, uname]) => ({ email: email, username: uname }));
      io.to(currentGroupId).emit('update userlist', userListArray);
      console.log(`${username} (Email: ${userEmail}) disconnected from group ${currentGroupId}. Active users:`, userListArray);
      socket.to(currentGroupId).emit('user_stopped_typing', { user: username });
    } else {
      // console.log('Anonymous or context-less user disconnected from socket.');
    }
  });
});

/*
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
*/

module.exports = server;