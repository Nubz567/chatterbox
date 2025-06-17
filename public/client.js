const socket = io({
    transports: ['websocket'] // Force WebSocket connection, more reliable on Vercel
});

document.addEventListener('DOMContentLoaded', () => {
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
            if (messageInput.value) {
                socket.emit('chat message', messageInput.value);
                socket.emit('typing_stop'); // Also clear typing for self on send
                clearTimeout(typingTimeout);
                currentlyTyping[currentUserEmail] = false; // Clear self from local typing display
                updateTypingIndicator();
                messageInput.value = '';
            }
        });
    }

    function displayPublicMessage(data) {
        if (!messagesList) return;
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

        if (currentUserEmail && data.user === currentUserEmail) {
            item.classList.add('my-message');
        } else {
            item.classList.add('other-message');
        }
        messagesList.appendChild(item);
        messagesList.scrollTop = messagesList.scrollHeight;

        if (data.user !== currentUserEmail && canPlaySound && document.hidden) {
            notificationSound.play().catch(e => console.warn("Error playing sound for group chat:", e));
        }
    }

    socket.on('load history', (history) => {
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
        displayPublicMessage(data);
    });

    socket.on('update userlist', (groupMembers) => {
        console.log('--- USER LIST DATA RECEIVED FROM SERVER ---');
        console.log(groupMembers);
        const localUserEmail = sessionStorage.getItem('chatterbox_useremail');
        const localUsername = sessionStorage.getItem('chatterbox_username'); // Get current user's username

        if (!userList) {
            console.error('[CLIENT] userList element not found!');
            return;
        }
        userList.innerHTML = '';

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

        if (groupMembers && groupMembers.length > 0) {
            // First, display the current user if they are in the list or known locally
            if (localUsername) {
                const selfItem = document.createElement('li');
                selfItem.textContent = `${localUsername} (You)`;
                selfItem.classList.add('cannot-pm'); // Can't PM self
                userList.appendChild(selfItem);
            }

            // Then, display other users
            groupMembers.forEach((member) => {
                let memberEmail = '';
                let memberUsername = '';

                if (typeof member === 'object' && member !== null && member.email && member.username) {
                    memberEmail = member.email;
                    memberUsername = member.username;
                } else if (typeof member === 'string') {
                    memberUsername = member; 
                    console.warn('[CLIENT] Received string username in userlist, PMs may not work for:', member);
                } else {
                    console.warn('[CLIENT] Invalid user data in groupMembers array:', member);
                    return; // Skip this invalid entry
                }

                // Skip if this member is the current user (already displayed)
                if (memberEmail === localUserEmail || memberUsername === localUsername) {
                    return; 
                }

                const item = document.createElement('li');
                item.textContent = memberUsername;
                
                if (memberEmail) { 
                    item.classList.add('can-pm');
                    item.dataset.email = memberEmail;
                    item.dataset.username = memberUsername; 

                    item.addEventListener('click', (event) => {
                        const clickedItem = event.currentTarget;
                        const targetUserEmail = clickedItem.dataset.email;
                        console.log(`Clicked to PM. Target Username: ${memberUsername}, Target Email: ${targetUserEmail}`);
                        if (targetUserEmail) {
                            socket.emit('start_private_chat', { targetUserEmail: targetUserEmail });
                        } else {
                            console.error('Could not start PM: targetUserEmail is missing for user:', memberUsername);
                        }
                    });
                } else {
                    item.classList.add('cannot-pm'); 
                }
                userList.appendChild(item);
            });
        } else {
            // Only show current user if no other members
            if (localUsername) {
                const selfItem = document.createElement('li');
                selfItem.textContent = `${localUsername} (You)`;
                selfItem.classList.add('cannot-pm');
                userList.appendChild(selfItem);
            } else {
                const noMembersLi = document.createElement('li');
                noMembersLi.textContent = 'No members currently in this group.'; // Changed message
                noMembersLi.style.fontStyle = 'italic';
                noMembersLi.style.padding = '5px 0';
                userList.appendChild(noMembersLi);
            }
        }
    });

    socket.on('connect', () => {
        console.log('Connected to server via Socket.IO');
    });

    socket.on('disconnect', (reason) => {
        console.log('Disconnected from server:', reason);
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
        currentUserEmail = identity.email;
        currentGroupId = identity.groupId;
        currentGroupName = identity.groupName;
        sessionStorage.setItem('chatterbox_username', identity.username); // Store username
        sessionStorage.setItem('chatterbox_useremail', identity.email);   // Store email
        console.log(`My identity: ${currentUserEmail} (Username: ${identity.username}), Group: ${currentGroupName} (ID: ${currentGroupId})`);

        if (groupChatTitle && currentGroupName) {
            groupChatTitle.textContent = currentGroupName;
        }
        setActiveChatWindow(groupChatArea);
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
});
