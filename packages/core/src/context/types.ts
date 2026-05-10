export interface FrameMatcher {
  strategy: "url-pattern" | "name" | "index";
  pattern?: string;
  name?: string;
  index?: number;
}

export interface ShadowMatcher {
  hostSelector: string;
}

export interface ModalMatcher {
  strategy: "trigger-text" | "title" | "class-pattern";
  trigger?: string;
  title?: string;
  classPattern?: string;
}

export type ContextStep =
  | { type: "frame"; matcher: FrameMatcher }
  | { type: "shadow"; matcher: ShadowMatcher }
  | { type: "modal"; matcher: ModalMatcher };

export type ContextPath = ContextStep[];
