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
    const videoUploadButton = document.getElementById('video-upload-button');
    const videoInput = document.getElementById('video-input');
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
        videoUploadButton,
        videoInput,
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
    async function sendMessage(message, imageData = null, videoData = null) {
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                const messageType = imageData ? 'image' : (videoData ? 'video' : 'text');
                const logMessage = imageData ? 
                    `Sending image message (attempt ${attempt}/${MAX_RETRIES}): ${imageData.imageName}` :
                    (videoData ? 
                        `Sending video message (attempt ${attempt}/${MAX_RETRIES}): ${videoData.videoName}` :
                        `Sending message (attempt ${attempt}/${MAX_RETRIES}): ${message ? message.substring(0, 50) : '(empty)'}...`);
                
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
                } else if (videoData) {
                    // Check if video data is too large for JSON request
                    const videoDataSize = videoData.videoData.length;
                    if (videoDataSize > 150 * 1024 * 1024) { // 150MB limit for JSON (100MB file becomes ~133MB Base64)
                        debugLog(`ERROR: Video data too large for JSON request: ${Math.round(videoDataSize / 1024 / 1024)}MB`);
                        throw new Error('Video is too large. Please try a smaller video.');
                    }
                    
                    // Send video message
                    Object.assign(requestBody, {
                        messageType: 'video',
                        videoData: videoData.videoData,
                        videoName: videoData.videoName,
                        videoSize: videoData.videoSize
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
                if (logBody.videoData) {
                    logBody.videoData = `[Video Data: ${Math.round(logBody.videoData.length / 1024)}KB]`;
                }
                if (logBody.imageData) {
                    logBody.imageData = `[Image Data: ${Math.round(logBody.imageData.length / 1024)}KB]`;
                }
                console.log('Sending request body:', logBody);
                debugLog(`Stringifying request body (video data size: ${videoData ? Math.round(videoData.videoData.length / 1024 / 1024) : 0}MB)...`);
                
                let requestBodyString;
                try {
                    requestBodyString = JSON.stringify(requestBody);
                    debugLog(`Request body stringified successfully. Size: ${Math.round(requestBodyString.length / 1024 / 1024)}MB`);
                } catch (stringifyError) {
                    debugLog(`ERROR: Failed to stringify request body: ${stringifyError.message}`);
                    throw new Error('Failed to prepare video for sending. The video might be too large.');
                }
                
                const response = await fetch('/api/chat/send', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Cache-Control': 'no-cache'
                    },
                    body: requestBodyString,
                    credentials: 'include'
                });

                if (response.ok) {
                    const result = await response.json();
                    debugLog('Message sent successfully:', result);
                    return result.message;
        } else {
                    const errorText = await response.text();
                    debugLog(`ERROR: Failed to send message - Status: ${response.status}, Response: ${errorText}`);
                    if (attempt === MAX_RETRIES) {
                        debugLog('ERROR: Max retries reached for message send');
                        return null;
                    }
                    await new Promise(resolve => setTimeout(resolve, 500 * attempt));
                }
            } catch (error) {
                debugLog(`ERROR sending message (attempt ${attempt}): ${error.message}`);
                                if (attempt === MAX_RETRIES) {
                    debugLog('ERROR: Max retries reached for message send');
            return null;
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
        } else if (messageData.messageType === 'video' && messageData.videoData) {
            // Display video message
            messageContentSpan.innerHTML = `${escapeHTML(messageData.user)}: `;
            
            const videoElement = document.createElement('video');
            videoElement.src = messageData.videoData;
            videoElement.controls = true;
            videoElement.className = 'message-video';
            videoElement.style.cssText = 'max-width: 100%; max-height: 400px; border-radius: 8px; margin-top: 5px;';
            videoElement.title = messageData.videoName || 'Video';
            
            messageContentSpan.appendChild(videoElement);
            
            // Add video name below
            if (messageData.videoName) {
                const videoNameSpan = document.createElement('div');
                videoNameSpan.style.cssText = 'font-size: 12px; color: #666; margin-top: 5px;';
                videoNameSpan.textContent = messageData.videoName;
                messageContentSpan.appendChild(videoNameSpan);
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

    // Handle video upload
    function handleVideoUpload(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            
            reader.onload = function(e) {
                const base64Data = e.target.result;
                const videoSize = file.size;
                const videoName = file.name;
                
                // Validate file size (100MB limit)
                if (videoSize > 100 * 1024 * 1024) {
                    reject(new Error('Video size must be less than 100MB'));
                    return;
                }
    
                // Validate file type
                if (!file.type.startsWith('video/')) {
                    reject(new Error('Please select a valid video file'));
                    return;
                }
                
                debugLog(`Video processed: ${videoName} - Size: ${Math.round(videoSize / 1024)}KB`);
                resolve({
                    videoData: base64Data,
                    videoName: videoName,
                    videoSize: videoSize
                });
            };
            
            reader.onerror = function() {
                reject(new Error('Failed to read video file'));
            };
            
            reader.readAsDataURL(file);
        });
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

    // Handle video upload button
    if (videoUploadButton && videoInput) {
        debugLog('Setting up video upload button event listener');
        videoUploadButton.addEventListener('click', (e) => {
            e.preventDefault();
            debugLog('Video upload button clicked');
            debugLog('Triggering file input click');
            try {
                videoInput.click();
                debugLog('File input click triggered successfully');
            } catch (error) {
                debugLog(`ERROR triggering file input: ${error.message}`);
            }
        });
        debugLog('Video upload button event listener set up successfully');
    } else {
        debugLog('ERROR: Video upload button or input not found');
        debugLog(`videoUploadButton: ${!!videoUploadButton}, videoInput: ${!!videoInput}`);
    }

    if (videoInput) {
        videoInput.addEventListener('change', async (e) => {
            debugLog('Video input change event triggered');
            const file = e.target.files[0];
            if (!file) {
                debugLog('No file selected');
                return;
            }
            debugLog(`File selected: ${file.name}, size: ${file.size}, type: ${file.type}`);

            try {
                if (!videoUploadButton) {
                    throw new Error('Video upload button not found');
                }
                
                // Show loading state
                const originalText = videoUploadButton.textContent || '🎥';
                videoUploadButton.textContent = '⏳';
                videoUploadButton.disabled = true;

                // Process video
                debugLog(`Processing video: ${file.name} (${Math.round(file.size / 1024 / 1024)}MB)`);
                const videoData = await handleVideoUpload(file);
                debugLog(`Video processed successfully. Base64 size: ${Math.round(videoData.videoData.length / 1024 / 1024)}MB`);
                
                // Send video message
                debugLog('Sending video message to server...');
                const sentMessage = await sendMessage(null, null, videoData);
                if (sentMessage) {
                    debugLog('Video sent successfully');
                    // Display immediately for instant feedback
                    displayMessage(sentMessage);
                    // Update lastMessageId to prevent duplicate from polling
                    lastMessageId = sentMessage.id;
                } else {
                    debugLog('ERROR: Failed to send video - sendMessage returned null');
                    alert('Failed to send video. Please try again.');
                }

                // Reset button state
                if (videoUploadButton) {
                    videoUploadButton.textContent = originalText;
                    videoUploadButton.disabled = false;
                }
                
                // Clear file input
                if (videoInput) {
                    videoInput.value = '';
                }
                
            } catch (error) {
                debugLog(`ERROR uploading video: ${error.message}`);
                debugLog(`Error stack: ${error.stack}`);
                alert(`Error uploading video: ${error.message}`);
                
                // Reset button state
                if (videoUploadButton) {
                    videoUploadButton.textContent = '🎥';
                    videoUploadButton.disabled = false;
                }
                if (videoInput) {
                    videoInput.value = '';
                }
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
