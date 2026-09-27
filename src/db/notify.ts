/* Indirection so the db layer can ping other tabs without importing the store. */
let hook: () => void = () => {};
export const setChangeHook = (fn: () => void) => (hook = fn);
export const notifyChange = () => hook();
