if (!window.__actionDraftRecorderLoaded) {
  window.__actionDraftRecorderLoaded = true;
  // console.log("[ActionDraft] Content script initialized");

  let isRecording = false;
  let lastCaptureTime = 0;
  const CAPTURE_DEBOUNCE_MS = 300; // Throttle rapid clicks to prevent lag

  safeStorageGet(["isRecording"]).then((data) => {
    isRecording = Boolean(data.isRecording);
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

        await safeStorageSet({ steps });
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
    return "Open the quantity selector";
  }

  if (/^\d+$/.test(name) && /(qty|quantity)/i.test(`${normalizedContext} ${element.parentElement?.textContent || ""}`)) {
    return `Select quantity ${name}`;
  }

  if (role === "button") {
    if (/add to cart|buy now|checkout|continue|submit|place order/i.test(normalizedName)) {
      return `Click ${name}`;
    }

    if (/close|dismiss|remove|delete|cancel/i.test(normalizedName)) {
      return `Use ${name} to dismiss this step`;
    }

    return `Select ${name}`;
  }

  if (role === "link") {
    return `Open ${name}`;
  }

  if (role === "tab") {
    return `Switch to the ${name} tab`;
  }

  if (role === "dropdown") {
    return `Open the ${name} dropdown`;
  }

  if (role === "menu item") {
    return `Choose ${name}`;
  }

  if (role === "checkbox") {
    return `Select the ${name} checkbox`;
  }

  if (role === "radio button") {
    return `Choose ${name}`;
  }

  if (role === "text field" || role === "search field" || role === "text area") {
    return `Place the cursor in ${name}`;
  }

  if (/^\d+$/.test(name)) {
    return `Choose ${name}`;
  }

  if (nearbyContext && !normalizedName.includes(normalizedContext)) {
    return `Select ${name} under ${nearbyContext}`;
  }

  return `Select ${name}`;
}

function describeElement(element) {
  const name = cleanLabel(getAccessibleName(element));
  const role = getRoleLabel(element);

  if (name) {
    return toSentenceCase(inferIntent(element, name, role));
  }

  if (role === "button") {
    return "Click the highlighted button";
  }

  if (role === "link") {
    return "Open the highlighted link";
  }

  if (role === "tab") {
    return "Switch to the highlighted tab";
  }

  const safeRole = typeof role === "string" && role.trim() ? role : "element";
  return "Use the highlighted " + safeRole;
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
