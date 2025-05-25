document.addEventListener('DOMContentLoaded', () => {
    const registerForm = document.getElementById('register-form');
    const messageDiv = document.getElementById('register-message');

    // Clear previous messages from URL params if any
    if (messageDiv) messageDiv.style.display = 'none';
    
    // Display messages from URL (though form submission will now handle this primarily)
    const urlParams = new URLSearchParams(window.location.search);
    const errorParam = urlParams.get('error');
    const successParam = urlParams.get('success');

    if (errorParam) {
        // This block can be simplified or removed if all errors are shown via form submission handling
        showMessage(messageDiv, `An error occurred: ${errorParam}`, true);
        window.history.replaceState({}, document.title, window.location.pathname);
    } else if (successParam) {
        // This block can be simplified or removed if all successes are shown via form submission handling
        showMessage(messageDiv, `Success: ${successParam}`, false);
        window.history.replaceState({}, document.title, window.location.pathname);
    }

    if (registerForm) {
        registerForm.addEventListener('submit', async (event) => {
            event.preventDefault(); // Prevent default form submission
            
            // Clear previous messages
            showMessage(messageDiv, '', false, true);

            const formData = new FormData(registerForm);
            const data = Object.fromEntries(formData.entries());

            // Basic client-side validation (optional, as server validates too)
            if (data.password !== data.confirmPassword) {
                showMessage(messageDiv, 'Passwords do not match.', true);
                return;
            }
            // Add other client-side checks if desired (e.g., username length)

            try {
                const response = await fetch('/register', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(data)
                    // No credentials needed for register, session is established on login
                });

                const result = await response.json();

                if (response.ok && result.success) {
                    // Redirect to login page with a success message parameter
                    if (result.redirectTo) {
                         window.location.href = `${result.redirectTo}?success=registered`;
                    } else {
                        // Fallback, though redirectTo should be provided
                        window.location.href = '/?success=registered'; 
                    }
                } else {
                    // Display error message, optionally highlighting the field
                    let errorMessage = result.message || 'Registration failed. Please try again.';
                    if (result.field) {
                        const fieldElement = document.getElementById(result.field);
                        if (fieldElement) {
                            // You could add a class to highlight the field or focus it
                            fieldElement.focus(); 
                            // errorMessage += ` (Field: ${result.field})`; // Or append field info
                        }
                    }
                    showMessage(messageDiv, errorMessage, true);
                }
            } catch (error) {
                console.error('Registration submission error:', error);
                showMessage(messageDiv, 'An unexpected error occurred. Please check console.', true);
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