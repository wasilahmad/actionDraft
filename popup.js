const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const clearBtn = document.getElementById("clearBtn");
const editGuideBtn = document.getElementById("editGuideBtn");
const downloadPdfBtn = document.getElementById("downloadPdfBtn");
const statusEl = document.getElementById("status");
const stepsEl = document.getElementById("steps");
const PANEL_CLOSE_PROMPT_KEY = "actionDraftPendingClearPrompt";

let currentSession = {
  isRecording: false,
  steps: []
};

startBtn.addEventListener("click", async () => {
  await sendMessage({ type: "START_RECORDING" });
  await refresh();
});

stopBtn.addEventListener("click", async () => {
  await sendMessage({ type: "STOP_RECORDING" });
  await refresh();
});

clearBtn.addEventListener("click", async () => {
  await promptToClearSession();
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

async function refresh() {
  const session = await sendMessage({ type: "GET_SESSION" });
  if (!session?.ok) {
    statusEl.textContent = "Unable to load session.";
    return;
  }

  const steps = session.steps || [];
  currentSession = {
    isRecording: Boolean(session.isRecording),
    steps
  };
  const recordingStatus = session.isRecording ? "Recording (all tabs)" : "Stopped";
  statusEl.textContent = `${recordingStatus} • ${steps.length} step${steps.length === 1 ? "" : "s"}`;

  // Change button text based on whether there are existing steps
  startBtn.textContent = steps.length > 0 ? "Resume" : "Start";
  startBtn.disabled = session.isRecording;
  stopBtn.disabled = !session.isRecording;
  clearBtn.disabled = session.isRecording || steps.length === 0;
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
        <div class="step" data-step-index="${index}">
          <div class="drag-handle" title="Drag to reorder">⋮⋮</div>
          <button class="delete-step-btn" data-delete-index="${index}" title="Delete this step" aria-label="Delete step ${index + 1}">×</button>
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
  attachDeleteListeners();
  initializeSortable();
}

function attachDeleteListeners() {
  const deleteButtons = stepsEl.querySelectorAll(".delete-step-btn");
  deleteButtons.forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const index = parseInt(btn.getAttribute("data-delete-index"), 10);
      if (!isNaN(index)) {
        await deleteStep(index);
      }
    });
  });
}

// Initialize SortableJS for drag & drop
function initializeSortable() {
  // Check if Sortable is available
  if (typeof Sortable === 'undefined') {
    console.error('SortableJS library not loaded');
    return;
  }

  // Destroy existing sortable instance if any
  if (stepsEl.sortableInstance) {
    stepsEl.sortableInstance.destroy();
  }

  // Create new Sortable instance
  stepsEl.sortableInstance = new Sortable(stepsEl, {
    animation: 150,
    handle: '.drag-handle',
    ghostClass: 'sortable-ghost',
    chosenClass: 'sortable-chosen',
    dragClass: 'sortable-drag',
    easing: 'cubic-bezier(1, 0, 0, 1)',
    
    onEnd: async function(evt) {
      // Get current steps
      const session = await sendMessage({ type: "GET_SESSION" });
      if (!session?.ok || !Array.isArray(session.steps)) {
        return;
      }

      const steps = [...session.steps];
      
      // Reorder the array based on the drag operation
      const movedItem = steps.splice(evt.oldIndex, 1)[0];
      steps.splice(evt.newIndex, 0, movedItem);
      
      // Save reordered steps
      await chrome.storage.local.set({ steps: steps });
      await refresh();
    }
  });
}

async function deleteStep(index) {
  const session = await sendMessage({ type: "GET_SESSION" });
  if (!session?.ok || !Array.isArray(session.steps)) {
    return;
  }

  const steps = session.steps;
  if (index < 0 || index >= steps.length) {
    return;
  }

  const confirmed = confirm(`Delete Step ${index + 1}?\n\nThis action cannot be undone.`);
  if (!confirmed) {
    return;
  }

  steps.splice(index, 1);
  
  await chrome.storage.local.set({ steps: steps });
  await refresh();
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
  const opened = window.open(url, "actiondraft-guide-viewer");

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

async function promptToClearSession() {
  const session = await sendMessage({ type: "GET_SESSION" });
  const steps = session?.steps || [];
  const isRecording = Boolean(session?.isRecording);

  const promptMessage = getClearSessionPromptMessage(steps.length, isRecording);
  if (promptMessage) {
    const confirmed = confirm(promptMessage);
    if (!confirmed) {
      return false;
    }
  }

  await sendMessage({ type: "CLEAR_SESSION" });
  currentSession = {
    isRecording: false,
    steps: []
  };
  localStorage.removeItem(PANEL_CLOSE_PROMPT_KEY);
  await refresh();
  return true;
}

function hasRecordedSessionData() {
  return currentSession.isRecording || currentSession.steps.length > 0;
}

function getClearSessionPromptMessage(stepCount, isRecording) {
  if (stepCount > 0) {
    return `Clear all ${stepCount} step${stepCount === 1 ? "" : "s"}?\n\nThis will delete all recorded steps and start a new session.\n\nThis action cannot be undone.`;
  }

  if (isRecording) {
    return "Stop recording and clear the current session?\n\nThis action cannot be undone.";
  }

  return "";
}

function handleBeforeUnload(event) {
  if (!hasRecordedSessionData()) {
    return;
  }

  event.preventDefault();
  event.returnValue = true;
}

function markPendingClearPrompt() {
  if (!hasRecordedSessionData()) {
    return;
  }

  localStorage.setItem(PANEL_CLOSE_PROMPT_KEY, "true");
}

async function promptForPendingPanelClose() {
  if (localStorage.getItem(PANEL_CLOSE_PROMPT_KEY) !== "true") {
    return;
  }

  localStorage.removeItem(PANEL_CLOSE_PROMPT_KEY);

  const session = await sendMessage({ type: "GET_SESSION" });
  if (!session?.ok || !Array.isArray(session.steps)) {
    return;
  }

  if (!session.isRecording && session.steps.length === 0) {
    return;
  }

  currentSession = {
    isRecording: Boolean(session.isRecording),
    steps: session.steps
  };

  await promptToClearSession();
}

window.addEventListener("beforeunload", handleBeforeUnload);
window.addEventListener("pagehide", markPendingClearPrompt);

async function initializePopup() {
  await refresh();
  await promptForPendingPanelClose();
}

initializePopup();
