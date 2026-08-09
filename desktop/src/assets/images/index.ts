// Manifest obrazów UI (design system Gabinet). Jedyne miejsce referencji do plików
// graficznych - komponenty importują obrazy wyłącznie stąd, po nazwie semantycznej.
import heroUrl from "./hero.webp";
import iconUrl from "./icon.webp";
import logoUrl from "./logo.webp";

export const images = {
  /** Pełny logotyp Poufnik (ekran startowy). */
  logo: logoUrl,
  /** Kwadratowa ikona aplikacji (pasek boczny). */
  icon: iconUrl,
  /** Ilustracja hero na ciemnym panelu ekranu startowego. */
  hero: heroUrl,
} as const;
