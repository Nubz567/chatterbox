let currentGroupId = null;
let currentUserEmail = null;
let currentUsername = null;
let lastMessageId = null;
let pollInterval = null;

window.addEventListener('load', () => {
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

    // Emoji list
    const EMOJI_LIST = [
        '😀', '😂', '😍', '🤔', '👍', '❤️', '🎉', '🔥', '😊', '😢', '😮', '👋',
        '💯', '🙏', '🌟', '💡', '🎈', '🍕', '🚀', '🚲', '💻', '📱', '💰', '👀',
        '⚙️', '🔒', '🔐', '🔓', '🔑', '🎤', '🎧', '🎵', '🎶', '🎹', '🎸', '🎺',
        '🎨', '🎥', '🎬', '🎭', '🎲', '🎯', '🎳', '🎰', '🎮', ''
    ];

    // Get group ID from URL
    const urlParams = new URLSearchParams(window.location.search);
    currentGroupId = urlParams.get('groupId');
    
    if (!currentGroupId) {
        console.error('No group ID found in URL');
        return;
    }

    console.log('Chat initialized for group:', currentGroupId);

    // Initialize emoji panel
    function initializeEmojiPanel() {
        if (emojiPanel) {
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
        }
    }

    // Update username display
    function updateUsernameDisplay() {
        if (usernameDisplay && currentUsername) {
            usernameDisplay.textContent = `Logged in as: ${currentUsername}`;
        }
    }

    // Fetch user info
    async function fetchUserInfo() {
        try {
            const response = await fetch('/api/user', { credentials: 'include' });
            if (response.ok) {
                const userData = await response.json();
                currentUserEmail = userData.email;
                currentUsername = userData.username;
                console.log('Current user:', userData);
                updateUsernameDisplay();
            }
        } catch (error) {
            console.error('Error fetching user info:', error);
        }
    }

    // Send message
    async function sendMessage(message) {
        try {
            const response = await fetch('/api/chat/send', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    message: message,
                    groupId: currentGroupId
                }),
                credentials: 'include'
            });

            if (response.ok) {
                const result = await response.json();
                console.log('Message sent:', result);
                return result.message;
            } else {
                console.error('Failed to send message');
            }
        } catch (error) {
            console.error('Error sending message:', error);
        }
    }

    // Fetch messages
    async function fetchMessages() {
        try {
            const response = await fetch(`/api/chat/messages/${currentGroupId}`, {
                credentials: 'include'
            });

            if (response.ok) {
                const data = await response.json();
                return data.messages || [];
            }
        } catch (error) {
            console.error('Error fetching messages:', error);
        }
        return [];
    }

    // Fetch users
    async function fetchUsers() {
        try {
            const response = await fetch(`/api/chat/users/${currentGroupId}`, {
                credentials: 'include'
            });

            if (response.ok) {
                const data = await response.json();
                return data.users || [];
            }
        } catch (error) {
            console.error('Error fetching users:', error);
        }
        return [];
    }

    // Display message
    function displayMessage(messageData) {
        if (!messagesList) {
            console.error('messagesList element not found');
            return;
        }

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
    }

    // Display user list
    function displayUsers(users) {
        if (!userList) {
            console.error('userList element not found');
            return;
        }

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
    }

    // Poll for new messages
    async function pollMessages() {
        const messages = await fetchMessages();
        
        if (messages.length > 0) {
            const lastMessage = messages[messages.length - 1];
            
            if (lastMessageId !== lastMessage.id) {
                // Clear messages if this is the first load
                if (lastMessageId === null) {
                    messagesList.innerHTML = '';
                    messages.forEach(displayMessage);
                } else {
                    // Only display new messages
                    const newMessages = messages.filter(msg => 
                        new Date(msg.timestamp) > new Date(lastMessageId)
                    );
                    newMessages.forEach(displayMessage);
                }
                
                lastMessageId = lastMessage.id;
            }
        }
    }

    // Poll for user updates
    async function pollUsers() {
        const users = await fetchUsers();
        displayUsers(users);
    }

    // Start polling
    function startPolling() {
        // Poll messages every 3 seconds (reduced frequency to be less buggy)
        pollInterval = setInterval(async () => {
            await pollMessages();
        }, 3000);

        // Poll users every 15 seconds (reduced frequency)
        setInterval(async () => {
            await pollUsers();
        }, 15000);
    }

    // Stop polling
    function stopPolling() {
        if (pollInterval) {
            clearInterval(pollInterval);
            pollInterval = null;
        }
    }

    // Handle message form submission
    if (messageForm && messageInput) {
        messageForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const message = messageInput.value.trim();
            if (!message) return;

            console.log('Sending message:', message);
            
            // Clear input immediately for better UX
            messageInput.value = '';
            
            // Send message
            const sentMessage = await sendMessage(message);
            if (sentMessage) {
                // Display the sent message immediately
                displayMessage(sentMessage);
            }
        });
    }

    // Handle emoji button
    if (emojiButton && emojiPanel) {
        emojiButton.addEventListener('click', () => {
            emojiPanel.classList.toggle('hidden');
        });
    }

    // Handle logout
    const logoutForm = document.querySelector('#logout-form');
    if (logoutForm) {
        logoutForm.addEventListener('submit', async (e) => {
            e.preventDefault();
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
                console.error('Logout failed:', error);
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
        await fetchUserInfo();
        initializeEmojiPanel();
        await pollMessages(); // Load initial messages
        await pollUsers(); // Load initial users
        startPolling();
    }

    // Start the chat
    initializeChat();

    // Cleanup on page unload
    window.addEventListener('beforeunload', () => {
        stopPolling();
    });
});
