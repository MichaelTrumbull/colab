// docs.js
// DOM elements
const editor = document.getElementById("editor");
const lineNumbers = document.getElementById("line-numbers");
const cursorsContainer = document.getElementById("cursors-container");
const welcomeDialog = document.getElementById("welcome-dialog");
const usernameInput = document.getElementById("username-input");
const joinButton = document.getElementById("join-button");
const statusElement = document.getElementById("status");

// Message types
const MSG_TEXT = "text";
const MSG_CURSOR = "cursor";
const MSG_JOIN = "join";
const MSG_CHAT = "chat"; // Included here as well for message handling

// State variables
const clientId = Math.random().toString(36).substr(2, 5);
let username = "";
let ws = null;
let peers = {}; // {clientId: {username, position, color}}
let charWidth = 8.4; // Approximate character width in pixels
let lineHeight = 19.2; // Approximate line height in pixels
let connected = false;
let lastTextUpdate = Date.now();
let textDebounceTimeout = null;
let usernameLoaded = false;

// Initialize
//if (usernameInput) {
//  usernameInput.focus();
//}


// Generate a color for a user
function getUserColor(id) {
  const hue = parseInt(id, 36) % 360;
  return `hsl(${hue}, 70%, 60%)`;
}

// Event handlers for joining
//if (joinButton) {
//  joinButton.addEventListener("click", joinDocument);
//}
//if (usernameInput) {
//  usernameInput.addEventListener("keyup", (e) => {
//    if (e.key === "Enter") joinDocument();
//  });
//}

function joinDocument(fetchedUsername) {
    username = fetchedUsername.trim(); // Use the fetched username
  
    if (username.length === 0) {
      // This case should ideally not happen if login worked, but good safeguard
      alert("Error getting username. Please log in again.");
      // Optional: Redirect to login page
      // window.location.href = "/";
      return;
    }
  
    usernameLoaded = true; // Mark username as loaded
  
    // Hide the welcome dialog if it's still visible (it might be if you refresh directly on /docs)
     if (welcomeDialog) {
       welcomeDialog.style.display = "none";
     }
  
  
    initWebSocket();
}

async function fetchUsername() {
    try {
        const response = await fetch('/get-username');
        if (!response.ok) {
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

document.addEventListener("DOMContentLoaded", async () => {
    // Fetch username after the DOM is fully loaded
    const fetchedUsername = await fetchUsername();
    if (fetchedUsername) {
        // If username is fetched successfully, proceed to join document
        joinDocument(fetchedUsername);
    } else {
        // fetchUsername redirects to login if unsuccessful
    }
});

function initWebSocket() {
    if (!usernameLoaded) {
        console.error("Username not loaded yet, cannot initialize WebSocket.");
        return; // Prevent connecting before username is known
    }
 
   if (statusElement) {
     statusElement.textContent = "Connecting...";
   }
 
   ws = new WebSocket("ws://" + location.host + "/ws");
 
   ws.onopen = () => {
     connected = true;
     if (statusElement) {
       statusElement.textContent = "Connected as " + username;
     }
 
     // Send join message with username
     sendMessage(MSG_JOIN, null); // username is now set globally
 
     // Add system message to chat (assuming addSystemMessage is available globally)
     if (typeof addSystemMessage === 'function') {
       addSystemMessage("You joined the document");
     }
   };
 
   ws.onclose = () => {
     connected = false;
     if (statusElement) {
       statusElement.textContent = "Disconnected. Please refresh to reconnect.";
     }
     // Add system message to chat (assuming addSystemMessage is available globally)
     if (typeof addSystemMessage === 'function') {
       addSystemMessage("Disconnected from server");
     }
   };
 
   ws.onerror = (error) => {
     console.error("WebSocket error:", error);
     if (statusElement) {
        statusElement.textContent = "Error connecting to server. Please refresh.";
     }
   };
 
   ws.onmessage = handleIncomingMessage;
 }

function handleIncomingMessage(event) {
  try {
    const message = JSON.parse(event.data);

    // Handle different message types
    switch (message.type) {
      case MSG_TEXT:
        handleTextUpdate(message);
        break;
      case MSG_CURSOR:
        handleCursorUpdate(message);
        break;
      case MSG_JOIN:
        handleUserJoin(message);
        break;
      case MSG_CHAT:
        // Handle chat messages (assuming handleChatMessage is available globally)
        if (typeof handleChatMessage === 'function') {
          handleChatMessage(message);
        }
        break;
    }
  } catch (error) {
    console.error("Error handling message:", error);
  }
}

function handleTextUpdate(message) {
  if (message.clientId === clientId) return;

  const content = message.content;
  if (!content || typeof content.text !== 'string') return;

  // Save current cursor position
  const cursorPos = editor.selectionStart;

  // Update the text
  if (editor) {
    editor.value = content.text;
  }


  // Restore cursor position
  if (editor) {
    editor.setSelectionRange(cursorPos, cursorPos);
  }


  // Update line numbers
  updateLineNumbers();
}

function handleCursorUpdate(message) {
  if (message.clientId === clientId) return;

  const content = message.content;
  if (!content || typeof content.position !== 'number') return;

  // Store peer information
  if (!peers[message.clientId]) {
    peers[message.clientId] = {
      username: message.username,
      position: content.position,
      color: getUserColor(message.clientId)
    };
  } else {
    peers[message.clientId].position = content.position;
    peers[message.clientId].username = message.username;
  }

  // Render all cursors
  renderCursors();
}

function handleUserJoin(message) {
    if (message.clientId === clientId) return;
  
    // Another user joined
    if (statusElement) {
      statusElement.textContent = `${message.username} joined the document`;
      setTimeout(() => {
        if (connected && statusElement) statusElement.textContent = "Connected as " + username;
      }, 3000);
    }
  
    // Store peer information with color
    peers[message.clientId] = {
      username: message.username,
      position: 0,
      color: getUserColor(message.clientId)
    };
  
    // Add system message to chat ONLY if our username is loaded (means we are properly in the session)
    if (usernameLoaded && typeof addSystemMessage === 'function') {
       addSystemMessage(`${message.username} joined the document`);
    }
  }

// This function is now in chat.js, but called from handleIncomingMessage in docs.js
// function handleChatMessage(message) { ... }

function sendMessage(type, content) {
  if (!connected || !ws) return;

  const message = {
    type: type,
    clientId: clientId,
    username: username,
    content: content
  };

  ws.send(JSON.stringify(message));
}

function sendTextUpdate() {
  if (editor) {
    sendMessage(MSG_TEXT, { text: editor.value });
  }
}

function sendCursorUpdate() {
   if (editor) {
    sendMessage(MSG_CURSOR, { position: editor.selectionStart });
   }
}

// This function is now in chat.js
// function sendChatMessage() { ... }

// This function is now in chat.js
// function addChatMessage(sender, text, senderId) { ... }

// This function is now in chat.js
// function addSystemMessage(text) { ... }

// Editor event listeners
if (editor) {
  editor.addEventListener("input", () => {
    updateLineNumbers();

    // Debounce text updates to reduce network traffic
    clearTimeout(textDebounceTimeout);
    const now = Date.now();

    // Send immediately if it's been more than 1 second since last update
    if (now - lastTextUpdate > 1000) {
      sendTextUpdate();
      lastTextUpdate = now;
    } else {
      // Otherwise debounce to 300ms
      textDebounceTimeout = setTimeout(() => {
        sendTextUpdate();
        lastTextUpdate = Date.now();
      }, 300);
    }

    // Always send cursor position
    sendCursorUpdate();
  });

  editor.addEventListener("click", sendCursorUpdate);
  editor.addEventListener("keyup", (e) => {
    // Only send cursor updates for navigation keys
    if (e.key.startsWith("Arrow") || e.key === "Home" || e.key === "End" ||
        e.key === "PageUp" || e.key === "PageDown") {
      sendCursorUpdate();
    }
  });

  editor.addEventListener("scroll", renderCursors);
}


// Update line numbers based on editor content
function updateLineNumbers() {
  if (!editor || !lineNumbers) return;
  const lines = editor.value.split("\n");
  let lineNumbersHTML = "";

  for (let i = 0; i < lines.length; i++) {
    lineNumbersHTML += (i + 1) + "\n";
  }

  lineNumbers.textContent = lineNumbersHTML;
}

// Render all remote cursors
function renderCursors() {
  if (!cursorsContainer || !editor) return;
  cursorsContainer.innerHTML = "";

  // Calculate positioning constants
  const scrollTop = editor.scrollTop;
  const scrollLeft = editor.scrollLeft;

  for (const [peerId, peerData] of Object.entries(peers)) {
    const position = peerData.position;
    const peerUsername = peerData.username;
    const color = peerData.color;

    // Calculate cursor position in x,y coordinates
    const textBeforeCursor = editor.value.substring(0, position);
    const lines = textBeforeCursor.split("\n");
    const lineIndex = lines.length - 1;
    const charIndex = lines[lineIndex].length;

    // Create cursor element
    const cursorElement = document.createElement("div");
    cursorElement.className = "remote-cursor";
    cursorElement.style.top = `${lineIndex * lineHeight - scrollTop + 5}px`;
    cursorElement.style.left = `${charIndex * charWidth - scrollLeft + 5}px`;
    cursorElement.style.background = color;

    // Create label element
    const labelElement = document.createElement("div");
    labelElement.className = "cursor-label";
    labelElement.textContent = peerUsername;
    labelElement.style.top = `${lineIndex * lineHeight - scrollTop - 16}px`;
    labelElement.style.left = `${charIndex * charWidth - scrollLeft + 8}px`;
    labelElement.style.backgroundColor = color;

    cursorsContainer.appendChild(cursorElement);
    cursorsContainer.appendChild(labelElement);
  }
}

// Initial line numbers setup
updateLineNumbers();