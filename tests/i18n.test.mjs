import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Import as an ES module without requiring a package.json or any browser globals.
const source = await readFile(new URL("../custom_components/ha_access_control_manager/www/acm-group-card-i18n.js", import.meta.url), "utf8");
const { translations, normalizeLanguage, translate } = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
);

const english = {
  card_name: "ACM Group Card",
  card_description: "Show a child card to selected ACM groups. Visibility only, not data security.",
  notice: "This controls dashboard visibility, not security or access permissions. The preview only shows the card when the signed-in user matches a selected group.",
  groups_title: "Visible to groups",
  child_title: "Wrapped card",
  select_group: "Select at least one group; otherwise this card is hidden.",
  invalid_groups: "ACM: select at least one group.",
  invalid_card: "ACM: configure a child card.",
  helpers_unavailable: "Home Assistant card helpers are not available yet.",
  native_timeout: "Home Assistant's card editor took too long to load.",
  catalog_timeout: "Loading groups took too long.",
  invalid_catalog: "The group catalog response is invalid.",
  catalog_unavailable: "Group catalog unavailable.",
  catalog_error: "Cannot load groups. {error} Administrator access may be required.",
  catalog_loading: "Loading group catalog…",
  no_groups: "No groups are available.",
  retry_groups: "Retry loading groups",
  unknown_group: "Unknown / unavailable group",
  unknown_hint: "Selected ID is preserved. Uncheck to remove it.",
  native_error: "Cannot load the native card editor. {error}",
  native_loading: "Loading Home Assistant card editor…",
  retry_editor: "Retry loading card editor",
  cancel_replace: "Cancel replacement",
  replace_card: "Replace card",
  remove_card: "Remove card",
  yaml_editor: "Show YAML editor",
  visual_editor: "Show visual editor",
  child_error: "ACM: unable to load child card: {error}",
  invalid_membership: "Invalid ACM group response",
};

test("English strings preserve the source contract", () => {
  assert.deepEqual(translations.en, english);
});

test("all six locales have exactly the same nonempty keys and placeholders", () => {
  assert.deepEqual(Object.keys(translations).sort(), ["de", "en", "es", "fr", "hu", "it"]);
  const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
  for (const [language, dictionary] of Object.entries(translations)) {
    assert.deepEqual(Object.keys(dictionary).sort(), Object.keys(english).sort(), language);
    for (const [key, value] of Object.entries(dictionary)) {
      assert.equal(typeof value, "string", `${language}.${key}`);
      assert.ok(value.trim(), `${language}.${key}`);
      assert.deepEqual(placeholders(value), placeholders(english[key]), `${language}.${key}`);
      assert.equal(translate(language, key), value);
    }
  }
});

test("language normalization handles region, case, and unsupported input", () => {
  for (const language of Object.keys(translations)) {
    for (const input of [language, language.toUpperCase(), `${language}-US`, `${language.toUpperCase()}_CA`]) {
      assert.equal(normalizeLanguage(input), language);
      assert.equal(translate(input, "groups_title"), translations[language].groups_title);
    }
  }
  assert.equal(normalizeLanguage(" FR_ca "), "fr");
  for (const input of ["zz", "zz-FR", "", "constructor", "__proto__", null, undefined, 42, {}, [], true]) {
    assert.equal(normalizeLanguage(input), "en");
    assert.equal(translate(input, "card_name"), english.card_name);
  }
});

test("missing translations fall back per key to English, then the key itself", () => {
  const original = translations.fr.native_error;
  try {
    delete translations.fr.native_error;
    assert.equal(translate("fr-CA", "native_error", { error: "detail" }), "Cannot load the native card editor. detail");
    assert.equal(translate("fr", "groups_title"), translations.fr.groups_title);
  } finally {
    translations.fr.native_error = original;
  }
  for (const key of ["missing_key", "constructor", "toString", "__proto__"]) {
    assert.equal(translate("fr", key), key);
  }
});

test("interpolation preserves opaque details, HTML, and replacement patterns literally", () => {
  const error = '<img src=x onerror="alert(1)"> $& $$ $` $\' $1 {error} {other}';
  for (const language of Object.keys(translations)) {
    for (const key of ["catalog_error", "native_error", "child_error"]) {
      const [before, after] = translations[language][key].split("{error}");
      assert.equal(translate(language, key, { error }), before + error + after);
      assert.equal(translate(language, key), translations[language][key]);
      assert.equal(translate(language, key, { other: "ignored" }), translations[language][key]);
      assert.equal(translate(language, key, null), translations[language][key]);
      assert.equal(translate(language, key, Object.create({ error: "inherited" })), translations[language][key]);
      for (const value of ["", 0, false, null, undefined]) {
        assert.equal(translate(language, key, { error: value }), before + String(value) + after);
      }
    }
  }
});
