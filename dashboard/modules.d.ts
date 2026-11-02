// Types of the vendored libraries the import map in index.html names (see vendor/README.md). Only what the Dashboard uses.
declare module 'preact' {
  export interface VNode {
    type: unknown;
    props: unknown;
    key: unknown;
  }
  export const Fragment: (props: { children?: unknown }) => VNode;
  export function h(
    type: string | ((props: never) => unknown),
    props?: Record<string, unknown> | null,
    ...children: unknown[]
  ): VNode;
  export function render(vnode: unknown, parent: Element): void;
}

declare module 'preact/hooks' {
  export function useState<T>(initial: T | (() => T)): [T, (value: T | ((previous: T) => T)) => void];
  export function useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void;
  export function useLayoutEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void;
  export function useRef<T>(initial: T): { current: T };
  export function useCallback<F extends (...args: never[]) => unknown>(callback: F, deps: readonly unknown[]): F;
}

declare module 'htm' {
  import type { VNode } from 'preact';
  const htm: (this: unknown, strings: TemplateStringsArray, ...values: unknown[]) => VNode;
  export default htm;
}
