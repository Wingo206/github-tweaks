declare const __GHT_BUILD_TIME__: string | undefined;

/** When this extension build was made (set by `wxt.config.ts`); `dev` in tests. */
export const BUILD_TIME = typeof __GHT_BUILD_TIME__ === 'string' ? __GHT_BUILD_TIME__ : 'dev';
