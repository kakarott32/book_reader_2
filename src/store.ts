import { file } from "bun";
import { join } from "path";
import { existsSync, mkdirSync } from "fs";

const DATA_FILE = "data.json";
const UPLOADS_DIR = "uploads";

if (!existsSync(UPLOADS_DIR)) {
    mkdirSync(UPLOADS_DIR);
}

interface Book {
    id: string;
    originalName: string;
    mimeType: string;
    localPath: string;
    cacheName?: string;
    cacheExpireTime?: string; // ISO string
}

interface ChatMessage {
    role: "user" | "model";
    parts: { text: string }[];
}

interface Data {
    books: Record<string, Book>;
    chats: Record<string, ChatMessage[]>; // Key: "userId_bookId"
}

// Initialize or Load Data
let data: Data = { books: {}, chats: {} };

async function loadData() {
    const f = file(DATA_FILE);
    if (await f.exists()) {
        try {
            data = await f.json();
        } catch (e) {
            console.error("Failed to parse data.json, starting fresh.");
        }
    }
}

async function saveData() {
    await Bun.write(DATA_FILE, JSON.stringify(data, null, 2));
}

// Initialize on load
await loadData();

export const Store = {
    addBook: async (fileObj: File, mimeType: string): Promise<Book> => {
        const id = crypto.randomUUID();
        const localPath = join(UPLOADS_DIR, `${id}_${fileObj.name}`);

        await Bun.write(localPath, fileObj);

        const book: Book = {
            id,
            originalName: fileObj.name,
            mimeType,
            localPath
        };

        data.books[id] = book;
        await saveData();
        return book;
    },

    getBook: (id: string): Book | undefined => {
        return data.books[id];
    },

    updateBookCache: async (id: string, cacheName: string, expireTime: string) => {
        if (data.books[id]) {
            data.books[id].cacheName = cacheName;
            data.books[id].cacheExpireTime = expireTime;
            await saveData();
        }
    },

    getHistory: (userId: string, bookId: string): ChatMessage[] => {
        const key = `${userId}_${bookId}`;
        return data.chats[key] || [];
    },

    appendHistory: async (userId: string, bookId: string, messages: ChatMessage[]) => {
        const key = `${userId}_${bookId}`;
        if (!data.chats[key]) {
            data.chats[key] = [];
        }
        data.chats[key].push(...messages);

        // Keep only last 50 messages to prevent infinite growth
        if (data.chats[key].length > 50) {
            data.chats[key] = data.chats[key].slice(-50);
        }

        await saveData();
    }
};
