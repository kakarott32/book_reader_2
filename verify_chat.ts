import { expect } from "bun:test";
import { io } from "socket.io-client";

const UPLOAD_URL = "http://localhost:3500";
const CHAT_URL = "http://localhost:3501";

async function uploadFile() {
    const file = Bun.file("dummy_book.txt");
    const formData = new FormData();
    formData.append("file", file);

    const response: any = await fetch(`${UPLOAD_URL}/api/upload`, {
        method: "POST",
        body: formData,
    });

    const result = await response.json();
    if (!result.success) {
        throw new Error(`Upload failed: ${JSON.stringify(result)}`);
    }
    return result.data;
}

function chat(fileUri: string, mimeType: string, message: string, userId: string): Promise<any> {
    return new Promise((resolve, reject) => {
        const socket = io(CHAT_URL);

        socket.on("connect", () => {
            console.log(`🔌 Connected to chat server as ${userId}`);
            socket.emit("chat_message", {
                fileUri,
                mimeType,
                message,
                userId
            });
        });

        socket.on("chat_response", (data) => {
            socket.disconnect();
            resolve(data);
        });

        socket.on("connect_error", (err) => {
            socket.disconnect();
            reject(err);
        });
    });
}

async function main() {
    console.log("🚀 Starting Verification (Socket.IO)...");

    try {
        // 1. Upload File (REST)
        console.log("📤 Uploading file...");
        const fileData: any = await uploadFile();
        console.log("✅ File uploaded:", fileData.name);

        // 2. Chat as User A (Alice)
        console.log("👤 User A: My name is Alice.");
        await chat(fileData.fileUri, fileData.mimeType, "My name is Alice.", "user_A");

        console.log("👤 User A: What is my name?");
        const responseA: any = await chat(fileData.fileUri, fileData.mimeType, "What is my name?", "user_A");
        console.log("🤖 AI (to User A):", responseA.answer);

        if (!responseA.answer.includes("Alice") && !responseA.answer.includes("أليس")) {
            console.error("❌ Test Failed: AI did not remember User A's name.");
        } else {
            console.log("✅ Test Passed: AI remembered User A.");
        }

        // 3. Chat as User B (Bob)
        console.log("👤 User B: What is my name?");
        const responseB: any = await chat(fileData.fileUri, fileData.mimeType, "What is my name?", "user_B");
        console.log("🤖 AI (to User B):", responseB.answer);

        if (responseB.answer.includes("Alice")) {
            console.error("❌ Test Failed: User B saw User A's context!");
        } else {
            console.log("✅ Test Passed: User B context is isolated.");
        }

    } catch (error) {
        console.error("❌ Verification Failed:", error);
    }
}

main();
