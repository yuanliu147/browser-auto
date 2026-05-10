export interface MemoryKey {
  equals(other: MemoryKey): boolean;
  hash(): string;
}

export class ExactMemoryKey implements MemoryKey {
  private instruction: string;

  constructor(instruction: string) {
    this.instruction = instruction.trim().toLowerCase();
  }

  equals(other: MemoryKey): boolean {
    return (
      other instanceof ExactMemoryKey && this.instruction === other.instruction
    );
  }

  hash(): string {
    return this.instruction;
  }
}

export interface ElementLocator {
  textAnchor?: { labelText: string; relation?: string };
  semantic?: { ariaLabel?: string; placeholder?: string; name?: string };
  structural?: { tagName: string; formIndex?: number; indexInForm?: number };
  xpath?: string;
}

export interface ContextStep {
  type: "frame" | "shadow" | "modal";
  matcher: Record<string, unknown>;
}

export interface PathStep {
  tool: string;
  args: Record<string, unknown>;
  locator?: ElementLocator;
  contextPath?: ContextStep[];
  lastKnownId?: string;
}

export interface MemorizedPath {
  fingerprint: string;
  createdAt: string;
  hitCount: number;
  steps: PathStep[];
  verify?: Array<{
    type: "urlContains" | "urlNotContains" | "titleContains";
    value: string;
  }>;
}

export interface PathMemory {
  get(key: MemoryKey): MemorizedPath | undefined;
  set(key: MemoryKey, path: MemorizedPath): void;
  invalidate(key: MemoryKey): void;
}

export class InMemoryPathMemory implements PathMemory {
  private store = new Map<string, MemorizedPath>();

  get(key: MemoryKey): MemorizedPath | undefined {
    return this.store.get(key.hash());
  }

  set(key: MemoryKey, path: MemorizedPath): void {
    this.store.set(key.hash(), path);
  }

  invalidate(key: MemoryKey): void {
    this.store.delete(key.hash());
  }
}

export function fingerprint(instruction: string): string {
  return instruction.trim().toLowerCase().replace(/\s+/g, " ");
}
