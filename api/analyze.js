export default async function handler(req, res) {

  // قبول طلبات POST فقط

  if (req.method !== "POST") {

    res.setHeader("Allow", "POST");

    return res.status(405).json({

      error: "طريقة الطلب غير مسموحة."

    });

  }

  const apiKey = process.env.GEMINI_API_KEY;

  const model = "gemini-3.8-flash";

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

    // إرسال الطلب إلى Google Gemini Interactions API

    const response = await fetch(

      "https://generativelanguage.googleapis.com/v1beta/interactions",

      {

        method: "POST",

        headers: {

          "Content-Type": "application/json",

          "x-goog-api-key": apiKey

        },

        body: JSON.stringify({

          model: model,

          input: prompt,

          generation_config: {

            thinking_level: "low"

          }

        })

      }

    );

    const data = await response.json();

    // إظهار تفاصيل الخطأ في سجلات Vercel دون كشف المفتاح

    if (!response.ok) {

      console.error(

        "Gemini API error:",

        response.status,

        JSON.stringify(data)

      );

      return res.status(502).json({

        error: "تعذر إكمال التحليل عبر Gemini.",

        details:

          data?.error?.message ||

          `Gemini API returned HTTP ${response.status}`

      });

    }

    // استخراج النص الناتج من الاستجابة

    let generatedText = data?.output_text;

    // احتياطًا: استخراج النص من عناصر المخرجات إذا لزم

    if (!generatedText && Array.isArray(data?.outputs)) {

      generatedText = data.outputs

        .filter((item) => item.type === "text" && item.text)

        .map((item) => item.text)

        .join("\n");

    }

    if (

      typeof generatedText !== "string" ||

      generatedText.trim() === ""

    ) {

      console.error(

        "Gemini returned no output text:",

        JSON.stringify(data)

      );

      return res.status(502).json({

        error: "لم يُرجع Gemini نصًا قابلًا للقراءة."

      });

    }

    // إزالة علامات Markdown إن أضافها النموذج

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

      console.error(

        "Gemini JSON parsing error:",

        parseError.message,

        generatedText.slice(0, 500)

      );

      return res.status(502).json({

        error: "وصلت نتيجة التحليل بتنسيق غير صالح."

      });

    }

    // التحقق من بنية النتيجة

    const validStatuses = [

      "نظامي",

      "غير نظامي",

      "يحتاج مراجعة"

    ];

    if (

      !result ||

      !validStatuses.includes(result.status) ||

      typeof result.summary !== "string" ||

      !Array.isArray(result.violations)

    ) {

      console.error("Invalid analysis response structure");

      return res.status(502).json({

        error: "تنسيق نتيجة التحليل غير صحيح."

      });

    }

    // توحيد أنواع الحقول لتتوافق مع واجهة الموقع

    result.violations = result.violations.map((item) => ({

      item: String(item?.item || "بند يحتاج إلى مراجعة"),

      article: String(item?.article || "تحتاج المادة إلى التحقق"),

      issue: String(item?.issue || "لم يذكر شرح للملاحظة"),

      suggestedClause: String(

        item?.suggestedClause || "لا توجد صياغة بديلة مقترحة"

      )

    }));

    // إرسال النتيجة للواجهة

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
