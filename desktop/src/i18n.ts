import type { EntityCategory } from "./types";

// Polska liczba mnoga: 1 wystąpienie, 2-4 wystąpienia, 5+ wystąpień.
function pluralWord(count: number, one: string, few: string, many: string): string {
  if (count === 1) {
    return one;
  }
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return few;
  }
  return many;
}

function plural(count: number, one: string, few: string, many: string): string {
  return `${count} ${pluralWord(count, one, few, many)}`;
}

// What the engine reports as removed (X-Poufnik-Removed codes).
const METADATA_LABELS: Record<string, string> = {
  document_properties: "właściwości dokumentu (autor, daty, tytuł, firma)",
  authors: "autorzy komentarzy i zmian",
  revision_ids: "identyfikatory sesji edycji",
  thumbnail: "miniatura strony",
  custom_properties: "właściwości niestandardowe i SharePoint",
  file_paths: "ścieżki plików i szablonów",
  printer_settings: "ustawienia drukarki",
  pdf_info: "informacje o dokumencie PDF",
  pdf_xmp: "metadane XMP",
  pdf_history: "wcześniejsze wersje zapisane w pliku",
  exif: "dane EXIF (aparat, daty)",
  gps: "lokalizacja GPS",
  xmp: "metadane XMP",
  iptc: "dane IPTC",
  image_comments: "opisy i komentarze w obrazie",
  trailing_data: "dane doklejone za obrazem",
  stored_versions: "zapisane wersje dokumentu",
};

export const texts = {
  appTitle: "Poufnik",
  steps: {
    import: "Import",
    review: "Przegląd i korekta",
    result: "Wynik",
  },
  nav: {
    stepsSection: "Etapy pracy",
    toolsSection: "Narzędzia",
    compare: "Porównanie",
    history: "Historia",
    batch: "Seryjne",
    restore: "Przywracanie",
    settings: "Ustawienia",
    earlyBirdBadge: "Early Bird",
    goHome: "Ekran startowy",
  },
  sidebar: {
    accountEarlyBird: "Early Bird",
    accountBasicTitle: "Wersja Basic",
    accountBasicHint: "Historia i narzędzia seryjne są dostępne z darmowym kontem.",
    logout: "Wyloguj się",
    login: "Zaloguj się do konta",
    register: "Utwórz darmowe konto",
  },
  footer: {
    offline: "Przetwarzanie lokalne. Dokumenty nie opuszczają tego urządzenia.",
    // Jedyne dwa zewnętrzne URL-e w aplikacji - otwierane wyłącznie świadomym kliknięciem
    // w przeglądarce systemowej (tauri/external.ts), nigdy fetchem. Ujęte w allowlist
    // testu offline-guard.
    lawternLabel: "www.lawtern.com",
    lawternHref: "https://www.lawtern.com",
    kancelariaLabel: "www.kancelariapaszkiewicz.pl",
    kancelariaHref: "https://www.kancelariapaszkiewicz.pl",
  },
  common: {
    offlineFull:
      "Dokumenty są przetwarzane w całości na Twoim komputerze. Poufnik nie wysyła ich do żadnego modelu językowego.",
    compliance:
      "Zaprojektowana pod zgodność z RODO i AI Act. Dane pozostają lokalnie, więc nie przekazujesz danych osobowych dostawcy AI.",
    connectivity:
      "Poufnik działa offline. Jedyne połączenie to Twoje konto z serwerem kancelarii – wyłącznie do aktualizacji i dostępu do funkcji Early Bird. Treść dokumentów nie jest nigdy wysyłana.",
  },
  engine: {
    starting: "Uruchamianie lokalnego silnika...",
    restarting: "Lokalny silnik został zatrzymany. Uruchamiam ponownie...",
    failedTitle: "Nie można uruchomić lokalnego silnika",
    retryHint: "Sprawdź instalację i uruchom aplikację ponownie.",
    readyLabel: "Silnik gotowy",
    restartingLabel: "Restart silnika",
    failedLabel: "Błąd silnika",
    startingLabel: "Start silnika",
    degradedBanner:
      "Działa tylko wykrywanie deterministyczne i słownikowe – dokładność obniżona",
  },
  updates: {
    settings: "Ustawienia",
    sectionTitle: "Aktualizacje",
    managedByStore: "Aktualizacje tej wersji dostarcza Microsoft Store.",
    managedByAppStore: "Aktualizacje tej wersji dostarcza App Store.",
    consentTitle: "Sprawdzanie aktualizacji",
    consentBody:
      "Poufnik może raz dziennie sprawdzać, czy dostępna jest nowsza wersja. Wymaga to połączenia z internetem, ale dotyczy wyłącznie numeru wersji aplikacji.",
    consentBody2: "Treść dokumentów pozostaje na tym urządzeniu – niezależnie od tej decyzji.",
    consentFootnote: "Decyzję można w każdej chwili zmienić w ustawieniach.",
    enableChecks: "Zgadzam się na sprawdzanie",
    disableChecks: "Nie sprawdzaj",
    settingsTitle: "Ustawienia",
    enabledLabel: "Sprawdzaj aktualizacje automatycznie.",
    enabledNote: "Wysyłane jest tylko zapytanie o numer wersji.",
    checkNow: "Sprawdź teraz",
    checking: "Sprawdzam aktualizacje...",
    upToDate: "Masz aktualną wersję.",
    updateTitle: "Dostępna aktualizacja",
    currentVersion: "Obecna wersja",
    newVersion: "Nowa wersja",
    changelog: "Zmiany",
    install: "Pobierz i zainstaluj",
    installing: "Instaluję aktualizację...",
    close: "Zamknij",
    disabledNote: "Po wyłączeniu aplikacja nie łączy się z manifestem aktualizacji.",
    checkFailed: "Nie udało się sprawdzić aktualizacji.",
  },
  account: {
    sectionTitle: "Konto i plan",
    email: "E-mail",
    emailUnavailable: "–",
    tier: "Warstwa",
    logout: "Wyloguj się",
    deleteAccount: "Usuń konto",
    deleteAccountNote:
      "Konto usuwasz w panelu konta Lawtern, który otworzy się w przeglądarce. Dokumenty i ustawienia zapisane na tym komputerze pozostają bez zmian.",
    note: "Konto obsługuje wyłącznie funkcje dodatkowe. Treść dokumentów jest przetwarzana lokalnie i nie jest przesyłana na serwery.",
    version: "Wersja aplikacji",
  },
  auth: {
    startTitle: "Anonimizacja dokumentów przed użyciem AI. W całości na Twoim komputerze.",
    startLead:
      "Poufnik anonimizuje dokumenty przed użyciem narzędzi AI. Wykrywanie jest dostrojone do języka polskiego, w tym do polskich identyfikatorów i odmiany nazwisk.",
    loginTitle: "Zaloguj się",
    login: "Zaloguj się",
    loginBrowser: "Zaloguj przez przeglądarkę",
    browserWaiting: "Czekam na potwierdzenie w przeglądarce...",
    loggingIn: "Logowanie...",
    password: "Hasło",
    emailPlaceholder: "imie@kancelaria.pl",
    createAccount: "Załóż darmowe konto",
    registerShort: "Załóż konto",
    noAccountPrompt: "Nie masz konta?",
    registerLink: "Załóż darmowe konto",
    registerCta: "Konto daje wcześniejszy dostęp do nowych funkcji. Dokumenty i tak zostają lokalnie.",
    orEarlyBird: "albo z darmowym kontem Early Bird",
    continueBasic: "Rozpocznij bez logowania",
    continueBasicNote: "Darmowa warstwa Basic – pełna anonimizacja, dostępna od razu.",
    settingsBasicNote: "Pracujesz w warstwie Basic. Darmowe konto odblokowuje Early Bird.",
    expired: "Sesja wygasła. Pracujesz teraz w warstwie Basic i możesz zalogować się ponownie.",
    invalidStoredSession:
      "Nie można potwierdzić zapisanej sesji. Pracujesz teraz w warstwie Basic.",
    loginNetwork:
      "Logowanie wymaga połączenia z serwisem kont. Praca w warstwie Basic działa bez tego połączenia.",
    loading: "Wczytywanie...",
  },
  tiers: {
    basic: "Basic",
    earlyBird: "Early Bird",
    pro: "Pro",
    enterprise: "Enterprise",
    plansTitle: "Plany",
    availableNow: "aktywna",
    later: "Zapowiedź",
    activeBadge: "Aktywna – darmowa",
    freeBadge: "Darmowa",
    freeAccountBadge: "Darmowe konto",
    earlyBirdFeature: (featureName: string) =>
      `${featureName.replace(/\.$/, "")} – funkcja dostępna z darmowym kontem Early Bird.`,
    earlyBirdHint: "Konto jest darmowe – dokumenty nadal są przetwarzane lokalnie.",
    backToResult: "Wróć do wyniku",
    earlyBirdActive: "Warstwa Early Bird jest aktywna.",
    earlyBirdActiveHint: "Funkcje tej warstwy są widoczne w obszarze pracy i ustawieniach.",
    plans: [
      {
        code: "basic",
        name: "Basic",
        status: "aktywna",
        description: "Pełna anonimizacja dokumentów. Bez logowania, na stałe.",
      },
      {
        code: "early_bird",
        name: "Early Bird",
        status: "aktywna po zalogowaniu",
        description: "Historia, porównanie, przetwarzanie seryjne i własne reguły – wcześniej.",
      },
      {
        code: "pro",
        name: "Pro",
        status: "Zapowiedź",
        description: "Dodatkowe funkcje dla kancelarii – zapowiedź.",
      },
      {
        code: "enterprise",
        name: "Enterprise",
        status: "Zapowiedź",
        description: "Wdrożenie w firmie i integracje – zapowiedź.",
      },
    ],
  },
  history: {
    button: "Historia",
    title: "Historia dokumentów",
    heading: "Historia dokumentów",
    lead: "Zapisywana na tym komputerze i dostępna wyłącznie za Twoją zgodą.",
    gateDescription:
      "Lista przetworzonych dokumentów zapisywana na tym komputerze, z możliwością powrotu do wyniku.",
    disabledTitle: "Historia dokumentów jest wyłączona",
    disabledBody:
      "Zapisuje lokalnie pełną sesję, w tym treść dokumentu, żeby móc ją później otworzyć. Wszystko zostaje na Twoim komputerze i możesz wyczyścić w każdej chwili.",
    enable: "Włącz historię",
    enabledLabel: "Zapisuj historię dokumentów na tym komputerze.",
    settingsDescription:
      "Zapisuje lokalnie pełną sesję, w tym treść dokumentu, żeby móc ją później otworzyć. Wszystko zostaje na Twoim komputerze i możesz wyczyścić w każdej chwili.",
    disabledNote: "Historia jest domyślnie wyłączona. Nowe wpisy nie są zapisywane.",
    empty: "Historia jest pusta",
    emptyHint: "Przetworzone dokumenty pojawią się tutaj.",
    loading: "Ładuję historię...",
    open: "Otwórz",
    delete: "Usuń",
    clear: "Wyczyść historię",
    clearConfirm:
      "Usunąć całą historię dokumentów z tego komputera? Tej operacji nie można cofnąć.",
    clearConfirmTitle: "Czyszczenie historii",
    deleteConfirm: "Usunąć ten wpis historii dokumentu?",
    deleteConfirmTitle: "Usuwanie wpisu historii",
    loadFailed: "Nie udało się wczytać historii dokumentów.",
    saveFailed: "Anonimizacja zakończona, ale nie udało się zapisać historii.",
    saved: "Sesja została zapisana w historii.",
    entitiesReplaced: (accepted: number, total: number) =>
      `${accepted} z ${total} danych zastąpionych`,
    createdAt: "Data",
    localOnly:
      "Historia jest przechowywana lokalnie w katalogu danych aplikacji i może zawierać dane wrażliwe.",
  },
  customRules: {
    title: "Własne reguły wykrywania",
    heading: "Własne reguły wykrywania",
    lead: "Dodatkowe wzorce wykrywane obok wbudowanych kategorii.",
    empty: "Brak własnych reguł",
    name: "Nazwa",
    label: "Oznaczenie w tekście, np. SYGNATURA",
    pattern: "Wzorzec (wyrażenie regularne)",
    sample: "Tekst testowy",
    add: "Dodaj regułę",
    delete: "Usuń",
    matchCount: (count: number) => `Trafienia w tekście testowym: ${count}`,
  },
  start: {
    step: "Krok 1 z 3",
    title: "Wybierz dokument",
    subtitle: "Dokument zostanie odczytany i przeanalizowany na tym komputerze.",
    dropTitle: "Przeciągnij plik albo kliknij, aby wybrać.",
    dropActive: "Upuść dokument, aby rozpocząć.",
    formats:
      "PDF, Word, Excel, PowerPoint, OpenOffice (ODT, ODS, ODP), TXT oraz skany i zdjęcia (JPG, PNG, HEIC). Do 50 MB.",
    chooseFile: "Wybierz plik",
    ocrNote: "Skany i zdjęcia są rozpoznawane automatycznie, w całości lokalnie.",
    forceOcr: "Wymuś rozpoznawanie tekstu (OCR)",
    forceOcrNote:
      "Zwykle niepotrzebne: strony bez tekstu Poufnik rozpoznaje sam. Włącz, gdy PDF ma uszkodzoną albo niepełną warstwę tekstu.",
  },
  batch: {
    title: "Przetwarzanie seryjne",
    heading: "Przetwarzanie seryjne",
    lead: "Wszystkie pliki są analizowane po kolei na tym komputerze. Każdy wynik możesz przejrzeć i poprawić osobno.",
    gateDescription:
      "Kolejka wielu plików naraz, zbiorczy podgląd wyników i wspólny eksport.",
    empty: "Kolejka jest pusta",
    dropTitle: "Przeciągnij pliki albo kliknij, aby wybrać.",
    dropActive: "Upuść pliki, aby dodać je do kolejki.",
    dropHint: "Przeciągnij kolejne pliki albo dodaj je z dysku.",
    addFiles: "Dodaj pliki",
    addFolder: "Dodaj folder",
    run: "Przetwórz kolejkę",
    running: "Przetwarzam...",
    export: "Pobierz gotowe wyniki",
    clear: "Wyczyść kolejkę",
    added: (count: number) => `Dodano do kolejki: ${plural(count, "plik", "pliki", "plików")}.`,
    skippedUnsupported: (count: number) =>
      `Pominięto ${plural(count, "nieobsługiwany plik", "nieobsługiwane pliki", "nieobsługiwanych plików")}.`,
    done: "Przetwarzanie seryjne zakończone.",
    exportDone: (count: number) =>
      `Zapisano ${plural(count, "plik", "pliki", "plików")} w folderze eksportu.`,
    noReadyResults: "Brak gotowych wyników do eksportu.",
    progress: (done: number, total: number) => `${done} z ${total} plików gotowe`,
    entityCount: (count: number) => plural(count, "wykrycie", "wykrycia", "wykryć"),
    fileSize: (size: number) => `${Math.max(1, Math.round(size / 1024))} KB`,
    noDetectionsYet: "—",
    columnFile: "Plik",
    columnStatus: "Stan",
    columnDetections: "Wykrycia",
    sharedCase: "Jedna sprawa",
    sharedCaseNote:
      "Ta sama osoba, firma czy adres dostaje to samo oznaczenie we wszystkich plikach, np. Jan Kowalski to [OSOBA_1] w każdym piśmie.",
    status: {
      queued: "Oczekuje",
      processing: "W toku",
      done: "Gotowe",
      error: "Błąd",
    },
  },
  processing: {
    title: "Przygotowuję dokument",
    parsing: "Odczyt dokumentu",
    parsingSub: "Struktura stron i tekst źródłowy.",
    ocr: "Rozpoznawanie tekstu",
    ocrSub: "Tylko strony zapisane jako obraz.",
    ocrSubForced: "Wymuszone dla całego dokumentu.",
    detecting: "Wykrywanie danych",
    detectingSub: "Osoby, identyfikatory, adresy, firmy, kontakt, daty.",
    note: "Analiza odbywa się na tym komputerze. Treść dokumentu nie jest nigdzie wysyłana.",
    loading: "Przetwarzam dokument...",
    pages: (count: number) => plural(count, "strona", "strony", "stron"),
  },
  shellActions: {
    title: "Poufnik",
    anonymized: (name: string) => `Zanonimizowano. Zapisano: ${name}`,
    ocr: (name: string) => `Tekst skopiowany do schowka i zapisany: ${name}`,
    markdown: (name: string) => `Markdown skopiowany do schowka i zapisany: ${name}`,
    restored: (name: string) => `Dane przywrócone. Zapisano: ${name}`,
    metadata: (name: string) => `Usunięto metadane. Zapisano: ${name}`,
    metadataRemoved: (codes: string[]) => {
      const labels = [...new Set(codes.map((code) => METADATA_LABELS[code] ?? code))];
      return labels.length > 0
        ? `Usunięte: ${labels.join(", ")}.`
        : "Plik nie zawierał metadanych do usunięcia.";
    },
    metadataSignature:
      "Uwaga: plik miał podpis elektroniczny, który w kopii bez metadanych nie jest już ważny. Oryginał został bez zmian.",
    metadataReencoded:
      "Zdjęcie zapisano ponownie, bo ten format trzyma metadane w środku obrazu.",
    restoredSimplified:
      "Nie udało się zachować wyglądu oryginału, więc dokument zapisano w uproszczonym układzie.",
    restoredPdfSimplified: "PDF zawiera sam tekst, bez układu stron oryginału.",
    noMap:
      "Nie znaleziono mapy zastąpień pasującej do tego pliku. Otwórz Poufnika, wybierz w menu Narzędzia – Przywracanie, a potem wczytaj mapę.",
    ambiguousMap:
      "Do tego pliku pasuje kilka map zastąpień z różnymi danymi, więc Poufnik nie zgaduje. Otwórz Poufnika, wybierz w menu Narzędzia – Przywracanie i wskaż właściwy dokument.",
    unsupported: "Poufnik nie obsługuje tego typu pliku.",
    failed: (name: string, message: string) => `Nie udało się przetworzyć ${name}: ${message}`,
  },
  errors: {
    importTitle: "Nie udało się przygotować dokumentu",
    chooseAnother: "Wybierz inny plik",
    generic: "Nie udało się przetworzyć dokumentu.",
    noEngine: "Lokalny silnik nie jest jeszcze gotowy.",
    tesseractNotFound:
      "Nie znaleziono Tesseract OCR. Zainstaluj Tesseract 5 z pakietami języka polskiego i angielskiego albo ustaw ANONYMIZER_TESSERACT_PATH.",
    payloadTooLarge: "Plik jest za duży. Limit to 50 MB.",
    legacyNeedsOffice: (format: string) =>
      `Plik ${format} Poufnik otwiera przez Microsoft Word albo LibreOffice, a żadnego z nich nie ma na tym komputerze. Zapisz plik jako DOCX i spróbuj ponownie.`,
    legacyConversionFailed: (format: string, message: string) =>
      `Nie udało się zamienić pliku ${format} na DOCX. ${message}`.trim(),
    unsupportedFile:
      "Nieobsługiwany format pliku. Użyj PDF, DOCX, DOC, RTF, XLSX, PPTX, ODT, ODS, ODP, TXT, JPG, PNG lub HEIC.",
    droppedMany: "Wybierz jeden dokument naraz.",
    noDocument: "Nie ma aktywnego dokumentu.",
    noReplacementMap: "Brak mapy zastąpień. Najpierw wykonaj anonimizację albo wczytaj mapę.",
    pdfRenderFailed: "Nie udało się utworzyć PDF w programie biurowym. Wyeksportuj DOCX i zapisz go jako PDF w Wordzie.",
  },
  document: {
    title: "Dokument",
    sourceParsed: "tekst",
    sourceOcr: "OCR",
    pages: (count: number) => {
      const lastTwo = count % 100;
      const last = count % 10;
      if (count === 1) return "1 strona";
      if (last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14)) return `${count} strony`;
      return `${count} stron`;
    },
    newDocument: "Nowy dokument",
    previousPage: "Poprzednia strona",
    nextPage: "Następna strona",
    page: "Strona",
    empty: "Dokument nie zawiera tekstu do wyświetlenia",
    failedValidationTooltip: "suma kontrolna niepoprawna – zweryfikuj",
    showOriginal: "Dokument",
    showCompare: "Porównanie",
    showResult: "Wynik",
  },
  review: {
    step: "Krok 2 z 3 – przegląd i korekta",
    title: "Sprawdź wykryte dane",
    toReplace: "do zastąpienia",
    goToResult: "Przejdź do wyniku",
    showLabel: "Anonimizuj",
  },
  preview: {
    before: "Przed",
    after: "Po – tak wygląda zapisany plik",
    loading: "Rysuję strony...",
    building: "Przygotowuję zanonimizowany plik...",
    failed: "Nie udało się pokazać tego pliku. Zapisany plik nadal wygląda jak oryginał.",
    morePages: (count: number) => `Pozostałe strony (${count}) są w zapisanym pliku.`,
    converting: "Przygotowuję podgląd w programie biurowym...",
    needsOffice: "Podgląd wymaga Microsoft Office albo LibreOffice.",
  },
  compare: {
    title: "Porównanie oryginału i wyniku",
    lead: "Przewijanie obu kolumn jest zsynchronizowane.",
    gateDescription:
      "Widok oryginału i wersji zanonimizowanej obok siebie, z zsynchronizowanym przewijaniem.",
    original: "Oryginał – pozostaje na tym komputerze",
    anonymized: "Po anonimizacji – bezpieczny do wysłania",
    needsResult:
      "Najpierw przetwórz dokument i przejdź do wyniku. Porównanie pokaże oryginał obok wersji po anonimizacji.",
    backToDocument: "Wróć do dokumentu",
  },
  legend: {
    title: "Legenda",
    redetect: "Wykryj ponownie",
    includeCategory: "Anonimizuj kategorię",
    excludeCategory: "Nie anonimizuj kategorii",
    total: "Łącznie",
  },
  corrections: {
    popoverTitle: "Korekta wykrycia",
    reject: "Odznacz",
    restore: "Oznacz do zastąpienia",
    category: "Zmień kategorię",
    group: "Wspólne oznaczenie",
    newGroup: "Nowe oznaczenie",
    createGroup: "Utwórz osobne oznaczenie",
    mergeGroup: "Połącz z innym",
    merge: "Połącz",
    addSensitive: "Dodaj własne zaznaczenie",
    addHint: "Fragment zostanie zastąpiony oznaczeniem, tak jak dane wykryte automatycznie.",
    add: "Dodaj zaznaczenie",
    cancel: "Anuluj",
    done: "Gotowe",
    close: "Zamknij",
  },
  entities: {
    title: "Wykryte dane",
    heading: "Wykryte dane",
    hint: "Poufnik zaznacza dane wrażliwe. Ty decydujesz, co zostanie zastąpione.",
    correct: "Popraw",
    uncertain: "niepewne",
    include: "Oznacz do zastąpienia",
    groupCount: (marked: number, total: number) => `${marked} z ${total} oznaczonych`,
    occurrences: (count: number) => plural(count, "wystąpienie", "wystąpienia", "wystąpień"),
    publicInstitutionsTitle: "Instytucje publiczne",
    publicInstitutionsHint: "Instytucje publiczne – pomijane. Kliknij, aby oznaczyć.",
    restorePublicInstitutions: "Oznacz wszystkie instytucje",
    emptyTitle: "Nie wykryto danych wrażliwych",
    emptyBody: "Sprawdź dokument samodzielnie przed wysłaniem – Poufnik mógł czegoś nie rozpoznać.",
    emptyHint: "Zaznacz fragment tekstu w dokumencie, aby dodać własne zaznaczenie.",
  },
  generation: {
    anonymize: "Przejdź do wyniku",
    anonymizing: "Anonimizuję...",
    step: "Krok 3 z 3",
    title: "Dokument gotowy",
    subtitle: "Po anonimizacji – bezpieczny do wysłania.",
    replacementBadge: (replacements: number, places: number) =>
      `${pluralWord(replacements, "zastąpienie", "zastąpienia", "zastąpień")} w ${plural(places, "miejscu", "miejscach", "miejscach")}`,
    tabDocument: "Dokument",
    report: "Raport do akt (PDF)",
    reportSaved: (name: string) => `Zapisano raport: ${name}.`,
    documentHeader: "Dokument przed i po anonimizacji",
    tabText: "Zanonimizowany tekst",
    tabMap: "Mapa zastąpień",
    tabRestore: "Przywróć dane z odpowiedzi",
    textHeader: "Tekst z oznaczeniami",
    replacementMap: "Mapa zastąpień",
    mapNote: "Łączy oznaczenia z prawdziwymi danymi. Pozostaje na tym urządzeniu i nie jest kopiowana razem z tekstem.",
    mapHiddenNote: "Mapa ukryta, aby nikt nie zobaczył danych przez ramię. Kliknij, aby pokazać.",
    mapShow: "Pokaż mapę zastąpień",
    mapHide: "Ukryj mapę",
    token: "Oznaczenie",
    original: "Oryginał",
    copyDocument: "Kopiuj dokument",
    saveMap: "Zapisz mapę zastąpień",
    saveMapEncrypted: "Zapisz mapę zaszyfrowaną",
    caseTitle: "Sprawa z kilkoma dokumentami",
    caseLead:
      "Wczytaj mapę zapisaną przy poprzednim piśmie tej sprawy: ta sama osoba dostanie to samo oznaczenie, a nowe dane kolejne numery.",
    caseLoad: "Użyj mapy sprawy",
    caseActive: (count: number) =>
      `Sprawa aktywna: ${count} oznaczeń. Kolejne dokumenty dostaną spójne oznaczenia; zapisz mapę, żeby kontynuować później.`,
    caseEnd: "Zakończ sprawę",
    caseBanner: (count: number) =>
      `Trwa sprawa (${count} oznaczeń): kolejne dokumenty dostają oznaczenia z jej mapy. Inny klient? Najpierw zakończ sprawę.`,
    mapPassword: "Hasło do mapy (opcjonalnie)",
    mapPasswordRepeat: "Powtórz hasło",
    mapPasswordMismatch: "Hasła się różnią.",
    mapPasswordNote:
      "Z hasłem mapa zapisze się zaszyfrowana (AES-256). Bez hasła nikt jej nie odczyta – Poufnik go nie zna i nie odzyska.",
    exportDocx: "Eksportuj DOCX",
    exportPdf: "Eksportuj PDF",
    exportOwnFormat: (format: string) => `Eksportuj ${format.toUpperCase()}`,
    exportSimplifiedLayout:
      "Oryginalny plik nie jest dostępny (dokument otwarty z historii), więc DOCX zapisano w uproszczonym układzie. Aby zachować wygląd oryginału, zaimportuj plik ponownie.",
    exportDocxFromPdf:
      "PDF nie przechowuje układu dokumentu Worda, więc DOCX z PDF ma uproszczony układ. Aby zachować wygląd oryginału, wybierz Eksportuj PDF.",
    exportFaithfulFailed:
      "Nie udało się zachować wyglądu oryginału bez ryzyka, że w pliku zostaną dane, więc dokument zapisano w uproszczonym układzie. Treść jest taka sama jak w zakładce Zanonimizowany tekst.",
    exportPdfLibreOffice:
      "PDF utworzono w LibreOffice – jego wygląd może minimalnie różnić się od tego w Microsoft Word.",
    exportPdfWithoutWord:
      "Na tym komputerze nie ma Microsoft Word, więc PDF ma uproszczony układ. Aby uzyskać PDF wyglądający jak oryginał, wyeksportuj DOCX i w Wordzie wybierz Zapisz jako PDF.",
    exportPdfSandboxed:
      "Ta wersja Poufnika nie tworzy PDF przez Microsoft Word, więc PDF ma uproszczony układ. Aby uzyskać PDF wyglądający jak oryginał, wyeksportuj DOCX i w Wordzie wybierz Zapisz jako PDF.",
    noticesTitle: "Co Poufnik zmienił w pliku",
    /** Strony skanu, na których coś widać, ale OCR nie odczytał z nich tekstu. */
    unreadPages: (pages: number[]) => {
      const shown = pages.slice(0, 10).map(String);
      const rest = pages.length - shown.length;
      const list =
        rest > 0
          ? `${shown.join(", ")} i ${rest} ${rest === 1 ? "innej" : "innych"}`
          : shown.length > 1
            ? `${shown.slice(0, -1).join(", ")} i ${shown[shown.length - 1]}`
            : shown[0];
      return pages.length === 1
        ? `Strona ${list} wygląda na zapisaną, ale nie udało się z niej odczytać tekstu. Sprawdź ją ręcznie przed wysłaniem - dane na niej mogły nie zostać zamaskowane.`
        : `Strony ${list} wyglądają na zapisane, ale nie udało się z nich odczytać tekstu. Sprawdź je ręcznie przed wysłaniem - dane na nich mogły nie zostać zamaskowane.`;
    },
    /** ``faces_masked:N`` - ile twarzy zamalowano na zdjęciach i skanach. */
    facesMasked: (count: number) => {
      const few = count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 10 || count % 100 >= 20);
      const noun = count === 1 ? "twarz" : few ? "twarze" : "twarzy";
      return `Zamalowano ${count} ${noun} na zdjęciach lub skanach.`;
    },
    /** ``second_engine_masks:N`` - wartości odczytane tylko drugim silnikiem OCR, zamalowane bez wpisu w mapie. */
    secondEngineMasks: (count: number) => {
      const few = count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 10 || count % 100 >= 20);
      const phrase =
        count === 1 ? "wartość odczytaną" : few ? "wartości odczytane" : "wartości odczytanych";
      return `Dodatkowo zamalowano ${count} ${phrase} drugim silnikiem OCR.`;
    },
    /** ``document_layout:<wzór>`` - rozpoznane dokumenty, których pola zamalowano według wzoru. */
    documentLayouts: (kinds: string[]) =>
      `Rozpoznano ${kinds.join(", ")}: ${kinds.length === 1 ? "jego pola zamalowano" : "ich pola zamalowano"} według wzoru z Rejestru Dokumentów Publicznych.`,
    documentKinds: {
      "dowod-osobisty": "dowód osobisty",
      paszport: "paszport",
      "prawo-jazdy": "prawo jazdy",
      "karta-pobytu": "kartę pobytu",
    } as Record<string, string>,
    pictureNotices: {
      pictures_redacted: "Dane osobowe widoczne na obrazach w dokumencie zostały zamalowane.",
      pictures_replaced:
        "Obraz, na którym nie dało się bezpiecznie zamalować danych, zastąpiono szarym polem.",
      pictures_not_checked:
        "Dokument ma obrazy w formacie, którego Poufnik nie odczytuje (np. EMF, SVG) – sprawdź je przed wysłaniem.",
    } as Record<string, string>,
    notices: {
      converted_to_docx:
        "Plik w starym formacie (DOC lub RTF) został zamieniony na DOCX; wynik zapiszesz jako DOCX.",
      tracked_changes_accepted:
        "Śledzone zmiany zostały zaakceptowane – wynik zawiera ostateczną wersję tekstu.",
      comments_removed: "Komentarze zostały usunięte.",
      metadata_cleared: "Usunięto autora, firmę i inne metadane pliku.",
      content_controls_unbound: "Pola formularza powiązane z ukrytymi danymi zostały odłączone.",
      custom_xml_removed: "Usunięto ukryte dane dołączone do pliku (np. właściwości SharePoint).",
      descriptions_cleared: "Usunięto opisy obrazów i podpowiedzi linków.",
      mail_merge_removed: "Usunięto powiązanie z korespondencją seryjną.",
      embedded_document_removed:
        "Usunięto osadzony dokument, którego treści Poufnik nie odczytuje.",
      form_fields_flattened:
        "Wypełnione pola formularza zamieniono na zwykły tekst strony – ich treść też jest anonimizowana.",
      annotations_removed: "Usunięto adnotacje, komentarze i linki z pliku PDF.",
      bookmarks_removed: "Usunięto zakładki (spis treści) pliku PDF.",
      attachments_removed: "Usunięto załączniki osadzone w pliku PDF.",
      scripts_removed: "Usunięto skrypty z pliku PDF.",
      hidden_descriptions_removed: "Usunięto ukryte opisy tekstu (np. dla czytników ekranu).",
      pdf_layout_export_unavailable:
        "Tego PDF nie da się zanonimizować z zachowaniem wyglądu – eksport PDF będzie miał uproszczony układ.",
      images_or_objects_present:
        "Dokument zawiera obrazy lub osadzone obiekty. W eksporcie PDF dane zanonimizowane w tekście są zamalowywane także na obrazach (np. na zrzutach ekranu), ale obraz może pokazywać inne dane – sprawdź obrazy przed wysłaniem.",
      sheet_names_replaced: "Nazwy arkuszy zawierające dane zastąpiono oznaczeniami.",
      external_links_removed: "Usunięto powiązania z innymi plikami i ich zapamiętane wartości.",
      connections_removed: "Usunięto połączenia z zewnętrznymi źródłami danych.",
      pivot_cache_cleared:
        "Usunięto zapamiętane dane tabel przestawnych – odświeżą się po otwarciu pliku.",
      heic_exported_as_jpeg: "Zdjęcia HEIC nie dało się zapisać w tym formacie, zapisano je jako JPG.",
    } as Record<string, string>,
    mapWarning: "Zapisany plik mapy pozwala przywrócić dane. Traktuj go jak dane wrażliwe.",
    mapWarningTitle: "Zapis mapy zastąpień",
    copied: "Skopiowano do schowka.",
  },
  prompts: {
    title: "Gotowe polecenia dla AI",
    lead: "Wybierz polecenie i skopiuj je razem z zanonimizowanym dokumentem do ChatGPT, Claude lub innego asystenta. Odpowiedź z oznaczeniami wklej potem w zakładce Przywróć dane z odpowiedzi.",
    loading: "Ładuję polecenia...",
    copyWithDocument: "Kopiuj polecenie z dokumentem",
    copyPrompt: "Kopiuj samo polecenie",
    showFull: "Pokaż całe polecenie",
    hideFull: "Zwiń polecenie",
    needsAnonymizedDocument: "Najpierw wykonaj anonimizację, aby dołączyć dokument do polecenia.",
  },
  deanonymization: {
    title: "Przywróć prawdziwe dane",
    lead: "Wklej odpowiedź AI, aby przywrócić prawdziwe dane – wyłącznie na tym komputerze.",
    inputLabel: "Odpowiedź z oznaczeniami",
    inputPlaceholder: "Wklej odpowiedź zawierającą oznaczenia, np. [OSOBA_1].",
    useCurrentMap: "Używana jest mapa z bieżącej sesji.",
    useLoadedMap: "Używana jest mapa wczytana z pliku.",
    loadMapShort: "Wczytaj mapę",
    mapLoaded: "Wczytana mapa zostanie użyta jako pierwsza.",
    mapHint: "Masz mapę zapisaną w pliku? Wczytaj ją, jeśli Poufnik nie znajdzie jej sam.",
    mapEncrypted: "Ta mapa jest zaszyfrowana. Podaj hasło:",
    mapUnlock: "Odszyfruj",
    mapPasswordField: "Hasło do mapy",
    restore: "Przywróć dane",
    restoring: "Przywracam...",
    result: "Tekst z przywróconymi danymi",
    warnings: "Ostrzeżenia",
    copyResult: "Kopiuj wynik",
    toolTitle: "Przywracanie danych",
    toolDropTitle: "Przeciągnij plik z odpowiedzią AI albo kliknij, aby wybrać.",
    toolDropActive: "Upuść plik, aby przywrócić dane.",
    toolFormats: "DOCX, PDF, TXT lub MD. Wynik zostanie zapisany w tym samym formacie.",
    fileTitle: "Masz plik z odpowiedzią AI?",
    fileLead:
      "Wskaż plik DOCX, PDF, TXT lub MD. Poufnik sam dobierze mapę zastąpień po nazwie pliku i oznaczeniach w treści, a wynik zapisze w tym samym formacie.",
    fileButton: "Przywróć dane w pliku",
    fileWorking: "Przywracam dane w pliku...",
    fileSaved: (name: string) => `Zapisano: ${name}.`,
    fileCancelled: "Nie zapisano pliku.",
    fileUnsupported: "Przywracać można pliki DOCX, PDF, TXT i MD.",
    fileNoMap:
      "Nie znaleziono mapy zastąpień pasującej do tego pliku. Wczytaj mapę JSON zapisaną przy anonimizacji.",
    fileChoose:
      "Do tego pliku pasuje kilka map z różnymi danymi. Wybierz dokument, z którego pochodzi odpowiedź:",
    fileChoiceLabel: (source: string | null, savedAt: number | null) =>
      `${source ?? "Mapa bez nazwy dokumentu"}${
        savedAt ? `, ${new Date(savedAt).toLocaleString("pl-PL", { dateStyle: "short", timeStyle: "short" })}` : ""
      }`,
    fileCancelChoice: "Anuluj",
  },
  restoreWarnings: {
    unknownTokens: (tokens: string[], subject: "file" | "text") => {
      const count = tokens.length;
      const lastDigit = count % 10;
      const teens = count % 100 >= 12 && count % 100 <= 14;
      const where = subject === "file" ? "pliku" : "tekście";
      const phrase =
        count === 1
          ? "zostało 1 oznaczenie, którego nie ma"
          : lastDigit >= 2 && lastDigit <= 4 && !teens
            ? `zostały ${count} oznaczenia, których nie ma`
            : `zostało ${count} oznaczeń, których nie ma`;
      const shown = tokens.slice(0, 10).join(", ");
      const more = count > 10 ? ` i ${count - 10} kolejnych` : "";
      return `W ${where} ${phrase} w mapie: ${shown}${more}. Sprawdź je ręcznie.`;
    },
  },
  hotkeys: {
    heading: "Skróty klawiszowe",
    enabled: "Anonimizacja i przywracanie przez schowek z dowolnego programu",
    note:
      "Skopiuj tekst (Ctrl+C), naciśnij Ctrl+Alt+Shift+P, a w schowku będzie wersja zanonimizowana do wklejenia w AI. Odpowiedź z AI skopiuj i naciśnij Ctrl+Alt+Shift+R: wróci z prawdziwymi danymi. Na Macu zamiast Ctrl jest Cmd. Poufnik musi być uruchomiony.",
    anonymized: (count: number) =>
      `Zanonimizowano ${count} ${count === 1 ? "fragment" : "fragmentów"}. Wklej tekst ze schowka.`,
    restored: "Przywrócono dane. Wklej tekst ze schowka.",
    empty: "Schowek jest pusty. Najpierw skopiuj tekst (Ctrl+C).",
    nothingFound: "W skopiowanym tekście nie ma danych do anonimizacji; schowek bez zmian.",
    noMap: "Nie znaleziono mapy pasującej do tekstu w schowku; schowek bez zmian.",
    ambiguousMap:
      "Do tego tekstu pasuje kilka map z różnymi danymi. Przywróć go w oknie Poufnika: Narzędzia – Przywracanie.",
    failed: (message: string) => `Nie udało się: ${message}`,
  },
  rememberedMaps: {
    heading: "Zapamiętane mapy do przywracania",
    enabled: "Zapamiętuj mapy do przywracania",
    // Only Windows encrypts them (DPAPI); on the Mac the Keychain comes in a later version,
    // so the text must not promise encryption there.
    note: (encrypted: boolean) =>
      encrypted
        ? "Dzięki temu „Przywróć dane” samo znajdzie mapę dokumentu. Mapy są zaszyfrowane kluczem Twojego konta Windows i kasowane po 30 dniach. Mapy zapisane przez Ciebie do pliku zostają bez zmian."
        : "Dzięki temu „Przywróć dane” samo znajdzie mapę dokumentu. Mapy są zaszyfrowane kluczem z Pęku kluczy macOS na tym komputerze i kasowane po 30 dniach. Mapy zapisane przez Ciebie do pliku zostają bez zmian.",
    deleteButton: "Usuń zapamiętane mapy",
    deleteConfirmButton: "Usuń",
    deleteConfirm:
      "Usunąć wszystkie zapamiętane mapy? Dokumentów zanonimizowanych wcześniej nie da się już przywrócić automatycznie (mapy zapisane przez Ciebie do pliku zostaną).",
    deleted: (count: number) =>
      count === 0
        ? "Nie było zapamiętanych map."
        : `Usunięto zapamiętane mapy: ${count}.`,
    deleteFailed: "Nie udało się usunąć zapamiętanych map.",
  },
  replacementMode: {
    heading: "Sposób zastąpienia danych",
    tokens: "Oznaczenia, np. [OSOBA_1], [PESEL_1]",
    tokensNote: "Od razu widać, co zostało ukryte. Zalecane do akt i do korekty.",
    pseudonyms: "Dane fikcyjne, np. „Adam Nowicki”, fikcyjny PESEL",
    pseudonymsNote:
      "Osoby, firmy i numery dostają wymyślone wartości w tej samej formie odmiany, więc tekst czyta się naturalnie. Adresy, daty i kwoty zostają oznaczeniami. Przywracanie działa tak samo, ale tylko z mapą tego dokumentu.",
    reportMode: "dane fikcyjne (osoby, firmy, numery); pozostałe kategorie: oznaczenia",
    profileHeading: "Rodzaj dokumentu",
    profileStandard: "Zwykły dokument",
    profileStandardNote: "Anonimizowane są wszystkie wykryte dane.",
    profileJudgment: "Orzeczenie do publikacji (BIP, portal orzeczeń)",
    profileJudgmentNote:
      "Sąd, sędziowie, protokolant, prokurator, sygnatury i daty zostają; strony, świadkowie, pełnomocnicy i daty urodzenia są anonimizowane. W przeglądzie możesz to zmienić dla każdego wykrycia.",
    facesHeading: "Zdjęcia i skany",
    maskFaces: "Zamaluj twarze na zdjęciach i skanach",
    maskFacesNote:
      "Wizerunek osoby to dane osobowe. Twarze na zdjęciach, skanach i obrazach w dokumentach są zamalowywane szarym polem z oznaczeniem [TWARZ_1]. Wykrywanie działa na tym komputerze; twarz bardzo małą lub zasłoniętą może pominąć, więc sprawdź wynik.",
  },
  excludedCategories: {
    heading: "Kategorie do anonimizacji",
    lead: "Odznaczone kategorie nie są anonimizowane w nowych dokumentach. Poufnik nadal je pokazuje w przeglądzie, ale bez zaznaczenia – w razie potrzeby możesz je zaznaczyć dla jednego dokumentu.",
  },
  finderMenu: {
    heading: "Menu w Finderze",
    lead: "Po włączeniu rozszerzenia „Poufnik w Finderze” pozycje Poufnika pojawią się od razu w menu po kliknięciu prawym przyciskiem na pliku. Włączysz je w Ustawieniach systemowych, w części Ogólne, na liście rozszerzeń. Bez tego te same akcje są w podmenu „Usługi”.",
    open: "Otwórz ustawienia rozszerzeń",
  },
  settings: {
    title: "Ustawienia",
    advanced: "Zaawansowane",
  },
  categories: {
    PERSON: "Osoba",
    PESEL: "PESEL",
    NIP: "NIP",
    REGON: "REGON",
    ID_CARD: "Dowód osobisty",
    PASSPORT: "Paszport",
    KRS: "KRS",
    LAND_REGISTER: "Księga wieczysta",
    CASE_NUMBER: "Sygnatura",
    ADMIN_CASE: "Znak sprawy",
    ADDRESS: "Adres",
    GPS: "Współrzędne GPS",
    COMPANY: "Firma",
    PUBLIC_INSTITUTION: "Instytucja publiczna",
    VEHICLE: "Pojazd",
    PHONE: "Telefon",
    EMAIL: "E-mail",
    URL: "URL",
    IP_ADDRESS: "Adres IP",
    MAC_ADDRESS: "Adres MAC",
    API_KEY: "Klucz API",
    DRIVING_LICENSE: "Prawo jazdy",
    LAND_PARCEL: "Działka",
    KSEF: "Numer KSeF",
    DATE: "Data",
    BANK_ACCOUNT: "Rachunek bankowy",
    PAYMENT_CARD: "Karta płatnicza",
    MONEY: "Kwota",
    CUSTOM: "Własne",
  } satisfies Record<EntityCategory, string>,
};
