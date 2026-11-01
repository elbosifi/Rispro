import { useEffect, useMemo, useState, type ReactNode } from "react";
import { t as translate, type Language } from "@/lib/i18n";
import { LanguageContext, type LanguageContextValue } from "./language-provider";
import { refreshInstitutionIdentity, useInstitutionIdentity } from "@/lib/institution-identity";

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
  const institution = useInstitutionIdentity();
  useEffect(() => {
    const refresh = () => { void refreshInstitutionIdentity().catch(() => undefined); };
    refresh();
    window.addEventListener("focus",refresh);
    return () => window.removeEventListener("focus",refresh);
  }, []);
  const [language, setLanguage] = useState<Language>(getStoredLanguage);

  useEffect(() => {
    document.documentElement.setAttribute("lang", language === "ar" ? "ar-LY" : "en");
    document.documentElement.setAttribute("dir", language === "ar" ? "rtl" : "ltr");
    localStorage.setItem("rispro-language", language);
  }, [language]);

  useEffect(() => {
    const hospital = language === "ar" ? institution.hospitalNameAr || institution.hospitalNameEn : institution.hospitalNameEn || institution.hospitalNameAr;
    document.title = hospital ? `${hospital} | RISpro` : "RISpro";
    document.querySelectorAll<HTMLLinkElement>('link[rel="icon"],link[rel="apple-touch-icon"]').forEach(link => { link.href = institution.hospitalLogo; });
  }, [institution,language]);

  const value = useMemo<LanguageContextValue>(
    () => ({
      language,
      isArabic: language === "ar",
      setLanguage,
      toggleLanguage: () => setLanguage((prev) => (prev === "ar" ? "en" : "ar")),
      t: (key, params) => translate(language, key, params)
    }),
    [language, institution]
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function EnglishLanguageScope({ children }: { children: ReactNode }) {
  return <LanguageContext.Provider value={englishLanguageValue}>{children}</LanguageContext.Provider>;
}
