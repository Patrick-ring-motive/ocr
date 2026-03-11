(async function () {
  // ── CDN / local imports ───────────────────────────────────────
  const TESSERACT_CDN =
    "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
  const _fixText = (await import("./libs/fix-text.js")).fixText;
  const fixText = text => _fixText(text, "fy", "en");
  // ── DOM refs ─────────────────────────────────────────────────
  const dropZone = document.getElementById("drop-zone");
  const fileInput = document.getElementById("file-input");
  const statusEl = document.getElementById("status");
  const progressContainer = document.getElementById("progress-container");
  const progressBar = document.getElementById("progress-bar");
  const previewSection = document.getElementById("preview-section");
  const previewContainer = document.getElementById("preview-container");
  const resultSection = document.getElementById("result-section");
  const ocrOutput = document.getElementById("ocr-output");
  const copyBtn = document.getElementById("copy-btn");
  const clearBtn = document.getElementById("clear-btn");

  // ── Helpers ──────────────────────────────────────────────────
  function setStatus(msg) {
    statusEl.textContent = msg;
  }

  function setProgress(pct) {
    progressContainer.style.display = "block";
    progressBar.style.width = pct + "%";
  }

  function hideProgress() {
    progressContainer.style.display = "none";
    progressBar.style.width = "0%";
  }

  function clearAll() {
    previewContainer.innerHTML = "";
    previewSection.style.display = "none";
    resultSection.style.display = "none";
    ocrOutput.textContent = "";
    setStatus("");
    hideProgress();
    fileInput.value = "";
  }

  // ── Display text immediately, then lazy-correct each page via fixText ──
  const PAGE_BREAK = "\n\n--- Page break ---\n\n";

  function displayWithLazyFix(pages) {
    const corrected = [...pages];
    ocrOutput.textContent = corrected.join(PAGE_BREAK);
    resultSection.style.display = "block";

    pages.forEach((raw, i) => {
      fixText(raw).then((fixed) => {
        if (fixed !== raw) {
          corrected[i] = fixed;
          ocrOutput.textContent = corrected.join(PAGE_BREAK);
        }
      }).catch(() => { /* keep original on failure */ });
    });
  }

  // ── Load Tesseract.js from CDN ───────────────────────────────
  function loadTesseract() {
    return new Promise((resolve, reject) => {
      if (window.Tesseract) return resolve(window.Tesseract);
      const s = document.createElement("script");
      s.src = TESSERACT_CDN;
      s.onload = () => resolve(window.Tesseract);
      s.onerror = () => reject(new Error("Failed to load Tesseract.js"));
      document.head.appendChild(s);
    });
  }

  // ── Load PDF.js from local files ──────────────────────────────
  let pdfjsLibCached;
  async function loadPdfJs() {
    if (pdfjsLibCached) return pdfjsLibCached;
    const pdfjs = await import("./libs/pdf.min.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc = "./libs/pdf.worker.min.mjs";
    pdfjsLibCached = pdfjs;
    return pdfjs;
  }

  // ── Open a PDF and return the document + page images ─────────
  async function loadPdf(file) {
    const pdfjsLib = await loadPdfJs();
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    setStatus(`Rendering ${pdf.numPages} PDF page(s)…`);
    const images = await Promise.all(
      Array.from({ length: pdf.numPages }, async (_, idx) => {
        const page = await pdf.getPage(idx + 1);
        const scale = 2;
        const viewport = page.getViewport({ scale });

        const canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext("2d");
        await page.render({ canvasContext: ctx, viewport }).promise;

        return new Promise((r) => canvas.toBlob(r, "image/png"));
      })
    );
    return { pdf, images };
  }

  // ── Extract embedded text from a PDF using PDF.js ────────────
  async function extractPdfText(pdf) {
    const pageTexts = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      setStatus(`Extracting text from page ${i} of ${pdf.numPages}…`);
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const strings = content.items.map((item) => item.str);
      pageTexts.push(strings.join(" "));
    }
    return pageTexts;
  }

  // ── Show image previews ──────────────────────────────────────
  function showPreviews(imageBlobs) {
    previewContainer.innerHTML = "";
    previewSection.style.display = "block";
    for (const blob of imageBlobs) {
      const img = document.createElement("img");
      img.src = URL.createObjectURL(blob);
      previewContainer.appendChild(img);
    }
  }

  // ── Tesseract worker pool ──────────────────────────────────────
  const INITIAL_POOL_SIZE = 10;
  const idle = [];
  let poolReady;

  async function initPool() {
    if (poolReady) return poolReady;
    poolReady = (async () => {
      const Tesseract = await loadTesseract();
      const workers = await Promise.all(
        Array.from({ length: INITIAL_POOL_SIZE }, () =>
          Tesseract.createWorker("eng")
        )
      );
      idle.push(...workers);
    })();
    return poolReady;
  }

  async function acquireWorker() {
    await initPool();
    if (idle.length > 0) return idle.pop();
    const Tesseract = await loadTesseract();
    return Tesseract.createWorker("eng");
  }

  function releaseWorker(worker) {
    idle.push(worker);
  }

  // ── Run OCR on a list of image blobs (parallel via pool) ─────
  async function runOcr(imageBlobs) {
    await initPool();

    setStatus(`Recognising text across ${imageBlobs.length} page(s)…`);

    const results = await Promise.all(
      imageBlobs.map(async (blob) => {
        const worker = await acquireWorker();
        const { data: { text } } = await worker.recognize(blob);
        releaseWorker(worker);
        return text;
      })
    );

    return results;
  }

  // ── Handle an uploaded file ──────────────────────────────────
  async function handleFile(file) {
    if (!file) return;

    clearAll();

    const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    const isMarkup = /^(text\/(html|xml)|application\/(xml|xhtml\+xml|svg\+xml))$/.test(file.type)
      || /\.(html?|xml|xhtml|svg)$/i.test(file.name);

    try {
      if (isMarkup) {
        setStatus("Parsing markup…");
        const markup = await file.text();
        const mimeType = /xml|xhtml|svg/i.test(file.name) || /xml/i.test(file.type)
          ? "text/xml" : "text/html";
        const doc = new DOMParser().parseFromString(markup, mimeType);
        const text = doc.body
          ? doc.body.textContent.trim()
          : doc.documentElement.textContent.trim();
        displayWithLazyFix([text]);
        setStatus("Done — text extracted from markup.");
      } else if (isPdf) {
        setStatus("Loading PDF…");
        const { pdf, images } = await loadPdf(file);
        showPreviews(images);

        // Try native text extraction first
        setStatus("Checking for embedded text…");
        const pageTexts = await extractPdfText(pdf);
        const nativeText = pageTexts.join("").trim();

        if (nativeText.replace(/\s/g, "").length > 0) {
          displayWithLazyFix(pageTexts);
          setStatus("Done — text extracted directly from PDF.");
          return;
        }

        // No embedded text found — fall back to OCR
        setStatus("No embedded text found. Running OCR…");
        const ocrPages = await runOcr(images);
        displayWithLazyFix(ocrPages);
      } else {
        showPreviews([file]);
        setStatus("Loading OCR engine…");
        const ocrPages = await runOcr([file]);
        displayWithLazyFix(ocrPages);
      }

      setStatus("Done!");
      hideProgress();
    } catch (err) {
      console.error(err);
      setStatus("Error: " + err.message);
      hideProgress();
    }
  }

  // ── Event listeners ──────────────────────────────────────────
  dropZone.addEventListener("click", () => fileInput.click());

  fileInput.addEventListener("change", (e) => {
    if (e.target.files.length) handleFile(e.target.files[0]);
  });

  dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZone.classList.add("dragover");
  });

  dropZone.addEventListener("dragleave", () => {
    dropZone.classList.remove("dragover");
  });

  dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.classList.remove("dragover");
    if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
  });

  copyBtn.addEventListener("click", () => {
    navigator.clipboard.writeText(ocrOutput.textContent).then(() => {
      copyBtn.textContent = "Copied!";
      setTimeout(() => (copyBtn.textContent = "Copy Text"), 1500);
    });
  });

  clearBtn.addEventListener("click", clearAll);
})();
import('https://patrick-ring-motive.github.io/logs-highlighter/index.js')
