export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { company } = req.body;
    if (!company) return res.status(400).json({ error: 'Company name required' });

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 1000,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        messages: [{
          role: 'user',
          content: `Find the LinkedIn company page URL and official website for: "${company}"

Search for "${company} LinkedIn company" and "${company} official website"

Return ONLY this JSON, no markdown, no extra text:
{"linkedin_url": "https://www.linkedin.com/company/...", "domain": "https://www.example.com", "company_name": "${company}", "confidence": "high"}

Use null for any field you cannot find with confidence.`
        }]
      })
    });

    const data = await response.json();

    // Find the last text block (after tool use completes)
    let rawText = '';
    for (const block of (data.content || [])) {
      if (block.type === 'text') rawText = block.text;
    }

    let result;
    try {
      const clean = rawText.replace(/```json|```/g, '').trim();
      const match = clean.match(/\{[\s\S]*\}/);
      result = JSON.parse(match ? match[0] : clean);
    } catch {
      result = { company_name: company, linkedin_url: null, domain: null, confidence: 'low', error: 'parse_failed' };
    }

    return res.status(200).json({ success: true, ...result });

  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}
