export const prerender = true;

export async function GET() {
  const robotsTxt = `User-agent: *
Allow: /
# The stock-list workbook is generated at build time and revealed in the UI only
# after a successful enquiry (§4). A static site cannot gate the file itself, but
# there is no reason for it to appear in search results as a naked download.
Disallow: /downloads/

User-agent: GPTBot
Allow: /

User-agent: ClaudeBot
Allow: /

User-agent: Claude-SearchBot
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: Google-Extended
Allow: /

User-agent: Applebot-Extended
Allow: /

User-agent: Bytespider
Allow: /

User-agent: CCBot
Allow: /

Sitemap: https://offers.akay.ie/sitemap.xml
`;

  return new Response(robotsTxt, {
    headers: {
      'Content-Type': 'text/plain',
    },
  });
}
