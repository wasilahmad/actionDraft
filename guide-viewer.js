const params = new URLSearchParams(window.location.search);
const mode = params.get("mode") || "edit";
const autoPrint = mode === "pdf";
let isEditing = mode === "edit";
const DEFAULT_GUIDE_TITLE = "User Guide: [Task Name]";
const STORAGE_KEYS = {
  STEPS: "steps",
  GUIDE_TITLE: "guideTitle"
};
let currentSteps = [];

const copyButton = document.getElementById("copyBtn");
const copyStatusEl = document.getElementById("copyStatus");
const downloadHtmlBtn = document.getElementById("downloadHtmlBtn");
const downloadConfluenceBtn = document.getElementById("downloadConfluenceBtn");
const editButton = document.getElementById("editToggle");
const stepsContainer = document.getElementById("guideSteps");
const guideTitleEl = document.querySelector(".page-header h1[data-editable='true']");
let copyStatusTimer;

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

  copyButton?.addEventListener("click", async () => {
    await copyGuide();
  });

  downloadHtmlBtn?.addEventListener("click", async () => {
    await downloadHtmlGuide();
  });

  downloadConfluenceBtn?.addEventListener("click", async () => {
    await downloadConfluencePackage();
  });

  editButton.addEventListener("click", async () => {
    if (isEditing) {
      await saveEdits();
    }

    isEditing = !isEditing;
    applyEditState();
  });

  window.addEventListener("beforeprint", () => {
    if (copyButton) {
      copyButton.style.display = "none";
    }
    if (downloadHtmlBtn) {
      downloadHtmlBtn.style.display = "none";
    }
    if (downloadConfluenceBtn) {
      downloadConfluenceBtn.style.display = "none";
    }
    editButton.style.display = "none";
  });

  window.addEventListener("afterprint", () => {
    if (copyButton) {
      copyButton.style.display = "";
    }
    if (downloadHtmlBtn) {
      downloadHtmlBtn.style.display = "";
    }
    if (downloadConfluenceBtn) {
      downloadConfluenceBtn.style.display = "";
    }
    editButton.style.display = "";
  });

  applyEditState();

  // Listen for storage changes to reflect deletions from popup
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") {
      return;
    }

    if (changes[STORAGE_KEYS.STEPS]) {
      const updatedSteps = Array.isArray(changes[STORAGE_KEYS.STEPS].newValue) 
        ? changes[STORAGE_KEYS.STEPS].newValue 
        : [];
      currentSteps = updatedSteps;
      renderSteps(updatedSteps);
      // Reapply edit state after rendering to maintain edit mode if active
      applyEditState();
    }

    if (changes[STORAGE_KEYS.GUIDE_TITLE]) {
      const updatedTitle = typeof changes[STORAGE_KEYS.GUIDE_TITLE].newValue === "string"
        ? changes[STORAGE_KEYS.GUIDE_TITLE].newValue.trim()
        : "";
      if (guideTitleEl) {
        guideTitleEl.textContent = updatedTitle || DEFAULT_GUIDE_TITLE;
      }
    }
  });

  if (autoPrint) {
    await waitForImagesToLoad();
    window.focus();
    window.print();
  }
}

function waitForImagesToLoad() {
  return new Promise((resolve) => {
    const images = Array.from(stepsContainer.querySelectorAll("img"));
    if (!images.length) {
      resolve();
      return;
    }

    let loadedCount = 0;
    const totalImages = images.length;

    images.forEach((img) => {
      if (img.complete && img.naturalHeight !== 0) {
        loadedCount++;
        if (loadedCount === totalImages) {
          resolve();
        }
      } else {
        img.addEventListener("load", () => {
          loadedCount++;
          if (loadedCount === totalImages) {
            resolve();
          }
        });
        img.addEventListener("error", () => {
          loadedCount++;
          if (loadedCount === totalImages) {
            resolve();
          }
        });
      }
    });
  });
}

function renderSteps(steps) {
  if (!steps.length) {
    stepsContainer.innerHTML = "<p>No steps captured yet.</p>";
    editButton.disabled = true;
    updateCopyAvailability();
    return;
  }

  editButton.disabled = false;
  stepsContainer.innerHTML = steps
    .map((step, index) => {
      const description = escapeHtml(step.description || `Step ${index + 1}`);
      const title = escapeHtml(step.title || `Step ${index + 1}`);
      const lazyAttr = autoPrint ? "" : "loading=\"lazy\"";
      return `
        <section class="step ${isEditing ? 'editing' : ''}" data-step-index="${index}">
          <h2 class="editable" data-editable="true">${title}</h2>
          <p class="editable step-description" data-editable="true">${description}</p>
          <div class="image-container">
            <img src="${step.image}" alt="Step ${index + 1}" ${lazyAttr} data-step-index="${index}" />
            <button class="change-image-btn" data-image-index="${index}" title="Change image">Change Image</button>
            <input type="file" class="image-file-input" data-file-index="${index}" accept="image/jpeg,image/jpg,image/png,image/gif,image/webp" />
          </div>
        </section>
      `;
    })
    .join("");

  attachImageChangeListeners();
  updateCopyAvailability();
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
  
  // Update step classes to show/hide change image buttons
  const stepElements = Array.from(stepsContainer.querySelectorAll('.step'));
  stepElements.forEach((step) => {
    if (isEditing) {
      step.classList.add('editing');
    } else {
      step.classList.remove('editing');
    }
  });
  
  editButton.textContent = isEditing ? "Done" : "Edit";
  updateCopyAvailability();
}

function attachImageChangeListeners() {
  const changeImageButtons = stepsContainer.querySelectorAll('.change-image-btn');
  const fileInputs = stepsContainer.querySelectorAll('.image-file-input');
  
  changeImageButtons.forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      const index = parseInt(btn.getAttribute('data-image-index'), 10);
      const fileInput = stepsContainer.querySelector(`.image-file-input[data-file-index="${index}"]`);
      
      if (fileInput && !isNaN(index)) {
        fileInput.click();
      }
    });
  });
  
  fileInputs.forEach((input) => {
    input.addEventListener('change', async (e) => {
      const index = parseInt(input.getAttribute('data-file-index'), 10);
      const file = e.target.files?.[0];
      
      if (file && !isNaN(index)) {
        await handleImageChange(index, file);
        // Reset input so the same file can be selected again
        input.value = '';
      }
    });
  });
}

async function handleImageChange(stepIndex, file) {
  // Validate file type
  const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
  if (!validTypes.includes(file.type)) {
    alert('Please select a valid image file (JPEG, PNG, GIF, or WebP).');
    return;
  }
  
  // Validate file size (max 10MB)
  const maxSize = 10 * 1024 * 1024; // 10MB
  if (file.size > maxSize) {
    alert('Image file is too large. Please select an image smaller than 10MB.');
    return;
  }
  
  try {
    // Disable the button while processing
    const changeBtn = stepsContainer.querySelector(`.change-image-btn[data-image-index="${stepIndex}"]`);
    if (changeBtn) {
      changeBtn.disabled = true;
      changeBtn.textContent = 'Loading...';
    }
    
    // Convert image to base64
    const base64Image = await fileToBase64(file);
    
    // Update the current step's image
    if (stepIndex >= 0 && stepIndex < currentSteps.length) {
      currentSteps[stepIndex].image = base64Image;
      
      // Update the image in the DOM
      const img = stepsContainer.querySelector(`img[data-step-index="${stepIndex}"]`);
      if (img) {
        img.src = base64Image;
      }
      
      // Save to storage
      await chrome.storage.local.set({
        [STORAGE_KEYS.STEPS]: currentSteps
      });
      
      // Show success feedback
      if (changeBtn) {
        changeBtn.textContent = 'Changed!';
        setTimeout(() => {
          changeBtn.textContent = 'Change Image';
          changeBtn.disabled = false;
        }, 1500);
      }
    }
  } catch (error) {
    console.error('Error changing image:', error);
    alert('Failed to change image. Please try again.');
    
    // Reset button state
    const changeBtn = stepsContainer.querySelector(`.change-image-btn[data-image-index="${stepIndex}"]`);
    if (changeBtn) {
      changeBtn.textContent = 'Change Image';
      changeBtn.disabled = false;
    }
  }
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = () => {
      resolve(reader.result);
    };
    
    reader.onerror = () => {
      reject(new Error('Failed to read file'));
    };
    
    reader.readAsDataURL(file);
  });
}

function updateCopyAvailability() {
  const hasSteps = currentSteps.length > 0;
  
  if (copyButton) {
    copyButton.disabled = isEditing || !hasSteps;
  }

  if (downloadHtmlBtn) {
    downloadHtmlBtn.disabled = isEditing || !hasSteps;
  }

  if (downloadConfluenceBtn) {
    downloadConfluenceBtn.disabled = isEditing || !hasSteps;
  }

  if (copyStatusEl && isEditing) {
    copyStatusEl.textContent = "Finish editing";
    return;
  }

  if (copyStatusEl && !copyStatusTimer) {
    copyStatusEl.textContent = "";
  }
}

async function copyGuide() {
  if (isEditing || !currentSteps.length) {
    updateCopyAvailability();
    return;
  }

  const html = buildClipboardHtml();
  const plainText = buildClipboardText();

  try {
    if (navigator.clipboard?.write && typeof ClipboardItem !== "undefined") {
      const clipboardItem = new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([plainText], { type: "text/plain" })
      });

      await navigator.clipboard.write([clipboardItem]);
    } else if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(plainText);
    } else {
      throw new Error("Clipboard API is unavailable");
    }

    setCopyStatus("Copied");
  } catch (error) {
    console.error("Unable to copy guide", error);
    setCopyStatus("Copy failed");
  }
}

async function downloadHtmlGuide() {
  if (isEditing || !currentSteps.length) {
    return;
  }

  const htmlContent = buildStandaloneHtml();
  const blob = new Blob([htmlContent], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  
  const title = (guideTitleEl?.textContent || DEFAULT_GUIDE_TITLE).trim() || DEFAULT_GUIDE_TITLE;
  const filename = `${sanitizeFilename(title)}.html`;
  
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);

  setCopyStatus("Downloaded");
}

async function downloadConfluencePackage() {
  if (isEditing || !currentSteps.length) {
    return;
  }

  if (typeof JSZip === 'undefined') {
    alert('JSZip library not loaded. Please refresh the page and try again.');
    return;
  }

  const title = (guideTitleEl?.textContent || DEFAULT_GUIDE_TITLE).trim() || DEFAULT_GUIDE_TITLE;
  const baseFilename = sanitizeFilename(title);

  setCopyStatus("Creating package...");

  try {
    const zip = new JSZip();
    
    // Add instruction HTML file
    const instructionHtml = buildConfluenceInstructionsHtml();
    zip.file("README.html", instructionHtml);
    
    // Create images folder
    const imagesFolder = zip.folder("images");
    
    // Add all images to the ZIP
    const steps = Array.from(stepsContainer.querySelectorAll(".step"));
    for (let i = 0; i < steps.length; i++) {
      const img = steps[i].querySelector("img");
      if (img && img.src) {
        const imageBlob = dataURLToBlob(img.src);
        // Detect file extension from MIME type
        const isJpeg = img.src.startsWith('data:image/jpeg');
        const extension = isJpeg ? 'jpg' : 'png';
        imagesFolder.file(`step_${i + 1}.${extension}`, imageBlob);
      }
    }
    
    // Generate ZIP file
    const zipBlob = await zip.generateAsync({ 
      type: "blob",
      compression: "DEFLATE",
      compressionOptions: { level: 6 }
    });
    
    // Download ZIP file
    downloadFile(zipBlob, `${baseFilename}_confluence_package.zip`);
    
    setCopyStatus("Package Downloaded");
    
  } catch (err) {
    console.error('Failed to create ZIP:', err);
    setCopyStatus("Download failed");
    alert('Failed to create package. Please try again.');
  }
}

function dataURLToBlob(dataUrl) {
  const parts = dataUrl.split(',');
  const mimeMatch = parts[0].match(/:(.*?);/);
  const mime = mimeMatch ? mimeMatch[1] : 'image/png';
  const bstr = atob(parts[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new Blob([u8arr], { type: mime });
}

function downloadFile(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
}

function buildConfluenceInstructionsHtml() {
  const title = escapeHtml((guideTitleEl?.textContent || DEFAULT_GUIDE_TITLE).trim() || DEFAULT_GUIDE_TITLE);
  const steps = Array.from(stepsContainer.querySelectorAll(".step"))
    .map((stepEl, index) => {
      const stepTitle = escapeHtml(stepEl.querySelector("h2")?.textContent?.trim() || `Step ${index + 1}`);
      const description = escapeHtml(stepEl.querySelector(".step-description")?.textContent?.trim() || "");
      const img = stepEl.querySelector("img");
      const isJpeg = img && img.src.startsWith('data:image/jpeg');
      const extension = isJpeg ? 'jpg' : 'png';
      const imageFilename = `step_${index + 1}.${extension}`;
      
      return `
<div style="margin-bottom: 24px; padding: 16px; background: #f8f9fa; border-left: 4px solid #3b82f6; border-radius: 4px;">
  <h3 style="margin: 0 0 8px; color: #1f2937;">${stepTitle}</h3>
  <p style="margin: 0 0 12px; color: #4b5563;">${description}</p>
  <p style="margin: 0; font-size: 13px; color: #6b7280; font-family: monospace;">
    <strong>Image:</strong> images/${imageFilename}
  </p>
</div>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Confluence Import Instructions - ${title}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      line-height: 1.6;
      color: #1f2937;
      background: #ffffff;
      max-width: 900px;
      margin: 0 auto;
      padding: 24px;
    }
    .header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 32px;
      border-radius: 12px;
      margin-bottom: 32px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.1);
    }
    .header h1 {
      margin: 0 0 12px;
      font-size: 28px;
    }
    .header p {
      margin: 0;
      opacity: 0.95;
      font-size: 15px;
    }
    .step-box {
      background: #f0f9ff;
      border: 2px solid #3b82f6;
      border-radius: 8px;
      padding: 20px;
      margin-bottom: 16px;
    }
    .step-box h2 {
      margin: 0 0 12px;
      color: #1e40af;
      font-size: 18px;
    }
    .step-box ol {
      margin: 8px 0;
      padding-left: 24px;
    }
    .step-box li {
      margin-bottom: 8px;
      color: #1f2937;
    }
    .step-box code {
      background: #e0e7ff;
      padding: 2px 6px;
      border-radius: 3px;
      font-size: 13px;
      color: #4338ca;
    }
    .info-box {
      background: #fef3c7;
      border-left: 4px solid #f59e0b;
      padding: 16px;
      border-radius: 4px;
      margin: 24px 0;
    }
    .info-box p {
      margin: 0;
      color: #92400e;
    }
    .success-box {
      background: #d1fae5;
      border-left: 4px solid #10b981;
      padding: 16px;
      border-radius: 4px;
      margin: 24px 0;
    }
    .success-box p {
      margin: 0;
      color: #065f46;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>📦 Confluence Package Downloaded</h1>
    <p>Your guide "${title}" has been packaged as a ZIP file. Extract it and follow the instructions below.</p>
  </div>

  <div class="info-box">
    <p><strong>📁 Package Contents:</strong></p>
    <ul style="margin: 8px 0; padding-left: 24px;">
      <li><code>README.html</code> - This instruction file</li>
      <li><code>images/</code> folder - Contains all step screenshots (step_1.jpg, step_2.jpg, etc.)</li>
    </ul>
  </div>

  <div class="step-box">
    <h2>📋 Method 1: Drag & Drop in Confluence (Easiest)</h2>
    <ol>
      <li>Extract the ZIP file to access the <code>images</code> folder</li>
      <li>In Confluence, create a new page or edit an existing one</li>
      <li>Type the title: <strong>${title}</strong></li>
      <li>Copy and paste each step's text (title and description) from below</li>
      <li>Drag the corresponding image from the <code>images</code> folder directly into Confluence</li>
      <li>Repeat for each step</li>
      <li>Click <code>Publish</code></li>
    </ol>
  </div>

  <div class="step-box">
    <h2>📸 Method 2: Bulk Upload Images</h2>
    <ol>
      <li>Extract the ZIP file</li>
      <li>Go to your Confluence page</li>
      <li>Click <code>...</code> (More actions) → <code>Attachments</code></li>
      <li>Upload all images from the <code>images</code> folder at once</li>
      <li>Edit the page and insert images: Type <code>/image</code> and select from attachments</li>
      <li>Add the text content for each step</li>
    </ol>
  </div>

  <div class="info-box">
    <p><strong>💡 Tip:</strong> All images are in the <code>images</code> folder with clear names: <code>step_1.jpg</code>, <code>step_2.jpg</code>, <code>step_3.jpg</code>, etc.</p>
  </div>

  <h2 style="margin: 32px 0 16px; color: #111827; font-size: 24px;">📝 Guide Content</h2>
  <p style="color: #6b7280; margin-bottom: 24px;">Copy the text below and paste into your Confluence page, then add the corresponding images.</p>

  <div style="background: #ffffff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 24px;">
    <h1 style="margin: 0 0 24px; color: #111827; font-size: 28px; border-bottom: 2px solid #e5e7eb; padding-bottom: 12px;">${title}</h1>
    ${steps}
  </div>

  <div class="success-box">
    <p><strong>✅ Ready to go!</strong> Your images are downloaded. Follow Method 1 or 2 above to add them to Confluence.</p>
  </div>

  <div style="margin-top: 40px; padding-top: 24px; border-top: 1px solid #e5e7eb; text-align: center; color: #9ca3af; font-size: 13px;">
    <p>Generated by ActionDraft • ${new Date().toLocaleDateString()}</p>
  </div>
</body>
</html>`;
}

function sanitizeFilename(name) {
  return name
    .replace(/[^a-z0-9]/gi, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .toLowerCase()
    .substring(0, 50) || 'guide';
}

function buildStandaloneHtml() {
  const title = escapeHtml((guideTitleEl?.textContent || DEFAULT_GUIDE_TITLE).trim() || DEFAULT_GUIDE_TITLE);
  const stepsHtml = Array.from(stepsContainer.querySelectorAll(".step"))
    .map((stepEl, index) => {
      const stepTitle = escapeHtml(stepEl.querySelector("h2")?.textContent?.trim() || `Step ${index + 1}`);
      const description = escapeHtml(stepEl.querySelector(".step-description")?.textContent?.trim() || "");
      const imageSrc = stepEl.querySelector("img")?.getAttribute("src") || "";
      const safeImageSrc = escapeAttribute(imageSrc);

      return `
    <div class="step">
      <h2>${stepTitle}</h2>
      <p>${description}</p>
      <img src="${safeImageSrc}" alt="${escapeAttribute(stepTitle)}" crossorigin="anonymous" />
    </div>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      line-height: 1.6;
      color: #1f2937;
      background: #ffffff;
      max-width: 980px;
      margin: 0 auto;
      padding: 24px;
    }
    .copy-banner {
      position: sticky;
      top: 0;
      background: #f0f9ff;
      border: 2px solid #3b82f6;
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 24px;
      z-index: 100;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }
    .copy-banner-text {
      font-size: 14px;
      color: #1e40af;
      line-height: 1.5;
    }
    .copy-banner-text strong {
      display: block;
      margin-bottom: 4px;
      font-size: 15px;
    }
    kbd {
      background: #e0e7ff;
      border: 1px solid #c7d2fe;
      border-radius: 3px;
      padding: 2px 6px;
      font-family: monospace;
      font-size: 13px;
      color: #4338ca;
    }
    h1 {
      font-size: 32px;
      font-weight: 700;
      color: #111827;
      margin: 0 0 24px 0;
      line-height: 1.2;
      border-bottom: 2px solid #e5e7eb;
      padding-bottom: 16px;
    }
    .step {
      margin-bottom: 32px;
      page-break-inside: avoid;
    }
    .step h2 {
      font-size: 22px;
      font-weight: 600;
      color: #111827;
      margin: 0 0 12px 0;
    }
    .step p {
      font-size: 15px;
      line-height: 1.6;
      color: #374151;
      margin: 0 0 16px 0;
      white-space: pre-wrap;
    }
    .step img {
      display: block;
      width: 100%;
      max-width: 100%;
      height: auto;
      border: 1px solid #d1d5db;
      border-radius: 8px;
      margin: 0;
    }
    @media print {
      .copy-banner { display: none !important; }
      body { padding: 16px; }
      .step { page-break-inside: avoid; }
    }
  </style>
</head>
<body>
  <div id="content">
    <h1>${title}</h1>
${stepsHtml}
  </script>
</body>
</html>`;
}

function buildClipboardHtml() {
  const safeTitle = escapeHtml((guideTitleEl?.textContent || DEFAULT_GUIDE_TITLE).trim() || DEFAULT_GUIDE_TITLE);
  const sections = Array.from(stepsContainer.querySelectorAll(".step"))
    .map((stepEl, index) => {
      const title = escapeHtml(stepEl.querySelector("h2")?.textContent?.trim() || `Step ${index + 1}`);
      const description = escapeHtml(stepEl.querySelector(".step-description")?.textContent?.trim() || "");
      const imageSrc = stepEl.querySelector("img")?.getAttribute("src") || "";
      const safeImageSrc = escapeAttribute(imageSrc);

      return `
        <div style="margin-bottom:24px;">
          <h2 style="margin:0 0 8px; font-size:20px; font-weight:600; color:#172b4d;">${title}</h2>
          <p style="margin:0 0 12px; font-size:14px; line-height:1.6; color:#42526e;">${description}</p>
          <p style="margin:0;"><img src="${safeImageSrc}" alt="${escapeAttribute(title)}" style="max-width:100%; height:auto; border:1px solid #ddd; border-radius:3px;" /></p>
        </div>
      `;
    })
    .join("");

  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif; color:#172b4d;">
      <h1 style="margin:0 0 20px; font-size:24px; font-weight:600; color:#172b4d; border-bottom:2px solid #dfe1e6; padding-bottom:12px;">${safeTitle}</h1>
      ${sections}
    </div>
  `.trim();
}

function buildClipboardText() {
  const title = (guideTitleEl?.textContent || DEFAULT_GUIDE_TITLE).trim() || DEFAULT_GUIDE_TITLE;
  const sections = Array.from(stepsContainer.querySelectorAll(".step"))
    .map((stepEl, index) => {
      const stepTitle = stepEl.querySelector("h2")?.textContent?.trim() || `Step ${index + 1}`;
      const description = stepEl.querySelector(".step-description")?.textContent?.trim() || "";

      return `${stepTitle}\n${description}`.trim();
    })
    .join("\n\n");

  return [title, sections].filter(Boolean).join("\n\n");
}

function setCopyStatus(message) {
  if (!copyStatusEl) {
    return;
  }

  copyStatusEl.textContent = message;
  window.clearTimeout(copyStatusTimer);
  copyStatusTimer = window.setTimeout(() => {
    copyStatusTimer = undefined;
    if (!isEditing) {
      copyStatusEl.textContent = "";
    }
  }, 2500);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
