import { useEffect, useState } from "react";
import { useAuth } from "../useAuth";
import "./Popup.css";
import {
  DEFAULT_SETTINGS,
  isFullTranslationLevel,
  LANGUAGE_STORAGE_KEY,
  TRANSLATION_LEVEL_STORAGE_KEY,
  normalizeSettings,
} from "../shared/settings";

function buildSettingsFromNormalized(normalizedSettings) {
  return {
    [LANGUAGE_STORAGE_KEY]: normalizedSettings[LANGUAGE_STORAGE_KEY],
    [TRANSLATION_LEVEL_STORAGE_KEY]: normalizedSettings[TRANSLATION_LEVEL_STORAGE_KEY],
  };
}

const EXP_LEVELS = [
  { level: "beginner", minExp: 0, nextExp: 100 },
  { level: "elementary", minExp: 100, nextExp: 500 },
  { level: "intermediate", minExp: 500, nextExp: 2000 },
  { level: "advanced", minExp: 2000, nextExp: 10000 },
  { level: "fluent", minExp: 10000, nextExp: null },
];

function getExpProgress(exp, level) {
  const normalizedExp = Math.max(0, Number(exp) || 0);
  const matchedLevel =
    EXP_LEVELS.find((entry) => entry.level === level) ?? EXP_LEVELS[0];

  if (matchedLevel.nextExp === null) {
    return {
      progressPercent: 100,
      progressLabel: `${normalizedExp} EXP`,
      nextLevelLabel: "Max level reached",
    };
  }

  const span = Math.max(1, matchedLevel.nextExp - matchedLevel.minExp);
  const progressPercent = Math.min(
    100,
    Math.max(0, ((normalizedExp - matchedLevel.minExp) / span) * 100)
  );
  const remainingExp = Math.max(0, matchedLevel.nextExp - normalizedExp);

  return {
    progressPercent,
    progressLabel: `${normalizedExp} EXP`,
    nextLevelLabel: `${remainingExp} EXP to ${EXP_LEVELS[EXP_LEVELS.findIndex((entry) => entry.level === level) + 1]?.level ?? "next level"}`,
  };
}

export default function Popup() {
  const [settings, setSettings] = useState(buildSettingsFromNormalized(DEFAULT_SETTINGS));
  const [status, setStatus] = useState("Loading settings...");
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingProfile, setIsLoadingProfile] = useState(false);
  const [userExp, setUserExp] = useState(0);
  const {email, loading} = useAuth();
  const usesFullTranslation = isFullTranslationLevel(
    settings[TRANSLATION_LEVEL_STORAGE_KEY]
  );
  const expProgress = getExpProgress(
    userExp,
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
        const normalizedSettings = normalizeSettings({
          [LANGUAGE_STORAGE_KEY]: selectedLanguage,
          [TRANSLATION_LEVEL_STORAGE_KEY]: translationLevel,
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
      {/* <div className="popup__brand-mark" aria-hidden="true">
        <img src="/icon-with-shadow.svg" alt="" />
      </div> */}

      <div className="popup__copy">
        <span className="popup__eyebrow">WordLoom</span>
        <h1>Everyday learning while you browse</h1>
        <p>
          {usesFullTranslation
            ? "Read in your target language with full-page support when you want a simpler session."
            : "Reveal select words and phrases in context, with difficulty gently matched to your EXP."}
        </p>
      </div>

      <section className="popup__panel">
        <div className="popup__panel-header">
          <div>
            <h2>Today’s setup</h2>
            <p>Choose your language and let WordLoom pace the challenge for you.</p>
          </div>
          <span className="popup__badge">Trusted sync</span>
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
            <option value="mandarin">Mandarin</option>
            <option value="russian">Russian</option>
          </select>
        </label>

        <label className="popup__field">
          <span>Current level</span>
          <div className="popup__readonly-field">
            {settings[TRANSLATION_LEVEL_STORAGE_KEY]}
          </div>
          <div className="popup__exp-card" aria-live="polite">
            <div className="popup__exp-meta">
              <strong>{isLoadingProfile ? "Loading EXP..." : expProgress.progressLabel}</strong>
              <span>{isLoadingProfile ? "Syncing level..." : expProgress.nextLevelLabel}</span>
            </div>
            <div
              className="popup__exp-bar"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(expProgress.progressPercent)}
              aria-label="Experience progress to next level"
            >
              <div
                className="popup__exp-fill"
                style={{ width: `${isLoadingProfile ? 0 : expProgress.progressPercent}%` }}
              />
            </div>
          </div>
        </label>
      </section>

      <section className="popup__panel popup__panel--soft">
        <div className="popup__mini-grid">
          <div>
            <span className="popup__mini-label">How it feels</span>
            <p className="popup__mini-copy">
              Meanings stay tucked into the page until you interact, so learning feels calm instead of noisy.
            </p>
          </div>
          <div>
            <span className="popup__mini-label">What changes next</span>
            <p className="popup__mini-copy">
              As your EXP improves, WordLoom gradually introduces more target-language context.
            </p>
          </div>
        </div>
      </section>

      <button className="popup__button" type="submit" disabled={isSaving}>
        {isSaving ? "Saving..." : "Save and refresh page"}
      </button>

      <p className="popup__status" aria-live="polite">{status}</p>
    </form>
  );
}
