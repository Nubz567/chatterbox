let currentGroupId = null;
let currentUserEmail = null;
let currentUsername = null;
let lastMessageId = null;
let pollInterval = null;
let messagePollInterval = null;
let userPollInterval = null;
let retryCount = 0;
const MAX_RETRIES = 3;

// Debug logging function
function debugLog(message, data = null) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}`;
    console.log(logMessage, data || '');
    
    // Also log to a visible debug area if it exists
    const debugArea = document.getElementById('debug-area');
    if (debugArea) {
        const debugEntry = document.createElement('div');
        debugEntry.style.cssText = 'font-size: 12px; color: #666; margin: 2px 0;';
        debugEntry.textContent = logMessage;
        debugArea.appendChild(debugEntry);
        debugArea.scrollTop = debugArea.scrollHeight;
    }
}

window.addEventListener('load', () => {
    debugLog('Chat page loaded, initializing...');
    
    const messagesList = document.getElementById('messages');
    const messageForm = document.getElementById('message-form');
    const messageInput = document.getElementById('message-input');
    const userList = document.getElementById('user-list');
    const typingIndicator = document.getElementById('typing-indicator');
    const groupChatArea = document.getElementById('group-chat-area');
    const pmChatWindowsContainer = document.getElementById('pm-chat-windows-container');
    const emojiButton = document.getElementById('emoji-button');
    const emojiPanel = document.getElementById('emoji-panel');
    const groupChatTitle = document.querySelector('#group-chat-area .chat-title-bar');
    const usernameDisplay = document.getElementById('username-display');
    const debugArea = document.getElementById('debug-area');
    const debugToggle = document.getElementById('debug-toggle');
    const userListLoading = document.getElementById('user-list-loading');

    // Check if all required elements exist
    const requiredElements = {
        messagesList,
        messageForm,
        messageInput,
        userList,
        emojiButton,
        emojiPanel,
        usernameDisplay,
        userListLoading
    };

    const missingElements = Object.entries(requiredElements)
        .filter(([name, element]) => !element)
        .map(([name]) => name);

    if (missingElements.length > 0) {
        debugLog(`ERROR: Missing required elements: ${missingElements.join(', ')}`);
        return;
    }

    debugLog('All required elements found');

    // Emoji list
    const EMOJI_LIST = [
        '😀', '😂', '😍', '🤔', '👍', '❤️', '🎉', '🔥', '😊', '😢', '😮', '👋',
        '💯', '🙏', '🌟', '💡', '🎈', '🍕', '🚀', '🚲', '💻', '📱', '💰', '👀',
        '⚙️', '🔒', '🔐', '🔓', '🔑', '🎤', '🎧', '🎵', '🎶', '🎹', '🎸', '🎺',
        '🎨', '🎥', '🎬', '🎭', '🎲', '🎯', '🎳', '🎰', '🎮'
    ];

    // Get group ID from URL
    const urlParams = new URLSearchParams(window.location.search);
    currentGroupId = urlParams.get('groupId');
    
    if (!currentGroupId) {
        debugLog('ERROR: No group ID found in URL');
        return;
    }

    debugLog(`Chat initialized for group: ${currentGroupId}`);

    // Initialize emoji panel
    function initializeEmojiPanel() {
        try {
            debugLog('Initializing emoji panel...');
            emojiPanel.innerHTML = '';
            EMOJI_LIST.forEach(emoji => {
                const emojiSpan = document.createElement('span');
                emojiSpan.textContent = emoji;
                emojiSpan.className = 'emoji';
                emojiSpan.style.cssText = 'cursor: pointer; padding: 5px; font-size: 20px;';
                emojiSpan.addEventListener('click', () => {
                    if (messageInput) {
                        messageInput.value += emoji;
                        messageInput.focus();
                    }
                    emojiPanel.classList.add('hidden');
                });
                emojiPanel.appendChild(emojiSpan);
            });
            debugLog(`Emoji panel initialized with ${EMOJI_LIST.length} emojis`);
        } catch (error) {
            debugLog(`ERROR initializing emoji panel: ${error.message}`);
        }
    }

    // Update username display
    function updateUsernameDisplay() {
        try {
            if (usernameDisplay && currentUsername) {
                usernameDisplay.textContent = `Logged in as: ${currentUsername}`;
                debugLog(`Username display updated: ${currentUsername}`);
            } else {
                debugLog(`WARNING: Cannot update username display - usernameDisplay: ${!!usernameDisplay}, currentUsername: ${currentUsername}`);
            }
        } catch (error) {
            debugLog(`ERROR updating username display: ${error.message}`);
        }
    }

    // Fetch user info with retry logic
    async function fetchUserInfo() {
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                debugLog(`Fetching user info (attempt ${attempt}/${MAX_RETRIES})...`);
                const response = await fetch('/api/user', { 
                    credentials: 'include',
                    headers: {
                        'Cache-Control': 'no-cache'
                    }
                });
                
                if (response.ok) {
                    const userData = await response.json();
                    currentUserEmail = userData.email;
                    currentUsername = userData.username;
                    debugLog('User info fetched successfully:', userData);
                    updateUsernameDisplay();
                    return userData;
                } else {
                    debugLog(`ERROR: Failed to fetch user info - Status: ${response.status}`);
                    if (attempt === MAX_RETRIES) {
                        debugLog('ERROR: Max retries reached for user info fetch');
                        return null;
                    }
                    await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
                }
            } catch (error) {
                debugLog(`ERROR fetching user info (attempt ${attempt}): ${error.message}`);
                if (attempt === MAX_RETRIES) {
                    debugLog('ERROR: Max retries reached for user info fetch');
                    return null;
                }
                await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
            }
        }
    }

    // Send message with retry logic
    async function sendMessage(message) {
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                debugLog(`Sending message (attempt ${attempt}/${MAX_RETRIES}): ${message.substring(0, 50)}...`);
                
                const response = await fetch('/api/chat/send', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Cache-Control': 'no-cache'
                    },
                    body: JSON.stringify({
                        message: message,
                        groupId: currentGroupId
                    }),
                    credentials: 'include'
                });

                if (response.ok) {
                    const result = await response.json();
                    debugLog('Message sent successfully:', result);
                    return result.message;
                } else {
                    debugLog(`ERROR: Failed to send message - Status: ${response.status}`);
                    if (attempt === MAX_RETRIES) {
                        debugLog('ERROR: Max retries reached for message send');
                        return null;
                    }
                    await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
                }
            } catch (error) {
                debugLog(`ERROR sending message (attempt ${attempt}): ${error.message}`);
                if (attempt === MAX_RETRIES) {
                    debugLog('ERROR: Max retries reached for message send');
                    return null;
                }
                await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
            }
        }
    }

    // Fetch messages with retry logic
    async function fetchMessages() {
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                debugLog(`Fetching messages (attempt ${attempt}/${MAX_RETRIES})...`);
                
                const response = await fetch(`/api/chat/messages/${currentGroupId}`, {
                    credentials: 'include',
                    headers: {
                        'Cache-Control': 'no-cache'
                    }
                });

                if (response.ok) {
                    const data = await response.json();
                    const messages = data.messages || [];
                    debugLog(`Messages fetched successfully: ${messages.length} messages`);
                    return messages;
                } else {
                    debugLog(`ERROR: Failed to fetch messages - Status: ${response.status}`);
                    if (attempt === MAX_RETRIES) {
                        debugLog('ERROR: Max retries reached for messages fetch');
                        return [];
                    }
                    await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
                }
            } catch (error) {
                debugLog(`ERROR fetching messages (attempt ${attempt}): ${error.message}`);
                if (attempt === MAX_RETRIES) {
                    debugLog('ERROR: Max retries reached for messages fetch');
                    return [];
                }
                await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
            }
        }
    }

    // Fetch users with retry logic and timeout
    async function fetchUsers() {
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                debugLog(`Fetching users (attempt ${attempt}/${MAX_RETRIES})...`);
                
                // Add timeout to prevent hanging requests
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
                
                const response = await fetch(`/api/chat/users/${currentGroupId}`, {
                    credentials: 'include',
                    headers: {
                        'Cache-Control': 'no-cache'
                    },
                    signal: controller.signal
                });

                clearTimeout(timeoutId);

                if (response.ok) {
                    const data = await response.json();
                    const users = data.users || [];
                    debugLog(`Users fetched successfully: ${users.length} users`);
                    return users;
                } else {
                    debugLog(`ERROR: Failed to fetch users - Status: ${response.status}`);
                    if (attempt === MAX_RETRIES) {
                        debugLog('ERROR: Max retries reached for users fetch');
                        return [];
                    }
                    await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
                }
            } catch (error) {
                debugLog(`ERROR fetching users (attempt ${attempt}): ${error.message}`);
                if (attempt === MAX_RETRIES) {
                    debugLog('ERROR: Max retries reached for users fetch');
                    return [];
                }
                await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
            }
        }
    }

    // Display message
    function displayMessage(messageData) {
        try {
            if (!messagesList) {
                debugLog('ERROR: messagesList element not found');
                return;
            }

            debugLog(`Displaying message: ${messageData.user}: ${messageData.text.substring(0, 30)}...`);

            const item = document.createElement('li');
            const date = new Date(messageData.timestamp);
            const hours = date.getHours().toString().padStart(2, '0');
            const minutes = date.getMinutes().toString().padStart(2, '0');
            const formattedTime = `[${hours}:${minutes}]`;

            const timeSpan = document.createElement('span');
            timeSpan.className = 'timestamp';
            timeSpan.textContent = `${formattedTime} `;
            item.appendChild(timeSpan);

            const messageContentSpan = document.createElement('span');
            messageContentSpan.innerHTML = `${escapeHTML(messageData.user)}: ${escapeHTML(messageData.text)}`;
            item.appendChild(messageContentSpan);

            if (currentUserEmail && messageData.email === currentUserEmail) {
                item.classList.add('my-message');
            } else {
                item.classList.add('other-message');
            }

            messagesList.appendChild(item);
            messagesList.scrollTop = messagesList.scrollHeight;
            debugLog('Message displayed successfully');
        } catch (error) {
            debugLog(`ERROR displaying message: ${error.message}`);
        }
    }

    // Display user list
    function displayUsers(users) {
        try {
            if (!userList || !userListLoading) {
                debugLog('ERROR: userList or userListLoading element not found');
                return;
            }

            debugLog(`Displaying ${users.length} users`);

            // Hide loading indicator and show user list
            userListLoading.style.display = 'none';
            userList.style.display = 'block';

            userList.innerHTML = '';
            
            // Add "Group Chat" header
            const groupChatItem = document.createElement('li');
            groupChatItem.className = 'group-chat-item';
            groupChatItem.innerHTML = '<strong>Group Chat</strong>';
            userList.appendChild(groupChatItem);

            // Add users
            users.forEach(user => {
                const userItem = document.createElement('li');
                userItem.className = 'user-item';
                userItem.innerHTML = `
                    <span class="user-name">${escapeHTML(user.username)}</span>
                    <span class="online-status ${user.online ? 'online' : 'offline'}">●</span>
                `;
                userList.appendChild(userItem);
            });
            
            debugLog('User list displayed successfully');
        } catch (error) {
            debugLog(`ERROR displaying users: ${error.message}`);
            // Show error state
            userListLoading.innerHTML = '<div style="text-align: center; padding: 20px; color: #e74c3c;">Failed to load users</div>';
        }
    }

    // Poll for new messages
    async function pollMessages() {
        try {
            const messages = await fetchMessages();
            
            if (messages.length > 0) {
                const lastMessage = messages[messages.length - 1];
                
                if (lastMessageId !== lastMessage.id) {
                    debugLog(`New messages detected. Last ID: ${lastMessageId}, Current ID: ${lastMessage.id}`);
                    
                    // Clear messages if this is the first load
                    if (lastMessageId === null) {
                        debugLog('First load - displaying all messages');
                        messagesList.innerHTML = '';
                        messages.forEach(displayMessage);
                    } else {
                        // Only display new messages
                        debugLog('Displaying new messages only');
                        const newMessages = messages.filter(msg => 
                            new Date(msg.timestamp) > new Date(lastMessageId)
                        );
                        newMessages.forEach(displayMessage);
                    }
                    
                    lastMessageId = lastMessage.id;
                } else {
                    debugLog('No new messages');
                }
            } else {
                debugLog('No messages found');
            }
        } catch (error) {
            debugLog(`ERROR in pollMessages: ${error.message}`);
        }
    }

    // Poll for user updates
    async function pollUsers() {
        try {
            const users = await fetchUsers();
            displayUsers(users);
        } catch (error) {
            debugLog(`ERROR in pollUsers: ${error.message}`);
        }
    }

    // Start polling with separate intervals
    function startPolling() {
        debugLog('Starting polling...');
        
        // Poll messages every 3 seconds (reduced frequency)
        messagePollInterval = setInterval(async () => {
            await pollMessages();
        }, 3000);

        // Poll users every 15 seconds (reduced frequency to reduce load)
        userPollInterval = setInterval(async () => {
            await pollUsers();
        }, 15000);
        
        debugLog('Polling started - Messages: 3s, Users: 15s');
    }

    // Stop polling
    function stopPolling() {
        debugLog('Stopping polling...');
        
        if (messagePollInterval) {
            clearInterval(messagePollInterval);
            messagePollInterval = null;
        }
        
        if (userPollInterval) {
            clearInterval(userPollInterval);
            userPollInterval = null;
        }
        
        debugLog('Polling stopped');
    }

    // Handle message form submission
    if (messageForm && messageInput) {
        messageForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const message = messageInput.value.trim();
            if (!message) {
                debugLog('Empty message - not sending');
                return;
            }

            debugLog(`Form submitted - sending message: ${message.substring(0, 50)}...`);
            
            // Clear input immediately for better UX
            messageInput.value = '';
            
            // Send message
            const sentMessage = await sendMessage(message);
            if (sentMessage) {
                debugLog('Message sent and received confirmation');
                // Display the sent message immediately
                displayMessage(sentMessage);
            } else {
                debugLog('ERROR: Failed to send message');
                // Restore the message to input for retry
                messageInput.value = message;
            }
        });
    }

    // Handle emoji button
    if (emojiButton && emojiPanel) {
        emojiButton.addEventListener('click', () => {
            debugLog('Emoji button clicked');
            emojiPanel.classList.toggle('hidden');
        });
    }

    // Handle debug toggle
    if (debugToggle && debugArea) {
        debugToggle.addEventListener('click', () => {
            const isVisible = debugArea.style.display !== 'none';
            debugArea.style.display = isVisible ? 'none' : 'block';
            debugToggle.textContent = isVisible ? 'Show Debug' : 'Hide Debug';
            debugLog(`Debug area ${isVisible ? 'hidden' : 'shown'}`);
        });
    }

    // Handle logout
    const logoutForm = document.querySelector('#logout-form');
    if (logoutForm) {
        logoutForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            debugLog('Logout form submitted');
            try {
                const response = await fetch('/logout', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                });
                const result = await response.json();
                if (result.redirectTo) {
                    window.location.href = result.redirectTo;
                }
            } catch (error) {
                debugLog(`ERROR during logout: ${error.message}`);
                window.location.href = '/';
            }
        });
    }

    // Utility functions
    function escapeHTML(str) {
        if (str === null || str === undefined) return '';
        const div = document.createElement('div');
        div.appendChild(document.createTextNode(str));
        return div.innerHTML;
    }

    // Initialize chat
    async function initializeChat() {
        debugLog('Initializing chat...');
        
        try {
            await fetchUserInfo();
            initializeEmojiPanel();
            await pollMessages(); // Load initial messages
            await pollUsers(); // Load initial users
            startPolling();
            
            debugLog('Chat initialization complete');
        } catch (error) {
            debugLog(`ERROR during chat initialization: ${error.message}`);
        }
    }

    // Start the chat
    initializeChat();

    // Cleanup on page unload
    window.addEventListener('beforeunload', () => {
        debugLog('Page unloading - cleaning up');
        stopPolling();
    });

    // Add error event listeners
    window.addEventListener('error', (event) => {
        debugLog(`Global error: ${event.error?.message || event.message}`);
    });

    window.addEventListener('unhandledrejection', (event) => {
        debugLog(`Unhandled promise rejection: ${event.reason}`);
    });
});
