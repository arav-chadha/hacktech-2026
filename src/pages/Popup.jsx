import { useEffect, useState } from "react";
import { useAuth } from "../useAuth";
import browser from "webextension-polyfill";
import "./Popup.css";
import {
  BATCH_CONCURRENCY_STORAGE_KEY,
  DEFAULT_SETTINGS,
  LANGUAGE_STORAGE_KEY,
  PHRASE_MAX_STORAGE_KEY,
  PHRASE_MIN_STORAGE_KEY,
  PHRASE_TEMPERATURE_STORAGE_KEY,
  normalizeSettings,
} from "../shared/settings";

export default function Popup() {
  const [settings, setSettings] = useState({
    [LANGUAGE_STORAGE_KEY]: DEFAULT_SETTINGS[LANGUAGE_STORAGE_KEY],
    [PHRASE_MIN_STORAGE_KEY]: String(DEFAULT_SETTINGS[PHRASE_MIN_STORAGE_KEY]),
    [PHRASE_MAX_STORAGE_KEY]: String(DEFAULT_SETTINGS[PHRASE_MAX_STORAGE_KEY]),
    [PHRASE_TEMPERATURE_STORAGE_KEY]: String(
      DEFAULT_SETTINGS[PHRASE_TEMPERATURE_STORAGE_KEY]
    ),
    [BATCH_CONCURRENCY_STORAGE_KEY]: String(
      DEFAULT_SETTINGS[BATCH_CONCURRENCY_STORAGE_KEY]
    ),
  });
  const [status, setStatus] = useState("Loading settings...");
  const [isSaving, setIsSaving] = useState(false);
  const {email, loading, error, signIn, logout} = useAuth();

  useEffect(() => {
    async function loadSettings() {
      try {
        const storedValues = await chrome.storage.local.get(Object.keys(DEFAULT_SETTINGS));
        const normalizedSettings = normalizeSettings(storedValues);
        setSettings({
          [LANGUAGE_STORAGE_KEY]: normalizedSettings[LANGUAGE_STORAGE_KEY],
          [PHRASE_MIN_STORAGE_KEY]: String(normalizedSettings[PHRASE_MIN_STORAGE_KEY]),
          [PHRASE_MAX_STORAGE_KEY]: String(normalizedSettings[PHRASE_MAX_STORAGE_KEY]),
          [PHRASE_TEMPERATURE_STORAGE_KEY]: String(
            normalizedSettings[PHRASE_TEMPERATURE_STORAGE_KEY]
          ),
          [BATCH_CONCURRENCY_STORAGE_KEY]: String(
            normalizedSettings[BATCH_CONCURRENCY_STORAGE_KEY]
          ),
        });
        setStatus("Edit settings, then save to reload translation.");
      } catch (error) {
        console.error("Failed to load extension settings:", error);
        setStatus("Couldn't load saved settings.");
      }
    }

    loadSettings();
  }, []);

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
        [PHRASE_MIN_STORAGE_KEY]: settings[PHRASE_MIN_STORAGE_KEY],
        [PHRASE_MAX_STORAGE_KEY]: settings[PHRASE_MAX_STORAGE_KEY],
        [PHRASE_TEMPERATURE_STORAGE_KEY]: settings[PHRASE_TEMPERATURE_STORAGE_KEY],
        [BATCH_CONCURRENCY_STORAGE_KEY]: settings[BATCH_CONCURRENCY_STORAGE_KEY],
      });

      await chrome.storage.local.set(normalizedSettings);
      setSettings({
        [LANGUAGE_STORAGE_KEY]: normalizedSettings[LANGUAGE_STORAGE_KEY],
        [PHRASE_MIN_STORAGE_KEY]: String(normalizedSettings[PHRASE_MIN_STORAGE_KEY]),
        [PHRASE_MAX_STORAGE_KEY]: String(normalizedSettings[PHRASE_MAX_STORAGE_KEY]),
        [PHRASE_TEMPERATURE_STORAGE_KEY]: String(
          normalizedSettings[PHRASE_TEMPERATURE_STORAGE_KEY]
        ),
        [BATCH_CONCURRENCY_STORAGE_KEY]: String(
          normalizedSettings[BATCH_CONCURRENCY_STORAGE_KEY]
        ),
      });
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
        <p>Translate random phrases with hosted Gemma and tune phrase selection.</p>
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

      <div className="popup__grid">
        <label className="popup__field" htmlFor="phrase-min">
          <span>Min Words</span>
          <input
            id="phrase-min"
            name={PHRASE_MIN_STORAGE_KEY}
            type="number"
            min="1"
            max="10"
            value={settings[PHRASE_MIN_STORAGE_KEY]}
            onChange={handleFieldChange}
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
        />
        <small>0 favors shorter phrases. 1 favors longer phrases.</small>
      </label>

      <label className="popup__field" htmlFor="batch-concurrency">
        <span>Parallel Requests</span>
        <select
          id="batch-concurrency"
          name={BATCH_CONCURRENCY_STORAGE_KEY}
          value={settings[BATCH_CONCURRENCY_STORAGE_KEY]}
          onChange={handleFieldChange}
        >
          <option value="1">1</option>
          <option value="2">2</option>
        </select>
      </label>

      <button className="popup__button" type="submit" disabled={isSaving}>
        {isSaving ? "Saving..." : "Save And Reload"}
      </button>

      <p className="popup__status">{status}</p>
    </form>
  );
}
