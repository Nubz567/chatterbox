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
    const imageModal = document.getElementById('image-modal');
    const modalImage = document.getElementById('modal-image');
    const modalClose = document.querySelector('.image-modal-close');

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
        modalClose
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
                    `Sending message (attempt ${attempt}/${MAX_RETRIES}): ${message.substring(0, 50)}...`;
                
                debugLog(logMessage);
                
                const requestBody = {
                    groupId: currentGroupId
                };

                if (imageData) {
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
                        message: message,
                        messageType: 'text'
                    });
                }
                
                const response = await fetch('/api/chat/send', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Cache-Control': 'no-cache'
                    },
                    body: JSON.stringify(requestBody),
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
                
                // Compress image if it's larger than 1MB
                if (imageSize > 1024 * 1024) {
                    compressImage(base64Data, imageName)
                        .then(compressedData => resolve(compressedData))
                        .catch(error => {
                            debugLog(`Compression failed, using original: ${error.message}`);
                            resolve({
                                imageData: base64Data,
                                imageName: imageName,
                                imageSize: imageSize
                            });
                        });
                } else {
                    resolve({
                        imageData: base64Data,
                        imageName: imageName,
                        imageSize: imageSize
                    });
                }
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
                
                // Calculate new dimensions (max 800px width/height)
                let { width, height } = img;
                const maxSize = 800;
                
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
                
                // Convert to base64 with quality 0.8
                const compressedBase64 = canvas.toDataURL('image/jpeg', 0.8);
                
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
                        // Hide loading indicator and show messages
                        if (messagesLoading) messagesLoading.style.display = 'none';
                        if (messagesList) messagesList.style.display = 'block';
                        
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
        
        // Poll messages every 1.5 seconds (faster for better responsiveness)
        messagePollInterval = setInterval(async () => {
            await pollMessages();
        }, 1500);

        // Poll users every 10 seconds (faster for better user list updates)
        userPollInterval = setInterval(async () => {
            await pollUsers();
        }, 10000);
        
        debugLog('Polling started - Messages: 1.5s, Users: 10s');
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

    // Handle image upload button
    if (imageUploadButton && imageInput) {
        imageUploadButton.addEventListener('click', () => {
            debugLog('Image upload button clicked');
            imageInput.click();
        });

        imageInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            try {
                debugLog(`Image selected: ${file.name} (${file.size} bytes)`);
                
                // Show loading state
                const originalText = imageUploadButton.textContent;
                imageUploadButton.textContent = '⏳';
                imageUploadButton.disabled = true;

                // Process image
                const imageData = await handleImageUpload(file);
                
                // Send image message
                const sentMessage = await sendMessage('', imageData);
                if (sentMessage) {
                    debugLog('Image sent successfully');
                    displayMessage(sentMessage);
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
                const sentMessage = await sendMessage('', imageData);
                if (sentMessage) {
                    debugLog('Dropped image sent successfully');
                    displayMessage(sentMessage);
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
