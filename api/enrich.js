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
        max_tokens: 500,
        messages: [{
          role: 'user',
          content: `You are a company data expert. For the company "${company}", find and return:
1. Their LinkedIn company page URL (format: https://www.linkedin.com/company/[slug])
2. Their official website domain (format: https://www.example.com)

Rules:
- Return ONLY valid JSON, no markdown, no explanation
- If you are not confident about a field, return null for that field
- LinkedIn URL must follow the exact format: https://www.linkedin.com/company/[slug]
- Domain should be the main official website
- Do not guess or make up URLs — only return what you are confident about

Return exactly this JSON:
{"linkedin_url": "https://www.linkedin.com/company/...", "domain": "https://www.example.com", "company_name": "${company}", "confidence": "high|medium|low"}`
        }],
      }),
    });

    const data = await res.json();
    const raw = data.content?.[0]?.text || '{}';

    let result;
    try {
      result = JSON.parse(raw.replace(/```json|```/g, '').trim());
    } catch {
      result = { error: 'Could not parse result', raw };
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
