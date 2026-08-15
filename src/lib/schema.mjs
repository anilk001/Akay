// JSON-LD schema generation for SEO

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
    address: {
      '@type': 'PostalAddress',
      addressLocality: 'Shannon',
      addressCountry: 'IE',
    },
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

// Incoterms under which the quoted price already has freight built in, so the
// buyer pays nothing further (DAP/DDP delivered; CIF/CFR carriage paid to a
// port). EXW/FCA/FOB leave freight to the buyer's own arrangement — no rate
// can be honestly stated for those, so shippingDetails is omitted entirely
// rather than publishing a fabricated figure.
const FREIGHT_INCLUDED_INCOTERMS = new Set(['DAP', 'DDP', 'CIF', 'CFR']);

// Public Terms reads e.g. "EXW Loendersloot" or "DAP" or "CFR Rotterdam" —
// the Incoterm is always the leading 3-letter code.
function shippingDetailsFor(offer) {
  const incoterm = (String(offer.terms || '').match(/^([A-Z]{3})\b/) || [])[1];
  if (!incoterm || !FREIGHT_INCLUDED_INCOTERMS.has(incoterm)) return null;
  return {
    '@type': 'OfferShippingDetails',
    shippingRate: {
      '@type': 'MonetaryAmount',
      value: '0',
      currency: offer.currency || 'EUR',
    },
  };
}

export function productOfferSchema(offer, slug) {
  const availability = mapAvailability(offer.stock);
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
          eligibleQuantity: {
            '@type': 'QuantitativeValue',
            unitText: 'case',
            minValue: 1,
          },
          seller: { '@id': `${SITE_URL}/#org` },
          // Price valid for 14 days from build time
          priceValidUntil: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
            .toISOString()
            .split('T')[0],
          // Wholesale trade offers are not consumer returns
          hasMerchantReturnPolicy: {
            '@type': 'MerchantReturnPolicy',
            returnPolicyCategory: 'https://schema.org/MerchantReturnNotPermitted',
          },
        }
      : null;

  if (offerBlock) {
    const shipping = shippingDetailsFor(offer);
    if (shipping) offerBlock.shippingDetails = shipping;
  }

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
