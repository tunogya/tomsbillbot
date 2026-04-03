import { en, Locale, LocaleKey } from "./locales/en";
import { zh } from "./locales/zh";

const locales: Record<string, Locale> = {
  en,
  zh,
};

export function getT(lang: string = "en") {
  const locale = locales[lang] || locales.en;

  return (key: LocaleKey, params: Record<string, string | number> = {}) => {
    let text = locale[key] || en[key] || key;

    Object.entries(params).forEach(([k, v]) => {
      text = text.replace(new RegExp(`\\{${k}\\}`, "g"), v.toString());
    });

    return text;
  };
}

export type TFunction = ReturnType<typeof getT>;
