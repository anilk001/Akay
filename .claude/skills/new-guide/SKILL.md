---
name: new-guide
description: Scaffold a new buyer's guide for offers.akay.ie — adds an entry to src/data/guides.mjs so it renders at /guides/<slug> and appears in the sitemap automatically. Use when the user wants a new trade guide, explainer, or educational page (e.g. duty status, incoterms, licensing).
---

# New buyer's guide

Guides are plain data: each is an object in the `guides` array in
`src/data/guides.mjs`, rendered by `src/pages/guides/[slug].astro`. The sitemap
(`src/pages/sitemap.xml.ts`) and guides index pick entries up automatically —
no other file needs touching.

## Steps

1. Ask for (or infer from the request) the topic and target reader. Guides are
   B2B trade education for beverage buyers — practical, concrete, no fluff.
2. Pick a `slug`: lowercase, hyphenated, keyword-rich (see existing ones like
   `t1-vs-t2-duty-status`, `incoterms-exw-dap-cfr`).
3. Append an object to the `guides` array matching the existing shape exactly:

   ```js
   {
     slug: 'my-new-guide',
     title: 'Title Cased, Keyword-Rich, Under ~70 Chars',
     excerpt: 'One sentence a buyer would click on.',
     content: `
   ## Markdown body

   Sections with ## headings, short paragraphs, concrete numbers and examples.
       `.trim(),
   }
   ```

4. Match the house style of existing guides:
   - `##` sections, short paragraphs, bold key terms, bullet lists
   - Concrete worked examples with EUR prices where relevant
   - A closing section pointing readers to enquire with AKAY when the topic
     needs case-by-case advice
   - Never include supplier names, buy prices, or margins — guides are public
5. Verify: run `npm run build` and confirm the new page is emitted at
   `dist/guides/<slug>/index.html` and listed in `dist/sitemap.xml`.
