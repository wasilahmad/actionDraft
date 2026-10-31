const STORAGE_KEYS = {
  IS_RECORDING: "isRecording",
  STEPS: "steps",
  GUIDE_TITLE: "guideTitle"
};

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.storage.local.set({
    [STORAGE_KEYS.IS_RECORDING]: false,
    [STORAGE_KEYS.STEPS]: [],
    [STORAGE_KEYS.GUIDE_TITLE]: ""
  });

  await configureSidePanelBehavior();
});

chrome.runtime.onStartup.addListener(async () => {
  await configureSidePanelBehavior();
});

// Inject content script into new tabs opened during recording
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // Only inject when page is loaded and recording is active
  if (changeInfo.status !== 'complete') return;
  
  try {
    const data = await chrome.storage.local.get([STORAGE_KEYS.IS_RECORDING]);
    if (!data[STORAGE_KEYS.IS_RECORDING]) return;

    // Skip restricted URLs
    if (!tab.url) return;
    if (tab.url.startsWith("chrome://") || 
        tab.url.startsWith("chrome-extension://") ||
        tab.url.startsWith("edge://") ||
        tab.url.startsWith("about:")) {
      return;
    }

    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: ["content.js"]
    });
  } catch (error) {
    // Silently ignore injection errors
    console.log(`Skipped injection for new tab ${tabId}:`, error.message);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // console.log("[ActionDraft BG] Message received:", message.type);
  if (!message || !message.type) {
    return;
  }

  if (message.type === "START_RECORDING") {
    // console.log("[ActionDraft BG] Starting recording");
    startRecordingFlow()
      .then(() => {
        // console.log("[ActionDraft BG] Recording started successfully");
        sendResponse({ ok: true });
      })
      .catch((error) => {
        console.error("[ActionDraft BG] Error starting recording:", error);
        sendResponse({ ok: false, error: error.message });
      });
    return true;
  }

  if (message.type === "STOP_RECORDING") {
    // console.log("[ActionDraft BG] Stopping recording");
    chrome.storage.local
      .set({ [STORAGE_KEYS.IS_RECORDING]: false })
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "CLEAR_SESSION") {
    // console.log("[ActionDraft BG] Clearing session");
    chrome.storage.local
      .set({ 
        [STORAGE_KEYS.IS_RECORDING]: false,
        [STORAGE_KEYS.STEPS]: [],
        [STORAGE_KEYS.GUIDE_TITLE]: ""
      })
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "GET_SESSION") {
    chrome.storage.local
      .get([STORAGE_KEYS.IS_RECORDING, STORAGE_KEYS.STEPS])
      .then((data) => {
        sendResponse({
          ok: true,
          isRecording: Boolean(data[STORAGE_KEYS.IS_RECORDING]),
          steps: Array.isArray(data[STORAGE_KEYS.STEPS]) ? data[STORAGE_KEYS.STEPS] : []
        });
      })
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "CAPTURE_STEP") {
    // console.log("[ActionDraft BG] Capturing step");
    captureAndAnnotate(sender, message.rect, message.clickX, message.clickY, message.dpr)
      .then((image) => {
        // console.log("[ActionDraft BG] Step captured, image length:", image?.length);
        sendResponse({ ok: true, image });
      })
      .catch((error) => {
        console.error("[ActionDraft BG] Error capturing step:", error);
        sendResponse({ ok: false, error: error.message });
      });
    return true;
  }
});

async function captureAndAnnotate(sender, rect, clickX, clickY, dpr = 1) {
  let tab = sender?.tab;
  if (!tab || typeof tab.windowId !== "number") {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    tab = tabs[0];
  }

  if (!tab || typeof tab.windowId !== "number") {
    throw new Error("Unable to identify tab window for screenshot capture.");
  }

  // 1. Take raw screenshot
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
    format: "png",
    quality: 100
  });

  // 2. If no rect was provided (shouldn't happen) return the raw screenshot
  if (!rect) return dataUrl;

  // 3. Decode PNG into an ImageBitmap via fetch → blob → createImageBitmap
  const blob = await (await fetch(dataUrl)).blob();
  const bitmap = await createImageBitmap(blob);

  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0);

  const PADDING = 25; // extra space around the element highlight for better visibility and click-dot room

  // Scale CSS-pixel rect/click coords to actual canvas pixel space (DPR aware)
  const x = (rect.left  - PADDING) * dpr;
  const y = (rect.top   - PADDING) * dpr;
  const w = (rect.width  + PADDING * 2) * dpr;
  const h = (rect.height + PADDING * 2) * dpr;
  const r = 6 * dpr; // border-radius

  // 4. Draw green highlight rectangle
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  // ctx.fillStyle = "rgba(0, 200, 83, 0.10)";
  // ctx.fill();
  ctx.strokeStyle = "#00C853";
  ctx.lineWidth = 3 * dpr;
  ctx.stroke();
  // Outer glow pass
  ctx.shadowColor = "rgba(0, 200, 83, 0.45)";
  ctx.shadowBlur = 10 * dpr;
  ctx.stroke();
  ctx.restore();

  // 5. Draw arrow cursor at the click point
  drawCursorOnCanvas(ctx, clickX * dpr, clickY * dpr, dpr);

  // 6. Re-encode to JPEG → base64 data URL (much better compression than PNG)
  const outBlob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.75 });
  const arrayBuffer = await outBlob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  
  // Convert bytes to base64 safely (process in chunks to avoid stack overflow)
  let binaryString = "";
  for (let i = 0; i < bytes.length; i++) {
    binaryString += String.fromCharCode(bytes[i]);
  }
  
  return "data:image/jpeg;base64," + btoa(binaryString);
}

function drawCursorOnCanvas(ctx, x, y, dpr) {
  const s = dpr * 1.4;
  ctx.save();
  ctx.translate(x, y);

  // Arrow body (white fill + dark outline)
  ctx.beginPath();
  ctx.moveTo(0,          0);
  ctx.lineTo(0,          14 * s);
  ctx.lineTo(3.5 * s,    10.5 * s);
  ctx.lineTo(6.5 * s,    16.5 * s);
  ctx.lineTo(9 * s,      15.2 * s);
  ctx.lineTo(6 * s,      9.5 * s);
  ctx.lineTo(11.5 * s,   9.5 * s);
  ctx.closePath();
  ctx.fillStyle = "white";
  ctx.fill();
  ctx.strokeStyle = "#222222";
  ctx.lineWidth = 1.2 * s;
  ctx.lineJoin = "round";
  ctx.stroke();

  // Green click-dot
  ctx.beginPath();
  ctx.arc(6.5 * s, 16.5 * s, 3.2 * s, 0, Math.PI * 2);
  ctx.fillStyle = "#00C853";
  ctx.globalAlpha = 0.85;
  ctx.fill();

  ctx.restore();
}

async function configureSidePanelBehavior() {
  if (!chrome.sidePanel?.setPanelBehavior) {
    return;
  }

  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch (error) {
    console.warn("Side panel behavior setup failed:", error);
  }
}

async function startRecordingFlow() {
  // Get existing steps to preserve them when resuming
  const data = await chrome.storage.local.get([STORAGE_KEYS.STEPS, STORAGE_KEYS.GUIDE_TITLE]);
  const existingSteps = Array.isArray(data[STORAGE_KEYS.STEPS]) ? data[STORAGE_KEYS.STEPS] : [];
  const existingTitle = data[STORAGE_KEYS.GUIDE_TITLE] || "";
  
  // Only set recording to true, preserve existing steps for resume functionality
  await chrome.storage.local.set({
    [STORAGE_KEYS.IS_RECORDING]: true,
    [STORAGE_KEYS.STEPS]: existingSteps,
    [STORAGE_KEYS.GUIDE_TITLE]: existingTitle
  });

  if (!chrome.scripting?.executeScript) {
    return;
  }

  // Inject content script into ALL open tabs to enable cross-tab recording
  try {
    const allTabs = await chrome.tabs.query({});
    
    for (const tab of allTabs) {
      // Skip chrome:// and other restricted URLs
      if (!tab.id || !tab.url) continue;
      if (tab.url.startsWith("chrome://") || 
          tab.url.startsWith("chrome-extension://") ||
          tab.url.startsWith("edge://") ||
          tab.url.startsWith("about:")) {
        continue;
      }

      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ["content.js"]
        });
      } catch (error) {
        // Silently skip tabs that can't be injected (e.g., chrome web store)
        console.log(`Skipped injection for tab ${tab.id}:`, error.message);
      }
    }
  } catch (error) {
    console.warn("Runtime content script injection skipped:", error);
  }
}
