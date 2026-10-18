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

  const apiKey = process.env.GROQ_API_KEY || process.env.GEMINI_API_KEY;

  if (!apiKey) {
    console.error("[CRITICAL_ERROR] API key is missing");
    return res.status(500).json({
      success: false,
      error: "مفتاح الـ API غير معرّف في Vercel."
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

    const systemPrompt = `أنت مساعد قانوني سعودي خبير ومحترف في مراجعة عقود العمل وفقاً لـ نظام العمل السعودي ولائحته التنفيذية الصادرة عن وزارة الموارد البشرية والتنمية الاجتماعية.
قم بتحليل نص العقد المرفق واستخراج المخاطر والبنود المخالفة بدقة تامة.

قواعد التحليل الإلزامية:
1. لا تخترع أرقام مواد أو نصوصًا نظامية غير دقيقة.
2. فرّق بدقة بين المخالفة النظامية الواضحة وبين المسائل التي تحتاج إلى مراجعة.
3. إذا كان العقد نظامياً، اجعل status "نظامي" وأفرغ مصفوفة violations.
4. أخرج كائن JSON صالح فقط دون أي نص إضافي.

البنية المطلوبة:
{
  "status": "نظامي أو غير نظامي أو يحتاج مراجعة",
  "summary": "ملخص تحليلي لمدى نظامية العقد وفق الأنظمة السعودية",
  "violations": [
    {
      "item": "اسم البند",
      "article": "المادة النظامية المرتبطة أو تحتاج تحقق",
      "issue": "شرح المشكلة القانونية",
      "suggestedClause": "الصياغة البديلة المقترحة"
    }
  ]
}`;

    // قائمة النماذج المتاحة في Groq مرتبة حسب الأولوية لضمان عمل المفتاح بأي حال
    const modelsToTry = [
      "llama-3.1-8b-instant",
      "llama-3.3-70b-versatile",
      "openai/gpt-oss-20b"
    ];

    let lastErrorDetails = null;
    let rawContent = null;

    for (const model of modelsToTry) {
      try {
        const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey.trim()}`
          },
          body: JSON.stringify({
            model: model,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: `نص العقد المراد فحصه وفق نظام العمل السعودي:\n"""\n${cleanContractText}\n"""` }
            ],
            response_format: { type: "json_object" },
            temperature: 0.1
          })
        });

        const data = await response.json();

        if (!response.ok) {
          console.warn(`Model ${model} returned error:`, response.status, data);
          lastErrorDetails = data?.error?.message || `HTTP ${response.status}`;
          continue; // تجربة النموذج التالي
        }

        rawContent = data?.choices?.[0]?.message?.content;
        if (rawContent && rawContent.trim() !== "") {
          break; // تم جلب النتيجة بنجاح من النموذج الحالي
        }
      } catch (err) {
        console.warn(`Error trying model ${model}:`, err.message);
        lastErrorDetails = err.message;
      }
    }

    if (!rawContent) {
      return res.status(502).json({
        success: false,
        error: "تعذر إكمال التحليل عبر نماذج Groq المتاحة.",
        details: lastErrorDetails || "جميع النماذج تعذرت استجابتها."
      });
    }

    const cleanedJsonString = rawContent
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();

    const parsedResult = JSON.parse(cleanedJsonString);

    const sanitizedViolations = (parsedResult.violations || []).map((item) => ({
      item: String(item?.item || "بند تعاقدي"),
      article: String(item?.article || "تحتاج المادة إلى التحقق النظامي"),
      issue: String(item?.issue || "ملاحظة تتطلب التدقيق القانوني"),
      suggestedClause: String(item?.suggestedClause || "صياغة بديلة مقترحة متوافقة مع نظام العمل")
    }));

    return res.status(200).json({
      success: true,
      status: parsedResult.status || "يحتاج مراجعة",
      summary: parsedResult.summary || "تم فحص العقد وتدقيقه بنجاح.",
      violations: sanitizedViolations
    });

  } catкус (error) {
    console.error("[INTERNAL_ERROR]:", error?.message || error);
    return res.status(500).json({
      success: false,
      error: "حدث خطأ داخلي أثناء معالجة وفحص العقد."
    });
  }
}
