import { useEffect, useState } from "react";
import { useAuth } from "../useAuth";
import browser from "webextension-polyfill";
import "./Popup.css";
import {
  DEFAULT_SETTINGS,
  LANGUAGE_STORAGE_KEY,
  KNOWLEDGE_LEVEL_TO_RATIO,
  READER_KNOWLEDGE_LEVEL_STORAGE_KEY,
  normalizeSettings,
} from "../shared/settings";

export default function Popup() {
  const [settings, setSettings] = useState({
    [LANGUAGE_STORAGE_KEY]: DEFAULT_SETTINGS[LANGUAGE_STORAGE_KEY],
    [READER_KNOWLEDGE_LEVEL_STORAGE_KEY]: String(
      DEFAULT_SETTINGS[READER_KNOWLEDGE_LEVEL_STORAGE_KEY]
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
          [READER_KNOWLEDGE_LEVEL_STORAGE_KEY]: String(
            normalizedSettings[READER_KNOWLEDGE_LEVEL_STORAGE_KEY]
          ),
        });
        setStatus("Edit settings, then save to reload the current page.");
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
        [READER_KNOWLEDGE_LEVEL_STORAGE_KEY]: settings[READER_KNOWLEDGE_LEVEL_STORAGE_KEY],
      });

      await chrome.storage.local.set(normalizedSettings);
      setSettings({
        [LANGUAGE_STORAGE_KEY]: normalizedSettings[LANGUAGE_STORAGE_KEY],
        [READER_KNOWLEDGE_LEVEL_STORAGE_KEY]: String(
          normalizedSettings[READER_KNOWLEDGE_LEVEL_STORAGE_KEY]
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
        <p>Pick a target language and how aggressively the reader should see translated phrases.</p>
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

      <label className="popup__field" htmlFor="knowledge-level">
        <div className="popup__label-row">
          <span>Reader Knowledge</span>
          <strong>Level {settings[READER_KNOWLEDGE_LEVEL_STORAGE_KEY]}</strong>
        </div>
        <input
          id="knowledge-level"
          name={READER_KNOWLEDGE_LEVEL_STORAGE_KEY}
          type="range"
          min="1"
          max="3"
          step="1"
          value={settings[READER_KNOWLEDGE_LEVEL_STORAGE_KEY]}
          onChange={handleFieldChange}
        />
        <small>
          Level {settings[READER_KNOWLEDGE_LEVEL_STORAGE_KEY]} translates about{" "}
          {Math.round(
            KNOWLEDGE_LEVEL_TO_RATIO[Number(settings[READER_KNOWLEDGE_LEVEL_STORAGE_KEY])] * 100
          )}
          % of detected phrases.
        </small>
      </label>

      <button className="popup__button" type="submit" disabled={isSaving}>
        {isSaving ? "Saving..." : "Save And Reload"}
      </button>

      <p className="popup__status">{status}</p>
    </form>
  );
}
