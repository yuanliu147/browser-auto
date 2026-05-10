export interface TextAnchor {
  labelText: string;
  relation?: "label-for" | "sibling" | "parent-child";
}

export interface SemanticHint {
  ariaLabel?: string;
  placeholder?: string;
  name?: string;
}

export interface StructuralHint {
  tagName: string;
  formIndex?: number;
  indexInForm?: number;
}

export interface ElementLocator {
  textAnchor?: TextAnchor;
  semantic?: SemanticHint;
  structural?: StructuralHint;
  xpath?: string;
}

export interface LocatedElement {
  backendNodeId: number;
  nodeId?: number;
  frameId?: string;
  rect?: { x: number; y: number; width: number; height: number };
}
