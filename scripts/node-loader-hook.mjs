// Node has no react-native runtime, and its ESM resolver takes specifiers literally, so the
// harness runs against an in-memory store and extensionless imports are resolved to .ts.
const stubUrl = `data:text/javascript,${encodeURIComponent(`
const store = new Map();
export default {
  async getItem(key) {
    return store.has(key) ? store.get(key) : null;
  },
  async setItem(key, value) {
    store.set(key, String(value));
  },
  async removeItem(key) {
    store.delete(key);
  },
};
`)}`;

export function resolve(specifier, context, nextResolve) {
  if (specifier === '@react-native-async-storage/async-storage') {
    return { url: stubUrl, format: 'module', shortCircuit: true };
  }
  if (specifier.startsWith('.') && !/\.[a-zA-Z]+$/.test(specifier)) {
    try {
      return nextResolve(`${specifier}.ts`, context);
    } catch {
      return nextResolve(specifier, context);
    }
  }
  return nextResolve(specifier, context);
}
