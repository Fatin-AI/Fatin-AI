export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({
      error: "طريقة الطلب غير مسموحة."
    });
  }

  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    console.error("Configuration error: GEMINI_API_KEY is missing");
    return res.status(500).json({
      error: "مفتاح Gemini غير مضبوط في إعدادات Vercel."
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

    const prompt = `
أنت مساعد قانوني متخصص في مراجعة عقود العمل وفق الأنظمة
واللوائح المعمول بها في المملكة العربية السعودية.

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
- لا تدّعِ أنك تحققت من أحدث النصوص النظامية دون مصدر.
- أجب باللغة العربية.
- أخرج كائن JSON صالحًا فقط، دون Markdown أو نص خارجه.

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
}

نص العقد المراد فحصه:
<contract>
${contractText}
</contract>
`;

    // استخدام النماذج الأكثر استقراراً عبر نقطة generateContent
    const models = [
      "gemini-1.5-flash",
      "gemini-2.0-flash",
      "gemini-1.5-pro"
    ];

    let lastErrorDetails = null;

    for (const model of models) {
      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey.trim()}`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              contents: [
                {
                  parts: [{ text: prompt }]
                }
              ],
              generationConfig: {
                responseMimeType: "application/json",
                temperature: 0.2
              }
            })
          }
        );

        const data = await response.json();

        if (!response.ok) {
          console.warn(`Model ${model} returned HTTP ${response.status}`, data);
          lastErrorDetails = data?.error?.message || `HTTP ${response.status}`;
          continue;
        }

        let generatedText = data?.candidates?.[0]?.content?.parts?.[0]?.text;

        if (typeof generatedText !== "string" || generatedText.trim() === "") {
          console.error("Gemini returned no output text for model", model);
          continue;
        }

        // إزالة علامات Markdown
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
          console.error("Gemini JSON parsing error:", parseError.message);
          continue;
        }

        const validStatuses = ["نظامي", "غير نظامي", "يحتاج مراجعة"];

        if (
          !result ||
          !validStatuses.includes(result.status) ||
          typeof result.summary !== "string" ||
          !Array.isArray(result.violations)
        ) {
          console.error("Invalid response structure from model", model);
          continue;
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

      } catch (err) {
        console.error(`Error processing model ${model}:`, err.message);
        lastErrorDetails = err.message;
      }
    }

    return res.status(502).json({
      error: "تعذر إكمال التحليل عبر Gemini بسبب ضغط الخوادم.",
      details: lastErrorDetails || "جميع الخوادم المتاحة كانت مشغولة."
    });

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
