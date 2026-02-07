import ar from "./ar.json";
import de from "./de.json";
import en from "./en.json";
import es from "./es.json";
import fr from "./fr.json";
import hi from "./hi.json";
import it from "./it.json";
import ja from "./ja.json";
import ko from "./ko.json";
import pl from "./pl.json";
import pt from "./pt.json";
import ru from "./ru.json";
import tr from "./tr.json";
import uk from "./uk.json";
import zh from "./zh.json";

export type BotLocale = typeof en;
export type LocaleKey = keyof BotLocale;
export type Translator = (key: LocaleKey, vars?: Record<string, string | number>) => string;

export const LANGUAGE_NAMES: Record<string, string> = {
  en: "English",
  ru: "Russian",
  ar: "Arabic",
  zh: "Chinese",
  de: "German",
  es: "Spanish",
  fr: "French",
  hi: "Hindi",
  it: "Italian",
  ja: "Japanese",
  ko: "Korean",
  pl: "Polish",
  pt: "Portuguese",
  tr: "Turkish",
  uk: "Ukrainian",
};

const locales: Record<string, BotLocale> = {
  en,
  ar,
  de,
  es,
  fr,
  hi,
  it,
  ja,
  ko,
  pl,
  pt,
  ru,
  tr,
  uk,
  zh,
};

export function createTranslator(lang: string): Translator {
  const strings = locales[lang] || locales.en;
  return (key: LocaleKey, vars?: Record<string, string | number>): string => {
    let str: string = strings[key] ?? en[key] ?? key;
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        str = str.replaceAll(`{${k}}`, String(v));
      }
    }
    return str;
  };
}
