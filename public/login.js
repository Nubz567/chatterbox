document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('login-form');
    const errorDiv = document.getElementById('login-error-message');
    const successDiv = document.getElementById('login-success-message');

    // Clear previous messages from URL params if any, as we handle them via JS now
    if (errorDiv) errorDiv.style.display = 'none';
    if (successDiv) successDiv.style.display = 'none';

    // Display messages from URL (e.g., after registration)
    const urlParams = new URLSearchParams(window.location.search);
    const successParam = urlParams.get('success');
    const errorParam = urlParams.get('error'); // Keep for general errors not from form submission

    if (successParam === 'registered') {
        showMessage(successDiv, 'Registration successful! Please login.', false);
        // Clean the URL
        window.history.replaceState({}, document.title, window.location.pathname);
    }
    // You might have other non-form-submission errors passed via URL that you want to keep handling
    // For instance, if a redirect from another page includes an error query param.
    if (errorParam && errorParam !== 'invalid_credentials' && errorParam !== 'missing_email_or_password' && errorParam !== 'login_error') {
        // Handle general errors if needed, or remove this block if all errors come from form submissions
        showMessage(errorDiv, `An error occurred: ${errorParam}`, true);
        window.history.replaceState({}, document.title, window.location.pathname);
    }


    if (loginForm) {
        loginForm.addEventListener('submit', async (event) => {
            event.preventDefault(); // Prevent default form submission

            // Clear previous messages
            showMessage(errorDiv, '', false, true);
            showMessage(successDiv, '', false, true);

            const formData = new FormData(loginForm);
            const data = Object.fromEntries(formData.entries());

            try {
                const response = await fetch('/login', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(data),
                    credentials: 'include' // Important for sessions
                });

                const result = await response.json();

                if (response.ok && result.success) {
                    showMessage(successDiv, result.message, false);
                    if (result.redirectTo) {
                        window.location.href = result.redirectTo;
                    } else {
                        // Fallback if redirectTo is not provided, though it should be
                        window.location.href = '/groups'; 
                    }
                } else {
                    showMessage(errorDiv, result.message || 'Login failed. Please try again.', true);
                }
            } catch (error) {
                console.error('Login submission error:', error);
                showMessage(errorDiv, 'An unexpected error occurred during login. Please check console.', true);
            }
        });
    }
});

function showMessage(element, message, isError, clear = false) {
    if (!element) return;
    if (clear) {
        element.textContent = '';
        element.style.display = 'none';
        return;
    }
    element.textContent = message;
    element.className = isError ? 'error-message' : 'success-message';
    element.style.display = 'block';
} 