if (!window.__actionDraftRecorderLoaded) {
  window.__actionDraftRecorderLoaded = true;
  // console.log("[ActionDraft] Content script initialized");

  let isRecording = false;
  let lastCaptureTime = 0;
  const CAPTURE_DEBOUNCE_MS = 300; // Throttle rapid clicks to prevent lag
  const CURSOR_BOX_ID = "actiondraft-recording-cursor-box";
  let cursorIndicator = null;

  safeStorageGet(["isRecording"]).then((data) => {
    isRecording = Boolean(data.isRecording);
    updateCursorIndicatorVisibility();
    // console.log("[ActionDraft] Initial isRecording state:", isRecording);
  });

  if (hasExtensionContext() && chrome?.storage?.onChanged?.addListener) {
    try {
      chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== "local") {
          return;
        }

        if (changes.isRecording) {
          isRecording = Boolean(changes.isRecording.newValue);
          updateCursorIndicatorVisibility();
          // console.log("[ActionDraft] isRecording changed to:", isRecording);
        }
      });
    } catch (error) {
      // Ignore extension reload/context invalidation during listener registration.
    }
  }

  document.addEventListener(
    "click",
    async (event) => {
      // console.log("[ActionDraft] Click detected, isRecording:", isRecording);
      if (!isRecording) {
        return;
      }

      const now = Date.now();
      if (now - lastCaptureTime < CAPTURE_DEBOUNCE_MS) {
        // console.log("[ActionDraft] Click debounced");
        return; // Debounce: ignore rapid-fire clicks
      }
      lastCaptureTime = now;

      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }

      try {
        const description = describeElement(target);
        // console.log("[ActionDraft] Captured step:", description);

        // Send rect + click coords so background.js can annotate the PNG directly.
        // No DOM overlay or delays — avoids MV3 message-channel timeout issues.
        const domRect = target.getBoundingClientRect();
        const response = await sendMessage({
          type: "CAPTURE_STEP",
          rect: {
            top:    domRect.top,
            left:   domRect.left,
            width:  domRect.width,
            height: domRect.height
          },
          clickX: event.clientX,
          clickY: event.clientY,
          dpr:    window.devicePixelRatio || 1
        });

        // console.log("[ActionDraft] CAPTURE_STEP response:", response);
        if (!response?.ok || !response.image) {
          // console.log("[ActionDraft] Capture failed:", response);
          return;
        }

        const data = await safeStorageGet(["steps"]);
        const steps = Array.isArray(data.steps) ? data.steps : [];
        
        steps.push({
          description,
          image: response.image,
          timestamp: Date.now()
        });

        const saved = await safeStorageSet({ steps });
        
        // Only alert if the save actually failed
        if (!saved) {
          // Remove the step we just added since save failed
          steps.pop();
          alert("⚠️ Storage Limit Reached!\n\nCannot save more steps - browser storage is full.\n\nPlease:\n• Click 'Stop' to end recording\n• Export your current guide (" + steps.length + " steps)\n• Delete unnecessary steps to free up space\n\nTip: Export to PDF or Confluence to preserve your work!");
          // Auto-stop recording when storage is actually full
          await safeStorageSet({ isRecording: false });
          return;
        }
      } catch (error) {
        const message = String(error?.message || error || "");
        if (!message.includes("Extension context invalidated")) {
          console.warn("ActionDraft capture skipped:", error);
        }
      }
      // console.log("[ActionDraft] Step stored, total steps:", steps.length);
    },
    true
  );

  document.addEventListener(
    "mousemove",
    (event) => {
      if (!isRecording) {
        return;
      }

      ensureCursorIndicator();
      cursorIndicator.style.left = `${event.clientX}px`;
      cursorIndicator.style.top = `${event.clientY}px`;
      cursorIndicator.style.opacity = "1";
    },
    true
  );

  document.addEventListener(
    "mouseleave",
    () => {
      if (cursorIndicator) {
        cursorIndicator.style.opacity = "0";
      }
    },
    true
  );

  ensureCursorIndicator();
  updateCursorIndicatorVisibility();

  function ensureCursorIndicator() {
    if (cursorIndicator?.isConnected) {
      return cursorIndicator;
    }

    cursorIndicator = document.getElementById(CURSOR_BOX_ID);
    if (cursorIndicator) {
      return cursorIndicator;
    }

    cursorIndicator = document.createElement("div");
    cursorIndicator.id = CURSOR_BOX_ID;
    cursorIndicator.setAttribute("aria-hidden", "true");
    Object.assign(cursorIndicator.style, {
      position: "fixed",
      left: "0px",
      top: "0px",
      width: "15px",
      height: "15px",
      transform: "translate(-50%, -50%)",
      border: "2px solid #00c853",
      borderRadius: "100%",
      boxShadow: "0 0 0 2px rgba(0, 200, 83, 0.22)",
      background: "rgba(0, 200, 83, 0.06)",
      pointerEvents: "none",
      zIndex: "2147483647",
      opacity: "0",
      transition: "opacity 0.15s ease-out",
      display: "none"
    });

    (document.documentElement || document.body || document).appendChild(cursorIndicator);
    return cursorIndicator;
  }

  function updateCursorIndicatorVisibility() {
    ensureCursorIndicator();
    cursorIndicator.style.display = isRecording ? "block" : "none";
    if (!isRecording) {
      cursorIndicator.style.opacity = "0";
    }
  }
} // End of guard block: if (!window.__actionDraftRecorderLoaded)

// ---------------------------------------------------------------------------
// Accessible-name helpers
// ---------------------------------------------------------------------------

function getAccessibleName(element) {
  // 1. aria-labelledby (may reference multiple IDs)
  const labelledById = element.getAttribute("aria-labelledby");
  if (labelledById) {
    const name = labelledById
      .split(" ")
      .map((id) => document.getElementById(id)?.textContent?.trim())
      .filter(Boolean)
      .join(" ");
    if (name) return name;
  }

  // 2. aria-label
  const ariaLabel = element.getAttribute("aria-label")?.trim();
  if (ariaLabel) return ariaLabel;

  // 3. <label for="id"> associated with the element
  if (element.id) {
    const associated = document.querySelector(`label[for="${CSS.escape(element.id)}"]`);
    const labelText = associated?.textContent?.trim();
    if (labelText) return labelText;
  }

  // 4. Wrapping <label>
  const parentLabel = element.closest("label");
  if (parentLabel) {
    const clone = parentLabel.cloneNode(true);
    clone.querySelectorAll("input,select,textarea,button").forEach((el) => el.remove());
    const parentText = clone.textContent.trim();
    if (parentText) return parentText;
  }

  // 5. title attribute
  const title = element.getAttribute("title")?.trim();
  if (title) return title;

  // 6. alt for images
  if (element.tagName === "IMG") {
    const alt = element.getAttribute("alt")?.trim();
    if (alt) return alt;
  }

  // 7. value / placeholder for inputs
  if (element.tagName === "INPUT") {
    const val = (element.value || element.getAttribute("placeholder") || "").trim();
    if (val) return val.slice(0, 60);
  }

  // 8. Visible inner text (skip empty/whitespace-only)
  const innerText = (element.innerText || element.textContent || "").trim().replace(/\s+/g, " ");
  if (innerText) return innerText.slice(0, 60);

  // 9. Scan first meaningful descendant for text/alt/aria-label
  for (const child of element.querySelectorAll("img[alt],[aria-label],span,p,strong,em")) {
    const childName = (
      child.getAttribute("alt") ||
      child.getAttribute("aria-label") ||
      child.textContent?.trim()
    )?.trim();
    if (childName) return childName.slice(0, 60);
  }

  return null;
}

function getRoleLabel(element) {
  const tag = element.tagName.toLowerCase();
  const type = (element.getAttribute("type") || "").toLowerCase();
  const role = (element.getAttribute("role") || "").toLowerCase();

  if (role === "button" || tag === "button" || (tag === "input" && ["button", "submit", "reset"].includes(type))) {
    return "button";
  }
  if (role === "link" || tag === "a") return "link";
  if (role === "tab") return "tab";
  if (role === "menuitem" || role === "option") return "menu item";
  if (role === "checkbox" || (tag === "input" && type === "checkbox")) return "checkbox";
  if (role === "radio" || (tag === "input" && type === "radio")) return "radio button";
  if (tag === "select") return "dropdown";
  if (tag === "textarea") return "text area";
  if (tag === "input" && type === "search") return "search field";
  if (tag === "input") return "text field";
  if (tag === "img") return "image";
  if (tag === "li") return "list item";
  return tag;
}

function cleanLabel(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/^[\s:|\-]+|[\s:|\-]+$/g, "")
    .trim();
}

function toSentenceCase(value) {
  if (!value) {
    return "";
  }

  return value.charAt(0).toUpperCase() + value.slice(1);
}

function getNearbyContext(element) {
  const candidateSelectors = [
    "label",
    "legend",
    "th",
    "h1",
    "h2",
    "h3",
    "h4",
    "[data-testid]",
    "[aria-label]"
  ];

  let current = element.parentElement;
  for (let depth = 0; current && depth < 3; depth += 1, current = current.parentElement) {
    for (const selector of candidateSelectors) {
      const candidate = current.querySelector(selector);
      if (!candidate || candidate === element || candidate.contains(element)) {
        continue;
      }

      const text = cleanLabel(candidate.textContent || candidate.getAttribute("aria-label") || candidate.getAttribute("data-testid"));
      if (text && text.length <= 60) {
        return text;
      }
    }
  }

  return "";
}

function inferIntent(element, name, role) {
  const normalizedName = cleanLabel(name).toLowerCase();
  const nearbyContext = getNearbyContext(element);
  const normalizedContext = nearbyContext.toLowerCase();

  if (/^qty\s*:?\s*\d+$/i.test(name) || /^quantity\s*:?\s*\d+$/i.test(name)) {
    return "Select the desired quantity";
  }

  if (/^\d+$/.test(name) && /(qty|quantity)/i.test(`${normalizedContext} ${element.parentElement?.textContent || ""}`)) {
    return `Select quantity ${name}`;
  }

  if (role === "button") {
    if (/add to cart|buy now|purchase/i.test(normalizedName)) {
      return `Click the "${name}" button to add the item`;
    }

    if (/checkout|continue|proceed/i.test(normalizedName)) {
      return `Click the "${name}" button to continue`;
    }

    if (/submit|place order/i.test(normalizedName)) {
      return `Click the "${name}" button to submit`;
    }

    if (/close|dismiss|cancel|exit/i.test(normalizedName)) {
      return `Click the "${name}" button to close`;
    }

    if (/remove|delete/i.test(normalizedName)) {
      return `Click the "${name}" button to remove the item`;
    }

    if (/save|apply|confirm|ok/i.test(normalizedName)) {
      return `Click the "${name}" button to save changes`;
    }

    if (/^(search|find|go)$/i.test(normalizedName)) {
      return `Click the "${name}" button`;
    }

    return `Click on the "${name}" button`;
  }

  if (role === "link") {
    return `Click on the "${name}" link`;
  }

  if (role === "tab") {
    return `Switch to the "${name}" tab`;
  }

  if (role === "dropdown") {
    return `Open the "${name}" dropdown menu`;
  }

  if (role === "menu item") {
    return `Select the "${name}" option`;
  }

  if (role === "checkbox") {
    return `Check the "${name}" checkbox`;
  }

  if (role === "radio button") {
    return `Select the "${name}" radio option`;
  }

  if (role === "text field" || role === "search field") {
    return `Enter text in the "${name}" field`;
  }

  if (role === "text area") {
    return `Enter text in the "${name}" text area`;
  }

  if (/^\d+$/.test(name)) {
    return `Select the "${name}" option`;
  }

  if (nearbyContext && !normalizedName.includes(normalizedContext)) {
    return `Select "${name}" under ${nearbyContext}`;
  }

  return `Click on the "${name}" element`;
}

function describeElement(element) {
  const name = cleanLabel(getAccessibleName(element));
  const role = getRoleLabel(element);

  if (name) {
    return toSentenceCase(inferIntent(element, name, role));
  }

  // Special handling for SVG icons
  if (element.tagName.toLowerCase() === 'svg' || element.closest('svg')) {
    const svgParent = element.tagName.toLowerCase() === 'svg' ? element : element.closest('svg');
    const parentButton = svgParent?.closest('button, a, [role="button"], [onclick]');
    
    if (parentButton) {
      const parentName = cleanLabel(getAccessibleName(parentButton));
      if (parentName) {
        return toSentenceCase(inferIntent(parentButton, parentName, 'button'));
      }
      return "Click on the icon button";
    }
    
    return "Click on the displayed icon";
  }

  // Handle icon fonts (Font Awesome, Material Icons, etc.)
  if (element.classList.contains('icon') || 
      element.classList.contains('fa') || 
      element.classList.contains('material-icons') ||
      /icon|glyph|symbol/.test(element.className)) {
    const iconParent = element.closest('button, a, [role="button"], [onclick]');
    if (iconParent) {
      const parentName = cleanLabel(getAccessibleName(iconParent));
      if (parentName) {
        return toSentenceCase(inferIntent(iconParent, parentName, 'button'));
      }
    }
    return "Click on the icon button";
  }

  // Try to get context from immediate parent
  const parent = element.parentElement;
  if (parent) {
    const parentName = cleanLabel(getAccessibleName(parent));
    if (parentName) {
      const parentRole = getRoleLabel(parent);
      return toSentenceCase(inferIntent(parent, parentName, parentRole));
    }
  }

  // Role-specific descriptions with complete sentences
  if (role === "button") {
    return "Click on the selected button";
  }

  if (role === "link") {
    return "Click on the link";
  }

  if (role === "tab") {
    return "Switch to the tab";
  }

  if (role === "checkbox") {
    return "Toggle the checkbox";
  }

  if (role === "radio button") {
    return "Select the radio option";
  }

  if (role === "dropdown" || role === "select") {
    return "Open the dropdown menu";
  }

  if (role === "image") {
    return "Click on the image";
  }

  if (role === "text field" || role === "search field") {
    return "Click in the input field";
  }

  if (role === "text area") {
    return "Click in the text area";
  }

  // More generic but contextual fallback
  if (element.onclick || element.getAttribute('onclick')) {
    return "Click on the selected element";
  }

  // Last resort - use role but with complete sentence
  const safeRole = typeof role === "string" && role.trim() ? role : "element";
  return `Click on the ${safeRole}`;
}

// DOM overlay removed — highlight + cursor are now drawn directly onto the
// captured PNG inside the service worker (background.js) using OffscreenCanvas.

function hasExtensionContext() {
  return Boolean(chrome?.runtime?.id);
}

async function safeStorageGet(keys) {
  if (!hasExtensionContext() || !chrome?.storage?.local?.get) {
    return {};
  }

  try {
    return await chrome.storage.local.get(keys);
  } catch (error) {
    return {};
  }
}

async function safeStorageSet(value) {
  if (!hasExtensionContext() || !chrome?.storage?.local?.set) {
    return false;
  }

  try {
    await chrome.storage.local.set(value);
    return true;
  } catch (error) {
    // Check if it's a quota exceeded error
    const errorMessage = String(error?.message || error || '').toLowerCase();
    if (errorMessage.includes('quota') || errorMessage.includes('storage')) {
      // Log current storage usage for debugging
      try {
        const bytesInUse = await chrome.storage.local.getBytesInUse(null);
        const mbInUse = (bytesInUse / (1024 * 1024)).toFixed(2);
        console.error(`Storage quota exceeded: ${mbInUse} MB in use. Error:`, error);
      } catch (e) {
        console.error('Storage quota exceeded:', error);
      }
    }
    return false;
  }
}

function sendMessage(message) {
  return new Promise((resolve) => {
    if (!hasExtensionContext()) {
      resolve({ ok: false, error: "Extension context invalidated" });
      return;
    }

    try {
      chrome.runtime.sendMessage(message, (response) => {
        try {
          const runtimeError = chrome?.runtime?.lastError;
          if (runtimeError) {
            resolve({ ok: false, error: runtimeError.message });
            return;
          }

          resolve(response || { ok: false });
        } catch (error) {
          resolve({ ok: false, error: String(error?.message || error) });
        }
      });
    } catch (error) {
      resolve({ ok: false, error: String(error?.message || error) });
    }
  });
}
