/**
 * Homologa los montos en CLP a separador de miles "." y decimales ",".
 *
 * El Liquid del tema ya usa ese formato, pero apps de terceros (descuentos wpd/wcp)
 * reescriben precios en el cliente con formato "$20,940" o "$20940.00". Este script
 * normaliza cualquier texto "$<monto>" del sitio, incluido el que se inserta después
 * de cargar la página (carrito, PLP, búsqueda, recomendaciones).
 */
(() => {
  const currency = String(
    window.Shopify?.currency?.active || window.Shopify?.currency?.currencyCode || window.Shopify?.currency?.isoCode || 'CLP'
  ).toUpperCase();

  if (currency !== 'CLP') return;

  /** Elementos cuyo texto no es contenido visible o es editable por el usuario. */
  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TEXTAREA', 'CODE', 'PRE']);

  /** "$" seguido de un monto compuesto por dígitos y separadores. */
  const MONEY_PATTERN = /(\$\s*)(\d[\d.,]*\d|\d)/g;
  const QUICK_CHECK = /\$\s*\d/;

  /**
   * Ya está en formato CLP: 940, 20.940, 1.250.000, 20.940,50
   * Los decimales se limitan a 1-2 dígitos: una coma seguida de 3 dígitos separa miles.
   */
  const CLP_FORMAT = /^\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?$/;

  /** Formato a corregir: 20,940 / 20,940.00 / 20940 / 20940.00 */
  const FOREIGN_FORMAT = /^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?$/;

  /**
   * @param {string} amount
   * @returns {string}
   */
  function formatAmount(amount) {
    if (CLP_FORMAT.test(amount) || !FOREIGN_FORMAT.test(amount)) return amount;

    const [whole = '0', fraction = ''] = amount.replaceAll(',', '').split('.');
    const groupedWhole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.');

    // CLP no usa decimales; solo se conservan si realmente tienen valor.
    return /[1-9]/.test(fraction) ? `${groupedWhole},${fraction}` : groupedWhole;
  }

  /**
   * @param {Text} node
   */
  function normalizeTextNode(node) {
    const text = node.nodeValue;
    if (!text || !QUICK_CHECK.test(text)) return;

    const parent = node.parentElement;
    if (!parent || SKIP_TAGS.has(parent.tagName) || parent.isContentEditable) return;

    const nextText = text.replace(MONEY_PATTERN, (_, symbol, amount) => `${symbol}${formatAmount(amount)}`);
    if (nextText !== text) node.nodeValue = nextText;
  }

  /**
   * @param {Node} root
   */
  function normalizeTree(root) {
    if (root.nodeType === Node.TEXT_NODE) {
      normalizeTextNode(/** @type {Text} */ (root));
      return;
    }

    if (!(root instanceof Element) || SKIP_TAGS.has(root.tagName)) return;

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (node.nodeType === Node.TEXT_NODE) return NodeFilter.FILTER_ACCEPT;

        const element = /** @type {Element} */ (node);
        if (SKIP_TAGS.has(element.tagName) || element.isContentEditable) return NodeFilter.FILTER_REJECT;

        return NodeFilter.FILTER_SKIP;
      },
    });

    let node = walker.nextNode();
    while (node) {
      normalizeTextNode(/** @type {Text} */ (node));
      node = walker.nextNode();
    }
  }

  /** @type {Set<Node>} */
  const pendingRoots = new Set();
  let frame = 0;

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'characterData') {
        pendingRoots.add(mutation.target);
        continue;
      }

      for (const node of mutation.addedNodes) pendingRoots.add(node);
    }

    if (pendingRoots.size) scheduleFlush();
  });

  function flush() {
    frame = 0;

    for (const root of pendingRoots) {
      if (root.isConnected) normalizeTree(root);
    }

    pendingRoots.clear();
    // Descarta las mutaciones generadas por este mismo script.
    observer.takeRecords();
  }

  function scheduleFlush() {
    if (frame) return;
    frame = requestAnimationFrame(flush);
  }

  function normalizeDocument() {
    pendingRoots.add(document.body || document.documentElement);
    scheduleFlush();
  }

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', normalizeDocument, { once: true });
  } else {
    normalizeDocument();
  }

  window.addEventListener('load', normalizeDocument, { once: true });
})();
