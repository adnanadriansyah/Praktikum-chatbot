let chatHistory = [];

// Load chat history from localStorage on startup
function loadChatHistory() {
    const saved = localStorage.getItem("geminiChatHistory");
    if (!saved) return;
    
    try {
        chatHistory = JSON.parse(saved);
        const messagesContainer = document.getElementById("messages");
        const welcomeScreen = document.getElementById("welcome-screen");
        
        if (!messagesContainer) return;
        
        // Hide welcome screen if there's history
        if (welcomeScreen && chatHistory.length > 0) {
            welcomeScreen.style.display = "none";
        }
        
        // Render saved messages
        chatHistory.forEach(msg => {
            const messageDiv = createMessageElement(msg.sender, msg.text);
            const typingEl = document.getElementById("typing");
            if (typingEl) {
                messagesContainer.insertBefore(messageDiv, typingEl);
            }
        });
        
        scrollToBottom();
    } catch (e) {
        console.error("Failed to load chat history:", e);
    }
}

// Save chat history to localStorage
function saveChatHistory() {
    localStorage.setItem("geminiChatHistory", JSON.stringify(chatHistory));
}

function createMessageElement(sender, text) {
    const messageDiv = document.createElement("div");
    messageDiv.className = `message ${sender}`;
    
    const avatar = document.createElement("div");
    avatar.className = "avatar";
    avatar.textContent = sender === "user" ? "👤" : "🤖";
    
    const content = document.createElement("div");
    content.className = "message-content";
    content.textContent = text;
    
    messageDiv.appendChild(avatar);
    messageDiv.appendChild(content);
    
    return messageDiv;
}

function addMessage(sender, text) {
    const messagesContainer = document.getElementById("messages");
    if (!messagesContainer) return;
    
    const typingIndicator = document.getElementById("typing");
    
    // Hide welcome screen
    const welcomeScreen = document.getElementById("welcome-screen");
    if (welcomeScreen) {
        welcomeScreen.style.display = "none";
    }
    
    // Create and add message
    const messageDiv = createMessageElement(sender, text);
    if (typingIndicator) {
        messagesContainer.insertBefore(messageDiv, typingIndicator);
    } else {
        messagesContainer.appendChild(messageDiv);
    }
    
    // Save to history
    chatHistory.push({ sender, text, time: new Date() });
    saveChatHistory();
    
    // Scroll to bottom
    scrollToBottom();
}

function showTyping() {
    const typingContainer = document.getElementById("typing");
    if (typingContainer) {
        typingContainer.classList.add("show");
    }
    scrollToBottom();
}

function hideTyping() {
    const typingContainer = document.getElementById("typing");
    if (typingContainer) {
        typingContainer.classList.remove("show");
    }
}

function scrollToBottom() {
    const wrapper = document.getElementById("messages-wrapper");
    if (!wrapper) return;
    setTimeout(() => {
        wrapper.scrollTop = wrapper.scrollHeight;
    }, 50);
}

function clearChat() {
    if (chatHistory.length === 0) return;
    
    if (confirm("Start a new chat? This will delete the current conversation.")) {
        chatHistory = [];
        localStorage.removeItem("geminiChatHistory");
        const messagesContainer = document.getElementById("messages");
        const welcomeScreen = document.getElementById("welcome-screen");
        
        if (messagesContainer) {
            // Remove all messages
            const messages = messagesContainer.querySelectorAll(".message");
            messages.forEach(msg => msg.remove());
        }
        
        // Show welcome screen again
        if (welcomeScreen) {
            welcomeScreen.style.display = "flex";
        }
    }
}

function send(event) {
    if (event) event.preventDefault();
    
    const input = document.getElementById("msg");
    const sendBtn = document.getElementById("send-btn");
    
    if (!input || !sendBtn) return;
    
    const message = input.value.trim();
    if (!message) return;
    
    // Disable button during request
    sendBtn.disabled = true;
    sendBtn.textContent = "Sending...";
    
    // Add user message
    addMessage("user", message);
    input.value = "";
    autoResizeTextarea();
    
    // Show typing indicator
    showTyping();
    
// Send to server
    fetch("http://localhost:8080/chat", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ message: message })
    })
    .then(res => {
        if (!res.ok) {
            throw new Error("Server error: " + res.statusText);
        }
        return res.json();
    })
    .then(data => {
        hideTyping();
        const responseText = data.response || data.error || "Maaf, terjadi kesalahan.";
        addMessage("bot", responseText);
    })
    .catch(err => {
        hideTyping();
        addMessage("bot", "Terjadi kesalahan koneksi. Silakan cek server dan coba lagi.");
        console.error("Error:", err);
    })
    .finally(() => {
        // Re-enable button
        sendBtn.disabled = false;
        sendBtn.textContent = "Send";
        input.focus();
    });
}

// Auto-resize textarea as user types
function autoResizeTextarea() {
    const textarea = document.getElementById("msg");
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = Math.min(textarea.scrollHeight, 200) + "px";
}

// Event listeners
document.addEventListener("DOMContentLoaded", () => {
    const input = document.getElementById("msg");
    
    if (!input) return;
    
    // Load saved chat history
    loadChatHistory();
    
    // Auto-resize textarea on input
    input.addEventListener("input", autoResizeTextarea);
    
    // Send on Enter (no newline)
    input.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            send();
        }
    });
    
    // Focus input on load
    input.focus();
});
