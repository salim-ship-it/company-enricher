export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { company } = req.body;
    if (!company) return res.status(400).json({ error: 'Company name required' });

    // ── Step 1: Clearbit → domain ──────────────────────────────────────
    let domain = null;
    let companyName = company;
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

    // ── Step 2: Generate LinkedIn slug candidates ──────────────────────
    function slugify(name) {
      return name
        .toLowerCase()
        .replace(/\b(llc|fze|fzco|ltd|limited|inc|corp|est|uae|dubai|abu dhabi|sharjah|ajman|medical|centre|center|clinic|hospital|polyclinic|healthcare|health care|group|co)\b/gi, '')
        .replace(/[^a-z0-9\s]/g, '')
        .trim()
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
    }

    const base = slugify(company);
    const words = base.split('-').filter(Boolean);

    // Build candidates from most likely to least likely
    const candidates = [];
    if (base) candidates.push(base);
    if (words.length > 1) candidates.push(words.join(''));               // no hyphens
    if (words.length > 1) candidates.push(words[0] + '-' + words[1]);   // first two words
    if (words[0]) candidates.push(words[0]);                             // first word only
    if (domain) {
      const domainSlug = domain.replace('https://', '').replace('http://', '').replace('www.', '').split('.')[0];
      if (domainSlug && !candidates.includes(domainSlug)) candidates.push(domainSlug);
    }
    // Also try common patterns
    const noSpaces = company.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!candidates.includes(noSpaces)) candidates.push(noSpaces);

    // ── Step 3: Verify LinkedIn slugs in parallel ─────────────────────
    let linkedinUrl = null;
    const checks = candidates.slice(0, 6).map(async (slug) => {
      if (!slug || slug.length < 2) return null;
      try {
        const r = await fetch(`https://www.linkedin.com/company/${slug}`, {
          method: 'HEAD',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
            'Accept-Language': 'en-US,en;q=0.9'
          },
          redirect: 'follow'
        });
        // 200 or redirected to same company = valid
        if (r.status === 200) return `https://www.linkedin.com/company/${slug}`;
        // Check final URL after redirects
        if (r.url && r.url.includes('/company/') && !r.url.includes('/login') && !r.url.includes('/authwall')) {
          const finalSlug = r.url.split('/company/')[1]?.split('/')[0]?.split('?')[0];
          if (finalSlug && finalSlug.length > 2) return `https://www.linkedin.com/company/${finalSlug}`;
        }
        return null;
      } catch { return null; }
    });

    const results = await Promise.all(checks);
    linkedinUrl = results.find(r => r !== null) || null;

    // ── Step 4: Build response ────────────────────────────────────────
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
