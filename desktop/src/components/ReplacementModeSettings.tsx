import { texts } from "../i18n";
import type { AnonymizationProfile, ReplacementMode } from "../tauri/replacementMode";

interface ReplacementModeSettingsProps {
  mode: ReplacementMode;
  onChange: (mode: ReplacementMode) => void;
  profile?: AnonymizationProfile;
  onProfileChange?: (profile: AnonymizationProfile) => void;
}

/** Tokens or fictional data, for every new anonymization (window, batch, context menu). */
export function ReplacementModeSettings({
  mode,
  onChange,
  profile = "standard",
  onProfileChange,
}: ReplacementModeSettingsProps) {
  const profiles: { value: AnonymizationProfile; label: string; note: string }[] = [
    {
      value: "standard",
      label: texts.replacementMode.profileStandard,
      note: texts.replacementMode.profileStandardNote,
    },
    {
      value: "judgment",
      label: texts.replacementMode.profileJudgment,
      note: texts.replacementMode.profileJudgmentNote,
    },
  ];
  const options: { value: ReplacementMode; label: string; note: string }[] = [
    { value: "tokens", label: texts.replacementMode.tokens, note: texts.replacementMode.tokensNote },
    {
      value: "pseudonyms",
      label: texts.replacementMode.pseudonyms,
      note: texts.replacementMode.pseudonymsNote,
    },
  ];
  return (
    <section className="settings-section">
      <h3>{texts.replacementMode.heading}</h3>
      {options.map((option) => (
        <label className="checkbox-row" key={option.value}>
          <input
            type="radio"
            name="replacement-mode"
            checked={mode === option.value}
            onChange={() => onChange(option.value)}
          />
          <span>
            <strong>{option.label}</strong>
            <span className="checkbox-row__note">{option.note}</span>
          </span>
        </label>
      ))}
      {onProfileChange ? (
        <>
          <h3>{texts.replacementMode.profileHeading}</h3>
          {profiles.map((option) => (
            <label className="checkbox-row" key={option.value}>
              <input
                type="radio"
                name="anonymization-profile"
                checked={profile === option.value}
                onChange={() => onProfileChange(option.value)}
              />
              <span>
                <strong>{option.label}</strong>
                <span className="checkbox-row__note">{option.note}</span>
              </span>
            </label>
          ))}
        </>
      ) : null}
    </section>
  );
}
