# ActionDraft - Privacy & Security Policy

## Data Storage & Privacy

### Local-Only Storage
- **All recorded steps are stored locally** in your browser's `chrome.storage.local` API
- **No data is sent to Google servers or any third-party services**
- **No account sync**: Data remains only on your device
- **No cloud backup**: Records are local to your device

### What Is Collected
- Step descriptions (action text, e.g., "Click on Add to Cart button")
- Screenshots of clicked elements with visual highlights
- Click timestamp (UTC milliseconds)

### What Is NOT Collected
- Website URLs or page addresses (removed for security)
- Sensitive credentials, passwords, or authentication tokens
- Personal user data or account information
- Cookies or browsing history
- Telemetry or usage analytics

### Data Retention
- Records persist in `chrome.storage.local` until:
  - User manually clears them via "Stop Recording" → export/delete workflow
  - Browser cache/storage is cleared
  - Extension is uninstalled
- **Records can be deleted at any time** by stopping recording or clearing your browser data

## Security Practices

### Screenshot Privacy
- Screenshots are taken only of visible page content
- No URL bar, address bar, or sensitive browser UI is included
- Clicked elements are highlighted with a green border for reference
- Images are stored as base64 PNG data locally

### Content Security Policy (CSP)
- Extension enforces `script-src 'self'` to prevent malicious script injection
- No inline scripts; all code is isolated and vetted
- Extension scripts run only with explicit user interaction

### No External Requests
- **No data leaves your device**: All processing happens locally
- No analytics, crash reporting, or telemetry
- No third-party APIs or service calls
- All libraries and code are bundled locally

### Salesforce Commerce Cloud Safety
- Designed for SFCC/storefront recording without data export
- Sensitive business data remains on your device
- Suitable for internal training and documentation
- No data sharing with Salesforce or other services

## Permissions

### Required Permissions
- `activeTab`: Allows recording clicks on the active browser tab
- `storage`: Stores captured steps locally in browser storage
- `sidePanel`: Opens the extension as a side drawer for easy access
- `scripting`: Injects recording script into active page
- `<all_urls>`: Enables recording across all websites (data never leaves your device)

### Why These Permissions Are Needed
- Safe, sandboxed operation within browser security model
- No special privileged access to your system
- All data operations are isolated to extension storage

## Performance

### Optimizations
- **Click debouncing** (300ms): Prevents lag from rapid-fire clicks
- **Lazy image loading**: Side panel loads images on-demand for smooth scrolling
- **Optimized encoding**: PNG compression balances quality and file size
- **Local processing**: All computations happen on your machine—zero network latency

### Resource Usage
- Minimal CPU impact during recording
- Efficient memory usage with image lazy-loading
- Screenshot operations are hardware-accelerated where available
- No background processes run when not recording

## Data Export

### When You Export
- **HTML Guide**: Contains screenshots + descriptions; stored locally
- **PDF Output**: Generated locally, never uploaded or sent anywhere
- **Download Flow**: You control where files are saved on your device

### Exported Files
- Self-contained: All data embedded as base64 images
- No external dependencies or remote resources
- Fully portable—can be shared securely via your own channels

## Compliance

- **No PII Collection**: No personal identifying information is gathered
- **GDPR Ready**: No cross-border data transfer; local-only storage
- **CCPA Compliant**: No data sales or third-party sharing
- **No Cookies**: Extension doesn't use cookies or tracking

## Questions?

For security concerns or clarifications, review the source code in the extension directory. All code is transparent and auditable.

---

**Last Updated**: April 2026  
**Extension Version**: 1.0+
