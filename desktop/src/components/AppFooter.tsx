import { texts } from "../i18n";
import { LockIcon } from "../ui/icons";

interface AppFooterProps {
  onOpenKancelaria: () => void;
  onOpenLawtern: () => void;
}

export function AppFooter({ onOpenKancelaria, onOpenLawtern }: AppFooterProps) {
  return (
    <footer className="app-footer">
      <LockIcon className="app-footer__icon" />
      <span>{texts.footer.offline}</span>
      <span className="app-footer__brand">
        <a
          href={texts.footer.lawternHref}
          onClick={(event) => {
            event.preventDefault();
            onOpenLawtern();
          }}
        >
          {texts.footer.lawternLabel}
        </a>
        <span className="app-footer__divider" aria-hidden="true" />
        <a
          href={texts.footer.kancelariaHref}
          onClick={(event) => {
            event.preventDefault();
            onOpenKancelaria();
          }}
        >
          {texts.footer.kancelariaLabel}
        </a>
      </span>
    </footer>
  );
}
