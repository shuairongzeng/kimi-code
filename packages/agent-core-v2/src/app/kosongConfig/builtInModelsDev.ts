declare const __ZIMI_CODE_BUILT_IN_CATALOG__: string | undefined;

export const BUILT_IN_MODELS_DEV_JSON: string | undefined =
  typeof __ZIMI_CODE_BUILT_IN_CATALOG__ === 'string'
    ? __ZIMI_CODE_BUILT_IN_CATALOG__
    : undefined;
