import type { AXNode, AXTree } from "../snapshot/axtree.js";
import type { ElementLocator } from "./types.js";

export function extractLocator(node: AXNode, tree: AXTree): ElementLocator {
  const locator: ElementLocator = {};

  // 1. Text anchor: find nearest label
  const labelText = findNearestLabel(node, tree);
  if (labelText) {
    locator.textAnchor = { labelText, relation: "label-for" };
  }

  // 2. Semantic hints from properties
  const props = new Map(
    (node.properties ?? []).map((p) => [p.name, p.value.value])
  );

  const ariaLabel = props.get("aria-label") as string | undefined;
  if (ariaLabel) {
    locator.semantic = { ...locator.semantic, ariaLabel };
  }

  const placeholder = props.get("placeholder") as string | undefined;
  if (placeholder) {
    locator.semantic = { ...locator.semantic, placeholder };
  }

  const name = props.get("name") as string | undefined;
  if (name) {
    locator.semantic = { ...locator.semantic, name };
  }

  // 3. Structural hint
  locator.structural = {
    tagName: "input", // Will be refined when DOM info is available
  };

  return locator;
}

function findNearestLabel(node: AXNode, tree: AXTree): string | undefined {
  // If the node itself is a textbox with a name, use the name as label
  if (
    node.name &&
    node.role &&
    ["textbox", "combobox", "textarea"].includes(node.role)
  ) {
    return node.name;
  }

  // Look for a parent/ancestor with a name that could be a label
  for (const [, n] of tree.nodeMap) {
    if (n.childIds?.includes(node.nodeId) && n.name) {
      return n.name;
    }
  }

  return undefined;
}
