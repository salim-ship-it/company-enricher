export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { company } = req.body;
    if (!company) return res.status(400).json({ error: 'Company name required' });

    const messages = [{
      role: 'user',
      content: `Search for the company "${company}" and find:
1. Their LinkedIn company URL (https://www.linkedin.com/company/...)
2. Their official website domain

After searching, return ONLY this JSON with no markdown:
{"linkedin_url": "...", "domain": "...", "company_name": "${company}", "confidence": "high|medium|low"}`
    }];

    // Agentic loop - handle tool use
    let finalText = '';
    let iterations = 0;

    while (iterations < 5) {
      iterations++;

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
          messages
        })
      });

      const data = await response.json();
      const stopReason = data.stop_reason;
      const content = data.content || [];

      // Add assistant response to messages
      messages.push({ role: 'assistant', content });

      if (stopReason === 'end_turn') {
        // Extract final text
        for (const block of content) {
          if (block.type === 'text') finalText = block.text;
        }
        break;
      }

      if (stopReason === 'tool_use') {
        // Build tool results
        const toolResults = [];
        for (const block of content) {
          if (block.type === 'tool_use') {
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: block.input?.query
                ? `Search completed for: ${block.input.query}`
                : 'Search completed'
            });
          }
        }
        messages.push({ role: 'user', content: toolResults });
        continue;
      }

      break;
    }

    // Parse result
    let result;
    try {
      const clean = finalText.replace(/```json|```/g, '').trim();
      const match = clean.match(/\{[\s\S]*\}/);
      result = JSON.parse(match ? match[0] : clean);
    } catch {
      result = {
        company_name: company,
        linkedin_url: null,
        domain: null,
        confidence: 'low'
      };
    }

    return res.status(200).json({ success: true, ...result });

  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}
