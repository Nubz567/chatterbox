const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const session = require('express-session');
const bcrypt = require('bcrypt');

// --- Global-like constants and in-memory stores ---
const MAX_HISTORY_LENGTH = 100;
// const messageHistory = []; // Will become group-specific
// const activeUsers = new Set(); // Will become group-specific

const groupMessageHistories = {}; // { groupId: [messages] }
const groupActiveUsers = {};    // { groupId: Set(userEmail) }

// --- NEW: In-memory store for Groups ---
const groups = {}; // Store groups, keyed by a unique group ID
                 // Example group: { id: 'uuid', name: 'Cool Group', adminEmail: 'user@example.com', joinCode: 'XYZ123', members: ['user@example.com'] }

// Helper function to generate unique IDs (simple version for now)
function generateUniqueId() {
    return Date.now().toString(36) + Math.random().toString(36).substring(2);
}
// --- End NEW ---

// --- IN-MEMORY USER STORE (FOR DEVELOPMENT ONLY) ---
// Replace with actual hashed passwords from your hash_password.js script
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

const app = express();
app.set('trust proxy', 1);

const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 3000;

// --- Session Configuration ---
const sessionMiddleware = session({
  secret: 'your secret key for chatterbox',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: process.env.NODE_ENV === 'production', // Use secure cookies in production (HTTPS)
    httpOnly: true, // Prevent client-side JS from accessing the cookie
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax' // Necessary for cross-site requests if API is on a different subdomain/domain. 'lax' is fine for same-site.
  }
});

app.use(sessionMiddleware);

// Middleware to parse URL-encoded data (for form submissions)
app.use(express.urlencoded({ extended: false }));
app.use(express.json()); // <-- ADDED: Middleware to parse JSON request bodies for API routes

// Serve static files from the "public" directory
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// Example of setting CSP headers
app.use((req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' data:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';"
  );
  next();
});

// Serve login.html as the main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Serve index.html (chat page) on the /chat route
app.get('/chat', (req, res) => {
  const { groupId, groupName } = req.query;

  if (!req.session.user || !req.session.user.email) {
    return res.redirect('/'); // Not logged in, redirect to login
  }

  if (!groupId) {
    console.log('Attempt to access /chat without groupId');
    return res.redirect('/groups?error=No+group+selected');
  }

  const group = groups[groupId]; // Get group from our in-memory store

  if (!group) {
    console.log(`Attempt to access non-existent group: ${groupId}`);
    return res.redirect('/groups?error=Group+not+found');
  }

  if (!group.members.includes(req.session.user.email)) {
    console.log(`User ${req.session.user.email} attempted to access group ${groupId} they are not a member of.`);
    return res.redirect('/groups?error=Not+a+member+of+this+group');
  }

  // User is logged in, groupId is valid, and user is a member. Store in session.
  req.session.currentGroup = { id: groupId, name: groupName || group.name }; // Use provided groupName or fallback to stored name
  console.log(`User ${req.session.user.email} entering chat for group: ${req.session.currentGroup.name} (ID: ${groupId})`);
  
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- NEW: Route for Groups Page ---
app.get('/groups', (req, res) => {
    if (req.session.user && req.session.user.email) {
        res.sendFile(path.join(__dirname, 'public', 'groups.html'));
    } else {
        res.redirect('/'); // If not logged in, redirect to login
    }
});
// --- End NEW ---

// --- NEW: Route for Change Password Page ---
app.get('/change-password', (req, res) => {
    console.log('Accessed /change-password GET route');
    if (req.session.user && req.session.user.email) {
        res.sendFile(path.join(__dirname, 'public', 'change-password.html'));
    } else {
        res.redirect('/'); // If not logged in, redirect to login
    }
});

// --- NEW: Route for Delete Account Confirmation Page ---
app.get('/delete-account', (req, res) => {
    console.log('Accessed /delete-account GET route'); // For debugging
    if (req.session.user && req.session.user.email) {
        res.sendFile(path.join(__dirname, 'public', 'delete-account.html'));
    } else {
        res.redirect('/'); // If not logged in, redirect to login
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

    const user = users.find(u => u.email === userEmail);
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
    // 1. Check if user is logged in
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

    const userIndex = users.findIndex(u => u.email === userEmail);
    // 3. Check if user exists in the array
    if (userIndex === -1) {
        // If this fails, it returns a 404 status
        return res.status(404).json({ success: false, message: 'User not found. Please log in again.' });
    }

    const user = users[userIndex];

    try {
        // 4. Compare the provided password with the stored hash
        const isMatch = await bcrypt.compare(password, user.hashedPassword);
        console.log(`Password match for ${userEmail}: ${isMatch}`);
        if (!isMatch) {
            // If passwords don't match, it returns a 400 status
            return res.status(400).json({ success: false, message: 'Incorrect password.' });
        }

        // If all above checks pass, it should reach here:
        users.splice(userIndex, 1);
        console.log(`Account deleted successfully for user: ${userEmail}`);
        console.log('Current users:', users.map(u => u.email));

        // --- NEW: Mark groups associated with the deleted user ---
        for (const groupId in groups) {
            if (groups.hasOwnProperty(groupId)) {
                const group = groups[groupId];
                const wasMember = group.members.includes(userEmail);
                const wasAdmin = group.adminEmail === userEmail;

                if (wasMember || wasAdmin) {
                    group.archivedDueToUserDeletion = true;
                    console.log(`Group "${group.name}" (ID: ${groupId}) marked as archived due to deletion of user ${userEmail}.`);
                    // If admin deleted, and no other members, group is effectively orphaned.
                    // If admin deleted, and other members exist, one could be promoted or group stays admin-less.
                    // For now, just marking as archived. Future logic could handle admin reassignment or auto-deletion if empty.
                }
                
                // Remove the deleted user from the members list specifically
                if (wasMember) {
                    const memberIndex = group.members.indexOf(userEmail);
                    if (memberIndex > -1) {
                        group.members.splice(memberIndex, 1);
                        console.log(`User ${userEmail} removed from members list of group "${group.name}" (ID: ${groupId}).`);
                    }
                }
                 // If the deleted user was the admin, and the group becomes empty,
                // it will remain archived. If other members exist, it's archived but admin-less.
                // The requirement is just to hide it until join code is used, so this is sufficient.
            }
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
app.post('/api/user/change-username', (req, res) => {
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
    const conflictingUser = users.find(u => u.username && u.username.toLowerCase() === newUsername.toLowerCase() && u.email !== userEmail);
    if (conflictingUser) {
        return res.status(400).json({ success: false, message: 'This username is already taken. Please choose another.' });
    }

    const userToUpdate = users.find(u => u.email === userEmail);
    if (!userToUpdate) {
        // This should ideally not happen if session is valid
        return res.status(404).json({ success: false, message: 'Current user not found in database.' });
    }

    const oldUsername = userToUpdate.username;
    userToUpdate.username = newUsername;
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
  console.log(`Login attempt for email: ${email}`); // Added log

  if (email && password) {
    const user = users.find(u => u.email === email);
    console.log('Found user in memory:', user ? {email: user.email, username: user.username} : null); // Added log

    if (user) {
      try {
        const passwordsMatch = await bcrypt.compare(password, user.hashedPassword);
        console.log(`Password comparison result for ${email}: ${passwordsMatch}`); // Added log

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
        // Optionally send an error response or redirect to an error page
        return res.redirect('/chat'); // Or wherever makes sense on error
      }
      console.log(`User ${userEmail} logged out.`);
      res.clearCookie('connect.sid'); // Optional: clear the session cookie
      res.redirect('/'); // Redirect to login page
    });
  } else {
    // If no session, just redirect to login
    res.redirect('/');
  }
});

// --- NEW: Registration Routes ---
app.get('/register', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'register.html'));
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
  if (users.find(user => user.email === email)) {
    console.log(`Registration failed: Email ${email} already exists (in current instance memory)`); // Added log
    return res.status(400).json({ success: false, message: 'Email already registered', field: 'email'});
    // return res.redirect('/register?error=email_exists');
  }
  if (users.find(user => user.username && user.username.toLowerCase() === username.toLowerCase())) {
    console.log(`Registration failed: Username ${username} already exists (in current instance memory)`); // Added log
    return res.status(400).json({ success: false, message: 'Username already taken', field: 'username'});
    // return res.redirect('/register?error=username_exists');
  }

  try {
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    // THIS PUSH IS TO THE IN-MEMORY ARRAY
    users.push({ email, username, hashedPassword });
    
    console.log(`New user registered (in current instance memory): ${email}, Username: ${username}`);
    console.log('Current users (in current instance memory):', users.map(u => ({email: u.email, username: u.username})));
    
    // res.redirect('/?success=registered');
    res.status(201).json({ success: true, message: 'Registration successful! Please log in.', redirectTo: '/'});

  } catch (error) {
    console.error("Error during registration hashing/storing:", error);
    // res.redirect('/register?error=registration_failed');
    res.status(500).json({ success: false, message: 'Error during registration process'});
  }
});

// --- NEW: API Endpoints for Groups ---

// Helper function to generate a simple join code
function generateJoinCode(length = 6) {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    // Ensure uniqueness (basic check for in-memory, would need db constraints in prod)
    if (Object.values(groups).some(g => g.joinCode === result)) {
        return generateJoinCode(length); // Recurse if not unique (rare for simple case)
    }
    return result;
}

app.post('/api/groups/create', (req, res) => {
    if (!req.session.user || !req.session.user.email) {
        return res.status(401).json({ error: 'User not authenticated' });
    }

    const { name } = req.body;
    if (!name || name.trim() === '') {
        return res.status(400).json({ error: 'Group name is required' });
    }

    const groupId = generateUniqueId();
    const adminEmail = req.session.user.email;
    const joinCode = generateJoinCode();

    const newGroup = {
        id: groupId,
        name: name.trim(),
        adminEmail: adminEmail,
        joinCode: joinCode,
        members: [adminEmail] // Creator is the first member
    };

    groups[groupId] = newGroup;
    console.log(`Group created: ${name} (ID: ${groupId}), Code: ${joinCode} by ${adminEmail}`);
    res.status(201).json(newGroup);
});

app.post('/api/groups/join', (req, res) => {
    if (!req.session.user || !req.session.user.email) {
        return res.status(401).json({ error: 'User not authenticated' });
    }

    const { joinCode } = req.body;
    if (!joinCode || joinCode.trim() === '') {
        return res.status(400).json({ error: 'Join code is required' });
    }

    const userEmail = req.session.user.email;
    const targetGroup = Object.values(groups).find(g => g.joinCode === joinCode.trim());

    if (!targetGroup) {
        return res.status(404).json({ error: 'Group not found with this join code' });
    }

    // --- NEW: If group was archived, unarchive it upon successful join via code ---
    if (targetGroup.archivedDueToUserDeletion) {
        delete targetGroup.archivedDueToUserDeletion;
        console.log(`Group "${targetGroup.name}" (ID: ${targetGroup.id}) was archived and is now restored by user ${userEmail} joining with code.`);
    }
    // --- End NEW ---

    if (targetGroup.members.includes(userEmail)) {
        return res.status(400).json({ error: 'User is already a member of this group', group: targetGroup });
    }

    targetGroup.members.push(userEmail);
    console.log(`User ${userEmail} joined group: ${targetGroup.name} (ID: ${targetGroup.id})`);
    res.status(200).json(targetGroup);
});

app.get('/api/user/groups', (req, res) => {
    if (!req.session.user || !req.session.user.email) {
        return res.status(401).json({ error: 'User not authenticated' });
    }
    const userEmail = req.session.user.email;
    const memberOfGroups = Object.values(groups).filter(group => {
        // User must be a member and the group must not be archived
        // unless the current user is a member (which implies they joined after it was archived, or it wasn't archived for them)
        return group.members.includes(userEmail) && !group.archivedDueToUserDeletion;
    });
    
    res.status(200).json(memberOfGroups);
});

app.get('/api/groups/:groupId/members', (req, res) => {
    if (!req.session.user || !req.session.user.email) {
        return res.status(401).json({ error: 'User not authenticated' });
    }

    const userEmail = req.session.user.email;
    const { groupId } = req.params;
    const group = groups[groupId];

    if (!group) {
        return res.status(404).json({ error: 'Group not found' });
    }

    if (!group.members.includes(userEmail)) {
        return res.status(403).json({ error: 'User is not a member of this group' });
    }

    // For privacy, you might only want to return emails or basic info, not full user objects if they existed
    res.status(200).json(group.members);
});

// --- NEW: API Endpoint for Leaving a Group ---
app.post('/api/groups/:groupId/leave', (req, res) => {
    if (!req.session.user || !req.session.user.email) {
        return res.status(401).json({ error: 'User not authenticated' });
    }

    const userEmail = req.session.user.email;
    const { groupId } = req.params;
    const group = groups[groupId];

    if (!group) {
        return res.status(404).json({ error: 'Group not found' });
    }

    const memberIndex = group.members.indexOf(userEmail);
    if (memberIndex === -1) {
        return res.status(400).json({ error: 'User is not a member of this group' });
    }

    group.members.splice(memberIndex, 1);
    console.log(`User ${userEmail} left group: ${group.name} (ID: ${groupId})`);

    // Optional: Handle if admin leaves
    // If the admin is the one leaving:
    if (group.adminEmail === userEmail) {
        console.log(`Admin ${userEmail} left group ${group.name}.`);
        // If there are other members, you might want to assign a new admin.
        // For now, the group will persist without an admin or with the admin still listed as admin but not a member.
        // If the group becomes empty, you might want to delete it.
        if (group.members.length === 0) {
            console.log(`Group ${group.name} is now empty after admin left. Consider deletion logic.`);
            // delete groups[groupId]; // Uncomment to delete empty group
            // console.log(`Group ${group.name} (ID: ${groupId}) was empty and has been deleted.`);
        }
    }

    const responseObject = { message: `Successfully left group "${group.name}".` };
    console.log('[Server INFO] Attempting to send JSON response for leave group:', JSON.stringify(responseObject));
    res.status(200).json(responseObject);
});

// --- NEW: API Endpoint for Deleting a Group (Admin Only) ---
app.delete('/api/groups/:groupId/delete', (req, res) => {
    if (!req.session.user || !req.session.user.email) {
        return res.status(401).json({ success: false, message: 'User not authenticated' });
    }

    const userEmail = req.session.user.email;
    const { groupId } = req.params;
    const group = groups[groupId];

    if (!group) {
        return res.status(404).json({ success: false, message: 'Group not found' });
    }

    // Authorization: Only the group admin can delete the group
    if (group.adminEmail !== userEmail) {
        return res.status(403).json({ success: false, message: 'You are not authorized to delete this group.' });
    }

    const groupName = group.name;

    // Proceed with deletion
    delete groups[groupId];
    delete groupMessageHistories[groupId];
    delete groupActiveUsers[groupId];

    console.log(`Group "${groupName}" (ID: ${groupId}) deleted by admin ${userEmail}.`);

    // Optional: Notify connected clients that this group has been deleted
    // This allows clients to react, e.g., redirect if they were in that group's chat
    io.to(groupId).emit('group_deleted', { groupId: groupId, groupName: groupName, message: `Group "${groupName}" has been deleted by the admin.` });
    // Note: Sockets in a room are automatically removed when the room is effectively gone,
    // but explicitly emitting helps clients clean up their UI or redirect.

    return res.status(200).json({ success: true, message: `Group "${groupName}" deleted successfully.` });
});
// --- End NEW API Endpoints ---

// Make Express session accessible to Socket.IO
io.engine.use(sessionMiddleware);

// const privateChatRooms = {}; // This might need to be re-evaluated in context of groups

io.on('connection', (socket) => {
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
  socket.on('start_private_chat', (data) => {
    const initiatorEmail = userEmail; 
    const initiatorUsername = username; 
    const targetEmail = data.targetUserEmail;

    if (initiatorEmail === 'Anonymous' || targetEmail === 'Anonymous') {
      socket.emit('private_chat_failed', { error: 'Login required for PM.' });
      return;
    }

    const targetUser = users.find(u => u.email === targetEmail);
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

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});