export const config = {
  api: {
    bodyParser: {
      sizeLimit: '1mb',
    },
  },
};

const VALID_STATUSES = ["نظامي", "غير نظامي", "يحتاج مراجعة"];

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({
      success: false,
      error: "طريقة الطلب غير مسموحة."
    });
  }

  // البحث عن المفتاح في كل الأسماء المحتملة التي قد تكون وضعتها في Vercel
  const apiKey = process.env.GROQ_API_KEY || 
                 process.env.GEMINI_API_KEY || 
                 process.env.gemini_api_key || 
                 process.env.GROQ_KEY ||
                 process.env.API_KEY;

  if (!apiKey) {
    console.error("[CRITICAL_ERROR] No API key environment variable found in Vercel.");
    return res.status(500).json({
      success: false,
      error: "مفتاح الـ API غير معرّف في Vercel. يرجى التاكد من إضافة GROQ_API_KEY في إعدادات البيئة."
    });
  }

  try {
    const { contractText } = req.body || {};

    if (typeof contractText !== "string" || contractText.trim().length < 15) {
      return res.status(400).json({
        success: false,
        error: "نص العقد المدخل فارغ أو قصير جداً."
      });
    }

    const cleanContractText = contractText.trim();

    const systemPrompt = `أنت مساعد قانوني سعودي خبير ومحترف في مراجعة عقود العمل وفقاً لـ نظام العمل السعودي ولائحته التنفيذية.
قم بتحليل نص العقد المرفق واستخراج المخاطر والبنود المخالفة.

قواعد التحليل الإلزامية:
1. لا تخترع أرقام مواد أو نصوصًا نظامية غير دقيقة.
2. فرّق بدقة بين المخالفة النظامية الواضحة وبين المسائل التي تحتاج إلى مراجعة.
3. إذا كان العقد نظامياً، اجعل status "نظامي" وأفرغ مصفوفة violations.
4. أخرج كائن JSON صالح فقط دون أي نص إضافي.

البنية المطلوبة:
{
  "status": "نظامي أو غير نظامي أو يحتاج مراجعة",
  "summary": "ملخص تحليلي لمدى نظامية العقد",
  "violations": [
    {
      "item": "اسم البند",
      "article": "المادة النظامية المرتبطة",
      "issue": "شرح المشكلة القانونية",
      "suggestedClause": "الصياغة البديلة المقترحة"
    }
  ]
}`;

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey.trim()}`
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `نص العقد المراد فحصه:\n"""\n${cleanContractText}\n"""` }
        ],
        response_format: { type: "json_object" },
        temperature: 0.1
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("[API_ERROR]", response.status, JSON.stringify(data));
      return res.status(502).json({
        success: false,
        error: "خطأ في الاتصال بمزود الخدمة Groq.",
        details: data?.error?.message || `HTTP ${response.status}`
      });
    }

    const rawContent = data?.choices?.[0]?.message?.content;
    const cleanedJsonString = rawContent
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();

    const parsedResult = JSON.parse(cleanedJsonString);

    const sanitizedViolations = (parsedResult.violations || []).map((item) => ({
      item: String(item?.item || "بند تعاقدي"),
      article: String(item?.article || "تحتاج المادة إلى التحقق النظامي"),
      issue: String(item?.issue || "ملاحظة تتطلب التدقيق"),
      suggestedClause: String(item?.suggestedClause || "صياغة بديلة مقترحة")
    }));

    return res.status(200).json({
      success: true,
      status: parsedResult.status || "يحتاج مراجعة",
      summary: parsedResult.summary || "تم فحص العقد.",
      violations: sanitizedViolations
    });

  } catch (error) {
    console.error("[INTERNAL_ERROR]:", error?.message || error);
    return res.status(500).json({
      success: false,
      error: "حدث خطأ داخلي أثناء معالجة العقد."
    });
  }
}
