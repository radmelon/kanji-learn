// Polyfill WeakRef for Hermes versions that don't support it natively.
// Required by Zustand and other modern libraries on some RN 0.81 builds.
if (typeof WeakRef === 'undefined') {
  (global as typeof globalThis & { WeakRef: unknown }).WeakRef = class WeakRef<T extends object> {
    private _target: T
    constructor(target: T) { this._target = target }
    deref(): T { return this._target }
  }
}
