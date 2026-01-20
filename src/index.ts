import { Elysia, t } from "elysia";
import { cors } from "@elysiajs/cors";
import { Server } from "socket.io";
import { GoogleGenAI } from "@google/genai";
import { env } from "bun";
import { Store } from "./store";

// --- 1. الإعدادات والتحقق ---

if (!env.GEMINI_API_KEY) {
    console.error("❌ خطأ: لم يتم العثور على GEMINI_API_KEY في ملف .env");
    process.exit(1);
}

const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });

// ⚠️ ملاحظة: الكاش يعمل بشكل أفضل مع موديلات 002 المستقرة أو أحدث النسخ
// استخدمنا gemini-1.5-pro-002 لدعمه القوي للكاش والسياق الكبير
const MODEL_NAME = "gemini-1.5-flash-002"; // نموذج سريع ويدعم سياق كبير

// --- 2. تعليمات النظام (System Prompt) ---
const SYSTEM_INSTRUCTION = `
الدور: أنت مدرس خصوصي ذكي باللهجة العراقية، تشرح المواد الأكاديمية بناءً على الملف المرفق فقط.

🔴 قواعد تنسيق الرياضيات (صارمة جداً):
1. **المعادلات الكبيرة (Block Math):**
   - استخدم حصراً الرمز $$ في سطر جديد قبل وبعد المعادلة.
   - 🚫 ممنوع نهائياً استخدام الأقواس المربعة \\[ ... \\] أو [ ... ].
   - مثال صحيح:
     $$ x = \frac{-b}{2a} $$

2. **المعادلات الصغيرة (Inline Math):**
   - استخدم حصراً الرمز $ (دولار واحد).
   - 🚫 ممنوع نهائياً استخدام الأقواس الهلالية \\( ... \\).

3. **التنسيق العام:**
   - اترك دائماً سطراً فارغاً قبل وبعد المعادلات الكبيرة.

⛔ السلبيات والممنوعات (Negative Constraints):
1. **لا تتحدث خارج الدراسة نهائياً:**
   - ارفض أي سؤال عن السياسة أو الدين أو الرياضة بعبارة: "آسف عيني، أني هنا حتى أدرسك وبس".
   
2. **النصائح:**
   - وجه نصائحك فقط نحو الدراسة.
   
3. **لا تختلق معلومات:**
   - اعتمد فقط على الملف المرفق.
`;

// --- 3. دوال مساعدة ---

async function waitForFileActive(fileName: string) {
    console.log(`⏳ جاري معالجة الملف: ${fileName}...`);
    while (true) {
        const file = await ai.files.get({ name: fileName });
        if (file.state === "ACTIVE") {
            console.log(`✅ الملف جاهز: ${fileName}`);
            return;
        }
        if (file.state === "FAILED") throw new Error("فشلت معالجة الملف.");
        await new Promise((r) => setTimeout(r, 2000));
    }
}

async function createCacheForBook(fileData: { mimeType: string, localPath: string, originalName: string }) {
    // 1. Upload to Gemini Files (Temporary)
    console.log(`📤 Uploading to Gemini: ${fileData.originalName}`);

    // Read file from disk
    const fileBuffer = await Bun.file(fileData.localPath).arrayBuffer();
    // Create a Blob-like object or pass the buffer if supported, but Bun.file works well usually
    // ai.files.upload expects 'file' to be a standard File/Blob or path in node.
    // Since we are in Bun, let's try passing the file directly from Bun.file() if compatible,
    // or we might need to cast it.
    // Note: @google/genai upload usually takes path or File object.
    // Let's rely on standard File object behavior or read it.

    // We can just construct a File object from the buffer
    const fileObj = new File([fileBuffer], fileData.originalName, { type: fileData.mimeType });

    const uploadResult: any = await ai.files.upload({
        file: fileObj,
        config: { displayName: fileData.originalName, mimeType: fileData.mimeType },
    });

    await waitForFileActive(uploadResult.name);

    // 2. Create Context Cache
    console.log("🚀 Creating Context Cache...");
    const ttlSeconds = 60 * 60; // 1 Hour

    const cacheResult = await ai.caches.create({
        model: MODEL_NAME,
        config: {
            displayName: `Cache_${fileData.originalName}`,
            systemInstruction: {
                parts: [{ text: SYSTEM_INSTRUCTION }]
            },
            contents: [
                {
                    role: "user",
                    parts: [{
                        fileData: {
                            fileUri: uploadResult.uri,
                            mimeType: uploadResult.mimeType
                        }
                    }]
                }
            ],
            ttl: `${ttlSeconds}s`
        }
    });

    console.log(`✅ Cache Created: ${cacheResult.name}`);
    return cacheResult;
}

// --- 4. خادم Elysia (الرفع + التسجيل) ---

const app = new Elysia()
    .use(cors())
    .get("/", () => "🤖 Server is Running")

    .post("/api/upload", async ({ body, set }) => {
        try {
            const { file } = body as { file: File };
            if (!file) throw new Error("لم يتم إرسال ملف");

            console.log(`📥 Receive File: ${file.name}`);

            // 1. Save to Local Disk & DB
            const book = await Store.addBook(file, file.type.split(';')[0]);

            // 2. Initial Cache Creation (Optional but good for immediate use)
            const cacheResult = await createCacheForBook(book);

            // 3. Update DB with Cache Info
            await Store.updateBookCache(book.id, cacheResult.name, cacheResult.expireTime);

            return {
                success: true,
                data: {
                    bookId: book.id, // Return Book ID instead of Cache Name
                    cacheName: cacheResult.name,
                    expirationTime: cacheResult.expireTime
                }
            };

        } catch (error: any) {
            console.error("Upload Error:", error);
            set.status = 500;
            return { success: false, error: error.message };
        }
    }, {
        body: t.Object({ file: t.Any() })
    })
    .listen(3500);

console.log(`🚀 API Server: http://${app.server?.hostname}:${app.server?.port}`);

// --- 5. خادم Socket.IO (المحادثة) ---

const io = new Server(3501, { cors: { origin: "*" } });
console.log("🚀 Socket Server: Port 3501");

io.on("connection", (socket) => {
    console.log(`🔌 Connected: ${socket.id}`);

    socket.on("chat_message", async (data) => {
        try {
            const { bookId, message, userId } = data;

            if (!bookId) {
                socket.emit("chat_response", { success: false, answer: "خطأ: لم يتم توفير معرف الكتاب (bookId)." });
                return;
            }

            // 1. Get Book Info
            const book = Store.getBook(bookId);
            if (!book) {
                socket.emit("chat_response", { success: false, answer: "خطأ: الكتاب غير موجود." });
                return;
            }

            // 2. Check Cache Status & Re-hydrate if needed
            let activeCacheName = book.cacheName;
            let needsRehydration = false;

            if (!activeCacheName) needsRehydration = true;
            else if (book.cacheExpireTime) {
                const now = new Date();
                const expire = new Date(book.cacheExpireTime);
                if (now >= expire) {
                    console.log("⚠️ Cache Expired. Re-hydrating...");
                    needsRehydration = true;
                }
            }

            if (needsRehydration) {
                try {
                    const newCache = await createCacheForBook(book);
                    activeCacheName = newCache.name;
                    await Store.updateBookCache(book.id, newCache.name, newCache.expireTime);
                } catch (e: any) {
                    console.error("Failed to re-hydrate cache:", e);
                    socket.emit("chat_response", { success: false, answer: "خطأ: فشل إعادة تنشيط الكتاب. يرجى المحاولة لاحقاً." });
                    return;
                }
            }

            // 3. Load Chat History
            let userHistory = Store.getHistory(userId, bookId);

            // 4. Append User Message
            const userMsg = { role: "user", parts: [{ text: message }] };
            userHistory.push(userMsg as any);

            // 5. Generate Content
            const response = await ai.models.generateContent({
                model: MODEL_NAME,
                contents: userHistory,
                config: {
                    cachedContent: activeCacheName
                }
            });

            let rawAnswer = response.text || "";
            const formattedAnswer = formatResponseForMarkdown(rawAnswer);

            // 6. Append Model Response & Save History
            const modelMsg = { role: "model", parts: [{ text: formattedAnswer }] };
            userHistory.push(modelMsg as any);
            await Store.appendHistory(userId, bookId, [userMsg as any, modelMsg as any]);

            socket.emit("chat_response", {
                success: true,
                answer: formattedAnswer
            });

        } catch (error: any) {
            console.error("❌ Chat Error:", error);

            // Check for 404/Not Found specifically if cache was deleted remotely but we thought it was alive
            if (error.message?.includes("Not Found") || error.status === 404) {
                 socket.emit("chat_response", {
                    success: false,
                    answer: "حدث خطأ في الاتصال بالكتاب (ربما انتهت الجلسة). حاول إرسال الرسالة مرة أخرى ليتم التحديث."
                    // In a real robust system, we would retry immediately here by forcing re-hydration.
                    // For now, asking user to retry is acceptable or we can add a retry logic.
                });
                // Invalidate cache in store so next try forces re-creation
                // Store.updateBookCache(bookId, "", "");
            } else {
                socket.emit("chat_response", { success: false, error: "حدث خطأ في المعالجة" });
            }
        }
    });
});

// --- دوال التنظيف ---
function formatResponseForMarkdown(text: string): string {
    let cleanText = text;
    cleanText = cleanText.replace(/\[\s*(.*?)\s*\]/gs, (match, p1) => `\n\n$$${p1}$$\n\n`);
    cleanText = cleanText.replace(/\\\[(.*?)\\\]/gs, '\n\n$$$1$$\n\n');
    cleanText = cleanText.replace(/\\\((.*?)\\\)/gs, '$$$1$');
    cleanText = cleanText.replace(/([^\s\$])(\$)/g, '$1 $2');
    cleanText = cleanText.replace(/(\$)([^\s\$])/g, '$1 $2');
    return cleanText;
}
