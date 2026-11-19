import { useEffect, useRef, useState } from "react";

import type { PreviewKind } from "../domain/preview";
import { texts } from "../i18n";
import { convertToPdf, NoPreviewConverterError } from "../tauri/pdf";
import { PreviewFrame } from "./PreviewFrame";

// A long contract still opens quickly; the saved file always has every page.
const MAX_PDF_PAGES = 60;

interface FilePreviewProps {
  file: Blob;
  kind: PreviewKind;
  label: string;
  /** File format (extension) of an "office" file: the program that converts it needs it. */
  format?: string;
}

/**
 * Pages of a PDF, Word document or picture drawn as they print. Everything runs inside the
 * window (pdf.js, docx-preview); nothing is sent anywhere. The libraries load only when a
 * preview is opened. A spreadsheet, presentation or OpenDocument file is first turned into a
 * PDF on this computer by Office or LibreOffice, then drawn like any PDF.
 */
export function FilePreview({ file, kind, label, format }: FilePreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error" | "no-converter">(
    "loading",
  );
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    let cancelled = false;
    let url: string | null = null;
    let resize: ResizeObserver | null = null;
    // Each run draws into its own element: a run that is still finishing for the previous file
    // writes into a detached element and never mixes its pages into the new document.
    const stage = document.createElement("div");
    if (kind === "image") {
      container.replaceChildren();
    } else {
      container.replaceChildren(stage);
    }
    setStatus("loading");

    const render = async () => {
      if (kind === "image") {
        url = URL.createObjectURL(file);
        setImageUrl(url);
        return;
      }
      if (kind === "docx") {
        const { renderAsync } = await import("docx-preview");
        if (cancelled) {
          return;
        }
        await renderAsync(file, stage, undefined, {
          className: "docx-page",
          inWrapper: true,
          ignoreLastRenderedPageBreak: false,
          breakPages: true,
          experimental: true,
        });
        // A link in the document must not open a web page in the app window (Poufnik works
        // offline): links are shown, not followed.
        for (const link of stage.querySelectorAll("a[href]")) {
          link.removeAttribute("href");
        }
        // Word pages are drawn at their real width (A4 = 794 px): shrink them to the column.
        const fit = () => fitDocxPages(container);
        fit();
        if (typeof ResizeObserver !== "undefined") {
          resize = new ResizeObserver(fit);
          resize.observe(container);
        }
        return;
      }
      if (kind === "office") {
        const pdf = await convertToPdf(file, format ?? "");
        if (cancelled) {
          return;
        }
        await renderPdf(pdf, stage, () => cancelled);
        return;
      }
      await renderPdf(file, stage, () => cancelled);
    };

    render().then(
      () => {
        if (!cancelled) {
          setStatus("ready");
        }
      },
      (failure: unknown) => {
        if (!cancelled) {
          setStatus(failure instanceof NoPreviewConverterError ? "no-converter" : "error");
        }
      },
    );
    return () => {
      cancelled = true;
      stage.remove();
      resize?.disconnect();
      if (url) {
        URL.revokeObjectURL(url);
      }
      setImageUrl(null);
    };
  }, [file, kind, format]);

  return (
    <PreviewFrame label={label}>
      {status === "loading" && (
        <p className="muted file-preview__status">
          {kind === "office" ? texts.preview.converting : texts.preview.loading}
        </p>
      )}
      {status === "no-converter" && (
        <p className="status-note file-preview__status" role="status">
          {texts.preview.needsOffice}
        </p>
      )}
      {status === "error" && (
        <p className="error-note file-preview__status" role="alert">
          {texts.preview.failed}
        </p>
      )}
      <div
        className="file-preview__pages"
        ref={containerRef}
        onClickCapture={(event) => {
          if ((event.target as Element).closest?.("a")) {
            event.preventDefault();
          }
        }}
      >
        {kind === "image" && imageUrl ? (
          <img className="file-preview__image" src={imageUrl} alt={label} />
        ) : null}
      </div>
    </PreviewFrame>
  );
}

function fitDocxPages(container: HTMLElement) {
  const wrapper = container.querySelector<HTMLElement>(".docx-page-wrapper");
  const page = wrapper?.querySelector<HTMLElement>("section.docx-page");
  if (!wrapper || !page) {
    return;
  }
  wrapper.style.zoom = "1"; // measure the page at its real width
  if (page.offsetWidth === 0) {
    return;
  }
  const available = container.clientWidth - 24;
  // Never larger than the real page, unless the user zoomed the preview in.
  const userZoom = Number(getComputedStyle(container).getPropertyValue("--preview-zoom")) || 1;
  wrapper.style.zoom = String(Math.min(Math.max(1, userZoom), available / page.offsetWidth));
}

async function renderPdf(file: Blob, container: HTMLElement, cancelled: () => boolean) {
  const pdfjs = await import("pdfjs-dist");
  const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const loading = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const pdf = await loading.promise;
  try {
    const pageCount = Math.min(pdf.numPages, MAX_PDF_PAGES);
    for (let number = 1; number <= pageCount && !cancelled(); number += 1) {
      const page = await pdf.getPage(number);
      if (cancelled()) {
        break;
      }
      // Sharp on high-DPI screens; the canvas is scaled down to the column by CSS.
      const viewport = page.getViewport({ scale: 1.6 * (window.devicePixelRatio || 1) });
      const canvas = document.createElement("canvas");
      canvas.className = "file-preview__page";
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      container.appendChild(canvas);
      await page.render({ canvas, viewport }).promise;
    }
    if (pdf.numPages > pageCount && !cancelled()) {
      const more = document.createElement("p");
      more.className = "muted";
      more.textContent = texts.preview.morePages(pdf.numPages - pageCount);
      container.appendChild(more);
    }
  } finally {
    await loading.destroy();
  }
}
