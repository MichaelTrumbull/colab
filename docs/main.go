package main

import (
	"log"
	"net/http"
	"sync"

	"github.com/gorilla/websocket"
)

// Message types for WebSocket communication
const (
	MessageTypeFull  = "full"
	MessageTypeDelta = "delta"
)

// Represents a message sent over the WebSocket
type Message struct {
	Type        string `json:"type"`                  // "full" or "delta"
	Content     string `json:"content,omitempty"`     // Full document content (for type "full")
	StartIndex  int    `json:"startIndex,omitempty"`  // Start index of the change (for type "delta")
	RemovedText string `json:"removedText,omitempty"` // Text removed (for type "delta")
	AddedText   string `json:"addedText,omitempty"`   // Text added (for type "delta")
}

// We'll store the document content in a simple string for this example.
// In a real application, you might use a more sophisticated data structure
// and persistence layer.
var documentContent string
var mu sync.Mutex // Mutex to protect access to documentContent

// Configure the WebSocket upgrader
var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		// Allow connections from any origin (for local development)
		return true
	},
}

// Slice to hold all active WebSocket connections
var clients = make(map[*websocket.Conn]bool)
var broadcast = make(chan Message) // Channel to broadcast messages

func main() {
	// Serve the index.html file
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		http.ServeFile(w, r, "index.html")
	})

	// WebSocket endpoint
	http.HandleFunc("/ws", handleConnections)

	// Start a goroutine to handle broadcasting messages
	go handleMessages()

	// Start the server
	log.Println("HTTP server started on :8080")
	err := http.ListenAndServe(":8080", nil)
	if err != nil {
		log.Fatal("ListenAndServe: ", err)
	}
}

func handleConnections(w http.ResponseWriter, r *http.Request) {
	// Upgrade initial GET request to a WebSocket
	ws, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Fatal(err)
	}
	// Ensure connection closes when function returns
	defer ws.Close()

	// Register the new client
	clients[ws] = true
	log.Printf("Client connected: %s", ws.RemoteAddr())

	// Send the current full document content to the new client
	mu.Lock()
	initialMessage := Message{
		Type:    MessageTypeFull,
		Content: documentContent,
	}
	err = ws.WriteJSON(initialMessage)
	mu.Unlock()
	if err != nil {
		log.Printf("Error sending initial content: %v", err)
		delete(clients, ws)
		return
	}

	// Listen for new messages from this client
	for {
		var msg Message
		err := ws.ReadJSON(&msg)
		if err != nil {
			log.Printf("Error reading message: %v", err)
			delete(clients, ws) // Remove the client if there's an error
			break
		}

		// Handle the received message
		mu.Lock()
		switch msg.Type {
		case MessageTypeDelta:
			// Apply the delta to the document content
			startIndex := msg.StartIndex
			removedText := msg.RemovedText
			addedText := msg.AddedText

			// Basic validation to prevent out-of-bounds access
			if startIndex < 0 || startIndex > len(documentContent) || startIndex+len(removedText) > len(documentContent) {
				log.Printf("Invalid delta received: %v", msg)
				mu.Unlock()
				continue // Skip applying this invalid delta
			}

			// Apply the delta
			newContent := documentContent[:startIndex] + addedText + documentContent[startIndex+len(removedText):]
			documentContent = newContent
			log.Printf("Applied delta. New content length: %d", len(documentContent))

			// Broadcast the updated full document to all clients
			// NOTE: For simplicity in this example, we broadcast the full document after applying a delta.
			// In a more complex system (like one using OT/CRDT), you might broadcast the delta itself.
			fullUpdateMessage := Message{
				Type:    MessageTypeFull,
				Content: documentContent,
			}
			broadcast <- fullUpdateMessage

		case MessageTypeFull:
			// If a client sends the full document (shouldn't happen with this frontend logic, but handle defensively)
			log.Println("Received unexpected full document update from client.")
			// In a real app, you might have logic to handle this,
			// perhaps treating it as a full sync or ignoring it.
			// For now, we'll just log and ignore.

		default:
			log.Printf("Received unknown message type: %s", msg.Type)
		}
		mu.Unlock()
	}
}

func handleMessages() {
	for {
		// Get the next message from the broadcast channel
		msg := <-broadcast

		// Send it to every connected client
		for client := range clients {
			err := client.WriteJSON(msg)
			if err != nil {
				log.Printf("Error writing message to client: %v", err)
				client.Close()
				delete(clients, client) // Remove the client if there's an error
			}
		}
	}
}
