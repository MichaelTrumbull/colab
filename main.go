package main

import (
	"crypto/rand"
	"embed"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math/big"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"golang.org/x/crypto/bcrypt"
)

//go:embed index.html
//go:embed docs.js
//go:embed chat.js
//go:embed style.css
//go:embed landing.html
//go:embed sheets.html
//go:embed sheets.js
//go:embed sheets.css
var embeddedFiles embed.FS

// --- Login and Session Management ---

type PinData struct {
	HashedPin []byte
	ExpiresAt time.Time
}

// Store for PINs (email -> PinData)
var (
	pinStore = make(map[string]PinData)
	storeMux sync.Mutex
)

// Store for user sessions (session_token -> username)
var (
	userSessions = make(map[string]string)
	sessionMu    sync.Mutex
)

// Generates a simple session token
func generateSessionToken() string {
	b := make([]byte, 16)
	rand.Read(b)
	return fmt.Sprintf("%x", b)
}

// Middleware to require a valid session cookie
func requireLogin(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		cookie, err := r.Cookie("session_token")
		if err != nil {
			// No session cookie, redirect to login
			http.Redirect(w, r, "/", http.StatusSeeOther)
			return
		}

		sessionToken := cookie.Value
		sessionMu.Lock()
		_, exists := userSessions[sessionToken] // We only need to check existence here
		sessionMu.Unlock()

		if !exists {
			// Invalid or expired session token, redirect to login
			// Optionally delete the invalid cookie here
			http.Redirect(w, r, "/", http.StatusSeeOther)
			return
		}

		// Session is valid, proceed to the next handler
		next.ServeHTTP(w, r)
	}
}

// Handler to provide the logged-in username to the frontend
func handleGetUsername(w http.ResponseWriter, r *http.Request) {
	cookie, err := r.Cookie("session_token")
	if err != nil {
		http.Error(w, "Not logged in", http.StatusUnauthorized)
		return
	}

	sessionToken := cookie.Value
	sessionMu.Lock()
	username, exists := userSessions[sessionToken]
	sessionMu.Unlock()

	if !exists {
		http.Error(w, "Invalid session", http.StatusUnauthorized)
		// Optionally delete the invalid cookie here
		return
	}

	w.Header().Set("Content-Type", "text/plain")
	fmt.Fprint(w, username)
}

// --- WebSocket Server for Docs ---

// Message types
const (
	TextUpdate   = "text"
	TextDelta    = "text-delta"
	CursorUpdate = "cursor"
	UserJoin     = "join"
	Chat         = "chat"
)

// Message represents a WebSocket message
type Message struct {
	Type     string      `json:"type"`
	ClientID string      `json:"clientId"`
	Username string      `json:"username"`
	Content  interface{} `json:"content"`
}

// TextContent represents text update content
type TextContent struct {
	Text string `json:"text"`
}

// TextDeltaContent represents a text change (delta)
type TextDeltaContent struct {
	Start int    `json:"start"`
	End   int    `json:"end"`
	Text  string `json:"text"`
}

// CursorContent represents cursor position content
type CursorContent struct {
	Position int `json:"position"`
}

// ChatContent represents chat message content
type ChatContent struct {
	Text string `json:"text"`
}

var (
	wsClients   = make(map[*websocket.Conn]string) // connection -> clientId
	wsUsernames = make(map[string]string)          // clientId -> username
	docText     = ""                               // current document text
	broadcast   = make(chan Message)
	upgrader    = websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool {
			return true // Allow any origin (local use)
		},
	}
	wsMu sync.Mutex // Mutex for WebSocket clients and docText
)

// Handle incoming WebSocket connections
func handleConnections(w http.ResponseWriter, r *http.Request) {
	// Attempt to get username from session cookie
	cookie, err := r.Cookie("session_token")
	var currentUsername string
	if err == nil {
		sessionMu.Lock()
		currentUsername, _ = userSessions[cookie.Value] // Get username from session
		sessionMu.Unlock()
	}

	// If no valid session, we cannot proceed with websocket
	if currentUsername == "" {
		log.Println("WebSocket connection attempted without valid session")
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	ws, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("WebSocket upgrade error: %v", err)
		return
	}
	defer ws.Close()

	// Generate a client ID for this WebSocket connection
	clientID := currentUsername + "_" + fmt.Sprintf("%d", time.Now().UnixNano()) // Simple unique ID based on username and time

	wsMu.Lock()
	wsClients[ws] = clientID
	wsUsernames[clientID] = currentUsername // Store the username from session
	wsMu.Unlock()

	log.Printf("New WebSocket client connected: %s (%s)", currentUsername, clientID)

	// Send the current document state to the new client immediately after connecting
	initialTextMsg := Message{
		Type:     TextUpdate,
		ClientID: "server",
		Username: "Server",
		Content:  TextContent{Text: docText},
	}
	textData, _ := json.Marshal(initialTextMsg)
	ws.WriteMessage(websocket.TextMessage, textData)

	// Notify other clients that a user joined (using the username from session)
	joinMsg := Message{
		Type:     UserJoin,
		ClientID: clientID,
		Username: currentUsername, // Use the session username
		Content:  nil,
	}
	broadcast <- joinMsg

	for {
		_, msg, err := ws.ReadMessage()
		if err != nil {
			wsMu.Lock()
			delete(wsClients, ws)
			// Optional: Clean up from wsUsernames if needed, but map lookup handles missing keys
			// delete(wsUsernames, clientID)
			log.Printf("WebSocket client %s disconnected", clientID)
			wsMu.Unlock()
			break
		}

		var message Message
		if err := json.Unmarshal(msg, &message); err != nil {
			log.Printf("Invalid JSON from client %s: %v", clientID, err)
			continue
		}

		// Server-side validation/processing of messages
		message.ClientID = clientID        // Ensure clientID is set by server for security
		message.Username = currentUsername // Ensure username is set by server

		wsMu.Lock()

		switch message.Type {
		case TextUpdate:
			if content, ok := message.Content.(map[string]interface{}); ok {
				if text, textOK := content["text"].(string); textOK {
					// Simple full text update (less efficient for large docs)
					docText = text
				}
			}
			// Broadcast TextUpdate to others
			broadcast <- message

		case CursorUpdate:
			// Broadcast CursorUpdate to others (handleMessages will skip sender)
			broadcast <- message

		case Chat:
			// Broadcast Chat to others
			broadcast <- message

		case UserJoin:
			// UserJoin is handled when the websocket connects, ignore subsequent joins
			log.Printf("Received unexpected UserJoin message from client %s", clientID)

		default:
			log.Printf("Unknown message type from client %s: %s", clientID, message.Type)
		}

		wsMu.Unlock()

	}
}

// Relay received message to all connected clients
func handleMessages() {
	for {
		msg := <-broadcast
		data, err := json.Marshal(msg)
		if err != nil {
			log.Printf("Error marshaling message for broadcast: %v", err)
			continue
		}

		wsMu.Lock() // Use the specific WebSocket mutex
		for client, clientID := range wsClients {
			// Don't send cursor updates back to the sender
			if msg.Type == CursorUpdate && clientID == msg.ClientID {
				continue
			}

			if err := client.WriteMessage(websocket.TextMessage, data); err != nil {
				log.Printf("Error sending message to client %s: %v", clientID, err)
				client.Close()
				delete(wsClients, client)
				// Optional: Clean up from wsUsernames
				// delete(wsUsernames, clientID)
			}
		}
		wsMu.Unlock()
	}
}

// --- Sheet Application Backend ---

const (
	sheetRows = 30 // Based on the provided sheets index.html
	sheetCols = 30 // Based on the provided sheets index.html
)

// Sheet data and mutex
var (
	sheetMu    sync.Mutex
	sheetCells = make([][]string, sheetRows)
)

// Initialize sheet data (combined init)
func init() {
	// Initialize sheet cells
	for i := range sheetCells {
		sheetCells[i] = make([]string, sheetCols)
	}
	// Existing init for docs docText is not needed as it's initialized to ""
	// If you had other init logic, combine them here.
}

// Handler to get all sheet data
func getSheetData(w http.ResponseWriter, r *http.Request) {
	sheetMu.Lock()
	defer sheetMu.Unlock()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(sheetCells)
}

// Handler to update a single sheet cell
func updateSheetCell(w http.ResponseWriter, r *http.Request) {
	sheetMu.Lock()
	defer sheetMu.Unlock()

	var data struct {
		Row int    `json:"row"`
		Col int    `json:"col"`
		Val string `json:"val"`
	}
	if err := json.NewDecoder(r.Body).Decode(&data); err != nil {
		http.Error(w, "Invalid data", http.StatusBadRequest)
		return
	}

	if data.Row >= 0 && data.Row < sheetRows && data.Col >= 0 && data.Col < sheetCols {
		sheetCells[data.Row][data.Col] = data.Val
		w.WriteHeader(http.StatusOK)
	} else {
		http.Error(w, "Invalid cell coordinates", http.StatusBadRequest)
	}
}

// Handler to serve the sheets HTML page
func serveSheetsApp(w http.ResponseWriter, r *http.Request) {
	file, err := embeddedFiles.Open("sheets.html") // Assuming the sheets HTML is renamed
	if err != nil {
		http.Error(w, "Could not open sheets.html", http.StatusInternalServerError)
		log.Printf("Error opening sheets.html: %v", err)
		return
	}
	defer file.Close()

	w.Header().Set("Content-Type", "text/html")
	if _, err := io.Copy(w, file); err != nil {
		log.Printf("Error serving sheets.html: %v", err)
	}
}

// --- HTTP Handlers for Serving Files and Pages ---

func serveForm(w http.ResponseWriter, r *http.Request) {
	// If a session cookie exists and is valid, redirect to landing page
	cookie, err := r.Cookie("session_token")
	if err == nil {
		sessionToken := cookie.Value
		sessionMu.Lock()
		_, exists := userSessions[sessionToken]
		sessionMu.Unlock()
		if exists {
			http.Redirect(w, r, "/landing", http.StatusSeeOther)
			return
		}
	}

	tmpl := `
	<!DOCTYPE html>
	<html>
	<head><title>PIN Login</title></head>
	<body>
		<h1>Login with Email + PIN</h1>

		<form method="POST" action="/request-pin">
			<label>Email:</label>
			<input name="email" type="email" required />
			<button type="submit">Request PIN</button>
		</form>

		<br/>

		<form method="POST" action="/verify-pin">
			<label>Email:</label>
			<input name="email" type="email" required />
			<label>PIN:</label>
			<input name="pin" type="text" required />
			<button type="submit">Verify PIN</button>
		</form>
	</body>
	</html>
	`
	w.Header().Set("Content-Type", "text/html")
	fmt.Fprint(w, tmpl)
}

func handleRequestPin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Only POST allowed", http.StatusMethodNotAllowed)
		return
	}

	email := strings.ToLower(strings.TrimSpace(r.FormValue("email")))
	if email == "" {
		http.Error(w, "Email required", http.StatusBadRequest)
		return
	}

	pin := generatePin()
	hashedPin, _ := bcrypt.GenerateFromPassword([]byte(pin), bcrypt.DefaultCost)

	storeMux.Lock()
	pinStore[email] = PinData{
		HashedPin: hashedPin,
		ExpiresAt: time.Now().Add(10 * time.Minute), // PIN valid for 10 minutes
	}
	storeMux.Unlock()

	// Simulate sending email (log the pin to the console)
	log.Printf("Generated PIN for %s: %s (valid for 10 minutes)\n", email, pin)

	// Redirect back to the login form with a message (optional)
	// For simplicity, we just redirect back to the form
	http.Redirect(w, r, "/", http.StatusSeeOther)
}

func handleVerifyPin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Only POST allowed", http.StatusMethodNotAllowed)
		return
	}

	email := strings.ToLower(strings.TrimSpace(r.FormValue("email")))
	pin := r.FormValue("pin")

	storeMux.Lock()
	data, exists := pinStore[email]
	// Clean up the used/expired PIN immediately after verification attempt
	delete(pinStore, email) // Remove PIN after use or attempt
	storeMux.Unlock()

	if !exists || time.Now().After(data.ExpiresAt) {
		http.Error(w, "Invalid or expired PIN", http.StatusUnauthorized)
		return
	}

	err := bcrypt.CompareHashAndPassword(data.HashedPin, []byte(pin))
	if err != nil {
		http.Error(w, "Incorrect PIN", http.StatusUnauthorized)
		return
	}

	// Success!
	// Extract username (email prefix)
	username := email
	if strings.Contains(email, "@") {
		username = strings.Split(email, "@")[0]
	}

	// Create a session
	sessionToken := generateSessionToken()
	sessionMu.Lock()
	userSessions[sessionToken] = username // Store username in session
	// TODO: Add session expiry and a cleanup routine for userSessions
	sessionMu.Unlock()

	// Set session cookie
	http.SetCookie(w, &http.Cookie{
		Name:     "session_token",
		Value:    sessionToken,
		Path:     "/",                            // Make the cookie available across the site
		Expires:  time.Now().Add(24 * time.Hour), // Cookie valid for 24 hours
		HttpOnly: true,                           // Prevent JavaScript access to the cookie
		// Secure: true, // Use Secure in production with HTTPS
		SameSite: http.SameSiteStrictMode, // Mitigate CSRF
	})

	// Redirect to the landing page
	http.Redirect(w, r, "/landing", http.StatusSeeOther)
}

// Handler for serving embedded static files (JS, CSS, HTML)
func serveEmbeddedFile(filename string, contentType string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		file, err := embeddedFiles.Open(filename)
		if err != nil {
			http.Error(w, fmt.Sprintf("Could not open %s", filename), http.StatusInternalServerError)
			log.Printf("Error opening %s: %v", filename, err)
			return
		}
		defer file.Close()

		w.Header().Set("Content-Type", contentType)
		if _, err := io.Copy(w, file); err != nil {
			log.Printf("Error serving %s: %v", filename, err)
		}
	}
}

// --- Helper Functions ---

func generatePin() string {
	const digits = "0123456789"
	bytes := make([]byte, 6)
	for i := range bytes {
		n, _ := rand.Int(rand.Reader, bigInt(len(digits)))
		bytes[i] = digits[n.Int64()]
	}
	return string(bytes)
}

func bigInt(n int) *big.Int {
	return big.NewInt(int64(n))
}

func main() {
	// Start the message broadcasting goroutine for Docs WebSocket
	go handleMessages()

	// --- HTTP Handlers ---

	// Login/Auth handlers
	http.HandleFunc("/", serveForm)
	http.HandleFunc("/request-pin", handleRequestPin)
	http.HandleFunc("/verify-pin", handleVerifyPin)

	// General handlers requiring login
	http.HandleFunc("/landing", requireLogin(serveEmbeddedFile("landing.html", "text/html"))) // Serve landing page
	http.HandleFunc("/get-username", requireLogin(handleGetUsername))                         // Endpoint for JS to get username

	// Docs Application Handlers (require login for the main page, static assets are served directly)
	http.HandleFunc("/docs", requireLogin(serveEmbeddedFile("index.html", "text/html"))) // Serve docs HTML
	http.HandleFunc("/docs.js", serveEmbeddedFile("docs.js", "application/javascript"))
	http.HandleFunc("/chat.js", serveEmbeddedFile("chat.js", "application/javascript")) // Chat JS is shared
	http.HandleFunc("/style.css", serveEmbeddedFile("style.css", "text/css"))
	// Docs WebSocket Handler - does its own session check inside handleConnections
	http.HandleFunc("/ws", handleConnections)

	// Sheets Application Handlers (require login for the main page, static assets are served directly)
	http.HandleFunc("/sheets/", requireLogin(serveSheetsApp))        // Serve sheets HTML
	http.HandleFunc("/sheets/get", requireLogin(getSheetData))       // Get sheet data
	http.HandleFunc("/sheets/update", requireLogin(updateSheetCell)) // Update a cell
	http.HandleFunc("/sheets/sheets.js", serveEmbeddedFile("sheets.js", "application/javascript"))
	http.HandleFunc("/sheets/sheets.css", serveEmbeddedFile("sheets.css", "text/css"))

	fmt.Println("Server running on http://localhost:8080")
	log.Fatal(http.ListenAndServe(":8080", nil))
}
