import { createContext, useContext } from "react";

export type DictationController = { busy: boolean; recording: boolean; processing: boolean; toggle: () => void; cancel: () => void };
export const DictationContext = createContext<DictationController | null>(null);
export const useDictation = () => useContext(DictationContext);
