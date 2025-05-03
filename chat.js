// chat.js
// DOM elements
const chatMessages = document.getElementById("chat-messages");
const chatInput = document.getElementById("chat-input");
const chatSendButton = document.getElementById("chat-send-button");

// Message types (assuming these are shared with docs.js or handled appropriately)
// const MSG_CHAT = "chat";

// Chat event handlers
if (chatSendButton) {
  chatSendButton.addEventListener("click", sendChatMessage);
}
if (chatInput) {
  chatInput.addEventListener("keyup", (e) => {
    if (e.key === "Enter") sendChatMessage();
  });
}


function sendChatMessage() {
  const text = chatInput.value.trim();
  if (text.length === 0) return;

  // Send chat message to server (assuming sendMessage function is available globally or imported)
  if (typeof sendMessage === 'function') {
    sendMessage(MSG_CHAT, { text: text });
  } else {
    console.error("sendMessage function is not available");
  }

  // Add to local chat (assuming addChatMessage function is available globally or imported)
   if (typeof addChatMessage === 'function') {
     addChatMessage(username, text, clientId); // Assuming username and clientId are available globally
   } else {
    console.error("addChatMessage function is not available");
  }


  // Clear input
  chatInput.value = "";
  chatInput.focus();
}

function addChatMessage(sender, text, senderId) {
  const messageElement = document.createElement("div");
  messageElement.className = "chat-message " +
    (senderId === clientId ? "chat-message-self" : "chat-message-other"); // Assuming clientId is available globally

  const senderElement = document.createElement("div");
  senderElement.className = "chat-message-sender";
  senderElement.textContent = sender;

  // Use the sender's color for their name (assuming peers and getUserColor are available globally)
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
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }
}

function addSystemMessage(text) {
  const messageElement = document.createElement("div");
  messageElement.className = "system-message";
  messageElement.textContent = text;

  if (chatMessages) {
    chatMessages.appendChild(messageElement);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }
}