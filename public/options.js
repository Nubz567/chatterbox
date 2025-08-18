// Load theme immediately when script loads
const savedSettings = JSON.parse(localStorage.getItem('settings')) || {
    theme: 'light',
    brightness: 100,
    notifications: true,
    soundNotifications: true,
    showOnlineStatus: true,
    showTypingStatus: true
};

if (savedSettings.theme === 'dark') {
    document.body.classList.add('dark-theme');
} else {
    document.body.classList.remove('dark-theme');
}

window.addEventListener('load', () => {
    // Get modal elements
    const optionsButton = document.querySelector('.options-button');
    const optionsModal = document.querySelector('.options-modal');
    const closeButton = document.querySelector('.options-close');

    // Get settings elements
    const themeInputs = document.querySelectorAll('input[name="theme"]');
    const brightnessInput = document.getElementById('brightness');
    const brightnessValue = document.querySelector('#brightness + .range-value');
    const enableNotifications = document.getElementById('enable-notifications');
    const soundNotifications = document.getElementById('sound-notifications');
    const showOnlineStatus = document.getElementById('show-online-status');
    const showTypingStatus = document.getElementById('show-typing-status');
    const changePasswordForm = document.getElementById('change-password-form');
    const changeUsernameForm = document.getElementById('change-username-form');
    const newUsernameInput = document.getElementById('new-username-input');
    const changeUsernameMessage = document.getElementById('change-username-message');

    // Load saved settings
    function loadSettings() {
        const settings = JSON.parse(localStorage.getItem('settings')) || {
            theme: 'light',
            brightness: 100,
            notifications: true,
            soundNotifications: true,
            showOnlineStatus: true,
            showTypingStatus: true
        };

        // Apply theme immediately
        if (settings.theme === 'dark') {
            document.body.classList.add('dark-theme');
        } else {
            document.body.classList.remove('dark-theme');
        }
        
        // Update radio buttons
        themeInputs.forEach(input => {
            input.checked = input.value === settings.theme;
        });

        // Apply brightness
        brightnessInput.value = settings.brightness;
        brightnessValue.textContent = `${settings.brightness}%`;
        document.body.style.filter = `brightness(${settings.brightness}%)`;

        // Apply other settings
        enableNotifications.checked = settings.notifications;
        soundNotifications.checked = settings.soundNotifications;
        showOnlineStatus.checked = settings.showOnlineStatus;
        showTypingStatus.checked = settings.showTypingStatus;
    }

    // Save settings
    function saveSettings() {
        const settings = {
            theme: document.querySelector('input[name="theme"]:checked').value,
            brightness: parseInt(brightnessInput.value),
            notifications: enableNotifications.checked,
            soundNotifications: soundNotifications.checked,
            showOnlineStatus: showOnlineStatus.checked,
            showTypingStatus: showTypingStatus.checked
        };
        localStorage.setItem('settings', JSON.stringify(settings));
        
        // Apply theme immediately after saving
        if (settings.theme === 'dark') {
            document.body.classList.add('dark-theme');
        } else {
            document.body.classList.remove('dark-theme');
        }
    }

    // Show modal
    optionsButton.addEventListener('click', () => {
        optionsModal.classList.add('active');
    });

    // Hide modal
    function hideModal() {
        optionsModal.classList.remove('active');
    }

    closeButton.addEventListener('click', hideModal);
    window.addEventListener('click', (e) => {
        if (e.target === optionsModal) {
            hideModal();
        }
    });

    // Close modal with Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && optionsModal.classList.contains('active')) {
            hideModal();
        }
    });

    // Handle theme change
    themeInputs.forEach(input => {
        input.addEventListener('change', () => {
            if (input.value === 'dark') {
                document.body.classList.add('dark-theme');
            } else {
                document.body.classList.remove('dark-theme');
            }
            saveSettings();
        });
    });

    // Handle brightness change
    brightnessInput.addEventListener('input', () => {
        const value = brightnessInput.value;
        brightnessValue.textContent = `${value}%`;
        document.body.style.filter = `brightness(${value}%)`;
        saveSettings();
    });

    // Handle notification settings
    enableNotifications.addEventListener('change', saveSettings);
    soundNotifications.addEventListener('change', saveSettings);
    showOnlineStatus.addEventListener('change', saveSettings);
    showTypingStatus.addEventListener('change', saveSettings);

    // Handle password change
    if (changePasswordForm) {
        changePasswordForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const currentPassword = document.getElementById('current-password').value;
            const newPassword = document.getElementById('new-password').value;
            const confirmPassword = document.getElementById('confirm-password').value;
            const messageElement = document.getElementById('password-message');

            if (newPassword !== confirmPassword) {
                messageElement.textContent = 'New passwords do not match';
                messageElement.style.color = 'red';
                return;
            }

            try {
                const response = await fetch('/change-password', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        currentPassword,
                        newPassword
                    })
                });

                const data = await response.json();
                messageElement.textContent = data.message;
                messageElement.style.color = data.success ? 'green' : 'red';

                if (data.success) {
                    changePasswordForm.reset();
                }
            } catch (error) {
                messageElement.textContent = 'An error occurred. Please try again.';
                messageElement.style.color = 'red';
            }
        });
    }

    // Handle Username Change
    if (changeUsernameForm) {
        changeUsernameForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const newUsername = newUsernameInput.value.trim();

            if (!newUsername) {
                showMessage(changeUsernameMessage, 'New username cannot be empty.', true);
                return;
            }
            // Basic client-side validation (mirroring some server-side for quick feedback)
            if (newUsername.length < 3 || newUsername.length > 20) {
                showMessage(changeUsernameMessage, 'Username must be between 3 and 20 characters.', true);
                return;
            }
            if (!/^[a-zA-Z0-9_]+$/.test(newUsername)) {
                showMessage(changeUsernameMessage, 'Username can only contain letters, numbers, and underscores.', true);
                return;
            }

            try {
                const response = await fetch('/api/user/change-username', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ newUsername })
                });

                // Try to parse the response as JSON first
                let data;
                try {
                    data = await response.json();
                } catch (jsonError) {
                    // This means await response.json() failed (SyntaxError)
                    console.error('Failed to parse server response as JSON:', jsonError);
                    let actualResponseText = '[Could not read server response as text]';
                    try {
                        actualResponseText = await response.text();
                        console.error("Actual non-JSON server response:", actualResponseText);
                    } catch (textReadError) {
                        console.error("Error reading server response as text after JSON parse failed:", textReadError);
                    }
                    // Construct a new error that includes the non-JSON text if possible
                    let specificMessage = 'Received an invalid response from the server (expected JSON).';
                    if (actualResponseText && actualResponseText !== '[Could not read server response as text]' && actualResponseText.length < 200 && !actualResponseText.trim().startsWith('<')) {
                         specificMessage += ` Server said: ${actualResponseText}`;
                    } else if (actualResponseText && actualResponseText !== '[Could not read server response as text]') {
                        specificMessage += ` Please check the browser console for the full server response.`;
                    }
                    throw new Error(specificMessage); // This will be caught by the outer catch
                }

                // If we reach here, data is valid JSON
                if (response.ok && data.success) {
                    showMessage(changeUsernameMessage, data.message, false);
                    newUsernameInput.value = ''; // Clear input
                    const usernameDisplayElement = document.getElementById('username-display');
                    if (usernameDisplayElement && data.newUsername) {
                        usernameDisplayElement.textContent = data.newUsername;
                    }
                } else {
                    // Server responded with ok:false or success:false, or a non-2xx status with valid JSON error
                    showMessage(changeUsernameMessage, data.message || 'Failed to change username.', true);
                }

            } catch (error) {
                // This catches: 
                // 1. Network errors from fetch itself (e.g., server down)
                // 2. The custom error thrown above if JSON parsing failed
                // 3. Any other unexpected errors during the try block
                console.error('Error changing username process:', error); 
                let displayMessage = 'An unexpected error occurred. Please try again.';
                if (error.message) {
                    if (error.message.toLowerCase().includes('failed to fetch')) {
                        displayMessage = 'Could not connect to the server. Please check your connection.';
                    } else {
                        // This will now include our more specific message from the inner catch if JSON parsing failed
                        displayMessage = error.message; 
                    }
                }
                showMessage(changeUsernameMessage, displayMessage, true);
            }
        });
    }

    // Function to display messages (generic, can be used by new form too)
    function showMessage(element, message, isError = false) {
        if (!element) return;
        element.textContent = message;
        element.style.color = isError ? 'red' : 'green';
        element.style.display = 'block';
        // Clear message after a few seconds
        setTimeout(() => {
            element.style.display = 'none';
            element.textContent = '';
        }, 5000);
    }

    // Load settings on page load
    loadSettings();
}); 