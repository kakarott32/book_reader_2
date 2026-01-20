# Book Reader 2

A "Smart Book Reader" application that allows users to upload books (text/PDF) and chat about them using an AI tutor powered by Google Gemini.

## Features

- **File Upload**: Upload book files via a REST API.
- **Context Caching**: Uses Google Gemini's Context Caching to efficiently handle large documents and maintain context across chat sessions.
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
