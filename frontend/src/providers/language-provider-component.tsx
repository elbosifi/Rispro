import { useEffect, useMemo, useState, type ReactNode } from "react";
import { t as translate, type Language } from "@/lib/i18n";
import { LanguageContext, type LanguageContextValue } from "./language-provider";

const englishLanguageValue: LanguageContextValue = {
  language: "en",
  isArabic: false,
  setLanguage: () => undefined,
  toggleLanguage: () => undefined,
  t: (key, params) => translate("en", key, params),
};

function getStoredLanguage(): Language {
  const stored = localStorage.getItem("rispro-language");
  return stored === "en" ? "en" : "ar";
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>(getStoredLanguage);

  useEffect(() => {
    document.documentElement.setAttribute("lang", language === "ar" ? "ar-LY" : "en");
    document.documentElement.setAttribute("dir", language === "ar" ? "rtl" : "ltr");
    localStorage.setItem("rispro-language", language);
  }, [language]);

  const value = useMemo<LanguageContextValue>(
    () => ({
      language,
      isArabic: language === "ar",
      setLanguage,
      toggleLanguage: () => setLanguage((prev) => (prev === "ar" ? "en" : "ar")),
      t: (key, params) => translate(language, key, params)
    }),
    [language]
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function EnglishLanguageScope({ children }: { children: ReactNode }) {
  return <LanguageContext.Provider value={englishLanguageValue}>{children}</LanguageContext.Provider>;
}
