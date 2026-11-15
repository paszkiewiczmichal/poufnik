import type { LocalStorageLike } from "./customRules";

/** How anonymized data is written: tokens ("[OSOBA_1]") or invented, inflected values. */
export type ReplacementMode = "tokens" | "pseudonyms";

const REPLACEMENT_MODE_KEY = "anonymizer.replacementMode.v1";

export function loadReplacementMode(storage?: LocalStorageLike): ReplacementMode {
  try {
    const value = (storage ?? window.localStorage).getItem(REPLACEMENT_MODE_KEY);
    return value === "pseudonyms" ? "pseudonyms" : "tokens";
  } catch {
    return "tokens";
  }
}

export function saveReplacementMode(mode: ReplacementMode, storage?: LocalStorageLike): void {
  (storage ?? window.localStorage).setItem(REPLACEMENT_MODE_KEY, mode);
}

/** What kind of document is prepared: "judgment" keeps the court and its staff (BIP). */
export type AnonymizationProfile = "standard" | "judgment";

const PROFILE_KEY = "anonymizer.profile.v1";

export function loadProfile(storage?: LocalStorageLike): AnonymizationProfile {
  try {
    return (storage ?? window.localStorage).getItem(PROFILE_KEY) === "judgment"
      ? "judgment"
      : "standard";
  } catch {
    return "standard";
  }
}

export function saveProfile(profile: AnonymizationProfile, storage?: LocalStorageLike): void {
  (storage ?? window.localStorage).setItem(PROFILE_KEY, profile);
}
