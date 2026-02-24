/**
 * Validates i18n key consistency across all locale files.
 * Checks both bot runtime (src/locales/) and setup wizard (scripts/i18n/).
 *
 * Exit code 0 = all good, 1 = mismatches found.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

interface Issue {
  dir: string;
  lang: string;
  type: "missing" | "extra" | "empty";
  key: string;
}

function checkDirectory(dir: string, label: string): Issue[] {
  const issues: Issue[] = [];
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));

  if (files.length === 0) {
    console.log(`  ${label}: no JSON files found`);
    return issues;
  }

  // Load all locales
  const locales = new Map<string, Record<string, string>>();
  for (const file of files) {
    const lang = file.replace(".json", "");
    const content = JSON.parse(readFileSync(join(dir, file), "utf-8"));
    locales.set(lang, content);
  }

  // English is source of truth
  const en = locales.get("en");
  if (!en) {
    console.log(`  ${label}: en.json not found`);
    return issues;
  }

  const enKeys = new Set(Object.keys(en));
  console.log(`  ${label}: ${enKeys.size} keys, ${locales.size} languages`);

  for (const [lang, strings] of locales) {
    if (lang === "en") continue;

    const langKeys = new Set(Object.keys(strings));

    // Missing keys (in en but not in this lang)
    for (const key of enKeys) {
      if (!langKeys.has(key)) {
        issues.push({ dir: label, lang, type: "missing", key });
      }
    }

    // Extra keys (in this lang but not in en)
    for (const key of langKeys) {
      if (!enKeys.has(key)) {
        issues.push({ dir: label, lang, type: "extra", key });
      }
    }

    // Empty values
    for (const key of langKeys) {
      if (enKeys.has(key) && strings[key] === "") {
        issues.push({ dir: label, lang, type: "empty", key });
      }
    }
  }

  return issues;
}

// ─── Main ────────────────────────────────────────────────────────

const ROOT = join(import.meta.dir, "..");

const allIssues = [
  ...checkDirectory(join(ROOT, "src/locales"), "src/locales"),
  ...checkDirectory(join(ROOT, "scripts/i18n"), "scripts/i18n"),
];

if (allIssues.length === 0) {
  console.log("\n  All i18n keys are consistent.\n");
  process.exit(0);
} else {
  console.log(`\n  Found ${allIssues.length} issue(s):\n`);
  for (const issue of allIssues) {
    const tag = issue.type === "missing" ? "MISSING" : issue.type === "extra" ? "EXTRA" : "EMPTY";
    console.log(`  [${tag}] ${issue.dir}/${issue.lang}.json — ${issue.key}`);
  }
  console.log("");
  process.exit(1);
}
