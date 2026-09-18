const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const editGuideBtn = document.getElementById("editGuideBtn");
const downloadPdfBtn = document.getElementById("downloadPdfBtn");
const statusEl = document.getElementById("status");
const stepsEl = document.getElementById("steps");

startBtn.addEventListener("click", async () => {
  await sendMessage({ type: "START_RECORDING" });
  await refresh();
});

stopBtn.addEventListener("click", async () => {
  await sendMessage({ type: "STOP_RECORDING" });
  await refresh();
});

editGuideBtn.addEventListener("click", () => {
  openGuideViewer("edit");
});

downloadPdfBtn.addEventListener("click", () => {
  openGuideViewer("pdf");
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") {
    return;
  }

  if (changes.steps || changes.isRecording) {
    refresh();
  }
});

refresh();

async function refresh() {
  const session = await sendMessage({ type: "GET_SESSION" });
  if (!session?.ok) {
    statusEl.textContent = "Unable to load session.";
    return;
  }

  const steps = session.steps || [];
  statusEl.textContent = `${session.isRecording ? "Recording" : "Stopped"} • ${steps.length} step${steps.length === 1 ? "" : "s"}`;

  startBtn.disabled = session.isRecording;
  stopBtn.disabled = !session.isRecording;
  editGuideBtn.disabled = steps.length === 0;
  downloadPdfBtn.disabled = steps.length === 0;

  renderSteps(steps);
}

function renderSteps(steps) {
  if (!steps.length) {
    stepsEl.innerHTML = '<p class="muted">No steps recorded yet.</p>';
    return;
  }

  stepsEl.innerHTML = steps
    .map((step, index) => {
      const description = escapeHtml(step.description || `Step ${index + 1}`);
      return `
        <div class="step">
          <p class="step-title">Step ${index + 1}</p>
          <p class="step-desc">${description}</p>
          <img 
            data-src="${step.image}" 
            alt="Step ${index + 1}"
            loading="lazy"
            class="step-image-lazy"
          />
        </div>
      `;
    })
    .join("");

  lazyLoadImages();
}

function lazyLoadImages() {
  const images = document.querySelectorAll(".step-image-lazy[data-src]");
  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const img = entry.target;
          img.src = img.dataset.src;
          img.classList.remove("step-image-lazy");
          observer.unobserve(img);
        }
      });
    }, { rootMargin: "50px" });

    images.forEach((img) => observer.observe(img));
  } else {
    images.forEach((img) => {
      img.src = img.dataset.src;
    });
  }
}

function openGuideViewer(mode) {
  const url = chrome.runtime.getURL(`guide-viewer.html?mode=${encodeURIComponent(mode)}`);
  const opened = window.open(url, "_blank");

  if (!opened) {
    statusEl.textContent = "Popup blocked. Please allow popups for this extension.";
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function sendMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      resolve(response || { ok: false });
    });
  });
}
