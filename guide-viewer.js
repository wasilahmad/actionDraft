const params = new URLSearchParams(window.location.search);
const mode = params.get("mode") || "edit";
const autoPrint = mode === "pdf";
let isEditing = mode === "edit";
const DEFAULT_GUIDE_TITLE = "Operational Walkthrough: [Task Name]";
const STORAGE_KEYS = {
  STEPS: "steps",
  GUIDE_TITLE: "guideTitle"
};
let currentSteps = [];

const editButton = document.getElementById("editToggle");
const stepsContainer = document.getElementById("guideSteps");
const guideTitleEl = document.querySelector(".page-header h1[data-editable='true']");

init();

async function init() {
  const data = await chrome.storage.local.get([STORAGE_KEYS.STEPS, STORAGE_KEYS.GUIDE_TITLE]);
  const steps = Array.isArray(data[STORAGE_KEYS.STEPS]) ? data[STORAGE_KEYS.STEPS] : [];
  const guideTitle = typeof data[STORAGE_KEYS.GUIDE_TITLE] === "string" ? data[STORAGE_KEYS.GUIDE_TITLE].trim() : "";

  currentSteps = steps;
  if (guideTitleEl) {
    guideTitleEl.textContent = guideTitle || DEFAULT_GUIDE_TITLE;
  }

  renderSteps(steps);

  editButton.addEventListener("click", async () => {
    if (isEditing) {
      await saveEdits();
    }

    isEditing = !isEditing;
    applyEditState();
  });

  window.addEventListener("beforeprint", () => {
    editButton.style.display = "none";
  });

  window.addEventListener("afterprint", () => {
    editButton.style.display = "";
  });

  applyEditState();

  if (autoPrint) {
    setTimeout(() => {
      window.focus();
      window.print();
    }, 300);
  }
}

function renderSteps(steps) {
  if (!steps.length) {
    stepsContainer.innerHTML = "<p>No steps captured yet.</p>";
    editButton.disabled = true;
    return;
  }

  stepsContainer.innerHTML = steps
    .map((step, index) => {
      const description = escapeHtml(step.description || `Step ${index + 1}`);
      const title = escapeHtml(step.title || `Step ${index + 1}`);
      return `
        <section class="step" data-step-index="${index}">
          <h2 class="editable" data-editable="true">${title}</h2>
          <p class="editable step-description" data-editable="true">${description}</p>
          <img src="${step.image}" alt="Step ${index + 1}" loading="lazy" />
        </section>
      `;
    })
    .join("");
}

async function saveEdits() {
  const updatedSteps = currentSteps.map((step, index) => {
    const stepEl = stepsContainer.querySelector(`.step[data-step-index='${index}']`);
    const titleEl = stepEl?.querySelector("h2.editable");
    const descEl = stepEl?.querySelector("p.step-description");
    const updatedTitle = (titleEl?.textContent || "").trim() || `Step ${index + 1}`;
    const updatedDescription = (descEl?.textContent || "").trim() || step.description || `Step ${index + 1}`;

    return {
      ...step,
      title: updatedTitle,
      description: updatedDescription
    };
  });

  const updatedGuideTitle = (guideTitleEl?.textContent || "").trim() || DEFAULT_GUIDE_TITLE;
  await chrome.storage.local.set({
    [STORAGE_KEYS.STEPS]: updatedSteps,
    [STORAGE_KEYS.GUIDE_TITLE]: updatedGuideTitle
  });

  currentSteps = updatedSteps;
}

function applyEditState() {
  const editableNodes = Array.from(document.querySelectorAll('[data-editable="true"]'));
  editableNodes.forEach((node) => {
    node.contentEditable = isEditing ? "true" : "false";
    node.spellcheck = isEditing;
  });
  editButton.textContent = isEditing ? "Done" : "Edit";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
