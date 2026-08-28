// JSON-LD schema generation for SEO

import { company, isTBC } from '../data/company.mjs';

const SITE_URL = 'https://offers.akay.ie';

export function organizationSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': `${SITE_URL}/#org`,
    name: 'Akay Irl Ltd',
    alternateName: 'AKAY Trade',
    url: SITE_URL,
    logo: `${SITE_URL}/akay-bird.png`,
    description:
      'Ireland-based B2B wholesale trading company dealing in spirits, beer, soft drinks and FMCG products by the case and pallet. Duty-paid and export (under-bond) supply across Europe, Asia and the Caribbean.',
    email: 'hello@akay.ie',
    telephone: '+353872382368',
    // The founding year is now confirmed, so this is a fact rather than an
    // inference back-calculated from a years-in-trade figure. It corroborates
    // the CRO number below against the public register.
    ...(isTBC(company.founded) ? {} : { foundingDate: String(company.founded) }),
    // The registered address, not just the town. A buyer verifying the
    // counterparty is checking this against a public register, and search
    // results that carry it are part of that check.
    address: {
      '@type': 'PostalAddress',
      streetAddress: '36 Gleann an Oir',
      addressLocality: 'Shannon',
      addressRegion: 'Co. Clare',
      ...(isTBC(company.eircode) ? {} : { postalCode: company.eircode }),
      addressCountry: 'IE',
    },
    // Registration numbers, emitted only once actually supplied — a TBC
    // sentinel must never reach structured data as if it were an identifier.
    ...(isTBC(company.vat) ? {} : { vatID: company.vat }),
    ...(isTBC(company.cro) ? {} : {
      identifier: [
        { '@type': 'PropertyValue', name: 'CRO company number', value: company.cro },
        ...(isTBC(company.eori) ? [] : [{ '@type': 'PropertyValue', name: 'EORI', value: company.eori }]),
      ],
    }),
    areaServed: ['Europe', 'Asia', 'Caribbean', 'Middle East', 'Africa'],
    knowsAbout: [
      'wholesale spirits',
      'wholesale beer',
      'FMCG wholesale',
      'duty-paid trading',
      'under-bond trading',
      'parallel trading',
    ],
  };
}

// Map stock status to schema.org availability
function mapAvailability(stock) {
  if (stock === 'in') return 'https://schema.org/InStock';
  if (stock === 'warn') return 'https://schema.org/LimitedAvailability';
  return null; // Enquire = omit availability field
}

// The unit `offer.amount` is priced in, derived from the price basis the
// normalizer parsed. `amount` is the case price only when the basis says so —
// per-bottle/-can/-piece offers carry a per-unit `amount`, so hardcoding
// 'case' would misprice the structured data for them. When the basis is
// unknown (a bare Price Display fallback) we assert no quantity at all.
function eligibleUnitText(basis) {
  if (/case|pack/.test(basis)) return 'case';
  if (/unit|bottle|btl|can|piece|jar/.test(basis)) return 'unit';
  return null;
}

export function productOfferSchema(offer, slug) {
  const availability = mapAvailability(offer.stock);
  const unitText = eligibleUnitText(offer.priceBasis || '');
  const offerBlock =
    offer.amount && offer.currency
      ? {
          '@type': 'Offer',
          price: offer.amount.toFixed(2),
          priceCurrency: offer.currency,
          availability: availability,
          itemCondition: 'https://schema.org/NewCondition',
          businessFunction: 'http://purl.org/goodrelations/v1#Sell',
          eligibleCustomerType: 'http://purl.org/goodrelations/v1#Business',
          ...(unitText
            ? {
                eligibleQuantity: {
                  '@type': 'QuantitativeValue',
                  unitText,
                  minValue: 1,
                },
              }
            : {}),
          seller: { '@id': `${SITE_URL}/#org` },
          // Price valid for 14 days from build time
          priceValidUntil: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
            .toISOString()
            .split('T')[0],
        }
      : null;

  const productSchema = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: offer.name,
    url: `${SITE_URL}/offers/${slug}/`,
    description: `${offer.name} ${offer.spec}, ${offer.tier || 'wholesale'}. ${offer.priceDetail || ''}`.trim(),
  };

  if (offer.brand) {
    productSchema.brand = { '@type': 'Brand', name: offer.brand };
  }

  if (offer.category) {
    productSchema.category = offer.category;
  }

  if (offerBlock) {
    productSchema.offers = offerBlock;
  }

  // Additional properties
  const additionalProperty = [];
  if (offer.spec) {
    additionalProperty.push({
      '@type': 'PropertyValue',
      name: 'Pack size',
      value: offer.spec,
    });
  }
  if (offer.tier) {
    additionalProperty.push({
      '@type': 'PropertyValue',
      name: 'Duty status',
      value: offer.tier,
    });
  }
  if (offer.terms) {
    additionalProperty.push({
      '@type': 'PropertyValue',
      name: 'Incoterm',
      value: offer.terms,
    });
  }
  if (offer.qty) {
    additionalProperty.push({
      '@type': 'PropertyValue',
      name: 'Stock',
      value: `${offer.qty.toLocaleString()} cases`,
    });
  }
  if (offer.origin) {
    additionalProperty.push({
      '@type': 'PropertyValue',
      name: 'Origin',
      value: offer.origin,
    });
  }

  if (additionalProperty.length > 0) {
    productSchema.additionalProperty = additionalProperty;
  }

  return productSchema;
}

// Breadcrumb schema for offer pages
export function breadcrumbSchema(offerName, category, slug) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      {
        '@type': 'ListItem',
        position: 1,
        name: 'Home',
        item: SITE_URL,
      },
      {
        '@type': 'ListItem',
        position: 2,
        name: category,
        item: `${SITE_URL}/category/${category.toLowerCase().replace(/\s+/g, '-')}/`,
      },
      {
        '@type': 'ListItem',
        position: 3,
        name: offerName,
        item: `${SITE_URL}/offers/${slug}/`,
      },
    ],
  };
}

// Category page ItemList schema
export function categoryItemListSchema(categoryName, offers) {
  return {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: `Wholesale ${categoryName} Offers`,
    url: `${SITE_URL}/category/${categoryName.toLowerCase().replace(/\s+/g, '-')}/`,
    mainEntity: {
      '@type': 'ItemList',
      itemListElement: offers.map((offer, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        url: `${SITE_URL}/offers/${offer.slug}/`,
        name: offer.name,
      })),
    },
  };
}

// Article schema for guide pages
export function articleSchema(title, content, slug) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: title,
    url: `${SITE_URL}/guides/${slug}/`,
    description: content.split('\n')[0],
    author: { '@type': 'Organization', name: 'AKAY Trade' },
    publisher: {
      '@type': 'Organization',
      name: 'AKAY Trade',
      logo: { '@type': 'ImageObject', url: `${SITE_URL}/akay-bird.png` },
    },
  };
}

// ---------------------------------------------------------------------------
// Aggregation-page structured data (§1).
// ---------------------------------------------------------------------------

// Generic breadcrumb builder. The offer-page helper above hardcodes a
// Home → Category → Offer trail; brand and category pages need shorter or
// differently-shaped trails, and offer pages now carry the brand step too.
export function breadcrumbList(crumbs) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((c, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: c.name,
      item: c.path.startsWith('http') ? c.path : `${SITE_URL}${c.path}`,
    })),
  };
}

// ItemList for a brand or category page. Capped: a 400-line brand page would
// otherwise emit a JSON-LD block bigger than the HTML around it, and search
// engines only read the head of a long list anyway.
export function aggregationItemListSchema({ name, path, offers, limit = 100 }) {
  return {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name,
    url: `${SITE_URL}${path}`,
    mainEntity: {
      '@type': 'ItemList',
      numberOfItems: offers.length,
      itemListElement: offers.slice(0, limit).map((offer, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        url: `${SITE_URL}/offers/${offer.slug}/`,
        name: offer.name,
      })),
    },
  };
}

// Declares the page as the canonical description of a Brand we stock, and ties
// it back to the seller. Only emitted when the brand has live lines — asserting
// a Brand page for a brand we cannot currently supply would be a false claim.
export function brandSchema(brand, path) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Brand',
    name: brand,
    url: `${SITE_URL}${path}`,
    mainEntityOfPage: `${SITE_URL}${path}`,
  };
}
