let socket; // Define socket in a broader scope

document.addEventListener('DOMContentLoaded', () => {
    // Now, initialize the socket connection with serverless-friendly settings
    socket = io({
        transports: ['polling'], // Use only polling for serverless compatibility
        timeout: 30000, // Increase timeout for serverless
        forceNew: true, // Force new connection
        reconnection: true, // Enable reconnection
        reconnectionAttempts: 5, // Try to reconnect 5 times
        reconnectionDelay: 1000, // Wait 1 second between attempts
        reconnectionDelayMax: 5000 // Max delay between attempts
    });

    // Show connecting status immediately
    updateConnectionStatus('connecting');

    const messagesList = document.getElementById('messages');
    const messageForm = document.getElementById('message-form');
    const messageInput = document.getElementById('message-input');
    const userList = document.getElementById('user-list');
    const typingIndicator = document.getElementById('typing-indicator');
    const groupChatArea = document.getElementById('group-chat-area');
    const pmChatWindowsContainer = document.getElementById('pm-chat-windows-container');
    const emojiButton = document.getElementById('emoji-button');
    const emojiPanel = document.getElementById('emoji-panel');
    const groupChatTitle = document.querySelector('#group-chat-area .chat-title-bar'); // For group name

    // Debug: Check if user list element is found
    console.log('[CLIENT] Page loaded. userList element found:', !!userList);
    if (userList) {
        console.log('[CLIENT] userList element:', userList);
    } else {
        console.error('[CLIENT] userList element not found! Check HTML structure.');
    }

    let typingTimeout;
    const TYPING_TIMER_LENGTH = 1500;
    let currentlyTyping = {};
    let currentUserEmail = null;
    let currentGroupId = null;    // Added for group context
    let currentGroupName = null;  // Added for group context
    let activePrivateChats = {}; // { roomName: { partnerEmail, windowElement, messagesElement, inputElement, titleElement } }

    const EMOJI_LIST = [
        '😀', '😂', '😍', '🤔', '👍', '❤️', '🎉', '🔥', '😊', '😢', '😮', '👋',
        '💯', '🙏', '🌟', '💡', '🎈', '🍕', '🚀', '🚲', '💻', '📱', '💰', '👀',
        '⚙️', '🔒', '🔐', '🔓', '🔑', '🎤', '🎧', '🎵', '🎶', '🎹', '🎸', '🎺'

    ];

    const notificationSound = new Audio('/notification.mp3');
    let canPlaySound = false;

    function enableSoundIfNeeded() {
        if (!canPlaySound) {
            notificationSound.play().then(() => {
                notificationSound.pause();
                notificationSound.currentTime = 0;
                canPlaySound = true;
                console.log("Sound enabled by user interaction.");
                document.removeEventListener('click', enableSoundIfNeeded);
                document.removeEventListener('keypress', enableSoundIfNeeded);
            }).catch(error => {
                console.warn("Sound could not be enabled by pre-play attempt:", error);
                canPlaySound = true;
            });
        }
    }
    document.addEventListener('click', enableSoundIfNeeded, { once: true });
    document.addEventListener('keypress', enableSoundIfNeeded, { once: true });

    function escapeHTML(str) {
        if (str === null || str === undefined) return '';
        const div = document.createElement('div');
        div.appendChild(document.createTextNode(str));
        return div.innerHTML;
    }

    function showConnectionError(message) {
        // Remove any existing error messages
        const existingErrors = document.querySelectorAll('.connection-error');
        existingErrors.forEach(err => err.remove());
        
        // Create new error message
        const errorDiv = document.createElement('div');
        errorDiv.className = 'connection-error';
        errorDiv.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: #ff4444;
            color: white;
            padding: 15px;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.2);
            z-index: 10000;
            max-width: 300px;
            font-size: 14px;
        `;
        errorDiv.textContent = message;
        
        document.body.appendChild(errorDiv);
        
        // Auto-remove after 10 seconds
        setTimeout(() => {
            if (errorDiv.parentNode) {
                errorDiv.remove();
            }
        }, 10000);
    }

    function updateConnectionStatus(status) {
        // Find or create connection status indicator
        let statusIndicator = document.getElementById('connection-status');
        if (!statusIndicator) {
            statusIndicator = document.createElement('div');
            statusIndicator.id = 'connection-status';
            statusIndicator.style.cssText = `
                position: fixed;
                top: 10px;
                left: 50%;
                transform: translateX(-50%);
                padding: 5px 15px;
                border-radius: 20px;
                font-size: 12px;
                font-weight: bold;
                z-index: 10001;
                transition: all 0.3s ease;
            `;
            document.body.appendChild(statusIndicator);
        }
        
        if (status === 'connected') {
            statusIndicator.textContent = '🟢 Connected';
            statusIndicator.style.background = '#4CAF50';
            statusIndicator.style.color = 'white';
        } else if (status === 'disconnected') {
            statusIndicator.textContent = '🔴 Disconnected';
            statusIndicator.style.background = '#f44336';
            statusIndicator.style.color = 'white';
        } else if (status === 'connecting') {
            statusIndicator.textContent = '🟡 Connecting...';
            statusIndicator.style.background = '#FF9800';
            statusIndicator.style.color = 'white';
        }
    }

    function linkify(text) {
        let escapedText = escapeHTML(text);
        const urlRegex = /(\b(https?|ftp|file):\/\/[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])|(\bwww\.[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])/ig;
        return escapedText.replace(urlRegex, function(url) {
            let fullUrl = url;
            if (!url.match(/^[a-zA-Z]+:\/\//)) {
                fullUrl = 'http://' + url;
            }
            return `<a href="${fullUrl}" target="_blank" rel="noopener noreferrer">${url}</a>`;
        });
    }

    function setActiveChatWindow(windowToActivate) {
        if (groupChatArea) {
            groupChatArea.style.display = 'none';
            groupChatArea.classList.remove('active-chat');
        }
        Object.values(activePrivateChats).forEach(chat => {
            if (chat.windowElement) {
                chat.windowElement.style.display = 'none';
                chat.windowElement.classList.remove('active-chat');
            }
        });

        if (windowToActivate) {
            windowToActivate.style.display = 'flex';
            windowToActivate.classList.add('active-chat');
            const input = windowToActivate.querySelector('input[type="text"]');
            if (input) {
                input.focus();
            } else if (windowToActivate === groupChatArea && messageInput) {
                messageInput.focus();
            }
        }
    }

    function createOrFocusPmWindow(partnerEmail, roomName) {
        console.log(`[CLIENT] createOrFocusPmWindow called with partner: ${partnerEmail}, room: ${roomName}`);
        if (activePrivateChats[roomName] && activePrivateChats[roomName].windowElement) {
            setActiveChatWindow(activePrivateChats[roomName].windowElement);
            return activePrivateChats[roomName];
        }

        const pmWindow = document.createElement('div');
        pmWindow.className = 'chat-window private-chat';
        pmWindow.dataset.room = roomName;
        pmWindow.style.display = 'none';

        const titleBar = document.createElement('div');
        titleBar.className = 'chat-title-bar';
        titleBar.textContent = `Private Chat with ${escapeHTML(partnerEmail)}`;
        pmWindow.appendChild(titleBar);

        const pmMessages = document.createElement('ul');
        pmMessages.className = 'pm-messages messages';
        pmWindow.appendChild(pmMessages);

        const pmForm = document.createElement('form');
        pmForm.className = 'pm-form';
        const pmInput = document.createElement('input');
        pmInput.type = 'text';
        pmInput.autocomplete = 'off';
        pmInput.placeholder = 'Type a private message...';
        const pmButton = document.createElement('button');
        pmButton.textContent = 'Send';
        pmForm.appendChild(pmInput);
        pmForm.appendChild(pmButton);
        pmWindow.appendChild(pmForm);

        if (pmChatWindowsContainer) {
            pmChatWindowsContainer.appendChild(pmWindow);
        } else {
            console.error("pmChatWindowsContainer not found!");
            return null;
        }

        pmForm.addEventListener('submit', (e) => {
            e.preventDefault();
            if (pmInput.value) {
                socket.emit('send_private_message', {
                    roomName: roomName,
                    text: pmInput.value,
                    recipientEmail: partnerEmail
                });
                pmInput.value = '';
            }
        });

        activePrivateChats[roomName] = {
            partnerEmail: partnerEmail,
            windowElement: pmWindow,
            messagesElement: pmMessages,
            inputElement: pmInput,
            titleElement: titleBar
        };

        setActiveChatWindow(pmWindow);
        return activePrivateChats[roomName];
    }

    function appendPmMessage(data, roomName, isMyMessage) {
        console.log(`[CLIENT] appendPmMessage called. Data:`, data, `Room: ${roomName}, IsMyMessage: ${isMyMessage}`);
        const chatSession = activePrivateChats[roomName];
        if (!chatSession || !chatSession.messagesElement) {
            console.error('PM session or messages element not found for room:', roomName);
            return;
        }

        const item = document.createElement('li');
        const date = new Date(data.timestamp || Date.now());
        const hours = date.getHours().toString().padStart(2, '0');
        const minutes = date.getMinutes().toString().padStart(2, '0');
        const formattedTime = `[${hours}:${minutes}]`;

        const timeSpan = document.createElement('span');
        timeSpan.className = 'timestamp';
        timeSpan.textContent = `${formattedTime} `;
        item.appendChild(timeSpan);

        const messageContentSpan = document.createElement('span');
        messageContentSpan.innerHTML = `${escapeHTML(data.user)}: ${linkify(data.text)}`;
        item.appendChild(messageContentSpan);

        item.classList.add(isMyMessage ? 'my-message' : 'other-message');
        chatSession.messagesElement.appendChild(item);
        chatSession.messagesElement.scrollTop = chatSession.messagesElement.scrollHeight;

        if (!isMyMessage && canPlaySound && document.hidden) {
            const pmWindow = chatSession.windowElement;
            if (!pmWindow || pmWindow.style.display === 'none' || !pmWindow.classList.contains('active-chat')) {
                notificationSound.play().catch(e => console.warn("Error playing sound for PM:", e));
            }
        }
    }

    if (messageForm && messageInput) {
        messageForm.addEventListener('submit', (e) => {
            e.preventDefault();
            console.log('=== MESSAGE SEND DEBUG ===');
            console.log('Message form submitted. Input value:', messageInput.value);
            console.log('Socket connected:', socket.connected);
            console.log('Socket ID:', socket.id);
            console.log('Current user email:', currentUserEmail);
            console.log('Current group ID:', currentGroupId);
            
            if (messageInput.value) {
                console.log('✅ Emitting chat message:', messageInput.value);
                socket.emit('chat message', messageInput.value);
                console.log('✅ Message emitted to server');
                socket.emit('typing_stop'); // Also clear typing for self on send
                clearTimeout(typingTimeout);
                currentlyTyping[currentUserEmail] = false; // Clear self from local typing display
                updateTypingIndicator();
                messageInput.value = '';
                console.log('✅ Message input cleared');
            } else {
                console.log('❌ Message input is empty, not sending');
            }
            console.log('=== END MESSAGE SEND DEBUG ===');
        });
    }

    function displayPublicMessage(data) {
        console.log('=== MESSAGE DISPLAY DEBUG ===');
        console.log('displayPublicMessage called with data:', data);
        console.log('messagesList element:', messagesList);
        console.log('messagesList exists:', !!messagesList);
        console.log('messagesList display style:', messagesList ? getComputedStyle(messagesList).display : 'N/A');
        console.log('messagesList visibility:', messagesList ? getComputedStyle(messagesList).visibility : 'N/A');
        console.log('messagesList parent display:', messagesList && messagesList.parentElement ? getComputedStyle(messagesList.parentElement).display : 'N/A');
        
        if (!messagesList) {
            console.error('❌ messagesList is null or undefined');
            return;
        }
        
        const item = document.createElement('li');
        const date = new Date(data.timestamp || Date.now());
        const hours = date.getHours().toString().padStart(2, '0');
        const minutes = date.getMinutes().toString().padStart(2, '0');
        const formattedTime = `[${hours}:${minutes}]`;

        const timeSpan = document.createElement('span');
        timeSpan.className = 'timestamp';
        timeSpan.textContent = `${formattedTime} `;
        item.appendChild(timeSpan);

        const messageContentSpan = document.createElement('span');
        messageContentSpan.innerHTML = `${escapeHTML(data.user)}: ${linkify(data.text)}`;
        item.appendChild(messageContentSpan);

        if (currentUserEmail && data.email === currentUserEmail) {
            item.classList.add('my-message');
            console.log('✅ Added my-message class');
        } else {
            item.classList.add('other-message');
            console.log('✅ Added other-message class');
        }
        
        console.log('About to append message item:', item);
        console.log('Item HTML:', item.outerHTML);
        messagesList.appendChild(item);
        console.log('✅ Message appended successfully');
        console.log('Current messagesList children count:', messagesList.children.length);
        console.log('MessagesList scrollTop before:', messagesList.scrollTop);
        messagesList.scrollTop = messagesList.scrollHeight;
        console.log('MessagesList scrollTop after:', messagesList.scrollTop);
        console.log('=== END MESSAGE DISPLAY DEBUG ===');

        if (data.user !== currentUserEmail && canPlaySound && document.hidden) {
            notificationSound.play().catch(e => console.warn("Error playing sound for group chat:", e));
        }
    }

    socket.on('load history', (history) => {
        console.log('load history event received:', history);
        if (!messagesList) return;
        messagesList.innerHTML = '';
        if (history && Array.isArray(history)) {
            history.forEach((messageData) => {
                displayPublicMessage(messageData); // Reuse displayPublicMessage for history
            });
        }
        messagesList.scrollTop = messagesList.scrollHeight;
        console.log('Message history loaded for group chat.');
    });

    socket.on('chat message', (data) => {
        console.log('=== MESSAGE RECEIVE DEBUG ===');
        console.log('✅ chat message event received:', data);
        console.log('Data type:', typeof data);
        console.log('Data keys:', Object.keys(data || {}));
        console.log('User identity check - currentUserEmail:', currentUserEmail, 'data.email:', data.email);
        console.log('Group identity check - currentGroupId:', currentGroupId, 'data.groupId:', data.groupId);
        displayPublicMessage(data);
        console.log('=== END MESSAGE RECEIVE DEBUG ===');
    });

    socket.on('update userlist', (users) => {
        console.log('[CLIENT] update userlist event received:', users);
        if (!userList) {
            console.error('[CLIENT] userList element not found!');
            return;
        }
    
        userList.innerHTML = ''; // Clear the list
    
        // Add "Group Chat" option
        const groupChatListItem = document.createElement('li');
        groupChatListItem.textContent = 'Group Chat';
        groupChatListItem.classList.add('group-chat-option');
        groupChatListItem.addEventListener('click', () => {
            if (groupChatArea) setActiveChatWindow(groupChatArea);
        });
        userList.appendChild(groupChatListItem);
    
        // Add "Back to Groups Portal" link
        const backToGroupsLink = document.createElement('li');
        backToGroupsLink.innerHTML = '<a href="/groups" style="font-weight: bold; color: #007bff; display: block; padding: 5px 0; text-decoration: none;">⬅️ Back to All Groups</a>';
        backToGroupsLink.style.borderBottom = '1px solid #eee';
        backToGroupsLink.style.marginBottom = '10px';
        userList.appendChild(backToGroupsLink);
    
        // Add "Members in this group:" title
        const membersTitle = document.createElement('li');
        membersTitle.textContent = `Members in ${currentGroupName || 'this group'}:`;
        membersTitle.style.fontWeight = 'bold';
        membersTitle.style.color = '#555';
        membersTitle.style.marginTop = '5px';
        membersTitle.style.padding = '5px 0';
        userList.appendChild(membersTitle);
    
        console.log('[CLIENT] Processing users:', users);
        if (users && users.length > 0) {
            users.forEach(user => {
                console.log('[CLIENT] Processing user:', user);
                const item = document.createElement('li');
                item.textContent = user.username;
        
                if (user.email === currentUserEmail) {
                    item.textContent += ' (You)';
                    item.classList.add('cannot-pm');
                } else {
                    item.classList.add('can-pm');
                    item.dataset.email = user.email;
                    item.addEventListener('click', () => {
                        console.log('[CLIENT] Initiating PM with:', user.email);
                        socket.emit('start_private_chat', { targetUserEmail: user.email });
                    });
                }
                userList.appendChild(item);
            });
        } else {
            console.log('[CLIENT] No users in the list');
            const noUsersItem = document.createElement('li');
            noUsersItem.textContent = 'No other users online';
            noUsersItem.className = 'no-users-message';
            userList.appendChild(noUsersItem);
        }
    });

    socket.on('connect', () => {
        console.log('✅ Connected to server via Socket.IO');
        console.log('Socket ID:', socket.id);
        console.log('Socket connected:', socket.connected);
        // Clear any connection error messages
        const errorMessages = document.querySelectorAll('.connection-error');
        errorMessages.forEach(msg => msg.remove());
        
        // Update connection status
        updateConnectionStatus('connected');
    });

    socket.on('connect_error', (error) => {
        console.error('❌ Socket.IO connection error:', error);
        console.error('Error details:', {
            type: error.type,
            description: error.description,
            context: error.context
        });
        // Show user-friendly error message
        showConnectionError('Connection failed. Trying to reconnect...');
    });

    socket.on('reconnect', (attemptNumber) => {
        console.log('✅ Reconnected to server after', attemptNumber, 'attempts');
        console.log('New Socket ID:', socket.id);
        // Clear error messages on successful reconnection
        const errorMessages = document.querySelectorAll('.connection-error');
        errorMessages.forEach(msg => msg.remove());
    });

    socket.on('reconnect_error', (error) => {
        console.error('❌ Socket.IO reconnection error:', error);
        showConnectionError('Reconnection failed. Please refresh the page.');
    });

    socket.on('reconnect_failed', () => {
        console.error('❌ Socket.IO reconnection failed after all attempts');
        showConnectionError('Unable to connect to server. Please check your internet connection and refresh the page.');
    });

    socket.on('disconnect', (reason) => {
        console.log('❌ Disconnected from server:', reason);
        console.log('Socket connected:', socket.connected);
        updateConnectionStatus('disconnected');
        if (typingIndicator) typingIndicator.textContent = '';
        if (reason === 'io server disconnect') {
            // This happens if server calls socket.disconnect(true) e.g. on auth error
            alert('Disconnected by server. You might need to re-select a group or log in.');
            window.location.href = '/groups'; // Redirect to groups page
        }
    });

    socket.on('auth_error', (errorMessage) => {
        console.error('Authentication/Authorization error:', errorMessage);
        alert(`Error: ${errorMessage}. Redirecting...`);
        // Depending on the error, redirect to login or groups page
        window.location.href = '/'; // Redirect to login page as a safe default
    });

    if (messageInput) {
        messageInput.addEventListener('input', () => {
            socket.emit('typing_start');
            clearTimeout(typingTimeout);
            typingTimeout = setTimeout(() => {
                socket.emit('typing_stop');
            }, TYPING_TIMER_LENGTH);
        });
    }

    function updateTypingIndicator() {
        if (!typingIndicator) return;
        const typingUsers = Object.keys(currentlyTyping).filter(user => currentlyTyping[user] && user !== currentUserEmail);
        if (typingUsers.length === 0) {
            typingIndicator.textContent = '';
        } else if (typingUsers.length === 1) {
            typingIndicator.textContent = `${typingUsers[0]} is typing...`;
        } else if (typingUsers.length === 2) {
            typingIndicator.textContent = `${typingUsers[0]} and ${typingUsers[1]} are typing...`;
        } else {
            typingIndicator.textContent = 'Multiple users are typing...';
        }
    }

    socket.on('user_typing', (data) => {
        if (data.user !== currentUserEmail) {
            currentlyTyping[data.user] = true;
            updateTypingIndicator();
        }
    });

    socket.on('user_stopped_typing', (data) => {
        if (data.user !== currentUserEmail) {
            currentlyTyping[data.user] = false;
            if (!currentlyTyping[data.user]) { 
                delete currentlyTyping[data.user];
            }
            updateTypingIndicator();
        }
    });

    socket.on('user_identity', (identity) => {
        console.log('=== USER IDENTITY DEBUG ===');
        console.log('✅ user_identity event received:', identity);
        currentUserEmail = identity.email;
        currentGroupId = identity.groupId;
        currentGroupName = identity.groupName;
        sessionStorage.setItem('chatterbox_username', identity.username); // Store username
        sessionStorage.setItem('chatterbox_useremail', identity.email);   // Store email
        console.log(`✅ Identity set - Email: ${currentUserEmail}, Username: ${identity.username}, Group: ${currentGroupName} (ID: ${currentGroupId})`);

        if (groupChatTitle && currentGroupName) {
            groupChatTitle.textContent = currentGroupName;
            console.log('✅ Group chat title updated');
        }
        setActiveChatWindow(groupChatArea);
        console.log('✅ Group chat area activated');
        
        // Request user list if it hasn't been populated yet
        setTimeout(() => {
            if (userList && userList.children.length <= 3) { // Only Group Chat, Back link, and Members title
                console.log('[CLIENT] User list seems empty, requesting user list...');
                socket.emit('request_userlist');
            }
        }, 1000);
        console.log('=== END USER IDENTITY DEBUG ===');
    });

    socket.on('private_chat_initiated', (data) => {
        console.log(`[CLIENT] Private chat initiated event. Data:`, data, `My email: ${currentUserEmail}`);
        createOrFocusPmWindow(data.email, data.roomName);
        if (canPlaySound && document.hidden) {
            notificationSound.play().catch(e => console.warn("Error playing sound for PM initiation:", e));
        }
    });

    socket.on('private_chat_failed', (data) => {
        console.error('Private chat failed:', data.error);
        alert(`Could not start private chat: ${data.error}`);
    });

    socket.on('receive_private_message', (messageData) => {
        console.log('[CLIENT] Received PM event. Message Data:', messageData, `My email: ${currentUserEmail}`);
        const partnerEmail = messageData.user === currentUserEmail
            ? activePrivateChats[messageData.roomName]?.partnerEmail
            : messageData.user;

        if (partnerEmail) {
            createOrFocusPmWindow(partnerEmail, messageData.roomName);
            appendPmMessage(messageData, messageData.roomName, messageData.user === currentUserEmail);
        } else {
            console.warn("[CLIENT] Could not determine partner for incoming PM. Message Data:", messageData);
        }
    });

    function populateEmojiPanel() {
        if (!emojiPanel || !messageInput) return;
        emojiPanel.innerHTML = '';
        EMOJI_LIST.forEach(emoji => {
            const emojiSpan = document.createElement('span');
            emojiSpan.textContent = emoji;
            emojiSpan.setAttribute('role', 'button');
            emojiSpan.setAttribute('aria-label', `Emoji ${emoji}`);
            emojiSpan.addEventListener('click', () => {
                messageInput.value += emoji;
                emojiPanel.classList.add('hidden');
                messageInput.focus();
            });
            emojiPanel.appendChild(emojiSpan);
        });
    }

    if (emojiButton && emojiPanel) {
        emojiButton.addEventListener('click', (event) => {
            event.stopPropagation();
            emojiPanel.classList.toggle('hidden');
            if (!emojiPanel.classList.contains('hidden') && messageInput) {
                messageInput.focus();
            }
        });

        document.addEventListener('click', (event) => {
            if (emojiPanel && !emojiPanel.classList.contains('hidden') && !emojiPanel.contains(event.target) && event.target !== emojiButton) {
                emojiPanel.classList.add('hidden');
            }
        });
        populateEmojiPanel();
    }

    if (groupChatArea) {
        setActiveChatWindow(groupChatArea);
    } else {
        console.error("Group chat area (#group-chat-area) not found!");
    }

    const logoutForm = document.getElementById('logout-form');
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
                window.location.href = '/'; // Fallback redirect
            }
        });
    }

    console.log("Chatterbox client.js loaded for group chat functionality.");
    
    // Debug function to test message display
    window.testMessageDisplay = function() {
        console.log('=== TESTING MESSAGE DISPLAY ===');
        const testData = {
            user: 'TestUser',
            email: 'test@example.com',
            text: 'This is a test message',
            timestamp: new Date(),
            groupId: currentGroupId
        };
        console.log('Testing with data:', testData);
        displayPublicMessage(testData);
        console.log('=== END TEST ===');
    };
    
    // Debug function to check DOM elements
    window.checkDOMElements = function() {
        console.log('=== DOM ELEMENTS CHECK ===');
        console.log('messagesList:', messagesList);
        console.log('messageForm:', messageForm);
        console.log('messageInput:', messageInput);
        console.log('userList:', userList);
        console.log('groupChatArea:', groupChatArea);
        console.log('=== END DOM CHECK ===');
    };
});
