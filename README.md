# Book Reader 2

A "Smart Book Reader" application that allows users to upload books (text/PDF) and chat about them using an AI tutor powered by Google Gemini.

## Features

- **File Upload**: Upload book files via a REST API.
- **Persistent Storage**: Files are saved locally and automatically re-uploaded to Gemini if the cache expires, ensuring long-term availability (1+ years).
- **Context Caching**: Uses Google Gemini's Context Caching to efficiently handle large documents.
- **AI Tutor Persona**: An Iraqi dialect speaking tutor ("مدرس خصوصي") who explains academic material.
- **Real-time Chat**: Chat interface using Socket.IO.
- **User Isolation**: Maintains separate chat histories for different users.
- **Math Formatting**: Supports LaTeX formatting for mathematical equations.

## Tech Stack

- **Runtime**: [Bun](https://bun.sh)
- **Web Framework**: [ElysiaJS](https://elysiajs.com)
- **Real-time Communication**: [Socket.IO](https://socket.io)
- **AI Model**: Google Gemini (via `@google/genai`)

## Prerequisites

- Bun installed (v1.2.22 or later)
- Google Gemini API Key

## Setup & Run

1.  **Install dependencies:**

    ```bash
    bun install
    ```

2.  **Set up Environment Variables:**
    Ensure you have a `.env` file or environment variables set with your Gemini API key:
    ```env
    GEMINI_API_KEY=your_api_key_here
    ```

3.  **Run the Server:**

    ```bash
    bun run index.ts
    ```
    This starts the API server on port 3500 and the Socket.IO server on port 3501.

## Verification

To verify the functionality (requires running server):

```bash
bun run verify_chat.ts
```

## API Reference

### 1. Upload File (REST)

**Endpoint:** `POST http://localhost:3500/api/upload`

**Body:** `FormData` with a field named `file`.

**Response:**
```json
{
  "success": true,
  "data": {
    "bookId": "unique-book-id",
    "cacheName": "gemini-cache-name",
    "expirationTime": "ISO-Date-String"
  }
}
```

### 2. Chat Interface (Socket.IO)

**Connection URL:** `http://localhost:3501`

**Event: `chat_message` (Client -> Server)**
Send this event to ask a question.

```javascript
{
  "bookId": "unique-book-id", // Returned from upload API
  "message": "Explain the first chapter",
  "userId": "unique-user-id"  // To track chat history per user
}
```

**Event: `chat_response` (Server -> Client)**
Listen for this event to receive the answer.

```javascript
{
  "success": true,
  "answer": "The explanation text..." // Contains LaTeX math like $$x^2$$
}
// OR in case of error
{
  "success": false,
  "error": "Error message description"
}
```

### Client Example (JS)

```javascript
import { io } from "socket.io-client";

const socket = io("http://localhost:3501");

socket.on("connect", () => {
  console.log("Connected!");

  // Send a question
  socket.emit("chat_message", {
    bookId: "your-book-id-here",
    message: "Hello, what is this book about?",
    userId: "user-123"
  });
});

socket.on("chat_response", (data) => {
  if (data.success) {
    console.log("Answer:", data.answer);
  } else {
    console.error("Error:", data.error);
  }
});
```
