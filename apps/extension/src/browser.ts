/** Chrome and Edge expose `chrome`, Firefox `browser`; both are promise based in MV3. */
export const ext: typeof chrome = (globalThis as { browser?: typeof chrome }).browser ?? chrome;
