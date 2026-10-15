export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { contractText } = req.body;
  const apiKey = process.env.GEMINI_API_KEY;

  if (!contractText) {
    return res.status(400).json({ error: 'نص العقد مفقود' });
  }

  if (!apiKey) {
    return res.status(500).json({ error: 'مفتاح الـ API غير معرف في Vercel.' });
  }

  const systemPrompt = `أنت مستشار قانوني سعودي خبير في نظام العمل السعودي ولائحته التنفيذية. 
اقرأ العقد التالي وحدد المخالفات النظامية والبنود المقترحة بناءً على نظام العمل السعودي. الرد يجب أن يكون بصيغة JSON فقط بهذا الشكل تماماً بدون أي نصوص إضافية:
{
  "status": "نظامي" أو "غير نظامي",
  "summary": "ملخص عام لنظامية العقد",
  "violations": [
    {
      "item": "عنوان المخالفة",
      "issue": "تفاصيل المخالفة",
      "article": "رقم المادة والمصدر",
      "suggestedClause": "البند المقترح للتعديل"
    }
  ]
}`;

  try {
    // جلب قائمة النماذج المتاحة للمفتاح أو استخدام gemini-2.5-flash / gemini-2.0-flash
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey.trim()}`;
    
    let response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: systemPrompt + "\n\n[نص العقد المراد فحصه]:\n" + contractText }] }],
        generationConfig: { responseMimeType: "application/json" }
      })
    });

    let data = await response.json();

    // في حال عدم توفر 2.5 جرب v1 المباشر مع gemini-1.5-flash
    if (data.error) {
      const fallbackUrl = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${apiKey.trim()}`;
      response = await fetch(fallbackUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: systemPrompt + "\n\n[نص العقد المراد فحصه]:\n" + contractText }] }],
          generationConfig: { responseMimeType: "application/json" }
        })
      });
      data = await response.json();
    }

    if (data.error) {
      throw new Error(data.error.message);
    }

    const rawText = data.candidates[0].content.parts[0].text;
    const result = JSON.parse(rawText);
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ error: "خطأ من الذكاء الاصطناعي: " + err.message });
  }
}
