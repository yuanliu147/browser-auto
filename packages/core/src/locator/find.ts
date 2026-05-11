import type { CDPPageManager } from "../cdp/page.js";
import type { ElementLocator, LocatedElement } from "./types.js";

export async function locateElement(
  page: CDPPageManager,
  locator: ElementLocator
): Promise<LocatedElement> {
  // 1. Try label text
  if (locator.textAnchor?.labelText) {
    const el = await findByLabelText(page, locator.textAnchor.labelText);
    if (el) return el;
  }

  // 2. Try visible text (for buttons/links without labels)
  if (locator.semantic?.name) {
    const el = await findByTextContent(page, locator.semantic.name);
    if (el) return el;
  }

  // 3. Try aria-label
  if (locator.semantic?.ariaLabel) {
    const el = await findByAriaLabel(page, locator.semantic.ariaLabel);
    if (el) return el;
  }

  // 4. Try placeholder
  if (locator.semantic?.placeholder) {
    const el = await findByPlaceholder(page, locator.semantic.placeholder);
    if (el) return el;
  }

  // 5. Try structural
  if (locator.structural) {
    const el = await findByStructure(page, locator.structural);
    if (el) return el;
  }

  // 6. Try xpath
  if (locator.xpath) {
    const el = await findByXPath(page, locator.xpath);
    if (el) return el;
  }

  throw new Error(`All locator strategies failed: ${JSON.stringify(locator)}`);
}

async function findByLabelText(
  page: CDPPageManager,
  label: string
): Promise<LocatedElement | null> {
  const expression = `
    (() => {
      const labels = Array.from(document.querySelectorAll('label'));
      const labelEl = labels.find(l => {
        const text = (l.textContent || '').trim();
        return text.startsWith(${JSON.stringify(label.trim())}) || text.includes(${JSON.stringify(label.trim())});
      });
      if (!labelEl) return null;
      let target = labelEl.htmlFor ? document.getElementById(labelEl.htmlFor) : null;
      if (!target) {
        target = labelEl.querySelector('input, select, textarea, button');
      }
      if (!target) {
        target = labelEl.nextElementSibling;
      }
      return target ? { tagName: target.tagName, id: target.id, className: target.className } : null;
    })()
  `;

  const result = (await page.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
  })) as {
    result?: {
      value?: { tagName: string; id: string; className: string } | null;
    };
  };

  const val = result.result?.value;
  if (!val) return null;

  // Get backendNodeId via DOM.querySelector
  try {
    const selector = val.id
      ? `#${val.id}`
      : val.className
        ? `.${val.className.split(" ")[0]}`
        : val.tagName.toLowerCase();
    return await queryBackendNodeId(page, selector);
  } catch {
    return null;
  }
}

async function findByTextContent(
  page: CDPPageManager,
  text: string
): Promise<LocatedElement | null> {
  const expression = `
    (() => {
      const candidates = document.querySelectorAll('button, a, [role="button"]');
      for (const el of candidates) {
        if ((el.textContent || '').trim() === ${JSON.stringify(text.trim())}) {
          return { tagName: el.tagName, id: el.id, className: el.className };
        }
      }
      return null;
    })()
  `;

  const result = (await page.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
  })) as {
    result?: {
      value?: { tagName: string; id: string; className: string } | null;
    };
  };

  const val = result.result?.value;
  if (!val) return null;

  try {
    const selector = val.id
      ? `#${val.id}`
      : val.className
        ? `.${val.className.split(" ")[0]}`
        : val.tagName.toLowerCase();
    return await queryBackendNodeId(page, selector);
  } catch {
    return null;
  }
}

async function findByAriaLabel(
  page: CDPPageManager,
  label: string
): Promise<LocatedElement | null> {
  return queryBackendNodeId(page, `[aria-label=${JSON.stringify(label)}]`);
}

async function findByPlaceholder(
  page: CDPPageManager,
  placeholder: string
): Promise<LocatedElement | null> {
  return queryBackendNodeId(
    page,
    `[placeholder=${JSON.stringify(placeholder)}]`
  );
}

async function findByStructure(
  page: CDPPageManager,
  structural: { tagName: string; formIndex?: number; indexInForm?: number }
): Promise<LocatedElement | null> {
  const expression = `
    (() => {
      const forms = document.querySelectorAll('form');
      const form = forms[${structural.formIndex ?? 0}] || document.body;
      const els = form.querySelectorAll(${JSON.stringify(structural.tagName)});
      const el = els[${structural.indexInForm ?? 0}];
      return el ? { tagName: el.tagName, id: el.id, className: el.className } : null;
    })()
  `;

  const result = (await page.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
  })) as {
    result?: {
      value?: { tagName: string; id: string; className: string } | null;
    };
  };

  const val = result.result?.value;
  if (!val) return null;

  const selector = val.id
    ? `#${val.id}`
    : val.className
      ? `.${val.className.split(" ")[0]}`
      : val.tagName.toLowerCase();
  return queryBackendNodeId(page, selector);
}

async function findByXPath(
  page: CDPPageManager,
  xpath: string
): Promise<LocatedElement | null> {
  const expression = `
    (() => {
      const result = document.evaluate(${JSON.stringify(xpath)}, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
      const el = result.singleNodeValue;
      return el ? { tagName: el.tagName, id: el.id, className: el.className } : null;
    })()
  `;

  const result = (await page.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
  })) as {
    result?: {
      value?: { tagName: string; id: string; className: string } | null;
    };
  };

  const val = result.result?.value;
  if (!val) return null;

  const selector = val.id
    ? `#${val.id}`
    : val.className
      ? `.${val.className.split(" ")[0]}`
      : val.tagName.toLowerCase();
  return queryBackendNodeId(page, selector);
}

async function queryBackendNodeId(
  page: CDPPageManager,
  selector: string
): Promise<LocatedElement | null> {
  try {
    const { root } = (await page.send("DOM.getDocument", {
      depth: 0,
    })) as { root: { nodeId: number } };

    const { nodeId } = (await page.send("DOM.querySelector", {
      nodeId: root.nodeId,
      selector,
    })) as { nodeId: number };

    if (!nodeId) return null;

    const { node } = (await page.send("DOM.describeNode", {
      nodeId,
    })) as { node: { backendNodeId?: number } };

    return { backendNodeId: node.backendNodeId ?? 0, nodeId };
  } catch {
    return null;
  }
}
