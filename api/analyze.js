export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({
      error: "طريقة الطلب غير مسموحة."
    });
  }

  // يدعم قراءة المفتاح سواء سميته GEMINI_API_KEY أو GROQ_API_KEY
  const apiKey = process.env.GEMINI_API_KEY || process.env.GROQ_API_KEY;

  if (!apiKey) {
    console.error("Configuration error: API key is missing");
    return res.status(500).json({
      error: "مفتاح API غير مضبوط في إعدادات Vercel."
    });
  }

  try {
    const contractText = req.body?.contractText;

    if (
      typeof contractText !== "string" ||
      contractText.trim().length < 20
    ) {
      return res.status(400).json({
        error: "نص العقد فارغ أو قصير جدًا."
      });
    }

    if (contractText.length > 150000) {
      return res.status(413).json({
        error: "نص العقد كبير جدًا. يرجى تقسيمه إلى أجزاء."
      });
    }

    const systemPrompt = `أنت مساعد قانوني متخصص في مراجعة عقود العمل وفق الأنظمة واللوائح المعمول بها في المملكة العربية السعودية.
حلل العقد المرفق وحدد:
1. البنود التي قد تخالف نظام العمل السعودي.
2. البنود الغامضة أو التي تحمل مخاطر قانونية.
3. البنود التي تحتاج إلى تحقق من النص النظامي.
4. الصياغات البديلة المقترحة عند الحاجة.

قواعد إلزامية:
- لا تخترع أرقام مواد أو نصوصًا نظامية.
- إذا لم تتأكد من رقم المادة، اذكر أن المادة تحتاج إلى تحقق.
- لا تعتبر كل بند غير مألوف مخالفة.
- فرّق بين المخالفة الواضحة والمسألة التي تحتاج إلى مراجعة.
- إذا لم تجد مخالفات، أعد مصفوفة violations فارغة.
- أجب باللغة العربية.
- أخرج كائن JSON صالحًا فقط، دون أي نص خارجه.

استخدم البنية التالية بالضبط:
{
  "status": "نظامي أو غير نظامي أو يحتاج مراجعة",
  "summary": "ملخص نتيجة الفحص",
  "violations": [
    {
      "item": "اسم البند",
      "article": "المادة النظامية أو ضرورة التحقق",
      "issue": "شرح المشكلة القانونية",
      "suggestedClause": "الصياغة البديلة المقترحة"
    }
  ]
}`;

    // إرسال الطلب إلى Groq API السريع
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
          { role: "user", content: contractText }
        ],
        response_format: { type: "json_object" },
        temperature: 0.2
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("Groq API error:", response.status, JSON.stringify(data));
      return res.status(502).json({
        error: "تعذر إكمال التحليل عبر Groq.",
        details: data?.error?.message || `HTTP ${response.status}`
      });
    }

    let generatedText = data?.choices?.[0]?.message?.content;

    if (typeof generatedText !== "string" || generatedText.trim() === "") {
      return res.status(502).json({
        error: "لم يُرجع نموذج Groq نصًا قابلًا للقراءة."
      });
    }

    generatedText = generatedText
      .trim()
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();

    let result;
    try {
      result = JSON.parse(generatedText);
    } catch (parseError) {
      console.error("Groq JSON parsing error:", parseError.message);
      return res.status(502).json({
        error: "وصلت نتيجة التحليل بتنسيق غير صالح."
      });
    }

    const validStatuses = ["نظامي", "غير نظامي", "يحتاج مراجعة"];

    if (
      !result ||
      !validStatuses.includes(result.status) ||
      typeof result.summary !== "string" ||
      !Array.isArray(result.violations)
    ) {
      return res.status(502).json({
        error: "تنسيق نتيجة التحليل غير صحيح."
      });
    }

    result.violations = result.violations.map((item) => ({
      item: String(item?.item || "بند يحتاج إلى مراجعة"),
      article: String(item?.article || "تحتاج المادة إلى التحقق"),
      issue: String(item?.issue || "لم يذكر شرح للملاحظة"),
      suggestedClause: String(
        item?.suggestedClause || "لا توجد صياغة بديلة مقترحة"
      )
    }));

    return res.status(200).json(result);

  } catch (error) {
    console.error(
      "Contract analysis server error:",
      error?.message || "Unknown error"
    );
    return res.status(500).json({
      error: "حدث خطأ داخلي أثناء فحص العقد."
    });
  }
}
