export type CategorySettings = Record<string, string>;
export type SettingsMap = Record<string, CategorySettings>;
export type GroupedSettings<T> = Record<string, T[]>;
