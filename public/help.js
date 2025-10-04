window.addEventListener('load', function() {
    // Create help button
    const helpButton = document.createElement('button');
    helpButton.className = 'help-button';
    helpButton.innerHTML = '?';
    document.body.appendChild(helpButton);

    // Create help modal
    const helpModal = document.createElement('div');
    helpModal.className = 'help-modal';
    helpModal.innerHTML = `
        <div class="help-content">
            <button class="help-close">&times;</button>
            
            <div class="help-section">
                <h2>Welcome to Chatterbox!</h2>
                <p>Chatterbox is a real-time chat application that allows you to communicate with others through group chats and private messages.</p>
            </div>

            <div class="help-section">
                <h2>Features</h2>
                
                <h3>Group Chats</h3>
                <ul>
                    <li>Create your own groups and invite others using join codes</li>
                    <li>Join existing groups using their join codes</li>
                    <li>Leave groups you no longer want to be part of</li>
                    <li>Share join codes with others to let them join your groups</li>
                </ul>

                <h3>Private Messages</h3>
                <ul>
                    <li>Start private conversations with other users</li>
                    <li>Click on any user's name in the user list to start a PM</li>
                    <li>Switch between different PM conversations easily</li>
                </ul>

                <h3>User Interface</h3>
                <ul>
                    <li>Clean and intuitive design</li>
                    <li>Real-time message updates</li>
                    <li>Easy navigation between different chats</li>
                    <li>Responsive design that works on all devices</li>
                </ul>
            </div>

            <div class="help-section">
                <h2>How to Use</h2>
                
                <h3>Getting Started</h3>
                <ol>
                    <li>Log in with your email and password</li>
                    <li>Create a new group or join an existing one</li>
                    <li>Start chatting with other group members</li>
                </ol>

                <h3>Managing Groups</h3>
                <ul>
                    <li>Visit the Groups page to manage your groups</li>
                    <li>Create new groups with custom names</li>
                    <li>Share join codes with others</li>
                    <li>Leave groups you no longer want to be part of</li>
                </ul>

                <h3>Private Messaging</h3>
                <ul>
                    <li>Click on any user's name in the user list</li>
                    <li>A new private chat window will open</li>
                    <li>Switch between different PMs using the user list</li>
                </ul>
            </div>

            <div class="help-section">
                <h2>Tips & Tricks</h2>
                <ul>
                    <li>If something doesn't work, refresh the page</li>
                    <li>Use the emoji panel to add emojis to your messages</li>
                    <li>Keep your join codes private to maintain group security</li>
                    <li>You can be part of multiple groups simultaneously</li>
                    <li>Switch between group chat and PMs easily using the sidebar</li>
                    <li>You can change your username and password in the options menu</li>
                </ul>
            </div>

            <div class="help-section">
                <h2>Recent Updates</h2>
                
                <div class="update-section">
                    <h3>Latest Features</h3>
                    <ul>
                        <li>Added emojis for messages</li>
                        <li>Added real-time typing indicators</li>
                        <li>Added a help section (this one)</li>
                        <li>Sending Pictures and videos</li>
                    </ul>
                </div>

                <div class="update-section">
                    <h3>Coming Soon</h3>
                    <ul>
                        <li>Even more emojis</li>
                        <li>Delete messages</li>
                        <li>User Bans</li>
                        <li>Voice messages</li>
                        <li>And more!</li>
                    </ul>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(helpModal);

    // Show modal when help button is clicked
    helpButton.addEventListener('click', function() {
        helpModal.classList.add('active');
    });

    // Hide modal when close button is clicked
    const closeButton = helpModal.querySelector('.help-close');
    closeButton.addEventListener('click', function() {
        helpModal.classList.remove('active');
    });

    // Hide modal when clicking outside the content
    helpModal.addEventListener('click', function(e) {
        if (e.target === helpModal) {
            helpModal.classList.remove('active');
        }
    });

    // Close modal with Escape key
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && helpModal.classList.contains('active')) {
            helpModal.classList.remove('active');
        }
    });
}); 