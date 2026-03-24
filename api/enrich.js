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
    let confidence = 'low';

    // Step 1: Clearbit autocomplete — free, no auth, best for known companies
    try {
      const cbRes = await fetch(
        `https://autocomplete.clearbit.com/v1/companies/suggest?query=${encodeURIComponent(company)}`,
        { headers: { 'User-Agent': 'Mozilla/5.0' } }
      );
      const cbData = await cbRes.json();
      if (cbData && cbData.length > 0) {
        const best = cbData[0];
        if (best.domain) domain = `https://${best.domain}`;
        companyName = best.name || company;
        confidence = 'medium';
      }
    } catch (e) {}

    // Step 2: DuckDuckGo HTML search for LinkedIn
    try {
      const q = encodeURIComponent(`${company} linkedin company page`);
      const ddgRes = await fetch(`https://html.duckduckgo.com/html/?q=${q}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept': 'text/html'
        }
      });
      const html = await ddgRes.text();
      const matches = [...html.matchAll(/linkedin\.com\/company\/([a-zA-Z0-9\-_]+)/g)];
      const skip = new Set(['login','signup','company','jobs','in','pub','search','about','help','legal','accessibility']);
      const slugs = [...new Set(matches.map(m => m[1]))].filter(s => s.length > 2 && !skip.has(s.toLowerCase()));
      if (slugs.length > 0) {
        linkedinUrl = `https://www.linkedin.com/company/${slugs[0]}`;
        confidence = domain ? 'high' : 'medium';
      }
    } catch (e) {}

    // Step 3: If still no domain, try to find from DuckDuckGo website search
    if (!domain) {
      try {
        const q = encodeURIComponent(`${company} official website UAE`);
        const ddgRes = await fetch(`https://html.duckduckgo.com/html/?q=${q}`, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'text/html'
          }
        });
        const html = await ddgRes.text();
        // Extract result URLs from DDG result links
        const urlMatches = [...html.matchAll(/uddg=([^"&]+)/g)];
        const skip = ['duckduckgo', 'google', 'linkedin', 'facebook', 'instagram', 'twitter', 'youtube', 'bayt', 'indeed', 'glassdoor', 'naukrigulf'];
        for (const m of urlMatches) {
          try {
            const decoded = decodeURIComponent(m[1]);
            const url = new URL(decoded);
            const host = url.hostname.replace('www.', '');
            if (!skip.some(s => host.includes(s))) {
              domain = `https://${url.hostname}`;
              confidence = linkedinUrl ? 'high' : 'medium';
              break;
            }
          } catch {}
        }
      } catch (e) {}
    }

    return res.status(200).json({
      success: true,
      company_name: companyName,
      linkedin_url: linkedinUrl,
      domain,
      confidence,
      search_linkedin: `https://www.linkedin.com/search/results/companies/?keywords=${encodeURIComponent(company)}`,
      search_google: `https://www.google.com/search?q=${encodeURIComponent(company + ' linkedin company page UAE')}`
    });

  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}
