import { defineConfig } from 'vite';

// base './' so the same build works on Firebase Hosting, as a PWA and inside a Chrome extension popup.
export default defineConfig({ base: './' });
