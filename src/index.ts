import { Elysia, t } from "elysia";
import { cors } from "@elysiajs/cors";
import { Server } from "socket.io";
import { GoogleGenAI } from "@google/genai";
import { env } from "bun";

// --- 1. الإعدادات والتحقق ---

if (!env.GEMINI_API_KEY) {
    console.error("❌ خطأ: لم يتم العثور على GEMINI_API_KEY في ملف .env");
    process.exit(1);
}

const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });

// ⚠️ ملاحظة: الكاش يعمل بشكل أفضل مع موديلات 002 المستقرة أو أحدث النسخ
// استخدمنا gemini-1.5-pro-002 لدعمه القوي للكاش والسياق الكبير
const MODEL_NAME = "gemini-3-flash-preview"; // نموذج سريع ويدعم سياق كبير

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

// تخزين سجل المحادثات (UserId -> Messages)
// ملاحظة: مع الكاش، لا نحتاج لتخزين الملف في السجل، فقط النصوص
const chatHistory = new Map<string, any[]>();

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

// --- 4. خادم Elysia (الرفع + إنشاء الكاش) ---

const app = new Elysia()
    .use(cors())
    .get("/", () => "🤖 Server is Running")

    .post("/api/upload", async ({ body, set }) => {
        try {
            const { file } = body as { file: File };
            if (!file) throw new Error("لم يتم إرسال ملف");

            console.log(`📤 رفع ملف: ${file.name}`);

            // 1. رفع الملف إلى Gemini Files
            const uploadResult: any = await ai.files.upload({
                file: file,
                config: { displayName: file.name, mimeType: file.type.split(';')[0] },
            });

            await waitForFileActive(uploadResult.name);

            // 2. 🔥 إنشاء الكاش (Context Caching)
            console.log("🚀 جاري إنشاء Cache للكتاب...");

            // مدة بقاء الكاش (مثلاً ساعة واحدة = 3600 ثانية)
            // ملاحظة: الكاش المدفوع قد يكلف، لكنه يوفر في التوكنات
            const ttlSeconds = 60 * 60;

            const cacheResult = await ai.caches.create({
                model: MODEL_NAME,
                config: {
                    displayName: `Cache_${file.name}`,
                    // نضع تعليمات النظام والملف داخل الكاش مرة واحدة وللأبد
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

            console.log(`✅ تم إنشاء الكاش: ${cacheResult.name}`);
            console.log(`🔢 عدد التوكنات: ${cacheResult.usageMetadata?.totalTokenCount || 'غير معروف'}`);

            return {
                success: true,
                data: {
                    // نرجع اسم الكاش للعميل ليستخدمه في الشات
                    cacheName: cacheResult.name,
                    expirationTime: cacheResult.expireTime,
                    totalTokens: cacheResult.usageMetadata?.totalTokenCount
                }
            };

        } catch (error: any) {
            console.error("Upload/Cache Error:", error);
            set.status = 500;
            return { success: false, error: error.message };
        }
    }, {
        body: t.Object({ file: t.Any() })
    })
    .listen(3500);

console.log(`🚀 API Server: http://${app.server?.hostname}:${app.server?.port}`);

// --- 5. خادم Socket.IO (المحادثة باستخدام الكاش) ---

const io = new Server(3501, { cors: { origin: "*" } });
console.log("🚀 Socket Server: Port 3501");

io.on("connection", (socket) => {
    console.log(`🔌 Connected: ${socket.id}`);

    socket.on("chat_message", async (data) => {
        try {
            // العميل يجب أن يرسل cacheName بدلاً من fileUri
            const { cacheName, message, userId } = data;

            if (!cacheName) {
                socket.emit("chat_response", { success: false, answer: "خطأ: لم يتم توفير مفتاح الكاش (cacheName)." });
                return;
            }

            const historyKey = `${userId}_${cacheName}`;
            let userHistory = chatHistory.get(historyKey) || [];

            // نضيف رسالة المستخدم الجديدة للسجل
            userHistory.push({ role: "user", parts: [{ text: message }] });

            // 🔥 استخدام الموديل مع الكاش
            // const model = ai.getGenerativeModel({ 
            //     model: MODEL_NAME,
            //     cachedContent: cacheName // نربط الموديل بالكاش المجهز مسبقاً
            // });

            // إرسال الطلب (نرسل فقط تاريخ المحادثة النصي، الملف والتعليمات موجودة في الكاش)
            const response = await ai.models.generateContent({
                model: MODEL_NAME,
                contents: userHistory,
                config: {
                    cachedContent: cacheName
                }
            });

            let rawAnswer = response.text || "";
            const formattedAnswer = formatResponseForMarkdown(rawAnswer);

            // تحديث السجل بإجابة الموديل
            userHistory.push({ role: "model", parts: [{ text: formattedAnswer }] });

            // تقليص الذاكرة (اختياري)
            if (userHistory.length > 20) userHistory = userHistory.slice(-20);
            chatHistory.set(historyKey, userHistory);

            socket.emit("chat_response", {
                success: true,
                answer: formattedAnswer
            });

        } catch (error: any) {
            console.error("❌ Chat Error:", error);

            // معالجة خاصة لانتهاء صلاحية الكاش (404 Not Found)
            if (error.message?.includes("Not Found") || error.status === 404) {
                socket.emit("chat_response", {
                    success: false,
                    error: "انتهت جلسة الكتاب (Expired Cache). يرجى إعادة رفع الملف."
                });
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