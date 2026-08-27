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

// Validate a barcode and return the schema.org property it belongs in.
//
// The catalogue has no product images, so it can never qualify for Google's
// image-bearing Product rich results. A GTIN is the substitute: given a valid
// one, Google resolves the listing against its own product catalogue instead of
// relying on our page alone.
//
// Publishing an INVALID identifier is worse than publishing none — Google flags
// it and distrusts the record — so the GS1 check digit is verified here. The
// weighting (3,1,3,1... from the rightmost data digit) is the same for EAN-8,
// UPC-12, EAN-13 and GTIN-14, so one routine covers every length we accept.
function gtinProperty(raw = '') {
  const code = String(raw).replace(/[^0-9]/g, '');
  const prop = { 8: 'gtin8', 12: 'gtin12', 13: 'gtin13', 14: 'gtin14' }[code.length];
  if (!prop) return null;

  const digits = code.split('').map(Number);
  const check = digits.pop();
  let sum = 0;
  digits.reverse().forEach((d, i) => { sum += d * (i % 2 === 0 ? 3 : 1); });
  if ((10 - (sum % 10)) % 10 !== check) return null;

  return { prop, code };
}

// Map stock status to schema.org availability
function mapAvailability(stock) {
  if (stock === 'in') return 'https://schema.org/InStock';
  if (stock === 'warn') return 'https://schema.org/LimitedAvailability';
  return null; // Enquire = omit availability field
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
        }
      : null;

  // Public Note is buyer-facing copy a trader wrote for this specific offer, so
  // it beats the generated template whenever it exists. The template stays as
  // the fallback for the offers that have none.
  const description = [
    `${offer.name} ${offer.spec}, ${offer.tier || 'wholesale'}.`,
    offer.priceDetail || '',
    offer.note || '',
  ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();

  const productSchema = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: offer.name,
    url: `${SITE_URL}/offers/${slug}/`,
    description,
  };

  // Product identifier, when the barcode passes its check digit.
  const gtin = gtinProperty(offer.ean);
  if (gtin) {
    productSchema[gtin.prop] = gtin.code;
  }

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

// CollectionPage + ItemList for a brand landing page. Mirrors the category
// schema so both collection surfaces describe themselves the same way.
export function brandCollectionSchema(brandName, slug, offers) {
  return {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: `${brandName} Wholesale Offers`,
    url: `${SITE_URL}/brand/${slug}/`,
    description: `Current wholesale trade offers for ${brandName} — case and pallet pricing, pack specs and duty tier on every line.`,
    mainEntity: {
      '@type': 'ItemList',
      numberOfItems: offers.length,
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
