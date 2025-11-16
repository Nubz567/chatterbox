let currentGroupId = null;
let currentUserEmail = null;
let currentUsername = null;
let currentGroupAdminEmail = null; // Store group admin email
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
    const userListLoading = document.getElementById('user-list-loading');
    const messagesLoading = document.getElementById('messages-loading');
    const imageUploadButton = document.getElementById('image-upload-button');
    const imageInput = document.getElementById('image-input');
    const imageModal = document.getElementById('image-modal');
    const modalImage = document.getElementById('modal-image');
    const modalClose = document.querySelector('.image-modal-close');
    const refreshMessagesButton = document.getElementById('refresh-messages');
    const refreshMessagesPersistent = document.getElementById('refresh-messages-persistent');
    const groupNameElement = document.getElementById('group-name');

    // Check if all required elements exist
    const requiredElements = {
        messagesList,
        messageForm,
        messageInput,
        userList,
        emojiButton,
        emojiPanel,
        usernameDisplay,
        userListLoading,
        messagesLoading,
        imageUploadButton,
        imageInput,
        imageModal,
        modalImage,
        modalClose,
        refreshMessagesButton,
        refreshMessagesPersistent,
        groupNameElement
    };

    const missingElements = Object.entries(requiredElements)
        .filter(([name, element]) => !element)
        .map(([name]) => name);

    if (missingElements.length > 0) {
        debugLog(`ERROR: Missing required elements: ${missingElements.join(', ')}`);
        return;
    }

    debugLog('All required elements found');
    debugLog(`Image upload button found: ${!!imageUploadButton}`);
    debugLog(`Image input found: ${!!imageInput}`);
    

    // Emoji list
    const EMOJI_LIST = [
        '😀', '😂', '😍', '🤔', '😊', '😢', '😮', '😎', '🤩', '🥳', '😴', '🤯', '🥺',
        '😤', '🤪', '😇', '🤠', '💯', '⚙️', '🌟', '💡', '🎈', '🍕', '❤️', '🎉', '🎰',
        '🎧', '🎵', '🎶', '🎹', '🎸', '🎺', '🎨', '🎥', '🎬', '🎭', '🎲', '🎯', '🎳', 
        '🎮', '👀', '👍', '🙏', '👆', '👇', '👈', '👉', '👌', '👍', '👎', '👏', '👐',
        '👋'

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
                    // Keep the emoji panel open until the user explicitly closes it
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

    // Fetch and update group name
    async function updateGroupName() {
        try {
            if (!currentGroupId) {
                debugLog('ERROR: No group ID available for fetching group name');
                return;
            }

            debugLog(`Fetching group information for ID: ${currentGroupId}`);
            const response = await fetch(`/api/groups/${currentGroupId}`, {
                credentials: 'include',
                headers: {
                    'Cache-Control': 'no-cache'
                }
            });

            if (response.ok) {
                const groupData = await response.json();
                if (groupData && groupData.name) {
                    if (groupNameElement) {
                        groupNameElement.textContent = groupData.name;
                        debugLog(`Group name updated: ${groupData.name}`);
                    }
                } else {
                    debugLog('ERROR: Group data or name not found in response');
                    if (groupNameElement) {
                        groupNameElement.textContent = 'Unknown Group';
                    }
                }
            } else {
                debugLog(`ERROR: Failed to fetch group info - Status: ${response.status}`);
                if (groupNameElement) {
                    groupNameElement.textContent = 'Group Chat';
                }
            }
        } catch (error) {
            debugLog(`ERROR fetching group name: ${error.message}`);
            if (groupNameElement) {
                groupNameElement.textContent = 'Group Chat';
            }
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
                    await new Promise(resolve => setTimeout(resolve, 500 * attempt));
                }
            } catch (error) {
                debugLog(`ERROR fetching user info (attempt ${attempt}): ${error.message}`);
                if (attempt === MAX_RETRIES) {
                    debugLog('ERROR: Max retries reached for user info fetch');
                    return null;
                }
                await new Promise(resolve => setTimeout(resolve, 500 * attempt));
            }
        }
    }

    // Send message with retry logic
    async function sendMessage(message, imageData = null) {
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                const messageType = imageData ? 'image' : 'text';
                const logMessage = imageData ? 
                    `Sending image message (attempt ${attempt}/${MAX_RETRIES}): ${imageData.imageName}` :
                    `Sending message (attempt ${attempt}/${MAX_RETRIES}): ${message ? message.substring(0, 50) : '(empty)'}...`;
                
                debugLog(logMessage);
                
                const requestBody = {
                    groupId: currentGroupId
                };

                if (imageData) {
                    // Check if image data is too large for JSON request
                    const imageDataSize = imageData.imageData.length;
                    if (imageDataSize > 10 * 1024 * 1024) { // 10MB limit for JSON
                        debugLog(`ERROR: Image data too large for JSON request: ${Math.round(imageDataSize / 1024 / 1024)}MB`);
                        throw new Error('Image is too large. Please try a smaller image.');
                    }
                    
                    // Send image message
                    Object.assign(requestBody, {
                        messageType: 'image',
                        imageData: imageData.imageData,
                        imageName: imageData.imageName,
                        imageSize: imageData.imageSize
                    });
        } else {
                    // Send text message
                    Object.assign(requestBody, {
                        message: message || '',
                        messageType: 'text'
                    });
                }
                
                // Log request body without the actual data to avoid console issues with large files
                const logBody = { ...requestBody };
                if (logBody.imageData) {
                    logBody.imageData = `[Image Data: ${Math.round(logBody.imageData.length / 1024)}KB]`;
                }
                console.log('Sending request body:', logBody);
                
                let requestBodyString;
                try {
                    requestBodyString = JSON.stringify(requestBody);
                    debugLog(`Request body stringified successfully. Size: ${Math.round(requestBodyString.length / 1024 / 1024)}MB`);
                } catch (stringifyError) {
                    debugLog(`ERROR: Failed to stringify request body: ${stringifyError.message}`);
                    throw new Error('Failed to prepare video for sending. The video might be too large.');
                }
                
                debugLog(`Making fetch request to /api/chat/send (attempt ${attempt})...`);
                debugLog(`Request body size: ${Math.round(requestBodyString.length / 1024 / 1024)}MB`);
                
                let response;
                try {
                    response = await fetch('/api/chat/send', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Cache-Control': 'no-cache'
                        },
                        body: requestBodyString,
                        credentials: 'include'
                    });
                } catch (fetchError) {
                    debugLog(`ERROR: Fetch request failed: ${fetchError.message}`);
                    debugLog(`Error stack: ${fetchError.stack}`);
                    throw new Error(`Network error: ${fetchError.message}`);
                }

                debugLog(`Response received - Status: ${response.status}, OK: ${response.ok}`);
                
                if (response.ok) {
                    try {
                        const result = await response.json();
                        debugLog('Message sent successfully:', result);
                        if (result.message) {
                            return result.message;
                        } else {
                            debugLog('ERROR: Response missing message field:', result);
                            throw new Error('Server response missing message data');
                        }
                    } catch (parseError) {
                        debugLog(`ERROR: Failed to parse response JSON: ${parseError.message}`);
                        throw new Error('Failed to parse server response');
                    }
                } else {
                    let errorText = '';
                    let errorData = null;
                    try {
                        errorText = await response.text();
                        try {
                            errorData = JSON.parse(errorText);
                        } catch (e) {
                            // Not JSON, use as text
                        }
                        debugLog(`ERROR: Failed to send message - Status: ${response.status}, Response: ${errorText}`);
                    } catch (textError) {
                        debugLog(`ERROR: Failed to read error response text: ${textError.message}`);
                        errorText = `HTTP ${response.status} Error`;
                    }
                    
                    // Check if user is banned
                    if (errorData && errorData.banned) {
                        debugLog('User is banned from this group');
                        alert(errorData.error || 'You have been banned from this group');
                        throw new Error('Banned from group');
                    }
                    
                    if (attempt === MAX_RETRIES) {
                        debugLog('ERROR: Max retries reached for message send');
                        throw new Error(errorData?.error || errorText || `Failed to send: HTTP ${response.status}`);
                    }
                    await new Promise(resolve => setTimeout(resolve, 500 * attempt));
                }
            } catch (error) {
                debugLog(`ERROR sending message (attempt ${attempt}): ${error.message}`);
                debugLog(`Error stack: ${error.stack}`);
                if (attempt === MAX_RETRIES) {
                    debugLog('ERROR: Max retries reached for message send');
                    throw error; // Re-throw to be caught by caller
                }
                await new Promise(resolve => setTimeout(resolve, 500 * attempt));
            }
        }
    }

    // Fetch messages with retry logic
    async function fetchMessages() {
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                debugLog(`Fetching messages (attempt ${attempt}/${MAX_RETRIES})...`);
                
                // Add timeout to prevent hanging requests
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 3000); // 3 second timeout
                
                const response = await fetch(`/api/chat/messages/${currentGroupId}`, {
                    credentials: 'include',
                    headers: {
                        'Cache-Control': 'no-cache'
                    },
                    signal: controller.signal
                });

                clearTimeout(timeoutId);

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
                    await new Promise(resolve => setTimeout(resolve, 500 * attempt));
                }
            } catch (error) {
                debugLog(`ERROR fetching messages (attempt ${attempt}): ${error.message}`);
                if (attempt === MAX_RETRIES) {
                    debugLog('ERROR: Max retries reached for messages fetch');
                    return [];
                }
                await new Promise(resolve => setTimeout(resolve, 500 * attempt));
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
                const timeoutId = setTimeout(() => controller.abort(), 3000); // 3 second timeout
                
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
                    if (data.adminEmail) {
                        currentGroupAdminEmail = data.adminEmail;
                        debugLog(`Group admin email: ${currentGroupAdminEmail}`);
                    }
                    debugLog(`Users fetched successfully: ${users.length} users`);
                    return users;
                } else {
                    debugLog(`ERROR: Failed to fetch users - Status: ${response.status}`);
                    if (attempt === MAX_RETRIES) {
                        debugLog('ERROR: Max retries reached for users fetch');
                        return [];
                    }
                    await new Promise(resolve => setTimeout(resolve, 500 * attempt));
                }
            } catch (error) {
                debugLog(`ERROR fetching users (attempt ${attempt}): ${error.message}`);
                if (attempt === MAX_RETRIES) {
                    debugLog('ERROR: Max retries reached for users fetch');
                    return [];
                }
                await new Promise(resolve => setTimeout(resolve, 500 * attempt));
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
        
        // Handle different message types
        if (messageData.messageType === 'image' && messageData.imageData) {
            // Display image message
            messageContentSpan.innerHTML = `${escapeHTML(messageData.user)}: `;
            
            const imageElement = document.createElement('img');
            imageElement.src = messageData.imageData;
            imageElement.alt = messageData.imageName || 'Image';
            imageElement.className = 'message-image';
            imageElement.title = messageData.imageName || 'Click to view full size';
            
            // Add click handler for full-size view
            imageElement.addEventListener('click', () => {
                showImageModal(messageData.imageData, messageData.imageName);
            });
            
            messageContentSpan.appendChild(imageElement);
            
            // Add image name below
            if (messageData.imageName) {
                const imageNameSpan = document.createElement('div');
                imageNameSpan.style.cssText = 'font-size: 12px; color: #666; margin-top: 5px;';
                imageNameSpan.textContent = messageData.imageName;
                messageContentSpan.appendChild(imageNameSpan);
            }
        } else {
            // Display text message
            messageContentSpan.innerHTML = `${escapeHTML(messageData.user)}: ${escapeHTML(messageData.text)}`;
        }
        
        item.appendChild(messageContentSpan);

            if (currentUserEmail && messageData.email === currentUserEmail) {
            item.classList.add('my-message');
        } else {
            item.classList.add('other-message');
        }
        
        item.setAttribute('data-message-id', messageData.id);
        item.setAttribute('data-message-timestamp', messageData.timestamp);
        item.setAttribute('data-message-email', messageData.email);
        
        // Add right-click context menu for user's own messages
        if (currentUserEmail && messageData.email === currentUserEmail) {
            item.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                showMessageContextMenu(e, item, messageData);
            });
        }
        
        messagesList.appendChild(item);
        messagesList.scrollTop = messagesList.scrollHeight;
            debugLog('Message displayed successfully');
        } catch (error) {
            debugLog(`ERROR displaying message: ${error.message}`);
        }
    }

    // Show image modal for full-size view
    function showImageModal(imageSrc, imageName) {
        if (modalImage && imageModal) {
            modalImage.src = imageSrc;
            modalImage.alt = imageName || 'Full size image';
            imageModal.style.display = 'block';
        }
    }

    // Close image modal
    function closeImageModal() {
        if (imageModal) {
            imageModal.style.display = 'none';
        }
    }

    // Handle image upload with optional compression
    function handleImageUpload(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            
            reader.onload = function(e) {
                const base64Data = e.target.result;
                const imageSize = file.size;
                const imageName = file.name;
                
                // Validate file size (5MB limit)
                if (imageSize > 5 * 1024 * 1024) {
                    reject(new Error('Image size must be less than 5MB'));
            return;
        }
    
                // Validate file type
                if (!file.type.startsWith('image/')) {
                    reject(new Error('Please select a valid image file'));
                    return;
                }
                
                // Always compress images to reduce size and prevent 500 errors
                compressImage(base64Data, imageName)
                    .then(compressedData => {
                        debugLog(`Image processed: ${imageName} - Original: ${Math.round(imageSize / 1024)}KB, Compressed: ${Math.round(compressedData.imageSize / 1024)}KB`);
                        resolve(compressedData);
                    })
                    .catch(error => {
                        debugLog(`Compression failed, using original: ${error.message}`);
                        // If compression fails, still try to send the original
                        resolve({
                            imageData: base64Data,
                            imageName: imageName,
                            imageSize: imageSize
                        });
                    });
            };
            
            reader.onerror = function() {
                reject(new Error('Failed to read image file'));
            };
            
            reader.readAsDataURL(file);
        });
    }

    // Compress image to reduce file size
    function compressImage(base64Data, imageName) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = function() {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                
                // Calculate new dimensions (max 600px width/height for better compression)
                let { width, height } = img;
                const maxSize = 600;
                
                if (width > height) {
                    if (width > maxSize) {
                        height = (height * maxSize) / width;
                        width = maxSize;
                    }
        } else {
                    if (height > maxSize) {
                        width = (width * maxSize) / height;
                        height = maxSize;
                    }
                }
                
                canvas.width = width;
                canvas.height = height;
                
                // Draw and compress
                ctx.drawImage(img, 0, 0, width, height);
                
                // Convert to base64 with lower quality for smaller size
                const compressedBase64 = canvas.toDataURL('image/jpeg', 0.7);
                
                // Calculate new size
                const compressedSize = Math.ceil((compressedBase64.length * 3) / 4);
                
                debugLog(`Image compressed: ${imageName} - Original: ${Math.round(base64Data.length / 1024)}KB, Compressed: ${Math.round(compressedSize / 1024)}KB`);
                
                resolve({
                    imageData: compressedBase64,
                    imageName: imageName,
                    imageSize: compressedSize
                });
            };
            
            img.onerror = function() {
                reject(new Error('Failed to load image for compression'));
            };
            
            img.src = base64Data;
        });
    }

    // Display user list
    async function displayUsers(users) {
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
            for (const user of users) {
                const userItem = document.createElement('li');
                userItem.className = 'user-item';
                userItem.setAttribute('data-user-email', user.email);
                
                const userContent = document.createElement('div');
                userContent.style.cssText = 'display: flex; align-items: center; justify-content: space-between; width: 100%;';
                
                const userInfo = document.createElement('div');
                userInfo.style.cssText = 'display: flex; align-items: center; gap: 8px; flex: 1;';
                
                // Check if user is banned
                let isBanned = false;
                let banInfo = null;
                if (currentUserEmail === currentGroupAdminEmail && user.email !== currentUserEmail) {
                    try {
                        const banResponse = await fetch(`/api/groups/banned/${currentGroupId}/${user.email}`, {
                            credentials: 'include'
                        });
                        if (banResponse.ok) {
                            const banData = await banResponse.json();
                            if (banData.banned) {
                                isBanned = true;
                                banInfo = banData;
                            }
                        }
                    } catch (error) {
                        debugLog(`Error checking ban status for ${user.email}: ${error.message}`);
                    }
                }
                
                // Add banned indicator to username if banned
                const usernameText = isBanned 
                    ? `${escapeHTML(user.username)} <span style="color: #e74c3c; font-size: 10px;">(Banned)</span>`
                    : escapeHTML(user.username);
                
                userInfo.innerHTML = `
                    <span class="user-name">${usernameText}</span>
                    <span class="online-status ${user.online ? 'online' : 'offline'}">●</span>
                `;
                userContent.appendChild(userInfo);
                
                // Add ban/unban button if current user is admin and this is not the admin themselves
                if (currentUserEmail === currentGroupAdminEmail && user.email !== currentUserEmail) {
                    if (isBanned) {
                        // Show unban button
                        const unbanButton = document.createElement('button');
                        unbanButton.className = 'unban-user-button';
                        unbanButton.textContent = '✅';
                        unbanButton.title = banInfo && banInfo.banType === 'temporary' && banInfo.expiresAt
                            ? `Unban User (Expires: ${new Date(banInfo.expiresAt).toLocaleString()})`
                            : 'Unban User';
                        unbanButton.style.cssText = 'background: #27ae60; color: white; border: none; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 12px; margin-left: 8px;';
                        unbanButton.addEventListener('click', async () => {
                            if (confirm(`Are you sure you want to unban ${user.username}?`)) {
                                try {
                                    const response = await fetch('/api/groups/unban', {
                                        method: 'POST',
                                        headers: {
                                            'Content-Type': 'application/json'
                                        },
                                        credentials: 'include',
                                        body: JSON.stringify({
                                            groupId: currentGroupId,
                                            userEmail: user.email
                                        })
                                    });
                                    
                                    const result = await response.json();
                                    
                                    if (response.ok && result.success) {
                                        alert(`User ${user.username} has been unbanned successfully.`);
                                        // Refresh user list
                                        await pollUsers();
                                    } else {
                                        alert(result.error || 'Failed to unban user');
                                    }
                                } catch (error) {
                                    debugLog(`ERROR unbanning user: ${error.message}`);
                                    alert(`Error unbanning user: ${error.message}`);
                                }
                            }
                        });
                        userContent.appendChild(unbanButton);
                    } else {
                        // Show ban button
                        const banButton = document.createElement('button');
                        banButton.className = 'ban-user-button';
                        banButton.textContent = '🚫';
                        banButton.title = 'Ban User';
                        banButton.style.cssText = 'background: #e74c3c; color: white; border: none; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 12px; margin-left: 8px;';
                        banButton.addEventListener('click', () => {
                            showBanModal(user.email, user.username);
                        });
                        userContent.appendChild(banButton);
                    }
                }
                
                userItem.appendChild(userContent);
                userList.appendChild(userItem);
            }
            
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
                
                // First load - display all messages
                if (lastMessageId === null) {
                    debugLog('First load - displaying all messages');
                    // Hide loading indicator and show messages
                    if (messagesLoading) messagesLoading.style.display = 'none';
                    if (messagesList) messagesList.style.display = 'block';
                    
                    messagesList.innerHTML = '';
                    messages.forEach(displayMessage);
                    lastMessageId = lastMessage.id;
                    debugLog(`First load complete. Last message ID: ${lastMessageId}`);
                } else {
                    // Check for new messages by comparing IDs
                    const currentMessageIds = messages.map(msg => msg.id);
                    const lastMessageIndex = currentMessageIds.indexOf(lastMessageId);
                    
                    if (lastMessageIndex === -1) {
                        // Last message not found, might be a new session - reload all
                        debugLog('Last message not found, reloading all messages');
                        messagesList.innerHTML = '';
                        
                        // Load messages one at a time
                        for (let i = 0; i < messages.length; i++) {
                            displayMessage(messages[i]);
                            
                            // Small delay between messages for smooth loading
                            if (i < messages.length - 1) {
                                await new Promise(resolve => setTimeout(resolve, 30));
                            }
                        }
                        
                        lastMessageId = lastMessage.id;
                    } else if (lastMessageIndex < messages.length - 1) {
                        // New messages found
                        const newMessages = messages.slice(lastMessageIndex + 1);
                        debugLog(`Found ${newMessages.length} new messages`);
                        
                        // Load new messages one at a time
                        for (let i = 0; i < newMessages.length; i++) {
                            displayMessage(newMessages[i]);
                            
                            // Small delay between messages for smooth loading
                            if (i < newMessages.length - 1) {
                                await new Promise(resolve => setTimeout(resolve, 30));
                            }
                        }
                        
                        lastMessageId = lastMessage.id;
        } else {
                        debugLog('No new messages');
                    }
                }
                    } else {
                debugLog('No messages found');
                // Hide loading indicator even if no messages
                if (lastMessageId === null && messagesLoading) {
                    messagesLoading.style.display = 'none';
                    if (messagesList) messagesList.style.display = 'block';
                }
            }
        } catch (error) {
            debugLog(`ERROR in pollMessages: ${error.message}`);
            // Hide loading indicator on error
            if (lastMessageId === null && messagesLoading) {
                messagesLoading.style.display = 'none';
                if (messagesList) messagesList.style.display = 'block';
                
                // Show error state with refresh option
                if (messagesList) {
                    messagesList.innerHTML = `
                        <div style="text-align: center; padding: 40px 20px; color: #e74c3c;">
                            <div style="margin-bottom: 15px; font-weight: bold;">Failed to load messages</div>
                            <div style="margin-bottom: 20px; font-size: 14px;">Please try refreshing or check your connection.</div>
                            <button onclick="location.reload()" style="padding: 8px 16px; background: #3498db; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 12px;">🔄 Reload Page</button>
                        </div>
                    `;
                }
            }
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
        
        // Poll messages every 1 second for faster updates
        messagePollInterval = setInterval(async () => {
            try {
                await pollMessages();
            } catch (error) {
                debugLog(`Error in message polling: ${error.message}`);
            }
        }, 1000);

        // Poll users every 15 seconds (less frequent)
        userPollInterval = setInterval(async () => {
            try {
                await pollUsers();
            } catch (error) {
                debugLog(`Error in user polling: ${error.message}`);
            }
        }, 15000);
        
        debugLog('Polling started - Messages: 1s, Users: 15s');
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
                // Display immediately for instant feedback
                displayMessage(sentMessage);
                // Update lastMessageId to prevent duplicate from polling
                lastMessageId = sentMessage.id;
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

    // Handle image upload button
    if (imageUploadButton && imageInput) {
        debugLog('Setting up image upload button event listener');
        imageUploadButton.addEventListener('click', (e) => {
            e.preventDefault();
            debugLog('Image upload button clicked');
            debugLog('Triggering file input click');
            try {
                imageInput.click();
                debugLog('File input click triggered successfully');
            } catch (error) {
                debugLog(`ERROR triggering file input: ${error.message}`);
            }
        });
        debugLog('Image upload button event listener set up successfully');
        } else {
        debugLog('ERROR: Image upload button or input not found');
        debugLog(`imageUploadButton: ${!!imageUploadButton}, imageInput: ${!!imageInput}`);
        if (imageUploadButton) {
            debugLog('Image upload button element:', imageUploadButton);
        }
        if (imageInput) {
            debugLog('Image input element:', imageInput);
        }
    }

    if (imageInput) {
        imageInput.addEventListener('change', async (e) => {
            debugLog('Image input change event triggered');
            const file = e.target.files[0];
            if (!file) {
                debugLog('No file selected');
                return;
            }
            debugLog(`File selected: ${file.name}, size: ${file.size}, type: ${file.type}`);

            try {
                
                // Show loading state
                const originalText = imageUploadButton.textContent;
                imageUploadButton.textContent = '⏳';
                imageUploadButton.disabled = true;

                // Process image
                const imageData = await handleImageUpload(file);
                
                // Send image message
                const sentMessage = await sendMessage(null, imageData);
                if (sentMessage) {
                    debugLog('Image sent successfully');
                    // Display immediately for instant feedback
                    displayMessage(sentMessage);
                    // Update lastMessageId to prevent duplicate from polling
                    lastMessageId = sentMessage.id;
                } else {
                    debugLog('ERROR: Failed to send image');
                    alert('Failed to send image. Please try again.');
                }

                // Reset button state
                imageUploadButton.textContent = originalText;
                imageUploadButton.disabled = false;
                
                // Clear file input
                imageInput.value = '';
                
            } catch (error) {
                debugLog(`ERROR uploading image: ${error.message}`);
                alert(`Error uploading image: ${error.message}`);
                
                // Reset button state
                imageUploadButton.textContent = originalText;
                imageUploadButton.disabled = false;
                imageInput.value = '';
            }
        });
    }

    // Handle image modal
    if (modalClose) {
        modalClose.addEventListener('click', closeImageModal);
    }

    // Close modal when clicking outside
    if (imageModal) {
        imageModal.addEventListener('click', (e) => {
            if (e.target === imageModal) {
                closeImageModal();
            }
        });
    }

    // Close modal with Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && imageModal && imageModal.style.display === 'block') {
            closeImageModal();
        }
        
        // Refresh messages with F5 or Ctrl+R
        if (e.key === 'F5' || (e.ctrlKey && e.key === 'r')) {
            e.preventDefault(); // Prevent default browser refresh
            if (refreshMessagesPersistent) {
                refreshMessagesPersistent.click();
            }
        }
    });

    // Add drag and drop support for images
    if (messageForm) {
        messageForm.addEventListener('dragover', (e) => {
            e.preventDefault();
            messageForm.classList.add('drag-over');
        });

        messageForm.addEventListener('dragleave', (e) => {
            e.preventDefault();
            messageForm.classList.remove('drag-over');
        });

        messageForm.addEventListener('drop', async (e) => {
            e.preventDefault();
            messageForm.classList.remove('drag-over');

            const files = Array.from(e.dataTransfer.files);
            const imageFiles = files.filter(file => file.type.startsWith('image/'));

            if (imageFiles.length === 0) {
                alert('Please drop image files only.');
                return;
            }

            // Handle first image file
            const file = imageFiles[0];
            try {
                debugLog(`Image dropped: ${file.name} (${file.size} bytes)`);
                
                // Show loading state
                const originalText = imageUploadButton.textContent;
                imageUploadButton.textContent = '⏳';
                imageUploadButton.disabled = true;

                // Process image
                const imageData = await handleImageUpload(file);
                
                // Send image message
                const sentMessage = await sendMessage(null, imageData);
                if (sentMessage) {
                    debugLog('Dropped image sent successfully');
                    // Display immediately for instant feedback
                    displayMessage(sentMessage);
                    // Update lastMessageId to prevent duplicate from polling
                    lastMessageId = sentMessage.id;
        } else {
                    debugLog('ERROR: Failed to send dropped image');
                    alert('Failed to send image. Please try again.');
                }

                // Reset button state
                imageUploadButton.textContent = originalText;
                imageUploadButton.disabled = false;
                
            } catch (error) {
                debugLog(`ERROR uploading dropped image: ${error.message}`);
                alert(`Error uploading image: ${error.message}`);
                
                // Reset button state
                imageUploadButton.textContent = originalText;
                imageUploadButton.disabled = false;
            }
        });
    }

    // Handle back to groups button
    const backToGroupsButton = document.getElementById('back-to-groups');
    if (backToGroupsButton) {
        backToGroupsButton.addEventListener('click', () => {
            debugLog('Back to groups button clicked');
            window.location.href = '/groups';
        });
    }

    // Handle refresh messages button
    if (refreshMessagesButton) {
        refreshMessagesButton.addEventListener('click', async () => {
            debugLog('Refresh messages button clicked');
            try {
                // Show loading state
                refreshMessagesButton.textContent = '⏳ Loading...';
                refreshMessagesButton.disabled = true;
                
                // Temporarily stop polling to prevent interference
                stopPolling();
                
                // Reset last message ID to force reload
                lastMessageId = null;
                
                // Fetch messages directly
                const messages = await fetchMessages();
                
                if (messages.length > 0) {
                    // Clear messages list
                    messagesList.innerHTML = '';
                    
                    // Load messages one at a time for better performance
                    for (let i = 0; i < messages.length; i++) {
                        displayMessage(messages[i]);
                        
                        // Small delay between messages for smooth loading
                        if (i < messages.length - 1) {
                            await new Promise(resolve => setTimeout(resolve, 50));
                        }
                    }
                    
                    lastMessageId = messages[messages.length - 1].id;
                    
                    // Hide loading and show messages
                    if (messagesLoading) messagesLoading.style.display = 'none';
                    if (messagesList) messagesList.style.display = 'block';
                } else {
                    // Just hide loading indicator if no messages
                    if (messagesLoading) messagesLoading.style.display = 'none';
                    if (messagesList) messagesList.style.display = 'block';
                }
                
                // Restart polling
                startPolling();
                
                // Reset button state
                refreshMessagesButton.textContent = 'Refresh Messages';
                refreshMessagesButton.disabled = false;
            } catch (error) {
                debugLog(`ERROR refreshing messages: ${error.message}`);
                // Reset button state on error
                refreshMessagesButton.textContent = 'Refresh Messages';
                refreshMessagesButton.disabled = false;
                
                // Restart polling even on error
                startPolling();
            }
        });
    }

    // Handle persistent refresh messages button
    if (refreshMessagesPersistent) {
        refreshMessagesPersistent.addEventListener('click', async () => {
            debugLog('Persistent refresh messages button clicked');
            try {
                // Show loading state
                refreshMessagesPersistent.textContent = '⏳ Loading...';
                refreshMessagesPersistent.disabled = true;
                
                // Show loading indicator
                if (messagesLoading) {
                    messagesLoading.style.display = 'block';
                }
                if (messagesList) {
                    messagesList.style.display = 'none';
                }
                
                // Small delay to show loading state
                await new Promise(resolve => setTimeout(resolve, 500));
                
                // Temporarily stop polling to prevent interference
                stopPolling();
                
                // Reset last message ID to force reload
                lastMessageId = null;
                
                                // Fetch messages directly instead of using pollMessages
                const messages = await fetchMessages();
                
                if (messages.length > 0) {
                    // Clear messages list
                    messagesList.innerHTML = '';
                    
                    // Load messages one at a time for better performance
                    for (let i = 0; i < messages.length; i++) {
                        displayMessage(messages[i]);
                        
                        // Small delay between messages for smooth loading
                        if (i < messages.length - 1) {
                            await new Promise(resolve => setTimeout(resolve, 50));
                        }
                    }
                    
                    lastMessageId = messages[messages.length - 1].id;
                    
                    // Hide loading and show messages
                    if (messagesLoading) messagesLoading.style.display = 'none';
                    if (messagesList) messagesList.style.display = 'block';
                    
                    debugLog(`Refresh complete. Loaded ${messages.length} messages one by one. Last ID: ${lastMessageId}`);
    } else {
                    // Just hide loading indicator if no messages
                    if (messagesLoading) messagesLoading.style.display = 'none';
                    if (messagesList) messagesList.style.display = 'block';
                    debugLog('Refresh complete. No messages found.');
                }
                
                // Restart polling
                startPolling();
                
                // Reset button state
                refreshMessagesPersistent.textContent = '🔄 Refresh';
                refreshMessagesPersistent.disabled = false;
            } catch (error) {
                debugLog(`ERROR refreshing messages: ${error.message}`);
                // Reset button state on error
                refreshMessagesPersistent.textContent = '🔄 Refresh';
                refreshMessagesPersistent.disabled = false;
                
                // Restart polling even on error
                startPolling();
                
                // Show error state
                if (messagesLoading) {
                    messagesLoading.style.display = 'none';
                }
                if (messagesList) {
                    messagesList.style.display = 'block';
                    messagesList.innerHTML = `
                        <div style="text-align: center; padding: 40px 20px; color: #e74c3c;">
                            <div style="margin-bottom: 15px; font-weight: bold;">Failed to load messages</div>
                            <div style="margin-bottom: 20px; font-size: 14px;">Please try refreshing again or check your connection.</div>
                            <button onclick="location.reload()" style="padding: 8px 16px; background: #3498db; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 12px;">🔄 Reload Page</button>
                        </div>
                    `;
                }
            }
        });
    }




    // Show ban modal
    function showBanModal(userEmail, username) {
        // Create modal overlay
        const modalOverlay = document.createElement('div');
        modalOverlay.id = 'ban-modal-overlay';
        modalOverlay.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); z-index: 10000; display: flex; align-items: center; justify-content: center;';
        
        // Create modal content
        const modalContent = document.createElement('div');
        modalContent.style.cssText = 'background: white; padding: 20px; border-radius: 8px; max-width: 400px; width: 90%; box-shadow: 0 4px 6px rgba(0,0,0,0.1);';
        
        modalContent.innerHTML = `
            <h3 style="margin-top: 0;">Ban User: ${escapeHTML(username)}</h3>
            <p>Are you sure you want to ban this user from this group?</p>
            <div style="margin: 15px 0;">
                <label style="display: block; margin-bottom: 10px;">
                    <input type="radio" name="banType" value="permanent" checked> Permanent Ban
                </label>
                <label style="display: block; margin-bottom: 10px;">
                    <input type="radio" name="banType" value="temporary"> Temporary Ban
                </label>
                <div id="duration-input" style="display: none; margin-top: 10px;">
                    <label>Duration (days):</label>
                    <input type="number" id="ban-duration" min="1" max="365" value="7" style="width: 100px; margin-left: 10px; padding: 4px;">
                </div>
            </div>
            <div style="display: flex; gap: 10px; justify-content: flex-end;">
                <button id="ban-cancel-btn" style="padding: 8px 16px; background: #95a5a6; color: white; border: none; border-radius: 4px; cursor: pointer;">Cancel</button>
                <button id="ban-confirm-btn" style="padding: 8px 16px; background: #e74c3c; color: white; border: none; border-radius: 4px; cursor: pointer;">Ban User</button>
            </div>
        `;
        
        modalOverlay.appendChild(modalContent);
        document.body.appendChild(modalOverlay);
        
        // Handle ban type change
        const banTypeInputs = modalContent.querySelectorAll('input[name="banType"]');
        const durationInput = modalContent.querySelector('#ban-duration');
        const durationDiv = modalContent.querySelector('#duration-input');
        
        banTypeInputs.forEach(input => {
            input.addEventListener('change', () => {
                if (input.value === 'temporary') {
                    durationDiv.style.display = 'block';
                } else {
                    durationDiv.style.display = 'none';
                }
            });
        });
        
        // Handle cancel
        const cancelBtn = modalContent.querySelector('#ban-cancel-btn');
        cancelBtn.addEventListener('click', () => {
            document.body.removeChild(modalOverlay);
        });
        
        // Handle confirm
        const confirmBtn = modalContent.querySelector('#ban-confirm-btn');
        confirmBtn.addEventListener('click', async () => {
            const selectedBanType = modalContent.querySelector('input[name="banType"]:checked').value;
            const durationDays = selectedBanType === 'temporary' ? parseInt(durationInput.value) : null;
            
            try {
                confirmBtn.disabled = true;
                confirmBtn.textContent = 'Banning...';
                
                const response = await fetch('/api/groups/ban', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    credentials: 'include',
                    body: JSON.stringify({
                        groupId: currentGroupId,
                        userEmail: userEmail,
                        banType: selectedBanType,
                        durationDays: durationDays
                    })
                });
                
                const result = await response.json();
                
                if (response.ok && result.success) {
                    alert(`User ${username} has been banned successfully.`);
                    document.body.removeChild(modalOverlay);
                    // Refresh user list
                    await pollUsers();
                } else {
                    alert(result.error || 'Failed to ban user');
                    confirmBtn.disabled = false;
                    confirmBtn.textContent = 'Ban User';
                }
            } catch (error) {
                debugLog(`ERROR banning user: ${error.message}`);
                alert(`Error banning user: ${error.message}`);
                confirmBtn.disabled = false;
                confirmBtn.textContent = 'Ban User';
            }
        });
        
        // Close on overlay click
        modalOverlay.addEventListener('click', (e) => {
            if (e.target === modalOverlay) {
                document.body.removeChild(modalOverlay);
            }
        });
    }

    // Show message context menu
    function showMessageContextMenu(event, messageItem, messageData) {
        // Remove any existing context menu
        const existingMenu = document.getElementById('message-context-menu');
        if (existingMenu) {
            document.body.removeChild(existingMenu);
        }
        
        // Create context menu
        const contextMenu = document.createElement('div');
        contextMenu.id = 'message-context-menu';
        contextMenu.style.cssText = `
            position: fixed;
            background: white;
            border: 1px solid #ddd;
            border-radius: 4px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.15);
            z-index: 10000;
            min-width: 150px;
            padding: 4px 0;
        `;
        
        // Delete message option
        const deleteOption = document.createElement('div');
        deleteOption.className = 'context-menu-item';
        deleteOption.textContent = 'Delete Message';
        deleteOption.style.cssText = `
            padding: 8px 16px;
            cursor: pointer;
            color: #e74c3c;
            transition: background 0.2s;
        `;
        deleteOption.addEventListener('mouseenter', () => {
            deleteOption.style.background = '#f5f5f5';
        });
        deleteOption.addEventListener('mouseleave', () => {
            deleteOption.style.background = 'transparent';
        });
        deleteOption.addEventListener('click', () => {
            handleDeleteMessage(messageData.id, messageItem);
            document.body.removeChild(contextMenu);
        });
        
        contextMenu.appendChild(deleteOption);
        document.body.appendChild(contextMenu);
        
        // Wait for menu to be rendered to get actual dimensions
        setTimeout(() => {
            // Position menu next to the message item
            const messageRect = messageItem.getBoundingClientRect();
            const menuRect = contextMenu.getBoundingClientRect();
            const menuWidth = menuRect.width;
            const menuHeight = menuRect.height;
            
            // Determine position based on message alignment
            // For "my-message" (right-aligned), show menu to the left
            // For "other-message" (left-aligned), show menu to the right
            const isMyMessage = messageItem.classList.contains('my-message');
            let x, y;
            
            if (isMyMessage) {
                // Position to the left of the message
                x = messageRect.left - menuWidth - 10;
            } else {
                // Position to the right of the message
                x = messageRect.right + 10;
            }
            
            // Align vertically with the top of the message
            y = messageRect.top;
            
            // Adjust if menu goes off screen horizontally
            if (x < 10) {
                // If too far left, position to the right instead
                x = messageRect.right + 10;
            }
            if (x + menuWidth > window.innerWidth - 10) {
                // If too far right, position to the left instead
                x = messageRect.left - menuWidth - 10;
                // If still off screen, position at screen edge
                if (x < 10) {
                    x = 10;
                }
            }
            
            // Adjust if menu goes off screen vertically
            if (y + menuHeight > window.innerHeight - 10) {
                // Position above if it would go below viewport
                y = messageRect.bottom - menuHeight;
            }
            if (y < 10) {
                // Ensure menu doesn't go above viewport
                y = 10;
            }
            
            contextMenu.style.left = `${x}px`;
            contextMenu.style.top = `${y}px`;
        }, 0);
        
        // Close menu when clicking outside
        const closeMenu = (e) => {
            if (!contextMenu.contains(e.target) && e.target !== messageItem) {
                if (document.body.contains(contextMenu)) {
                    document.body.removeChild(contextMenu);
                }
                document.removeEventListener('click', closeMenu);
            }
        };
        
        // Close on click outside (after a small delay to allow menu click)
        setTimeout(() => {
            document.addEventListener('click', closeMenu);
        }, 100);
    }
    
    // Handle delete message (placeholder for now)
    function handleDeleteMessage(messageId, messageItem) {
        debugLog(`Delete message requested for ID: ${messageId}`);
        // TODO: Implement delete logic with 3-minute time limit
        alert('Delete message functionality will be implemented next');
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
            await updateGroupName();
            initializeEmojiPanel();
            
            // Load initial messages with retry
            let messagesLoaded = false;
            for (let attempt = 1; attempt <= 3; attempt++) {
                try {
                    debugLog(`Loading initial messages (attempt ${attempt}/3)`);
                    
                    // Fetch messages directly for initial load
                    const messages = await fetchMessages();
                    
                    if (messages.length > 0) {
                        // Clear messages list
                        messagesList.innerHTML = '';
                        
                        // Load messages one at a time for better performance
                        for (let i = 0; i < messages.length; i++) {
                            displayMessage(messages[i]);
                            
                            // Small delay between messages for smooth loading
                            if (i < messages.length - 1) {
                                await new Promise(resolve => setTimeout(resolve, 50));
                            }
                        }
                        
                        lastMessageId = messages[messages.length - 1].id;
                        
                        // Hide loading and show messages
                        if (messagesLoading) messagesLoading.style.display = 'none';
                        if (messagesList) messagesList.style.display = 'block';
                        
                        debugLog(`Initial load complete. Loaded ${messages.length} messages one by one. Last ID: ${lastMessageId}`);
    } else {
                    // Just hide loading indicator if no messages
                    if (messagesLoading) messagesLoading.style.display = 'none';
                    if (messagesList) messagesList.style.display = 'block';
                    debugLog('Initial load complete. No messages found.');
                }
                    
                    messagesLoaded = true;
                    break;
            } catch (error) {
                    debugLog(`Failed to load messages (attempt ${attempt}): ${error.message}`);
                    if (attempt < 3) {
                        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
                    }
                }
            }
            
            if (!messagesLoaded) {
                debugLog('WARNING: Failed to load initial messages after 3 attempts');
                // Show error state
                if (messagesLoading) messagesLoading.style.display = 'none';
                if (messagesList) {
                    messagesList.style.display = 'block';
                    messagesList.innerHTML = `
                        <div style="text-align: center; padding: 40px 20px; color: #e74c3c;">
                            <div style="margin-bottom: 15px; font-weight: bold;">Failed to load messages</div>
                            <div style="margin-bottom: 20px; font-size: 14px;">Please try refreshing or check your connection.</div>
                            <button onclick="location.reload()" style="padding: 8px 16px; background: #3498db; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 12px;">🔄 Reload Page</button>
                        </div>
                    `;
                }
            }
            
            // Load initial users
            await pollUsers();
            
            // Start polling
            startPolling();
            
            debugLog('Chat initialization complete');
            } catch (error) {
            debugLog(`ERROR during chat initialization: ${error.message}`);
        }
    }

    // Start the chat
    initializeChat();

    // Handle page visibility changes
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            debugLog('Page hidden - pausing polling');
            stopPolling();
        } else {
            debugLog('Page visible - resuming polling');
            startPolling();
        }
    });

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
