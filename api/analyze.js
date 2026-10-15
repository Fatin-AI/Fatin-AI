export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { contractText } = req.body;
  const token = process.env.GEMINI_API_KEY; // هنا تحط توكن الـ AQ. في فريبل Vercel
  const projectId = process.env.GCP_PROJECT_ID; // معرف مشروع جوجل كلود

  if (!contractText) {
    return res.status(400).json({ error: 'نص العقد مفقود' });
  }

  if (!token || !projectId) {
    return res.status(500).json({ error: 'تأكد من إضافة توكن AQ ومعرف المشروع (GCP_PROJECT_ID) في إعدادات Vercel.' });
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
    // رابط Vertex AI الرسمي الذي يدعم توكنات AQ. (يتطلب Project ID)
    const url = `https://us-central1-aiplatform.googleapis.com/v1/projects/${projectId}/locations/us-central1/publishers/google/models/gemini-1.5-flash:generateContent`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token.trim()}`
      },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [{ text: systemPrompt + "\n\n[نص العقد المراد فحصه]:\n" + contractText }]
        }],
        generationConfig: {
          temperature: 0.2
        }
      })
    });

    const data = await response.json();
    if (data.error) {
      throw new Error(data.error.message);
    }

    const rawText = data.candidates[0].content.parts[0].text;
    // تنظيف الـ JSON في حال وجود علامات تخزين إضافية
    const cleanJson = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
    const result = JSON.parse(cleanJson);
    
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ error: "خطأ Vertex AI: " + err.message });
  }
}
