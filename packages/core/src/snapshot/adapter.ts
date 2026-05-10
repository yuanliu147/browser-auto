import type { AXNode } from "./axtree.js";

export interface ComponentAdapter {
  name: string;
  match(node: AXNode, domInfo?: ElementDOMInfo): boolean;
  inferType(node: AXNode, domInfo?: ElementDOMInfo): string;
  extractOptions?(node: AXNode, domInfo?: ElementDOMInfo): string[] | undefined;
}

export interface ElementDOMInfo {
  className?: string;
  tagName?: string;
  attributes?: Record<string, string>;
}

export class AntDAdapter implements ComponentAdapter {
  name = "antd";

  match(_node: AXNode, domInfo?: ElementDOMInfo): boolean {
    if (!domInfo?.className) return false;
    return /\bant-/.test(domInfo.className);
  }

  inferType(_node: AXNode, domInfo?: ElementDOMInfo): string {
    const cls = domInfo?.className ?? "";
    if (cls.includes("ant-input") || cls.includes("ant-input-affix-wrapper"))
      return "text-input";
    if (cls.includes("ant-select")) return "dropdown";
    if (cls.includes("ant-switch")) return "switch";
    if (cls.includes("ant-checkbox")) return "checkbox";
    if (cls.includes("ant-radio")) return "radio";
    if (cls.includes("ant-btn")) return "button";
    if (cls.includes("ant-textarea")) return "textarea";
    if (cls.includes("ant-picker")) return "date-picker";
    if (cls.includes("ant-modal")) return "modal";
    if (cls.includes("ant-form")) return "form";
    return "unknown";
  }
}

export class ElementAdapter implements ComponentAdapter {
  name = "element";

  match(_node: AXNode, domInfo?: ElementDOMInfo): boolean {
    if (!domInfo?.className) return false;
    return /\bel-/.test(domInfo.className);
  }

  inferType(_node: AXNode, domInfo?: ElementDOMInfo): string {
    const cls = domInfo?.className ?? "";
    if (cls.includes("el-input")) return "text-input";
    if (cls.includes("el-select")) return "dropdown";
    if (cls.includes("el-switch")) return "switch";
    if (cls.includes("el-checkbox")) return "checkbox";
    if (cls.includes("el-radio")) return "radio";
    if (cls.includes("el-button")) return "button";
    if (cls.includes("el-textarea")) return "textarea";
    if (cls.includes("el-date-picker")) return "date-picker";
    if (cls.includes("el-dialog")) return "modal";
    if (cls.includes("el-form")) return "form";
    return "unknown";
  }
}

const builtinAdapters: ComponentAdapter[] = [
  new AntDAdapter(),
  new ElementAdapter(),
];

export function inferComponentType(
  node: AXNode,
  domInfo?: ElementDOMInfo,
  customAdapters: ComponentAdapter[] = []
): { type: string; adapter?: string } {
  const allAdapters = [...customAdapters, ...builtinAdapters];
  for (const adapter of allAdapters) {
    if (adapter.match(node, domInfo)) {
      const type = adapter.inferType(node, domInfo);
      if (type !== "unknown") {
        return { type, adapter: adapter.name };
      }
    }
  }
  return { type: node.role ?? "unknown" };
}
