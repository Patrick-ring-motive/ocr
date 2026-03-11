(async function () {
  // ── CDN / local imports ───────────────────────────────────────
  const TESSERACT_CDN =
    "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";

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
    const images = [];

    for (let i = 1; i <= pdf.numPages; i++) {
      setStatus(`Rendering PDF page ${i} of ${pdf.numPages}…`);
      const page = await pdf.getPage(i);
      const scale = 2;
      const viewport = page.getViewport({ scale });

      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext("2d");
      await page.render({ canvasContext: ctx, viewport }).promise;

      const blob = await new Promise((r) => canvas.toBlob(r, "image/png"));
      images.push(blob);
    }
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

  // ── Run OCR on a list of image blobs ─────────────────────────
  async function runOcr(imageBlobs) {
    const Tesseract = await loadTesseract();

    const worker = await Tesseract.createWorker("eng", 1, {
      logger: (m) => {
        if (m.status === "recognizing text") {
          setProgress(Math.round(m.progress * 100));
        }
      },
    });

    const results = [];
    for (let i = 0; i < imageBlobs.length; i++) {
      setStatus(
        `Recognising text (${i + 1}/${imageBlobs.length})…`
      );
      setProgress(0);
      const {
        data: { text },
      } = await worker.recognize(imageBlobs[i]);
      results.push(text);
    }

    await worker.terminate();
    return results.join("\n\n--- Page break ---\n\n");
  }

  // ── Handle an uploaded file ──────────────────────────────────
  async function handleFile(file) {
    if (!file) return;

    clearAll();

    const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");

    try {
      if (isPdf) {
        setStatus("Loading PDF…");
        const { pdf, images } = await loadPdf(file);
        showPreviews(images);

        // Try native text extraction first
        setStatus("Checking for embedded text…");
        const pageTexts = await extractPdfText(pdf);
        const nativeText = pageTexts.join("\n\n--- Page break ---\n\n").trim();

        if (nativeText.length > 0) {
          ocrOutput.textContent = nativeText;
          resultSection.style.display = "block";
          setStatus("Done — text extracted directly from PDF.");
          return;
        }

        // No embedded text found — fall back to OCR
        setStatus("No embedded text found. Running OCR…");
        const ocrText = await runOcr(images);
        ocrOutput.textContent = ocrText;
      } else {
        showPreviews([file]);
        setStatus("Loading OCR engine…");
        const ocrText = await runOcr([file]);
        ocrOutput.textContent = ocrText;
      }

      resultSection.style.display = "block";
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
