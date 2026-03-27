export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { company } = req.body;
    if (!company) return res.status(400).json({ error: 'Company name required' });

    let domain = null;
    let linkedinUrl = null;
    let companyName = company;

    // ── Step 1: Clearbit for domain ──────────────────────────────────
    try {
      const cb = await fetch(
        `https://autocomplete.clearbit.com/v1/companies/suggest?query=${encodeURIComponent(company)}`,
        { headers: { 'User-Agent': 'Mozilla/5.0' } }
      );
      const cbData = await cb.json();
      if (cbData?.length > 0 && cbData[0].domain) {
        domain = `https://${cbData[0].domain}`;
        companyName = cbData[0].name || company;
      }
    } catch {}

    // ── Step 2: Use Claude with web_search to find LinkedIn ──────────
    try {
      const messages = [{
        role: 'user',
        content: `Search for the LinkedIn company page for "${company}". 
This is likely a clinic or medical center in Saudi Arabia or UAE.
Search: "${company} linkedin company"
Also try: "${company} Saudi Arabia linkedin"

After searching, return ONLY this JSON (no markdown):
{"linkedin_url": "https://www.linkedin.com/company/...", "domain": "https://...", "company_name": "${company}", "confidence": "high|medium|low"}

Use null for fields you cannot find. Only return verified URLs you actually found in search results.`
      }];

      let finalText = '';
      let iterations = 0;

      while (iterations < 6) {
        iterations++;
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'anthropic-dangerous-direct-browser-access': 'true',
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-5',
            max_tokens: 500,
            tools: [{ type: 'web_search_20250305', name: 'web_search' }],
            messages
          })
        });

        const data = await response.json();
        const content = data.content || [];
        messages.push({ role: 'assistant', content });

        if (data.stop_reason === 'end_turn') {
          for (const block of content) {
            if (block.type === 'text') finalText = block.text;
          }
          break;
        }

        if (data.stop_reason === 'tool_use') {
          const toolResults = content
            .filter(b => b.type === 'tool_use')
            .map(b => ({
              type: 'tool_result',
              tool_use_id: b.id,
              content: `Search executed for: ${b.input?.query || company}`
            }));
          messages.push({ role: 'user', content: toolResults });
          continue;
        }
        break;
      }

      // Parse result from Claude
      if (finalText) {
        try {
          const match = finalText.match(/\{[\s\S]*?\}/);
          if (match) {
            const parsed = JSON.parse(match[0]);
            if (parsed.linkedin_url && parsed.linkedin_url.includes('linkedin.com/company/')) {
              linkedinUrl = parsed.linkedin_url;
            }
            if (parsed.domain && !domain) {
              domain = parsed.domain;
            }
            if (parsed.company_name) companyName = parsed.company_name;
          }
        } catch {}
      }
    } catch {}

    // ── Step 3: Slug verification fallback ───────────────────────────
    if (!linkedinUrl) {
      function slugify(name) {
        return name
          .toLowerCase()
          .replace(/\b(llc|fze|fzco|ltd|limited|inc|corp|est|uae|dubai|saudi|arabia|ksa|medical|centre|center|clinic|hospital|polyclinic|healthcare|group|co|general|complex|specialized|dental|care)\b/gi, '')
          .replace(/[^a-z0-9\s]/g, '')
          .trim()
          .replace(/\s+/g, '-')
          .replace(/-+/g, '-')
          .replace(/^-|-$/g, '');
      }

      const base = slugify(company);
      const words = base.split('-').filter(Boolean);
      const candidates = [...new Set([
        base,
        words.join(''),
        words.slice(0, 2).join('-'),
        words[0],
        words.slice(0, 3).join('-'),
      ].filter(s => s && s.length > 2))].slice(0, 5);

      const checks = candidates.map(async (slug) => {
        try {
          const r = await fetch(`https://www.linkedin.com/company/${slug}`, {
            method: 'HEAD',
            headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
            redirect: 'follow'
          });
          if (r.status === 200) return `https://www.linkedin.com/company/${slug}`;
          if (r.url?.includes('/company/') && !r.url?.includes('/login') && !r.url?.includes('/authwall')) {
            const finalSlug = r.url.split('/company/')[1]?.split('/')[0]?.split('?')[0];
            if (finalSlug?.length > 2) return `https://www.linkedin.com/company/${finalSlug}`;
          }
          return null;
        } catch { return null; }
      });

      const results = await Promise.all(checks);
      linkedinUrl = results.find(r => r !== null) || null;
    }

    const confidence = (domain && linkedinUrl) ? 'high' : (domain || linkedinUrl) ? 'medium' : 'low';

    return res.status(200).json({
      success: true,
      company_name: companyName,
      linkedin_url: linkedinUrl,
      domain,
      confidence,
      search_linkedin: `https://www.linkedin.com/search/results/companies/?keywords=${encodeURIComponent(company)}`,
      search_google: `https://www.google.com/search?q=${encodeURIComponent(company + ' linkedin company page')}`
    });

  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}
