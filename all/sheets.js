// sheets.js
const rows = 30; // Ensure these match the Go backend constants
const cols = 30; // Ensure these match the Go backend constants
let sheetData = Array.from({ length: rows }, () => Array(cols).fill(''));
let selectedCell = null;

const colNames = [...Array(cols)].map((_, i) => {
  const first = String.fromCharCode(65 + (i % 26));
  const second = i >= 26 ? String.fromCharCode(64 + Math.floor(i / 26)) : '';
  return second + first;
});

// --- WebSocket and Chat Logic ---
// Message types (should match Go backend and docs.js)
const MSG_CHAT = "chat";
const MSG_JOIN = "join"; // To handle join messages in chat

// State variables for WebSocket/Chat
const clientId = Math.random().toString(36).substr(2, 5); // Client ID for this browser session
let username = ""; // This will store the username fetched from the server
let ws = null;
let connected = false;

// Note: The chat DOM elements (chatMessages, chatInput, chatSendButton) are used by chat.js,
// so ensure chat.js is loaded after sheets.js and the elements exist when chat.js runs.


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

// Main initialization function - fetches username, then loads sheet and initializes WebSocket
async function initializeSheet() {
    const fetchedUsername = await fetchUsername();
    if (fetchedUsername) {
        username = fetchedUsername; // Set the global username
        loadSheet(); // Load sheet data via HTTP
        initWebSocket(); // Initialize WebSocket for chat
    } else {
        // fetchUsername redirects to login if unsuccessful
    }
}

// --- WebSocket Functions ---

function initWebSocket() {
   if (ws) return; // Don't re-initialize if already connected

   console.log("Attempting to connect WebSocket...");
   // Connect to the same WS endpoint as the docs app
   ws = new WebSocket("ws://" + location.host + "/ws");

   ws.onopen = () => {
     connected = true;
     console.log("WebSocket connected.");
     // No need to send MSG_JOIN here, the backend handles it from the session cookie
     addSystemMessage("Connected to chat.");
   };

   // This handler receives all messages from the WebSocket
   ws.onmessage = handleIncomingMessage;

   ws.onclose = (event) => {
     connected = false;
     console.log("WebSocket disconnected:", event.code, event.reason);
     addSystemMessage("Disconnected from chat.");
     // Optional: Attempt to reconnect after a delay
     // setTimeout(initWebSocket, 5000);
   };

   ws.onerror = (error) => {
     console.error("WebSocket error:", error);
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
                // Handle chat messages. The addChatMessage function should be available from chat.js
                if (typeof addChatMessage === 'function') {
                   addChatMessage(message.username, message.content.text, message.clientId);
                } else {
                   console.error("addChatMessage function not available.");
                }
                break;
            case MSG_JOIN:
                 // Handle user join messages from the server
                 // Note: This MSG_JOIN comes from the backend now after a user connects their WS
                 if (typeof addSystemMessage === 'function') {
                    addSystemMessage(`${message.username} joined the chat.`);
                 } else {
                    console.error("addSystemMessage function not available.");
                 }
                 break;
            // If you add real-time cell updates via WS, handle those cases here
            // case "cell-update":
            //     handleRemoteCellUpdate(message.content);
            //     break;
            default:
                // console.log("Received unhandled WS message type:", message.type);
        }
    } catch (error) {
        console.error("Error processing WS message:", error);
    }
}


// Function to send messages via WebSocket (copied from docs.js)
// This function is called by sendChatMessage in chat.js
function sendMessage(type, content) {
  if (!connected || !ws) {
      console.warn("WebSocket not connected, cannot send message.");
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


// --- Sheet Data Handling (Keep Existing) ---

async function loadSheet() {
  // Updated endpoint
  const res = await fetch('/sheets/get');
  if (!res.ok) {
      console.error("Error loading sheet data:", res.status);
      // Handle error, maybe redirect to login if unauthorized
      return;
  }
  sheetData = await res.json();
  renderTable();
}

function renderTable() {
  const table = document.getElementById('sheet');
  table.innerHTML = '';

  const headerRow = document.createElement('tr');
  headerRow.appendChild(document.createElement('th'));
  for (let j = 0; j < cols; j++) {
    const th = document.createElement('th');
    th.textContent = colNames[j];
    headerRow.appendChild(th);
  }
  table.appendChild(headerRow);

  for (let i = 0; i < rows; i++) {
    const tr = document.createElement('tr');
    const rowLabel = document.createElement('th');
    rowLabel.textContent = i + 1;
    tr.appendChild(rowLabel);

    for (let j = 0; j < cols; j++) {
      const td = document.createElement('td');
      td.contentEditable = true;
      td.dataset.row = i;
      td.dataset.col = j;

      const rawVal = (sheetData[i] && sheetData[i][j]) || '';
      let displayVal = rawVal;
      td.className = '';

      if (rawVal && rawVal.startsWith('=')) {
        try {
          displayVal = evaluateFormula(rawVal, sheetData);
        } catch (e) {
          console.error("Formula error:", rawVal, e);
          displayVal = 'ERR';
          td.classList.add('error');
        }
      }

      td.textContent = displayVal;

      td.addEventListener('focus', () => {
        selectedCell = td;
        document.getElementById('functionBar').value = (sheetData[i] && sheetData[i][j]) || '';
      });

      td.addEventListener('input', () => {
        const row = parseInt(td.dataset.row);
        const col = parseInt(td.dataset.col);
        if (!sheetData[row]) {
           sheetData[row] = Array(cols).fill('');
        }
        sheetData[row][col] = td.textContent;
        document.getElementById('functionBar').value = td.textContent;
      });

      td.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          td.blur();
        }
      });

      td.addEventListener('blur', async () => {
        const row = parseInt(td.dataset.row);
        const col = parseInt(td.dataset.col);
        const newVal = (sheetData[row] && sheetData[row][col]) || '';

        await fetch('/sheets/update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ row, col, val: newVal })
        });

        // Re-render after updating
        setTimeout(loadSheet, 100);
      });

      tr.appendChild(td);
    }

    table.appendChild(tr);
  }
}

function evaluateFormula(formula, currentSheetData) {
  if (!formula.startsWith('=')) return formula;

  const expression = formula.slice(1).replace(/[A-Z]+[0-9]+/g, ref => {
    const col = columnLabelToIndex(ref.match(/[A-Z]+/)[0]);
    const row = parseInt(ref.match(/[0-9]+/)[0]) - 1;

    if (row >= 0 && row < rows && col >= 0 && col < cols) {
      const val = (currentSheetData[row] && currentSheetData[row][col]) || '';
      if (val.startsWith('=')) {
          try {
             return evaluateFormula(val, currentSheetData);
          } catch {
             return 'NaN';
          }
      }
      return parseFloat(val) || 0;
    }
    return 0;
  });

  try {
    const result = new Function('return ' + expression)();
    if (typeof result === 'number' && isFinite(result)) {
        return result.toString();
    } else if (typeof result === 'string') {
        return result;
    } else {
        return 'ERR';
    }
  } catch (e) {
     console.error("Error evaluating expression:", expression, e);
     return 'ERR';
  }
}

function columnLabelToIndex(label) {
  let index = 0;
  for (let i = 0; i < label.length; i++) {
    index *= 26;
    index += label.charCodeAt(i) - 64;
  }
  return index - 1;
}

function exportCSV() {
  let csv = sheetData.map(row => row.map(cell => `"${cell.replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'sheet.csv';
  a.click();
  URL.revokeObjectURL(url);
}

document.getElementById('csvInput').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function (event) {
    const lines = event.target.result.split('\n').slice(0, rows);
    for (let i = 0; i < rows; i++) {
      const cells = (lines[i] || '').split(',').slice(0, cols).map(cell =>
        cell.trim().replace(/^"|"$/g, '').replace(/""/g, '"')
      );
      if (!sheetData[i]) {
         sheetData[i] = Array(cols).fill('');
      }
      for(let j=0; j<cols; j++){
          sheetData[i][j] = cells[j] !== undefined ? cells[j] : '';
      }
    }
    renderTable();
  };
  reader.readAsText(file);
});

document.getElementById('functionBar').addEventListener('change', async (e) => {
  if (!selectedCell) return;
  const row = parseInt(selectedCell.dataset.row);
  const col = parseInt(selectedCell.dataset.col);
  const newVal = e.target.value;

  if (!sheetData[row]) {
     sheetData[row] = Array(cols).fill('');
  }
  sheetData[row][col] = newVal;

  await fetch('/sheets/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ row, col, val: newVal })
  });

  renderTable();
});

// --- Initialization Call ---

// Start the process by fetching username, then loading sheet and initializing WebSocket
document.addEventListener("DOMContentLoaded", initializeSheet);

// Note: addChatMessage and addSystemMessage are defined in chat.js
// Ensure chat.js is loaded AFTER sheets.js in the HTML.