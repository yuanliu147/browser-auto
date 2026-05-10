import type { FrameMatcher, ShadowMatcher, ModalMatcher } from "./types.js";

export function matchFrame(
  frame: { id: string; url: string; name?: string },
  matcher: FrameMatcher
): boolean {
  switch (matcher.strategy) {
    case "url-pattern":
      return matcher.pattern
        ? new RegExp(matcher.pattern).test(frame.url)
        : false;
    case "name":
      return frame.name === matcher.name;
    case "index": {
      // Index matching is done during ordered traversal, not here
      return false;
    }
    default:
      return false;
  }
}

export function matchShadow(
  element: { tagName: string; id?: string; className?: string },
  matcher: ShadowMatcher
): boolean {
  const selector = matcher.hostSelector;
  if (selector.startsWith("#")) {
    return element.id === selector.slice(1);
  }
  if (selector.startsWith(".")) {
    return element.className?.includes(selector.slice(1)) ?? false;
  }
  return element.tagName.toLowerCase() === selector.toLowerCase();
}

export function matchModal(
  modal: { title?: string; trigger?: string; className?: string },
  matcher: ModalMatcher
): boolean {
  switch (matcher.strategy) {
    case "title":
      return modal.title === matcher.title;
    case "trigger-text":
      return modal.trigger === matcher.trigger;
    case "class-pattern":
      return matcher.classPattern
        ? new RegExp(matcher.classPattern).test(modal.className ?? "")
        : false;
    default:
      return false;
  }
}
