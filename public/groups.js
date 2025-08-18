let currentUserEmail = null; // Store current user's email globally in this script

window.addEventListener('load', () => {
    const myGroupsList = document.getElementById('my-groups-list');
    const noGroupsMessage = document.getElementById('no-groups-message');
    const createGroupForm = document.getElementById('create-group-form');
    const newGroupNameInput = document.getElementById('new-group-name');
    const createGroupMessage = document.getElementById('create-group-message');
    const joinGroupForm = document.getElementById('join-group-form');
    const joinCodeInput = document.getElementById('join-code');
    const joinGroupMessage = document.getElementById('join-group-message');
    const usernameDisplay = document.getElementById('username-display');
    const groupListMessages = document.getElementById('group-list-messages');

    // Function to fetch and display username, and store email
    async function fetchAndStoreCurrentUser() {
        if (!usernameDisplay) return;
        try {
            const response = await fetch('/api/user', { credentials: 'include' });
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({})); // Try to parse error, default to empty obj
                throw new Error(errorData.error || 'Failed to fetch user data');
            }
            const userData = await response.json();
            if (userData && userData.username) {
                usernameDisplay.textContent = userData.username;
                currentUserEmail = userData.email; // Store email
            } else {
                usernameDisplay.textContent = 'User'; 
                currentUserEmail = null;
            }
        } catch (error) {
            console.error('Error fetching username:', error);
            usernameDisplay.textContent = 'Error'; 
            currentUserEmail = null;
        }
    }

    // Function to display messages (success or error)
    function showMessage(element, message, isError = false) {
        if (!element) return; 
        element.textContent = message;
        element.style.color = isError ? 'red' : 'green';
        element.style.display = 'block';
        setTimeout(() => { 
            if (element) { // Check if element still exists
                element.style.display = 'none'; 
                element.textContent = '';
            }
        }, 5000);
    }

    // Fetch and display user's groups
    async function fetchUserGroups() {
        try {
            const response = await fetch('/api/user/groups', { credentials: 'include' });
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({})); 
                throw new Error(errorData.error || 'Failed to fetch groups');
            }
            const groups = await response.json();
            renderGroups(groups);
        } catch (error) {
            console.error('Error fetching groups:', error);
            if (groupListMessages) {
                 showMessage(groupListMessages, error.message, true);
            }
        }
    }

    // Render groups in the list
    function renderGroups(groups) {
        if (!myGroupsList) {
            console.error("myGroupsList element not found, cannot render groups.");
            return;
        }
        myGroupsList.innerHTML = ''; 
        if (groups.length === 0) {
            if(noGroupsMessage) noGroupsMessage.style.display = 'block';
            const p = document.createElement('p');
            p.id = 'no-groups-message'; 
            p.textContent = 'You are not a member of any groups yet.';
            if(groups.length > 0 && noGroupsMessage) noGroupsMessage.style.display = 'none'; else myGroupsList.appendChild(p);
        } else {
            if(noGroupsMessage) noGroupsMessage.style.display = 'none';
            groups.forEach(group => {
                const listItem = document.createElement('li');
                let deleteButtonHTML = '';
                if (currentUserEmail && group.adminEmail === currentUserEmail) {
                    deleteButtonHTML = `<button class="delete-group-btn button-danger" data-group-id="${group.id}" data-group-name="${escapeHTML(group.name)}">Delete Group</button>`;
                }

                listItem.innerHTML = `
                    <div class="group-info-main">
                        <strong>${escapeHTML(group.name)}</strong>
                        <span class="admin-info">(Admin: ${escapeHTML(group.adminEmail)})</span>
                    </div>
                    <div class="join-code-display">
                        Join Code: <code>${escapeHTML(group.joinCode)}</code>
                        <button class="copy-btn" title="Copy join code" data-clipboard-text="${escapeHTML(group.joinCode)}">📋</button>
                    </div>
                    <div class="group-actions">
                        <button class="view-group-chat button-primary" data-group-id="${group.id}" data-group-name="${escapeHTML(group.name)}">Open Chat</button>
                        <button class="leave-group-btn button-danger" data-group-id="${group.id}" data-group-name="${escapeHTML(group.name)}">Leave Group</button>
                        ${deleteButtonHTML}
                    </div>
                `;
                
                listItem.querySelector('.view-group-chat').addEventListener('click', (e) => {
                    const groupId = e.target.dataset.groupId;
                    const groupName = e.target.dataset.groupName;
                    window.location.href = `/chat?groupId=${groupId}&groupName=${encodeURIComponent(groupName)}`;
                });

                listItem.querySelector('.leave-group-btn').addEventListener('click', handleLeaveGroup);
                
                const deleteBtn = listItem.querySelector('.delete-group-btn');
                if (deleteBtn) {
                    deleteBtn.addEventListener('click', handleDeleteGroup);
                }
                
                const copyBtn = listItem.querySelector('.copy-btn');
                if (copyBtn) {
                    copyBtn.addEventListener('click', (e) => {
                        const codeToCopy = e.target.dataset.clipboardText;
                        navigator.clipboard.writeText(codeToCopy).then(() => {
                            showMessage(e.target.closest('li').querySelector('.group-actions'), 'Copied!', false); // Show message in actions area
                        }).catch(err => {
                            console.error('Failed to copy text: ', err);
                            showMessage(e.target.closest('li').querySelector('.group-actions'), 'Copy failed.', true);
                        });
                    });
                }
                myGroupsList.appendChild(listItem);
            });
        }
    }

    // Handle Leave Group button click
    async function handleLeaveGroup(event) {
        const button = event.target;
        const groupId = button.dataset.groupId;
        const groupName = button.dataset.groupName;
        let response; 

        if (confirm(`Are you sure you want to leave the group "${escapeHTML(groupName)}"?`)) {
            try {
                response = await fetch(`/api/groups/${groupId}/leave`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' }, 
                    credentials: 'include'
                });
                const data = await response.json(); 
                if (!response.ok) {
                    throw new Error(data.error || `Failed to leave group. Status: ${response.status}`);
                }
                if (groupListMessages) {
                    showMessage(groupListMessages, data.message || `Successfully left group "${escapeHTML(groupName)}"!`, false);
                }
                fetchUserGroups(); 
            } catch (error) {
                console.error('Error leaving group:', error); 
                let errorMessage = 'An unexpected error occurred while trying to leave the group.';
                if (error instanceof SyntaxError && error.message.toLowerCase().includes("json")) {
                    errorMessage = `Received an invalid response from the server (expected JSON).`;
                    if (response) { 
                        try {
                            const textResponse = await response.text();
                            console.error("Actual non-JSON server response:", textResponse);
                            if (textResponse.length < 200 && !textResponse.trim().startsWith('<')) {
                                errorMessage += ` Server said: ${textResponse}`;
                            } else {
                                errorMessage += ` Please check the console for server response details.`;
                            }
                        } catch (textError) {
                            console.error("Could not read response text after JSON parse error:", textError);
                        }
                    }
                } else if (error.message) {
                    errorMessage = error.message;
                }
                if (groupListMessages) {
                    showMessage(groupListMessages, errorMessage, true);
                }
                if (response && response.ok && error instanceof SyntaxError) {
                    console.log('Group leave action was successful on server despite bad JSON response, refreshing list.');
                    fetchUserGroups();
                }
            }
        }
    }

    // --- NEW: Handle Delete Group button click ---
    async function handleDeleteGroup(event) {
        const button = event.target;
        const groupId = button.dataset.groupId;
        const groupName = button.dataset.groupName;
        let response; // To make it available in catch block

        if (confirm(`Are you sure you want to PERMANENTLY DELETE the group "${escapeHTML(groupName)}"? This cannot be undone.`)) {
            try {
                response = await fetch(`/api/groups/${groupId}`, {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include'
                });

                const data = await response.json(); // Expect JSON response

                if (!response.ok || !data.success) {
                    throw new Error(data.message || `Failed to delete group. Status: ${response.status}`);
                }
                
                if (groupListMessages) {
                    showMessage(groupListMessages, data.message || `Successfully deleted group "${escapeHTML(groupName)}"!`, false);
                }
                fetchUserGroups(); // Refresh the list

            } catch (error) {
                console.error('Error deleting group:', error);
                let errorMessage = 'An unexpected error occurred while trying to delete the group.';

                if (error instanceof SyntaxError && error.message.toLowerCase().includes("json")) {
                    errorMessage = `Received an invalid response from the server (expected JSON).`;
                    if (response) { 
                        try {
                            const textResponse = await response.text();
                            console.error("Actual non-JSON server response for delete:", textResponse);
                            if (textResponse.length < 200 && !textResponse.trim().startsWith('<')) {
                                errorMessage += ` Server said: ${textResponse}`;
                            } else {
                                errorMessage += ` Please check the console for details.`;
                            }
                        } catch (textError) {
                            console.error("Could not read response text after JSON parse error (delete):", textError);
                        }
                    }
                } else if (error.message) {
                    errorMessage = error.message;
                }

                if (groupListMessages) {
                    showMessage(groupListMessages, errorMessage, true);
                }

                // If server indicated success (200 OK) despite malformed JSON, still refresh
                if (response && response.ok && error instanceof SyntaxError) {
                    console.log('Group delete action might have been successful on server despite bad JSON, refreshing list.');
                    fetchUserGroups();
                }
            }
        }
    }

    // Handle Create Group form submission
    if (createGroupForm) {
        createGroupForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const groupName = newGroupNameInput.value.trim();
            if (!groupName) {
                showMessage(createGroupMessage, 'Group name cannot be empty.', true);
                return;
            }

            let response; // Make response available in the catch block

            try {
                response = await fetch('/api/groups/create', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: groupName }),
                    credentials: 'include'
                });

                const responseText = await response.text();
                let data;

                try {
                    data = JSON.parse(responseText);
                } catch (e) {
                    console.error("Failed to parse server response as JSON:", responseText);
                    if (!response.ok) {
                        throw new Error(`Server error: ${response.status} ${response.statusText}. Check console for response body.`);
                    }
                    throw new Error("Received an unreadable response from the server.");
                }

                if (!response.ok) {
                    throw new Error(data.message || 'Failed to create group');
                }

                showMessage(createGroupMessage, `Group "${escapeHTML(data.name)}" created! Join Code: ${data.joinCode}`, false);
                newGroupNameInput.value = '';
                fetchUserGroups(); 
            } catch (error) {
                console.error('Error creating group:', error);
                // We're now throwing more descriptive errors, so this should be more helpful.
                showMessage(createGroupMessage, error.message, true);
            }
        });
    }

    // Handle Join Group form submission
    if (joinGroupForm) {
        joinGroupForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const code = joinCodeInput.value.trim();
            if (!code) {
                showMessage(joinGroupMessage, 'Join code cannot be empty.', true);
                return;
            }
            try {
                const response = await fetch('/api/groups/join', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ joinCode: code }),
                    credentials: 'include'
                });
                const data = await response.json();
                if (!response.ok) {
                    throw new Error(data.error || 'Failed to join group');
                }
                showMessage(joinGroupMessage, `Successfully joined group "${escapeHTML(data.name)}"!`, false);
                joinCodeInput.value = '';
                fetchUserGroups(); 
            } catch (error) {
                console.error('Error joining group:', error);
                showMessage(joinGroupMessage, error.message, true);
            }
        });
    }

    function escapeHTML(str) {
        if (str === null || str === undefined) return '';
        const div = document.createElement('div');
        div.appendChild(document.createTextNode(String(str)));
        return div.innerHTML;
    }

    // Initial fetch of user data and then groups
    async function initializePage() {
        // Show loading indicator
        if (myGroupsList) {
            myGroupsList.innerHTML = '<li style="text-align: center; padding: 20px; color: #666;">Loading groups...</li>';
        }
        
        await fetchAndStoreCurrentUser(); // Fetch user data first
        await fetchUserGroups();          // Then fetch their groups
    }

    initializePage();

    const logoutForm = document.querySelector('form[action="/logout"]');
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
}); 