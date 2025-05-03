// chat.js
// DOM elements
const chatMessages = document.getElementById("chat-messages");
const chatInput = document.getElementById("chat-input");
const chatSendButton = document.getElementById("chat-send-button");
const statusElement = document.getElementById("status"); // Also need status element

// Message types (should match Go backend)
const MSG_CHAT = "chat";
const MSG_JOIN = "join"; // To handle join messages

// State variables
const clientId = Math.random().toString(36).substr(2, 5); // Client ID for this browser session
let username = ""; // This will store the username fetched from the server
let ws = null;
let connected = false;
// peers and getUserColor are not strictly needed for basic chat, but included for consistency if desired later
let peers = {};
function getUserColor(id) {
  const hue = parseInt(id, 36) % 360;
  return `hsl(${hue}, 70%, 60%)`;
}


// --- Initialization and Username Fetch ---

// Function to fetch the username from the server (copied from docs.js)
async function fetchUsername() {
    try {
        const response = await fetch('/get-username');
        if (!response.ok) {
            console.error("Failed to fetch username:", response.status);
            // If not logged in or session invalid, redirect to login
            window.location.href = "/";
            return null;
        }
        const fetchedUsername = await response.text();
        return fetchedUsername;
    } catch (error) {
        console.error("Error fetching username:", error);
        // Redirect to login on fetch error
        window.location.href = "/";
        return null;
    }
}

// Main initialization function - fetches username, then initializes WebSocket
async function initializeChat() {
    const fetchedUsername = await fetchUsername();
    if (fetchedUsername) {
        username = fetchedUsername; // Set the global username
        initWebSocket(); // Initialize WebSocket for chat
    } else {
        // fetchUsername redirects to login if unsuccessful
    }
}


// --- WebSocket Functions ---

function initWebSocket() {
   if (ws) return; // Don't re-initialize if already connected

   console.log("Attempting to connect WebSocket...");
   if (statusElement) {
     statusElement.textContent = "Connecting...";
   }
   // Connect to the same WS endpoint as the docs app
   ws = new WebSocket("ws://" + location.host + "/ws");

   ws.onopen = () => {
     connected = true;
     console.log("WebSocket connected.");
     if (statusElement) {
       statusElement.textContent = "Connected as " + username;
     }
     // Backend handles the MSG_JOIN based on the session cookie now
     addSystemMessage("Connected to chat.");
   };

   // This handler receives all messages from the WebSocket
   ws.onmessage = handleIncomingMessage;

   ws.onclose = (event) => {
     connected = false;
     console.log("WebSocket disconnected:", event.code, event.reason);
     if (statusElement) {
       statusElement.textContent = "Disconnected. Please refresh to reconnect.";
     }
     addSystemMessage("Disconnected from chat.");
     // Optional: Attempt to reconnect after a delay
     // setTimeout(initWebSocket, 5000);
   };

   ws.onerror = (error) => {
     console.error("WebSocket error:", error);
      if (statusElement) {
        statusElement.textContent = "Error connecting to server. Please refresh.";
      }
     // Error is usually followed by close
   };
}

// Handles incoming WebSocket messages and directs them
function handleIncomingMessage(event) {
    try {
        const message = JSON.parse(event.data);
        // console.log("Received WS message:", message);

        switch (message.type) {
            case MSG_CHAT:
                // Handle chat messages.
                addChatMessage(message.username, message.content.text, message.clientId);
                break;
            case MSG_JOIN:
                 // Handle user join messages from the server
                 // This MSG_JOIN comes from the backend after a user connects their WS
                 addSystemMessage(`${message.username} joined the chat.`);
                 break;
            // Add other message types if needed for the chat app
            default:
                // console.log("Received unhandled WS message type:", message.type);
        }
    } catch (error) {
        console.error("Error processing WS message:", error);
    }
}


// Function to send messages via WebSocket
function sendMessage(type, content) {
  if (!connected || !ws) {
      console.warn("WebSocket not connected, cannot send message.");
      // Optionally display a message to the user
      // addSystemMessage("Message failed to send. Not connected.");
      return;
  }

  const message = {
    type: type,
    // ClientID and Username are added/overwritten by the Go backend from the session for security
    // We still include them here as chat.js might expect them for local display before broadcast
    clientId: clientId,
    username: username, // Use the fetched username
    content: content
  };

  ws.send(JSON.stringify(message));
}


// --- Chat UI Handling (Keep Existing) ---

function sendChatMessage() {
  const text = chatInput.value.trim();
  if (text.length === 0) return;

  // Send chat message to server
  sendMessage(MSG_CHAT, { text: text });


  // Add to local chat immediately for better perceived performance
  addChatMessage(username, text, clientId); // Use the fetched username and local clientId


  // Clear input
  chatInput.value = "";
  chatInput.focus();
}

function addChatMessage(sender, text, senderId) {
  const messageElement = document.createElement("div");
  messageElement.className = "chat-message " +
    (senderId === clientId ? "chat-message-self" : "chat-message-other");

  const senderElement = document.createElement("div");
  senderElement.className = "chat-message-sender";
  senderElement.textContent = sender;

  // Optional: Use user color if peers data was being managed (it's not in standalone chat)
  // For a simple chat, just use a default color or no color styling here.
   if (senderId !== clientId && peers && getUserColor) {
     const color = peers[senderId]?.color || getUserColor(senderId);
     senderElement.style.color = color;
   } else if (clientId && getUserColor) {
     senderElement.style.color = getUserColor(clientId);
   }


  const textElement = document.createElement("div");
  textElement.textContent = text;

  messageElement.appendChild(senderElement);
  messageElement.appendChild(textElement);

  if (chatMessages) {
    chatMessages.appendChild(messageElement);
    // Auto-scroll to the bottom
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }
}

function addSystemMessage(text) {
  const messageElement = document.createElement("div");
  messageElement.className = "system-message";
  messageElement.textContent = text;

  if (chatMessages) {
    chatMessages.appendChild(messageElement);
    // Auto-scroll to the bottom
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }
}


// --- Event Listeners ---

// Chat input and send button listeners
if (chatSendButton) {
  chatSendButton.addEventListener("click", sendChatMessage);
}
if (chatInput) {
  chatInput.addEventListener("keyup", (e) => {
    if (e.key === "Enter") sendChatMessage();
  });
}

// Initialize chat on DOMContentLoaded
document.addEventListener("DOMContentLoaded", initializeChat);