export const config = { runtime: 'edge' };

export default async function handler(req) {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { ...cors, 'Content-Type': 'application/json' } });

  try {
    const { company } = await req.json();
    if (!company) return new Response(JSON.stringify({ error: 'Company name required' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 1000,
        tools: [
          {
            type: 'web_search_20250305',
            name: 'web_search'
          }
        ],
        messages: [{
          role: 'user',
          content: `Search the web for the company "${company}" and find:
1. Their exact LinkedIn company page URL (https://www.linkedin.com/company/...)
2. Their official website domain

Search for: "${company} LinkedIn" and "${company} official website"

After searching, return ONLY valid JSON with no markdown:
{"linkedin_url": "...", "domain": "...", "company_name": "${company}", "confidence": "high|medium|low"}

If you cannot find a field with confidence, use null.`
        }],
      }),
    });

    const data = await res.json();

    // Extract text from the final response (after tool use)
    let rawText = '';
    for (const block of (data.content || [])) {
      if (block.type === 'text') rawText = block.text;
    }

    let result;
    try {
      result = JSON.parse(rawText.replace(/```json|```/g, '').trim());
    } catch {
      // Try to extract JSON from the text
      const match = rawText.match(/\{[\s\S]*\}/);
      if (match) {
        try { result = JSON.parse(match[0]); }
        catch { result = { error: 'Parse failed', raw: rawText.slice(0, 200) }; }
      } else {
        result = { error: 'No result found', raw: rawText.slice(0, 200) };
      }
    }

    return new Response(JSON.stringify({ success: true, ...result }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }
}
