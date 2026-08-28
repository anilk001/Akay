// §6 — translated copy for the trust pages and the category-page chrome.
//
// Scope is deliberate. Catalogue rows stay in English: product names ARE brand
// names, and "Absolut Vodka 12 x 100cl" translated is worse than untranslated.
// What gets translated is the part a buyer in Luanda or Recife actually needs to
// read — what the customs codes mean, how we trade, and who we are.
//
// Written as prose per language rather than run through a key-per-word
// dictionary, because these pages are arguments, not UI labels, and a
// string-substituted argument reads like one.

export const I18N_PAGES = ['/about/', '/trade-terms/', '/customs-glossary/', '/categories/'];

// Shared chrome: breadcrumbs, headings and the labels the category pages need.
export const UI = {
  pt: {
    catalogue: 'Catálogo',
    categories: 'Categorias',
    brands: 'Marcas',
    tradeTerms: 'Condições comerciais',
    customs: 'Regime aduaneiro',
    about: 'Sobre nós',
    liveLines: 'linhas disponíveis',
    brandsLabel: 'marcas',
    inStock: 'em stock agora',
    currencies: 'moedas',
    viewInEnglish: 'Ver o catálogo completo em inglês',
    catalogueNote: 'As linhas do catálogo são apresentadas em inglês — os nomes dos produtos são nomes de marca. Os preços, especificações e o regime aduaneiro são os mesmos.',
    browseLines: (n, c) => `Ver ${n} linhas de ${c}`,
  },
  es: {
    catalogue: 'Catálogo',
    categories: 'Categorías',
    brands: 'Marcas',
    tradeTerms: 'Condiciones comerciales',
    customs: 'Régimen aduanero',
    about: 'Quiénes somos',
    liveLines: 'líneas disponibles',
    brandsLabel: 'marcas',
    inStock: 'en stock ahora',
    currencies: 'divisas',
    viewInEnglish: 'Ver el catálogo completo en inglés',
    catalogueNote: 'Las líneas del catálogo se muestran en inglés: los nombres de producto son nombres de marca. Los precios, especificaciones y el régimen aduanero son los mismos.',
    browseLines: (n, c) => `Ver ${n} líneas de ${c}`,
  },
  fr: {
    catalogue: 'Catalogue',
    categories: 'Catégories',
    brands: 'Marques',
    tradeTerms: 'Conditions commerciales',
    customs: 'Régime douanier',
    about: 'À propos',
    liveLines: 'lignes disponibles',
    brandsLabel: 'marques',
    inStock: 'en stock maintenant',
    currencies: 'devises',
    viewInEnglish: 'Voir le catalogue complet en anglais',
    catalogueNote: "Les lignes du catalogue restent en anglais : les noms de produits sont des noms de marque. Les prix, les spécifications et le régime douanier sont identiques.",
    browseLines: (n, c) => `Voir ${n} lignes de ${c}`,
  },
  ar: {
    catalogue: 'الكتالوج',
    categories: 'الفئات',
    brands: 'الماركات',
    tradeTerms: 'شروط التعامل',
    customs: 'الوضع الجمركي',
    about: 'من نحن',
    liveLines: 'بنود متاحة',
    brandsLabel: 'ماركة',
    inStock: 'متوفر الآن',
    currencies: 'عملات',
    viewInEnglish: 'اطّلع على الكتالوج الكامل بالإنجليزية',
    catalogueNote: 'تظل بنود الكتالوج بالإنجليزية، لأن أسماء المنتجات هي أسماء ماركات. الأسعار والمواصفات والوضع الجمركي هي نفسها.',
    browseLines: (n, c) => `اطّلع على ${n} بنداً من ${c}`,
  },
};

// The three long-form pages. `sections` is a list of { h2, p[] } so the template
// is identical across languages and only the words change.
export const PAGES = {
  '/about/': {
    pt: {
      title: 'Sobre a Akay Irl Ltd — atacadista de bebidas e FMCG na Irlanda',
      description: 'A Akay Irl Ltd é uma empresa comercial B2B sediada na Irlanda: destilados, cervejas, refrigerantes e FMCG por caixa, palete e contentor, com documentação de exportação completa.',
      h1: 'Sobre a Akay Irl Ltd',
      lede: 'Empresa comercial B2B sediada em Shannon, na Irlanda. Vendemos por caixa, palete e contentor a compradores comerciais — nunca ao consumidor final.',
      sections: [
        {
          h2: 'O que vendemos',
          p: [
            'Destilados, cervejas, vinhos, champanhe, refrigerantes, confeitaria, artigos de higiene e mercearia. As linhas de destilados são as mais profundas do catálogo, mas consolidamos várias categorias no mesmo contentor — muitas vezes é isso que torna o frete por caixa viável.',
            'Todas as mercadorias são produto genuíno do proprietário da marca, adquirido ao proprietário da marca ou a um distribuidor autorizado. Não trabalhamos com produto contrafeito, reenchido ou desviado.',
          ],
        },
        {
          h2: 'Como trabalhamos',
          p: [
            'O catálogo mostra o preço atual, o formato de embalagem, o regime aduaneiro e o ponto de carga de cada linha. O stock roda diariamente: uma linha vendida hoje sai do catálogo hoje.',
            'Não há registo nem senha. Escolha as linhas que lhe interessam, envie um único pedido e respondemos com preços firmes, disponibilidade e condições de carga para essas linhas específicas.',
          ],
        },
        {
          h2: 'Verificação',
          p: [
            'Um comprador que coloca a primeira encomenda de um contentor deve verificar a contraparte antes de transferir qualquer valor. Os nossos dados de registo estão publicados no rodapé de todas as páginas deste site.',
            'Referências comerciais e bancárias disponíveis a pedido. Pedimos o mesmo aos nossos fornecedores.',
          ],
        },
        {
          h2: 'Documentação',
          p: [
            'Fatura comercial, lista de embalagem, CMR, declaração de trânsito T1/T2, EX1 na exportação para fora da UE, certificado de análise onde o produtor o emite e certificado sanitário quando o destino o exige.',
            'Se o seu despachante precisar de algo que não esteja nesta lista, diga-nos na fase de cotação e não depois do carregamento: alguns certificados não podem ser emitidos retroativamente.',
          ],
        },
      ],
    },
    es: {
      title: 'Sobre Akay Irl Ltd — mayorista de bebidas y FMCG en Irlanda',
      description: 'Akay Irl Ltd es una empresa comercial B2B con sede en Irlanda: destilados, cervezas, refrescos y FMCG por caja, palé y contenedor, con documentación de exportación completa.',
      h1: 'Sobre Akay Irl Ltd',
      lede: 'Empresa comercial B2B con sede en Shannon, Irlanda. Vendemos por caja, palé y contenedor a compradores comerciales, nunca al consumidor final.',
      sections: [
        {
          h2: 'Qué vendemos',
          p: [
            'Destilados, cervezas, vinos, champán, refrescos, confitería, artículos de higiene y alimentación. Las líneas de destilados son las más profundas del catálogo, pero consolidamos varias categorías en el mismo contenedor: a menudo es lo que hace viable el flete por caja.',
            'Toda la mercancía es producto genuino del titular de la marca, adquirido al titular de la marca o a un distribuidor autorizado. No trabajamos con producto falsificado, rellenado ni desviado.',
          ],
        },
        {
          h2: 'Cómo trabajamos',
          p: [
            'El catálogo muestra el precio actual, el formato de caja, el régimen aduanero y el punto de carga de cada línea. El stock rota a diario: una línea vendida hoy sale del catálogo hoy.',
            'No hay registro ni contraseña. Marque las líneas que le interesen, envíe una única solicitud y le responderemos con precios firmes, disponibilidad y condiciones de carga para esas líneas concretas.',
          ],
        },
        {
          h2: 'Verificación',
          p: [
            'Un comprador que hace su primer pedido de contenedor debe verificar a la contraparte antes de transferir nada. Nuestros datos registrales están publicados en el pie de todas las páginas de este sitio.',
            'Referencias comerciales y bancarias disponibles a petición. Pedimos lo mismo a nuestros proveedores.',
          ],
        },
        {
          h2: 'Documentación',
          p: [
            'Factura comercial, lista de empaque, CMR, declaración de tránsito T1/T2, EX1 en exportación fuera de la UE, certificado de análisis cuando el productor lo emite y certificado sanitario cuando el destino lo exige.',
            'Si su agente de aduanas necesita algo que no figure en esta lista, díganoslo en la fase de cotización y no después de la carga: algunos certificados no pueden emitirse de forma retroactiva.',
          ],
        },
      ],
    },
    fr: {
      title: 'À propos d’Akay Irl Ltd — grossiste boissons et FMCG en Irlande',
      description: 'Akay Irl Ltd est une société de négoce B2B basée en Irlande : spiritueux, bières, boissons sans alcool et FMCG à la caisse, à la palette et au conteneur, avec documentation d’export complète.',
      h1: 'À propos d’Akay Irl Ltd',
      lede: 'Société de négoce B2B basée à Shannon, en Irlande. Nous vendons à la caisse, à la palette et au conteneur à des acheteurs professionnels, jamais au consommateur final.',
      sections: [
        {
          h2: 'Ce que nous vendons',
          p: [
            'Spiritueux, bières, vins, champagne, boissons sans alcool, confiserie, hygiène et épicerie. Les spiritueux constituent la partie la plus profonde du catalogue, mais nous consolidons plusieurs catégories dans le même conteneur — c’est souvent ce qui rend le fret à la caisse viable.',
            'Toute la marchandise est un produit authentique du propriétaire de la marque, acquis auprès du propriétaire de la marque ou d’un distributeur agréé. Nous ne traitons ni contrefaçon, ni produit reconditionné, ni marchandise détournée.',
          ],
        },
        {
          h2: 'Comment nous travaillons',
          p: [
            'Le catalogue affiche pour chaque ligne le prix actuel, le format de caisse, le régime douanier et le point de chargement. Le stock tourne quotidiennement : une ligne vendue aujourd’hui quitte le catalogue aujourd’hui.',
            'Aucune inscription, aucun mot de passe. Sélectionnez les lignes qui vous intéressent, envoyez une seule demande, et nous revenons avec des prix fermes, la disponibilité et les conditions de chargement pour ces lignes précises.',
          ],
        },
        {
          h2: 'Vérification',
          p: [
            'Un acheteur qui passe sa première commande de conteneur doit vérifier sa contrepartie avant tout virement. Nos données d’immatriculation figurent en pied de chaque page de ce site.',
            'Références commerciales et bancaires disponibles sur demande. Nous demandons la même chose à nos fournisseurs.',
          ],
        },
        {
          h2: 'Documentation',
          p: [
            'Facture commerciale, liste de colisage, CMR, déclaration de transit T1/T2, EX1 à l’export hors UE, certificat d’analyse lorsque le producteur en délivre un, et certificat sanitaire lorsque la destination l’exige.',
            'Si votre commissionnaire en douane a besoin d’un document absent de cette liste, dites-le nous au stade de la cotation et non après chargement : certains certificats ne peuvent pas être délivrés rétroactivement.',
          ],
        },
      ],
    },
    ar: {
      title: 'عن شركة Akay Irl Ltd — تجارة الجملة للمشروبات والسلع الاستهلاكية من أيرلندا',
      description: 'شركة Akay Irl Ltd هي شركة تجارة بين الشركات مقرها أيرلندا: مشروبات روحية وبيرة ومشروبات غازية وسلع استهلاكية بالكرتونة والطبلية والحاوية، مع مستندات تصدير كاملة.',
      h1: 'عن شركة Akay Irl Ltd',
      lede: 'شركة تجارة بين الشركات مقرها شانون في أيرلندا. نبيع بالكرتونة والطبلية والحاوية للمشترين التجاريين فقط، ولا نبيع للمستهلك النهائي.',
      sections: [
        {
          h2: 'ما نبيعه',
          p: [
            'مشروبات روحية وبيرة ونبيذ وشمبانيا ومشروبات غازية وحلويات ومستحضرات عناية ومواد غذائية. المشروبات الروحية هي أعمق قسم في الكتالوج، لكننا ندمج عدة فئات في الحاوية نفسها، وهذا في الغالب ما يجعل تكلفة الشحن لكل كرتونة مجدية.',
            'كل البضاعة منتج أصلي من مالك الماركة، مُشترى من مالك الماركة أو من موزّع معتمد. لا نتعامل مع بضاعة مقلّدة أو مُعاد تعبئتها أو محوّلة عن مسارها.',
          ],
        },
        {
          h2: 'كيف نعمل',
          p: [
            'يعرض الكتالوج لكل بند السعر الحالي وشكل التعبئة والوضع الجمركي ونقطة التحميل. المخزون يتغيّر يومياً: البند الذي يُباع اليوم يخرج من الكتالوج اليوم.',
            'لا تسجيل ولا كلمة مرور. اختر البنود التي تريدها، وأرسل طلباً واحداً، ونعود إليك بأسعار نهائية وبيان التوفّر وشروط التحميل لتلك البنود تحديداً.',
          ],
        },
        {
          h2: 'التحقّق من الشركة',
          p: [
            'من يضع أول طلب حاوية عليه أن يتحقّق من الطرف المقابل قبل تحويل أي مبلغ. بيانات تسجيل شركتنا منشورة في أسفل كل صفحة من هذا الموقع.',
            'المراجع التجارية والبنكية متاحة عند الطلب. ونطلب المثل من مورّدينا.',
          ],
        },
        {
          h2: 'المستندات',
          p: [
            'فاتورة تجارية، وقائمة تعبئة، وبوليصة CMR، وبيان عبور T1/T2، وبيان تصدير EX1 عند الشحن خارج الاتحاد الأوروبي، وشهادة تحليل حين يصدرها المُنتِج، وشهادة صحية حين تطلبها جهة الوصول.',
            'إذا احتاج مخلّصك الجمركي مستنداً غير مذكور هنا، أخبرنا في مرحلة التسعير وليس بعد التحميل: بعض الشهادات لا يمكن إصدارها بأثر رجعي.',
          ],
        },
      ],
    },
  },

  '/trade-terms/': {
    pt: {
      title: 'Condições comerciais, mínimos, Incoterms e documentos | Akay Irl Ltd',
      description: 'Como trabalhamos: mínimos de encomenda, Incoterms que praticamos, pontos de carga, documentos fornecidos, consolidação de paletes mistas e prazos de entrega.',
      h1: 'Condições comerciais',
      lede: 'Tudo o que de outra forma teria de nos perguntar por email. Se faltar algo de que precisa, diga-nos e acrescentamos a esta página.',
      sections: [
        {
          h2: 'Mínimos de encomenda',
          p: [
            'Os mínimos são definidos por linha pelo armazém que detém o stock, não centralmente por nós, por isso variam. Quando uma linha tem o seu próprio mínimo, ele está indicado nessa oferta.',
            'Como regra: uma linha isolada sai normalmente a partir de uma palete completa, e uma encomenda mista precisa de atingir um valor que justifique carregar um envio. Abaixo disso continuamos a cotar, mas o frete por caixa passa a dominar o preço.',
          ],
        },
        {
          h2: 'Pagamento',
          p: [
            'As condições de pagamento são confirmadas na cotação, para as linhas, o volume e o destino concretos. Ficam por escrito antes de qualquer compromisso e não mudam entre a cotação e a fatura.',
            'Numa primeira encomenda com uma contraparte nova, espere condições mais apertadas do que numa conta estabelecida. Isso funciona nos dois sentidos: peça-nos referências comerciais e bancárias e nós fornecemos.',
          ],
        },
        {
          h2: 'Incoterms',
          p: [
            'EXW: recolhe no armazém indicado; carregamento, desalfandegamento de exportação, frete e seguro são seus. FCA: entregamos ao transportador que indicar e tratamos do desalfandegamento de exportação. FOB: entregamos a bordo no porto indicado.',
            'CFR: pagamos o frete marítimo até ao porto de destino, sem seguro. CIF: como CFR, mais seguro de carga mínimo. DAP: entregamos no endereço indicado, com direitos e desalfandegamento de importação a seu cargo.',
            'As condições de cada linha aparecem no rodapé do respetivo cartão no catálogo, com o ponto de carga acrescentado quando é conhecido.',
          ],
        },
        {
          h2: 'Documentos fornecidos',
          p: [
            'Fatura comercial, lista de embalagem, CMR nos movimentos rodoviários, declaração de trânsito T1/T2, EX1 na exportação para fora da UE, certificado de análise onde o produtor o emite e certificado sanitário quando o destino o exige.',
            'A documentação é a parte de uma encomenda de exportação que corre mal mais vezes. Diga-nos o que o seu despachante exige na fase de cotação.',
          ],
        },
        {
          h2: 'Paletes mistas e consolidação',
          p: [
            'Paletes mistas são possíveis quando as linhas estão no mesmo armazém. Construir uma palete a partir de dois armazéns implica um movimento interno primeiro, o que acrescenta custo e alguns dias.',
            'Em encomendas de contentor consolidamos entre categorias. Álcool sob regime suspensivo não pode ser consolidado com mercadoria com direitos pagos no mesmo movimento, porque circulam sob regimes aduaneiros diferentes.',
          ],
        },
        {
          h2: 'Prazos',
          p: [
            'A partir da encomenda confirmada e do pagamento recebido, os movimentos rodoviários europeus carregam normalmente em poucos dias úteis. No frete marítimo, o prazo depende sobretudo da escala de partida do porto de carga.',
            'Em qualquer envio por mar cotamos uma data de carga, não uma data de entrega. Uma data de entrega que não controlamos não é um compromisso que valha a pena assumir.',
          ],
        },
      ],
    },
    es: {
      title: 'Condiciones comerciales, mínimos, Incoterms y documentos | Akay Irl Ltd',
      description: 'Cómo trabajamos: mínimos de pedido, Incoterms que aplicamos, puntos de carga, documentos suministrados, consolidación de palés mixtos y plazos.',
      h1: 'Condiciones comerciales',
      lede: 'Todo lo que de otro modo tendría que preguntarnos por correo. Si falta algo que necesita, dígalo y lo añadimos a esta página.',
      sections: [
        {
          h2: 'Mínimos de pedido',
          p: [
            'Los mínimos los fija por línea el almacén que tiene el stock, no nosotros de forma central, por eso varían. Cuando una línea tiene su propio mínimo, aparece en esa oferta.',
            'Como regla: una línea suelta sale normalmente a partir de un palé completo, y un pedido mixto necesita alcanzar un valor que justifique cargar un envío. Por debajo seguimos cotizando, pero el flete por caja empieza a dominar el precio.',
          ],
        },
        {
          h2: 'Pago',
          p: [
            'Las condiciones de pago se confirman en la cotización, para las líneas, el volumen y el destino concretos. Quedan por escrito antes de cualquier compromiso y no cambian entre cotización y factura.',
            'En un primer pedido con una contraparte nueva, espere condiciones más estrictas que en una cuenta consolidada. Funciona en ambos sentidos: pídanos referencias comerciales y bancarias y se las facilitamos.',
          ],
        },
        {
          h2: 'Incoterms',
          p: [
            'EXW: recoge en el almacén indicado; carga, despacho de exportación, flete y seguro son suyos. FCA: entregamos al transportista que designe y gestionamos el despacho de exportación. FOB: entregamos a bordo en el puerto indicado.',
            'CFR: pagamos el flete marítimo hasta el puerto de destino, sin seguro. CIF: como CFR, más seguro de carga mínimo. DAP: entregamos en la dirección indicada, con aranceles y despacho de importación a su cargo.',
            'Las condiciones de cada línea figuran en el pie de su ficha en el catálogo, con el punto de carga añadido cuando se conoce.',
          ],
        },
        {
          h2: 'Documentos suministrados',
          p: [
            'Factura comercial, lista de empaque, CMR en movimientos por carretera, declaración de tránsito T1/T2, EX1 en exportación fuera de la UE, certificado de análisis cuando el productor lo emite y certificado sanitario cuando el destino lo exige.',
            'La documentación es la parte de un pedido de exportación que falla con más frecuencia. Díganos qué exige su agente de aduanas en la fase de cotización.',
          ],
        },
        {
          h2: 'Palés mixtos y consolidación',
          p: [
            'Los palés mixtos son posibles cuando las líneas están en el mismo almacén. Construir un palé desde dos almacenes implica un movimiento interior previo, que añade coste y algunos días.',
            'En pedidos de contenedor consolidamos entre categorías. El alcohol en régimen suspensivo no puede consolidarse con mercancía con aranceles pagados en el mismo movimiento, porque circulan bajo regímenes aduaneros distintos.',
          ],
        },
        {
          h2: 'Plazos',
          p: [
            'Desde el pedido confirmado y el pago recibido, los movimientos por carretera en Europa suelen cargar en pocos días laborables. En marítimo, el plazo depende sobre todo del calendario de salidas del puerto de carga.',
            'En cualquier envío por mar cotizamos una fecha de carga, no de entrega. Una fecha de entrega que no controlamos no es un compromiso que merezca hacerse.',
          ],
        },
      ],
    },
    fr: {
      title: 'Conditions commerciales, minimums, Incoterms et documents | Akay Irl Ltd',
      description: 'Comment nous travaillons : minimums de commande, Incoterms pratiqués, points de chargement, documents fournis, consolidation de palettes mixtes et délais.',
      h1: 'Conditions commerciales',
      lede: 'Tout ce qu’il vous faudrait sinon nous demander par courriel. S’il manque une information dont vous avez besoin, dites-le et nous l’ajoutons à cette page.',
      sections: [
        {
          h2: 'Minimums de commande',
          p: [
            'Les minimums sont fixés ligne par ligne par l’entrepôt qui détient le stock, et non par nous de façon centralisée : ils varient donc. Lorsqu’une ligne porte son propre minimum, il figure sur cette offre.',
            'En règle générale : une ligne seule part à partir d’une palette complète, et une commande mixte doit atteindre une valeur qui justifie de charger un envoi. En dessous, nous cotons toujours, mais le fret à la caisse commence à dominer le prix.',
          ],
        },
        {
          h2: 'Paiement',
          p: [
            'Les conditions de paiement sont confirmées sur la cotation, pour les lignes, le volume et la destination concernés. Elles sont écrites avant tout engagement et ne changent pas entre la cotation et la facture.',
            'Pour une première commande avec une nouvelle contrepartie, attendez-vous à des conditions plus strictes que pour un compte établi. Cela vaut dans les deux sens : demandez-nous des références commerciales et bancaires, nous les fournissons.',
          ],
        },
        {
          h2: 'Incoterms',
          p: [
            'EXW : vous enlevez à l’entrepôt désigné ; chargement, dédouanement export, fret et assurance sont à votre charge. FCA : nous livrons au transporteur que vous désignez et prenons en charge le dédouanement export. FOB : nous livrons à bord au port désigné.',
            'CFR : nous payons le fret maritime jusqu’au port de destination, sans assurance. CIF : comme CFR, avec une assurance cargo minimale. DAP : nous livrons à l’adresse indiquée, droits et dédouanement import restant à votre charge.',
            'Les conditions de chaque ligne figurent en pied de sa fiche dans le catalogue, avec le point de chargement lorsqu’il est connu.',
          ],
        },
        {
          h2: 'Documents fournis',
          p: [
            'Facture commerciale, liste de colisage, CMR sur les mouvements routiers, déclaration de transit T1/T2, EX1 à l’export hors UE, certificat d’analyse lorsque le producteur en délivre, certificat sanitaire lorsque la destination l’exige.',
            'La documentation est la partie d’une commande export qui échoue le plus souvent. Indiquez-nous ce qu’exige votre commissionnaire dès la cotation.',
          ],
        },
        {
          h2: 'Palettes mixtes et consolidation',
          p: [
            'Les palettes mixtes sont possibles lorsque les lignes se trouvent dans le même entrepôt. Constituer une palette depuis deux entrepôts suppose un mouvement intérieur préalable, qui ajoute du coût et quelques jours.',
            'Sur les commandes conteneur, nous consolidons entre catégories. L’alcool sous suspension de droits ne peut pas être consolidé avec de la marchandise droits acquittés sur le même mouvement : les deux circulent sous des régimes douaniers différents.',
          ],
        },
        {
          h2: 'Délais',
          p: [
            'À compter de la commande confirmée et du paiement reçu, les mouvements routiers européens chargent en général en quelques jours ouvrés. En maritime, le délai dépend surtout du calendrier des départs au port de chargement.',
            'Sur tout envoi maritime, nous cotons une date de chargement et non une date de livraison. Une date de livraison que nous ne contrôlons pas n’est pas un engagement qui vaille la peine d’être pris.',
          ],
        },
      ],
    },
    ar: {
      title: 'شروط التعامل والحدود الدنيا وشروط الإنكوترمز والمستندات | Akay Irl Ltd',
      description: 'كيف نعمل: الحدود الدنيا للطلب، وشروط الإنكوترمز التي نتعامل بها، ونقاط التحميل، والمستندات المرفقة، ودمج الطبليات المختلطة، والمدد الزمنية.',
      h1: 'شروط التعامل',
      lede: 'كل ما كنت ستحتاج لسؤالنا عنه بالبريد. إن كان ينقص شيء تحتاجه، أخبرنا ونضيفه إلى هذه الصفحة.',
      sections: [
        {
          h2: 'الحدود الدنيا للطلب',
          p: [
            'الحد الأدنى يحدده لكل بند المستودع الذي يحتفظ بالمخزون، لا نحن مركزياً، ولذلك يتفاوت. وحين يحمل بند حداً أدنى خاصاً به، فهو مكتوب على ذلك العرض.',
            'كقاعدة عامة: البند المنفرد يُشحن عادة من طبلية كاملة وما فوق، والطلب المختلط يحتاج قيمة تجعل تحميل الشحنة مجدياً. وما دون ذلك نستمر في التسعير، لكن تكلفة الشحن لكل كرتونة تبدأ في السيطرة على السعر.',
          ],
        },
        {
          h2: 'الدفع',
          p: [
            'تُحدَّد شروط الدفع في عرض السعر، بحسب البنود والكمية وجهة الوصول تحديداً. وتكون مكتوبة قبل أي التزام، ولا تتغيّر بين عرض السعر والفاتورة.',
            'في أول طلب مع طرف جديد، توقّع شروطاً أضيق من حساب قائم. وهذا يعمل في الاتجاهين: اطلب منا مراجع تجارية وبنكية ونحن نقدّمها.',
          ],
        },
        {
          h2: 'شروط الإنكوترمز',
          p: [
            'EXW: تستلم من المستودع المحدد، والتحميل والتخليص للتصدير والشحن والتأمين عليك. FCA: نسلّم إلى الناقل الذي تحدده ونتولّى تخليص التصدير. FOB: نسلّم على ظهر السفينة في الميناء المحدد.',
            'CFR: ندفع الشحن البحري إلى ميناء الوصول دون تأمين. CIF: مثل CFR مع تأمين بحري بالحد الأدنى. DAP: نسلّم إلى العنوان المحدد، وتبقى الرسوم والتخليص عند الوصول عليك.',
            'شروط كل بند مكتوبة أسفل بطاقته في الكتالوج، وتُضاف نقطة التحميل حين تكون معروفة.',
          ],
        },
        {
          h2: 'المستندات المرفقة',
          p: [
            'فاتورة تجارية، وقائمة تعبئة، وبوليصة CMR في النقل البري، وبيان عبور T1/T2، وبيان EX1 عند التصدير خارج الاتحاد الأوروبي، وشهادة تحليل حين يصدرها المُنتِج، وشهادة صحية حين تطلبها جهة الوصول.',
            'المستندات هي الجزء الذي يتعثّر أكثر من غيره في طلبات التصدير. أخبرنا بما يطلبه مخلّصك الجمركي في مرحلة التسعير.',
          ],
        },
        {
          h2: 'الطبليات المختلطة والدمج',
          p: [
            'الطبليات المختلطة ممكنة حين تكون البنود في المستودع نفسه. أما تكوين طبلية من مستودعين فيتطلّب نقلاً داخلياً أولاً، وهو ما يضيف تكلفة وبعض الأيام.',
            'في طلبات الحاويات ندمج بين الفئات. لكن الكحول تحت التعليق الجمركي لا يمكن دمجه مع بضاعة مدفوعة الرسوم في الحركة نفسها، لأن الاثنين يسيران تحت نظامين جمركيين مختلفين.',
          ],
        },
        {
          h2: 'المدد الزمنية',
          p: [
            'من تأكيد الطلب ووصول الدفعة، تُحمّل الحركات البرية الأوروبية عادة في أيام عمل قليلة. أما في الشحن البحري فالمدة تتوقف على جدول الإقلاع من ميناء التحميل أكثر مما تتوقف علينا.',
            'في أي شحنة بحرية نعطي تاريخ تحميل لا تاريخ تسليم. تاريخ تسليم لا نتحكّم فيه ليس التزاماً يستحق أن يُقطع.',
          ],
        },
      ],
    },
  },

  '/customs-glossary/': {
    pt: {
      title: 'T1, T2, sob regime suspensivo e direitos pagos explicados | Akay Irl Ltd',
      description: 'O que significa o regime aduaneiro de cada oferta para si como importador: T1 em suspensão, T2 mercadoria da União, stock em armazém sob regime suspensivo e direitos pagos.',
      h1: 'Regime aduaneiro, em termos simples',
      lede: 'Todas as linhas do catálogo mostram um regime aduaneiro. É o fator que mais pesa no custo real da mercadoria à chegada e em saber se a pode comprar.',
      sections: [
        {
          h2: 'T1',
          p: [
            'Regime de trânsito aduaneiro, não uma categoria de produto. A mercadoria está fisicamente na UE mas nunca foi desalfandegada para venda aqui: direitos de importação, imposto especial de consumo e IVA continuam suspensos, e o envio circula entre armazéns sob garantia aduaneira.',
            'É o regime normal do negócio de exportação, tipicamente 15% a 40% mais barato do que a mesma mercadoria com direitos pagos, porque nenhum dos impostos do destino está ainda no preço.',
            'Para comprar T1 precisa de um local que receba sob regime suspensivo: um armazém autorizado, um destinatário aprovado, ou um envio de exportação que saia da UE.',
          ],
        },
        {
          h2: 'T2',
          p: [
            'T2 significa mercadoria da União: os direitos de importação foram pagos e a mercadoria pode circular e ser vendida em qualquer ponto do mercado único sem outra formalidade aduaneira.',
            'O imposto especial sobre o álcool é uma questão separada do regime aduaneiro. Quando uma linha está desalfandegada e com imposto pago, listamo-la como direitos pagos.',
          ],
        },
        {
          h2: 'Sob regime suspensivo',
          p: [
            'Descreve onde está a mercadoria: um armazém autorizado a manter mercadoria com direitos e imposto suspensos. Loendersloot, nos Países Baixos, é o exemplo mais conhecido no setor das bebidas.',
            'Pode ser expedida para si em suspensão ou desalfandegada à saída. A diferença altera significativamente o custo à chegada, por isso é definida na cotação e não presumida.',
          ],
        },
        {
          h2: 'Direitos pagos',
          p: [
            'Posição totalmente desalfandegada: direitos e imposto especial pagos no país onde a mercadoria está, pronta para revenda sem qualquer outro facto tributário.',
            'É o regime mais caro dos quatro. Se vai reexportar para fora da UE, normalmente é a compra errada: estaria a pagar imposto especial europeu sobre mercadoria que sai da Europa.',
          ],
        },
        {
          h2: 'Qual devo pedir?',
          p: [
            'Se a mercadoria sai da UE, peça T1 ou sob regime suspensivo. Se vende dentro da UE e não tem instalação autorizada, peça T2 ou direitos pagos.',
            'Se não tem a certeza, diga-nos o país de destino e o que pretende fazer com a mercadoria, e dizemos-lhe quais das nossas linhas pode efetivamente comprar.',
          ],
        },
      ],
    },
    es: {
      title: 'T1, T2, en régimen suspensivo y aranceles pagados | Akay Irl Ltd',
      description: 'Qué significa el régimen aduanero de cada oferta para usted como importador: T1 en suspensión, T2 mercancía de la Unión, stock en depósito aduanero y aranceles pagados.',
      h1: 'Régimen aduanero, en términos claros',
      lede: 'Cada línea del catálogo muestra un régimen aduanero. Es el factor que más pesa en el coste real de la mercancía a la llegada y en si usted puede comprarla.',
      sections: [
        {
          h2: 'T1',
          p: [
            'Régimen de tránsito aduanero, no una categoría de producto. La mercancía está físicamente en la UE pero nunca se ha despachado para su venta aquí: aranceles, impuestos especiales e IVA siguen suspendidos, y el envío circula entre depósitos bajo garantía aduanera.',
            'Es el régimen normal del negocio de exportación, normalmente entre un 15% y un 40% más barato que la misma mercancía con aranceles pagados, porque ninguno de los impuestos del destino está aún en el precio.',
            'Para comprar T1 necesita un lugar que reciba en suspensión: un depósito aduanero, un destinatario autorizado, o un envío de exportación que salga de la UE.',
          ],
        },
        {
          h2: 'T2',
          p: [
            'T2 significa mercancía de la Unión: los aranceles se han pagado y la mercancía puede circular y venderse en cualquier punto del mercado único sin más formalidad aduanera.',
            'El impuesto especial sobre el alcohol es una cuestión distinta del régimen aduanero. Cuando una línea está despachada y con el impuesto pagado, la listamos como aranceles pagados.',
          ],
        },
        {
          h2: 'En régimen suspensivo',
          p: [
            'Describe dónde está la mercancía: un depósito autorizado para mantener mercancía con aranceles e impuestos suspendidos. Loendersloot, en los Países Bajos, es el ejemplo más conocido del sector de bebidas.',
            'Puede expedirse a usted en suspensión o despacharse a la salida. La diferencia cambia mucho el coste a la llegada, por eso se fija en la cotización y no se presume.',
          ],
        },
        {
          h2: 'Aranceles pagados',
          p: [
            'Posición totalmente despachada: aranceles e impuestos especiales pagados en el país donde está la mercancía, lista para reventa sin ningún otro hecho imponible.',
            'Es el régimen más caro de los cuatro. Si va a reexportar fuera de la UE, normalmente es la compra equivocada: pagaría impuestos especiales europeos sobre mercancía que sale de Europa.',
          ],
        },
        {
          h2: '¿Cuál debo pedir?',
          p: [
            'Si la mercancía sale de la UE, pida T1 o régimen suspensivo. Si vende dentro de la UE y no dispone de instalación autorizada, pida T2 o aranceles pagados.',
            'Si no está seguro, díganos el país de destino y qué piensa hacer con la mercancía, y le diremos cuáles de nuestras líneas puede comprar realmente.',
          ],
        },
      ],
    },
    fr: {
      title: 'T1, T2, sous douane et droits acquittés expliqués | Akay Irl Ltd',
      description: 'Ce que le régime douanier de chaque offre signifie pour vous en tant qu’importateur : T1 en suspension, T2 marchandise de l’Union, stock en entrepôt sous douane et droits acquittés.',
      h1: 'Le régime douanier, en clair',
      lede: 'Chaque ligne du catalogue affiche un régime douanier. C’est le facteur qui pèse le plus sur le coût réel de la marchandise à l’arrivée, et sur votre capacité à l’acheter.',
      sections: [
        {
          h2: 'T1',
          p: [
            'Régime de transit douanier, et non une catégorie de produit. La marchandise se trouve physiquement dans l’UE mais n’a jamais été dédouanée pour y être vendue : droits, accises et TVA restent suspendus, et l’envoi circule entre entrepôts sous garantie douanière.',
            'C’est le régime normal de l’activité export, généralement 15 à 40 % moins cher que la même marchandise droits acquittés, puisque aucune taxe de destination n’est encore dans le prix.',
            'Pour acheter en T1, il vous faut un lieu capable de recevoir sous suspension : un entrepôt sous douane, un destinataire agréé, ou un envoi export quittant l’UE.',
          ],
        },
        {
          h2: 'T2',
          p: [
            'T2 signifie marchandise de l’Union : les droits d’importation sont payés et la marchandise peut circuler et être vendue partout dans le marché unique sans autre formalité douanière.',
            'Les accises sur l’alcool sont une question distincte du régime douanier. Lorsqu’une ligne est à la fois dédouanée et accises payées, nous l’indiquons droits acquittés.',
          ],
        },
        {
          h2: 'Sous douane',
          p: [
            'Décrit où se trouve le stock : un entrepôt autorisé à détenir de la marchandise droits et accises suspendus. Loendersloot, aux Pays-Bas, en est l’exemple le plus connu dans les spiritueux.',
            'Le stock peut vous être expédié sous suspension ou dédouané à la sortie. L’écart change nettement le coût rendu, il est donc arrêté dans la cotation et non supposé.',
          ],
        },
        {
          h2: 'Droits acquittés',
          p: [
            'Position entièrement dédouanée : droits de douane et accises payés dans le pays où se trouve le stock, prêt à être revendu sans autre événement fiscal.',
            'C’est le plus cher des quatre régimes. Si vous réexportez hors UE, c’est généralement le mauvais achat : vous paierez des accises européennes sur de la marchandise qui quitte l’Europe.',
          ],
        },
        {
          h2: 'Lequel demander ?',
          p: [
            'Si la marchandise quitte l’UE, demandez du T1 ou du sous douane. Si vous vendez dans l’UE et n’avez pas d’installation agréée, demandez du T2 ou droits acquittés.',
            'En cas de doute, indiquez-nous le pays de destination et ce que vous comptez faire de la marchandise : nous vous dirons lesquelles de nos lignes vous pouvez réellement prendre.',
          ],
        },
      ],
    },
    ar: {
      title: 'شرح T1 وT2 والإيداع الجمركي والرسوم المدفوعة | Akay Irl Ltd',
      description: 'ماذا يعني الوضع الجمركي لكل عرض بالنسبة لك كمستورد: T1 تحت التعليق، وT2 بضاعة الاتحاد، والمخزون في مستودع جمركي، والرسوم المدفوعة.',
      h1: 'الوضع الجمركي بعبارات واضحة',
      lede: 'كل بند في الكتالوج يحمل وضعاً جمركياً. وهو العامل الأكبر في التكلفة الحقيقية للبضاعة عند الوصول، وفي ما إذا كان بإمكانك شراؤها أصلاً.',
      sections: [
        {
          h2: 'T1',
          p: [
            'وضع عبور جمركي، لا تصنيف للمنتج. البضاعة موجودة فعلياً داخل الاتحاد الأوروبي لكنها لم تُخلَّص للبيع فيه: رسوم الاستيراد والرسوم الانتقائية وضريبة القيمة المضافة كلها معلّقة، والشحنة تتحرك بين المستودعات الجمركية بضمان.',
            'هذا هو الوضع المعتاد في أعمال التصدير، وهو عادة أرخص بنسبة 15% إلى 40% من البضاعة نفسها مدفوعة الرسوم، لأن ضرائب جهة الوصول ليست في السعر بعد.',
            'لشراء T1 تحتاج مكاناً يستقبلها تحت التعليق: مستودع جمركي، أو مُرسَل إليه معتمد جمركياً، أو شحنة تصدير تخرج من الاتحاد الأوروبي.',
          ],
        },
        {
          h2: 'T2',
          p: [
            'T2 تعني بضاعة الاتحاد: رسوم الاستيراد مدفوعة، والبضاعة يمكنها التحرك والبيع في أي مكان داخل السوق الموحّدة دون إجراء جمركي آخر.',
            'الرسوم الانتقائية على الكحول مسألة منفصلة عن الوضع الجمركي. وحين يكون البند مُخلَّصاً ومدفوع الرسوم الانتقائية، ندرجه بوصف الرسوم المدفوعة.',
          ],
        },
        {
          h2: 'الإيداع الجمركي',
          p: [
            'يصف مكان وجود البضاعة: مستودع مرخّص لحفظ البضاعة مع تعليق الرسوم. ومستودع Loendersloot في هولندا هو المثال الأشهر في تجارة المشروبات.',
            'يمكن شحنها إليك تحت التعليق أو تخليصها عند الخروج. والفرق بين الحالتين يغيّر التكلفة عند الوصول تغييراً كبيراً، ولذلك يُحدَّد في عرض السعر ولا يُفترض.',
          ],
        },
        {
          h2: 'الرسوم المدفوعة',
          p: [
            'الوضع المُخلَّص بالكامل: الرسوم الجمركية والانتقائية مدفوعة في البلد الذي توجد فيه البضاعة، وهي جاهزة لإعادة البيع دون أي واقعة ضريبية أخرى.',
            'وهو الأعلى سعراً بين الأوضاع الأربعة. وإذا كنت ستعيد تصدير البضاعة خارج الاتحاد الأوروبي فهو عادة الشراء الخطأ: ستكون تدفع رسوماً أوروبية على بضاعة تخرج من أوروبا.',
          ],
        },
        {
          h2: 'أي وضع أطلب؟',
          p: [
            'إذا كانت البضاعة ستخرج من الاتحاد الأوروبي فاطلب T1 أو الإيداع الجمركي. وإذا كنت تبيع داخل الاتحاد ولا تملك منشأة جمركية فاطلب T2 أو الرسوم المدفوعة.',
            'وإن لم تكن متأكداً، أخبرنا ببلد الوصول وبما تنوي فعله بالبضاعة، ونخبرك أي بنودنا يمكنك أخذها فعلاً.',
          ],
        },
      ],
    },
  },
};
