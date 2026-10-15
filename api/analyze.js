export default async function handler(req, res) {

  // السماح بطلبات POST فقط

  if (req.method !== "POST") {

    return res.status(405).json({

      error: "طريقة الطلب غير مسموحة."

    });

  }

  // قراءة مفتاح Gemini من إعدادات Vercel

  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {

    console.error("Missing GEMINI_API_KEY environment variable");

    return res.status(500).json({

      error: "مفتاح Gemini غير مضبوط في إعدادات الخادم."

    });

  }

  // استخدام النموذج المتاح حاليًا

  const model = "gemini-3.8-flash";

  try {

    // قراءة نص العقد

    const contractText = req.body?.contractText;

    if (

      typeof contractText !== "string" ||

      contractText.trim().length < 20

    ) {

      return res.status(400).json({

        error: "نص العقد فارغ أو قصير جدًا."

      });

    }

    // الحد الأقصى للنص لتقليل الطلبات الضخمة

    if (contractText.length > 150000) {

      return res.status(413).json({

        error: "حجم نص العقد كبير جدًا. يرجى تقسيم العقد."

      });

    }

    // تعليمات التحليل القانوني

    const prompt = `

أنت مساعد قانوني متخصص في مراجعة عقود العمل وفق الأنظمة

واللوائح المعمول بها في المملكة العربية السعودية.

مهمتك تحليل نص عقد العمل المقدم، وتحديد البنود التي قد تخالف

نظام العمل السعودي أو لوائحه، والبنود الغامضة أو التي تحتاج

إلى مراجعة قانونية.

قواعد التحليل:

1. حلل العقد بناءً على النصوص النظامية السعودية ذات الصلة.

2. لا تخترع مواد نظامية أو أرقام مواد أو أحكامًا قانونية.

3. إذا لم تكن متأكدًا من رقم مادة نظامية، اكتب

   "تحتاج إلى التحقق من النص النظامي" بدلًا من اختلاق رقم.

4. ميّز بين المخالفة النظامية المحتملة، والبند الغامض،

   والبند الذي يحتاج إلى مراجعة.

5. لا تعتبر كل بند غير مألوف مخالفة نظامية.

6. راعِ طبيعة عقد العمل ومحتوياته والنصوص النظامية ذات الصلة.

7. إذا لم تجد مخالفة واضحة، فلا تختلق مخالفات.

8. قدم اقتراحًا عمليًا لصياغة بديلة عندما يكون ذلك مناسبًا.

9. أجب باللغة العربية.

10. أخرج JSON صالحًا فقط، دون Markdown أو أي نص خارجه.

يجب أن يكون الرد وفق البنية التالية:

{

  "status": "نظامي أو غير نظامي أو يحتاج مراجعة",

  "summary": "ملخص نتيجة الفحص",

  "violations": [

    {

      "item": "اسم البند أو وصفه",

      "article": "المادة النظامية ذات الصلة أو تنبيه بضرورة التحقق",

      "issue": "شرح المشكلة وأسبابها",

      "suggestedClause": "الصياغة البديلة المقترحة"

    }

  ]

}

معايير الحالة:

- "غير نظامي": عند وجود مخالفة نظامية واضحة أو محتملة بقوة.

- "يحتاج مراجعة": عند وجود غموض أو نقص في المعلومات أو حاجة

  إلى التحقق من النصوص النظامية.

- "نظامي": عندما لا تظهر مخالفات واضحة في النص المتاح.

إذا لم توجد مخالفات أو ملاحظات، اجعل violations مصفوفة فارغة.

تنبيه: لا تدّعِ أنك تحققت من أحدث النصوص النظامية إذا لم تكن

متاحة لك في الطلب. اذكر حدود الفحص عند الحاجة.

نص العقد المراد فحصه:

<contract>

${contractText}

</contract>

`;

    // الاتصال بواجهة Gemini API

    const response = await fetch(

      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,

      {

        method: "POST",

        headers: {

          "Content-Type": "application/json",

          "x-goog-api-key": apiKey

        },

        body: JSON.stringify({

          contents: [

            {

              role: "user",

              parts: [

                {

                  text: prompt

                }

              ]

            }

          ],

          generationConfig: {

            responseMimeType: "application/json"

          }

        })

      }

    );

    // قراءة رد الخدمة

    const responseData = await response.json();

    // تسجيل تفاصيل الخطأ في سجلات Vercel دون إظهار المفتاح

    if (!response.ok) {

      console.error(

        "Gemini API error:",

        response.status,

        JSON.stringify(responseData)

      );

      return res.status(502).json({

        error: "تعذر إكمال التحليل عبر Gemini.",

        details:

          responseData?.error?.message ||

          `Gemini API returned HTTP ${response.status}`

      });

    }

    // استخراج النص الناتج

    const generatedText =

      responseData?.candidates?.[0]?.content?.parts

        ?.map((part) => part.text || "")

        .join("")

        .trim();

    if (!generatedText) {

      console.error(

        "Gemini returned no text:",

        JSON.stringify(responseData)

      );

      return res.status(502).json({

        error: "لم يُرجع Gemini نتيجة تحليل قابلة للقراءة."

      });

    }

    // تحويل النتيجة إلى JSON

    let result;

    try {

      result = JSON.parse(generatedText);

    } catch (parseError) {

      console.error(

        "Failed to parse Gemini JSON:",

        parseError.message

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

      console.error("Invalid Gemini result structure");

      return res.status(502).json({

        error: "نتيجة التحليل لا تطابق التنسيق المطلوب."

      });

    }

    // تنظيف النتائج والتحقق من أنواع الحقول

    result.violations = result.violations.map((item) => ({

      item: String(item?.item || "بند يحتاج إلى مراجعة"),

      article: String(item?.article || "لم تحدد مادة نظامية"),

      issue: String(item?.issue || "لم يذكر شرح للملاحظة"),

      suggestedClause: String(

        item?.suggestedClause || "لا توجد صياغة بديلة مقترحة"

      )

    }));

    // إرسال النتيجة إلى واجهة الموقع

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
