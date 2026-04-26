import { useEffect, useState } from "react";
import { useAuth } from "../useAuth";
import browser from "webextension-polyfill";
import "./Popup.css";
import {
  DEFAULT_SETTINGS,
  isFullTranslationLevel,
  LANGUAGE_STORAGE_KEY,
  PHRASE_COVERAGE_STORAGE_KEY,
  PHRASE_MAX_STORAGE_KEY,
  PHRASE_MIN_STORAGE_KEY,
  PHRASE_TEMPERATURE_STORAGE_KEY,
  SETTINGS_PRESETS,
  TRANSLATION_LEVEL_STORAGE_KEY,
  normalizeSettings,
} from "../shared/settings";

function buildSettingsFromNormalized(normalizedSettings) {
  return {
    [LANGUAGE_STORAGE_KEY]: normalizedSettings[LANGUAGE_STORAGE_KEY],
    [TRANSLATION_LEVEL_STORAGE_KEY]: normalizedSettings[TRANSLATION_LEVEL_STORAGE_KEY],
    [PHRASE_MIN_STORAGE_KEY]: String(normalizedSettings[PHRASE_MIN_STORAGE_KEY]),
    [PHRASE_MAX_STORAGE_KEY]: String(normalizedSettings[PHRASE_MAX_STORAGE_KEY]),
    [PHRASE_COVERAGE_STORAGE_KEY]: String(normalizedSettings[PHRASE_COVERAGE_STORAGE_KEY]),
    [PHRASE_TEMPERATURE_STORAGE_KEY]: String(
      normalizedSettings[PHRASE_TEMPERATURE_STORAGE_KEY]
    ),
  };
}

export default function Popup() {
  const [settings, setSettings] = useState(buildSettingsFromNormalized(DEFAULT_SETTINGS));
  const [status, setStatus] = useState("Loading settings...");
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingProfile, setIsLoadingProfile] = useState(false);
  const [userExp, setUserExp] = useState(0);
  const {email, loading, error, signIn, logout} = useAuth();
  const usesFullTranslation = isFullTranslationLevel(
    settings[TRANSLATION_LEVEL_STORAGE_KEY]
  );

  useEffect(() => {
    async function loadSettings() {
      try {
        const storedValues = await chrome.storage.local.get(Object.keys(DEFAULT_SETTINGS));
        const normalizedSettings = normalizeSettings(storedValues);
        setSettings(buildSettingsFromNormalized(normalizedSettings));
        setStatus("Loading your level from MongoDB...");
      } catch (error) {
        console.error("Failed to load extension settings:", error);
        setStatus("Couldn't load saved settings.");
      }
    }

    loadSettings();
  }, []);

  useEffect(() => {
    if (!email || loading) {
      return;
    }

    async function syncLanguageProfile() {
      setIsLoadingProfile(true);

      try {
        const selectedLanguage = settings[LANGUAGE_STORAGE_KEY];
        const response = await new Promise((resolve, reject) => {
          chrome.runtime.sendMessage(
            {
              type: "GET_LANGUAGE_PROFILE",
              payload: {
                userEmail: email,
                targetLanguage: selectedLanguage,
              },
            },
            (message) => {
              if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
              }

              if (message?.error) {
                reject(new Error(message.error));
                return;
              }

              resolve(message?.profile ?? null);
            }
          );
        });

        const translationLevel = String(response?.translationLevel ?? DEFAULT_SETTINGS[TRANSLATION_LEVEL_STORAGE_KEY]);
        const exp = Number(response?.exp ?? 0);
        const preset = SETTINGS_PRESETS[translationLevel] ?? DEFAULT_SETTINGS;
        const normalizedSettings = normalizeSettings({
          [LANGUAGE_STORAGE_KEY]: selectedLanguage,
          [TRANSLATION_LEVEL_STORAGE_KEY]: translationLevel,
          [PHRASE_MIN_STORAGE_KEY]: preset[PHRASE_MIN_STORAGE_KEY],
          [PHRASE_MAX_STORAGE_KEY]: preset[PHRASE_MAX_STORAGE_KEY],
          [PHRASE_COVERAGE_STORAGE_KEY]: preset[PHRASE_COVERAGE_STORAGE_KEY],
          [PHRASE_TEMPERATURE_STORAGE_KEY]: preset[PHRASE_TEMPERATURE_STORAGE_KEY],
        });

        setUserExp(exp);
        setSettings(buildSettingsFromNormalized(normalizedSettings));
        setStatus("Level is synced from MongoDB based on your EXP.");
      } catch (profileError) {
        console.error("Failed to load language profile:", profileError);
        setStatus("Couldn't load your MongoDB-backed level.");
      } finally {
        setIsLoadingProfile(false);
      }
    }

    void syncLanguageProfile();
  }, [email, loading, settings[LANGUAGE_STORAGE_KEY]]);

  function handleFieldChange(event) {
    const { name, value } = event.target;
    setSettings((currentSettings) => ({
      ...currentSettings,
      [name]: value,
    }));
  }

  async function handleSave(event) {
    event.preventDefault();
    setIsSaving(true);

    try {
      const normalizedSettings = normalizeSettings({
        [LANGUAGE_STORAGE_KEY]: settings[LANGUAGE_STORAGE_KEY],
        [TRANSLATION_LEVEL_STORAGE_KEY]: settings[TRANSLATION_LEVEL_STORAGE_KEY],
        [PHRASE_MIN_STORAGE_KEY]: settings[PHRASE_MIN_STORAGE_KEY],
        [PHRASE_MAX_STORAGE_KEY]: settings[PHRASE_MAX_STORAGE_KEY],
        [PHRASE_COVERAGE_STORAGE_KEY]: settings[PHRASE_COVERAGE_STORAGE_KEY],
        [PHRASE_TEMPERATURE_STORAGE_KEY]: settings[PHRASE_TEMPERATURE_STORAGE_KEY],
      });

      await chrome.storage.local.set(normalizedSettings);
      setSettings(buildSettingsFromNormalized(normalizedSettings));
      setStatus("Saved. Reloading the current page...");

      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (activeTab?.id !== undefined) {
        await chrome.tabs.reload(activeTab.id);
      } else {
        setStatus("Saved settings, but couldn't find the active tab to reload.");
      }
    } catch (error) {
      console.error("Failed to save extension settings:", error);
      setStatus("Couldn't save settings.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form className="popup" onSubmit={handleSave}>
      <img src="/icon-with-shadow.svg" alt="Language Extension icon" />
      <div className="popup__copy">
        <h1>Language Extension</h1>
        <p>
          {usesFullTranslation
            ? "Fully translate the page into your target language."
            : "Translate random phrases with OpenAI and tune phrase selection."}
        </p>
      </div>

      <label className="popup__field" htmlFor="language-select">
        <span>Language</span>
        <select
          id="language-select"
          name={LANGUAGE_STORAGE_KEY}
          value={settings[LANGUAGE_STORAGE_KEY]}
          onChange={handleFieldChange}
        >
          <option value="spanish">Spanish</option>
          <option value="french">French</option>
        </select>
      </label>

      <label className="popup__field" htmlFor="translation-level-select">
        <span>Level</span>
        <select
          id="translation-level-select"
          name={TRANSLATION_LEVEL_STORAGE_KEY}
          value={settings[TRANSLATION_LEVEL_STORAGE_KEY]}
          disabled
        >
          <option value="beginner">Beginner</option>
          <option value="elementary">Elementary</option>
          <option value="intermediate">Intermediate</option>
          <option value="advanced">Advanced</option>
          <option value="fluent">Fluent</option>
        </select>
        <small>
          {isLoadingProfile
            ? "Loading level from MongoDB..."
            : `Synced from MongoDB. Current EXP: ${userExp}.`}
        </small>
      </label>

      <div className="popup__grid">
        <label className="popup__field" htmlFor="phrase-min">
          <span>Min Words</span>
          <input
            id="phrase-min"
            name={PHRASE_MIN_STORAGE_KEY}
            type="number"
            min="1"
            max="1"
            value={settings[PHRASE_MIN_STORAGE_KEY]}
            disabled
            readOnly
          />
        </label>

        <label className="popup__field" htmlFor="phrase-max">
          <span>Max Words</span>
          <input
            id="phrase-max"
            name={PHRASE_MAX_STORAGE_KEY}
            type="number"
            min="1"
            max="10"
            value={settings[PHRASE_MAX_STORAGE_KEY]}
            onChange={handleFieldChange}
            disabled={usesFullTranslation}
          />
        </label>

        <label className="popup__field" htmlFor="phrase-coverage">
          <span>Coverage %</span>
          <input
            id="phrase-coverage"
            name={PHRASE_COVERAGE_STORAGE_KEY}
            type="number"
            min="1"
            max="100"
            value={settings[PHRASE_COVERAGE_STORAGE_KEY]}
            onChange={handleFieldChange}
            disabled={usesFullTranslation}
          />
        </label>
      </div>

      <label className="popup__field" htmlFor="phrase-temperature">
        <div className="popup__label-row">
          <span>Length Bias</span>
          <strong>{Number(settings[PHRASE_TEMPERATURE_STORAGE_KEY]).toFixed(2)}</strong>
        </div>
        <input
          id="phrase-temperature"
          name={PHRASE_TEMPERATURE_STORAGE_KEY}
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={settings[PHRASE_TEMPERATURE_STORAGE_KEY]}
          onChange={handleFieldChange}
          disabled={usesFullTranslation}
        />
        <small>
          {usesFullTranslation
            ? "Fluent mode ignores phrase-length tuning and translates the full paragraph."
            : "0 favors shorter phrases. 1 favors longer phrases."}
        </small>
      </label>

      <button className="popup__button" type="submit" disabled={isSaving}>
        {isSaving ? "Saving..." : "Save And Reload"}
      </button>

      <p className="popup__status">{status}</p>
    </form>
  );
}
