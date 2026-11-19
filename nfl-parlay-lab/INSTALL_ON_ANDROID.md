# Install NFL Parlay Lab on Android

This Next.js app includes a web app manifest, app icon, and standalone display settings for Android home-screen installation.

## Prerequisite: persistent hosting
A Codespaces forwarded-port URL is temporary. Deploy the **server-side Next.js app** to a stable HTTPS host that supports Node.js and persistent storage as required by the existing app. Keep the FanDuel API key in server-side environment variables only. Never embed the key in the PWA or client bundle.

## Install
1. Open the deployed HTTPS URL in Chrome on your Samsung phone.
2. Open Chrome's menu and select **Install app** (or **Add to Home screen**, depending on Chrome's installability assessment).
3. Launch **NFL Parlay Lab** from the home screen.

## Verification
- Check that `/manifest.webmanifest` responds and the browser loads `/icon.svg`.
- Verify standalone launch, mobile layouts, API calls, and app refresh on Android.
- Check that app installation is actually offered in Chrome; SVG icons may not meet every browser's install-prompt requirements. If not, add 192x192 and 512x512 PNG icons and reference them in the manifest.
- Do not cache betting odds, API responses, or authenticated pages offline; odds and injuries require current network data.
- Do not claim the app is deployed or installable until verified on the real HTTPS deployment.
