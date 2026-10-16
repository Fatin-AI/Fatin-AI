/**
 * ------------------------------------------------------------------
 * مشروع: فطن AI - نظام تدقيق عقود العمل الذكي
 * البيئة: Vercel Serverless Function (Groq API Engine)
 * الإصدار: 3.0 Enterprise (آمن، دقيق، ومحصّن ضد الأخطاء)
 * ------------------------------------------------------------------
 */

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '1mb', // حماية الخادم من الملفات الكبيرة جداً
    },
  },
};

// الحالات النظامية المعتمدة وفقاً للبيئة القانونية السعودية
const VALID_STATUSES = ["نظامي", "غير نظامي", "يحتاج مراجعة"];

export default async function handler(req, res) {
  // 1. التحقق من نوع الطلب (يسمح بـ POST فقط)
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({
      success: false,
      error: "طريقة الطلب غير مسموحة. يُرجى استخدام بروتوكول POST."
    });
  }

  // 2. التحقق من مفتاح المصادقة البيئي
  const apiKey = process.env.GROQ_API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("[CRITICAL_ERROR] API key is missing from Vercel environment variables.");
    return res.status(500).json({
      success: false,
      error: "خطأ في تكوين الخادم: مفتاح الربط غير متوفر في النظام."
    });
  }

  try {
    // 3. التحقق وتطهير المدخلات (Input Validation & Sanitization)
    const { contractText } = req.body || {};

    if (typeof contractText !== "string" || contractText.trim().length < 15) {
      return res.status(400).json({
        success: false,
        error: "نص العقد المدخل فارغ أو قصير جداً لإجراء تدقيق قانوني موثوق."
      });
    }

    if (contractText.length > 100000) {
      return res.status(413).json({
        success: false,
        error: "حجم نص العقد كبير جداً. يُرجى تقسيم العقد إلى أجزاء أصغر."
      });
    }

    const cleanContractText = contractText.trim();

    // 4. بناء الموجه الاحترافي (System Prompt) الموجه لنظام العمل السعودي
    const systemPrompt = `أنت مساعد قانوني سعودي خبير ومحترف في مراجعة عقود العمل وفقاً لـ نظام العمل السعودي ولائحته التنفيذية الصادرة عن وزارة الموارد البشرية والتنمية الاجتماعية.
قم بتحليل نص العقد المرفق بدقة متناهية واستخراج المخاطر والبنود المخالفة.

قواعد التحليل الإلزامية:
1. لا تخترع أرقام مواد أو نصوصًا نظامية غير دقيقة. إذا لم تكن متأكداً تماماً من رقم المادة، اذكر بوضوح أن المادة تحتاج إلى تحقق.
2. فرّق بدقة بين المخالفة النظامية الواضحة (مثل مخالفة الحد الأدنى للأجور، أوقات عمل تتجاوز النظام دون تعويض، أو إجازات منتقصة) وبين المسائل التعاقدية التي تحتاج إلى مراجعة وتفاوض.
3. إذا كان العقد خلوّاً من أي مخالفات جوهرية، اجعل status "نظامي" وأفرغ مصفوفة violations.
4. يجب أن يكون الرد بصيغة JSON صالح (Valid JSON) حصراً، ودون أي نصوص إضافية أو علامات Markdown خارج الكائن الرئيسي.

استخدم البنية الهيكلية التالية تماماً:
{
  "status": "نظامي أو غير نظامي أو يحتاج مراجعة",
  "summary": "ملخص تحليلي احترافي وشامل لمدى نظامية العقد وفق نظام العمل السعودي",
  "violations": [
    {
      "item": "اسم البند أو موضوعه في العقد",
      "article": "المادة النظامية المرتبطة في نظام العمل السعودي أو (تحتاج إلى تحقق)",
      "issue": "شرح مفصل وصريح للمشكلة أو المخالفة القانونية",
      "suggestedClause": "الصياغة البديلة المقترحة والمتوافقة مع نظام العمل"
    }
  ]
}`;

    // 5. استدعاء محرك الذكاء الاصطناعي (Groq - Llama 3.3 70B Versatile)
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
        response_format: { type: "json_object" }, // إجبار النموذج على إرجاع JSON نقي
        temperature: 0.1, // خفض درجة العشوائية لضمان أعلى دقة قانونية ممكنة
        max_tokens: 4096
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("[API_ERROR] Groq returned error:", response.status, JSON.stringify(data));
      return res.status(502).json({
        success: false,
        error: "تعذر إكمال معالجة التحليل القانوني عبر الخادم الخارجي.",
        details: data?.error?.message || `HTTP Error ${response.status}`
      });
    }

    const rawContent = data?.choices?.[0]?.message?.content;
    if (typeof rawContent !== "string" || rawContent.trim() === "") {
      console.error("[PARSE_ERROR] Empty content returned from Groq model.");
      return res.status(502).json({
        success: false,
        error: "فشل النموذج في استرجاع نتيجة صحيحة."
      });
    }

    // 6. تنظيف الـ JSON المسترجع من أي إضافات محتملة
    const cleanedJsonString = rawContent
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();

    let parsedResult;
    try {
      parsedResult = JSON.parse(cleanedJsonString);
    } catch (jsonErr) {
      console.error("[JSON_PARSE_FATAL]:", jsonErr.message, "Raw Content:", cleanedJsonString.slice(0, 300));
      return res.status(502).json({
        success: false,
        error: "حدث خطأ في معالجة بنية البيانات القانونية المسترجعة."
      });
    }

    // 7. التحقق الهيكلي الصارم لصحة البيانات (Schema Validation)
    if (
      !parsedResult ||
      !VALID_STATUSES.includes(parsedResult.status) ||
      typeof parsedResult.summary !== "string" ||
      !Array.isArray(parsedResult.violations)
    ) {
      console.error("[SCHEMA_VALIDATION_ERROR]: Invalid response structure received.");
      return res.status(502).json({
        success: false,
        error: "بنية التقرير القانوني المسترجع غير مطابقة للمعايير المعتمدة."
      });
    }

    // 8. تعقيم عناصر المصفوفة لضمان عدم وجود حقول فارغة تكسر واجهة المستخدم
    const sanitizedViolations = parsedResult.violations.map((item) => ({
      item: String(item?.item || "بند تعاقدي عام"),
      article: String(item?.article || "تحتاج المادة إلى التحقق النظامي"),
      issue: String(item?.issue || "ملاحظة تتطلب التدقيق القانوني"),
      suggestedClause: String(item?.suggestedClause || "صياغة بديلة متوافقة مع نظام العمل")
    }));

    const finalResponsePayload = {
      success: true,
      status: parsedResult.status,
      summary: parsedResult.summary,
      violations: sanitizedViolations
    };

    // إرجاع الاستجابة النهائية بنجاح تام
    return res.status(200).json(finalResponsePayload);

  } catch (error) {
    console.error("[INTERNAL_SERVER_ERROR]:", error?.message || error);
    return res.status(500).json({
      success: false,
      error: "حدث خطأ تقني داخلي أثناء معالجة العقد. يُرجى المحاولة لاحقاً."
    });
  }
}
