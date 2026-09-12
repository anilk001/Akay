import { SITE_URL } from '../lib/site.mjs';

export const prerender = true;

// AI crawlers get an explicit group. A robots.txt group inherits nothing from
// the wildcard group, so every rule these bots should obey — including the
// /sig/ exclusion — has to be repeated here rather than left to `User-agent: *`.
const AI_CRAWLERS = [
  'GPTBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  'ClaudeBot',
  'Claude-SearchBot',
  'Claude-User',
  'PerplexityBot',
  'Perplexity-User',
  'Google-Extended',
  'Applebot-Extended',
  'Bytespider',
  'CCBot',
  'meta-externalagent',
  'Amazonbot',
];

export async function GET() {
  const robotsTxt = `# akay.ie — AKAY Trade's public B2B wholesale catalogue.
# The whole catalogue is meant to be indexed. /sig/ holds internal email
# signature HTML with no search value, so it stays out of the index.

User-agent: *
Allow: /
Disallow: /sig/

# Answer engines are welcome to the catalogue and the buyer's guides.
${AI_CRAWLERS.map((bot) => `User-agent: ${bot}`).join('\n')}
Allow: /
Disallow: /sig/

Sitemap: ${SITE_URL}/sitemap.xml
`;

  return new Response(robotsTxt, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
