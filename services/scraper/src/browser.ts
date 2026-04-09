import { Browser, chromium } from 'playwright';
import logger from './logger';

let browser: Browser | null = null;

export async function getBrowser(): Promise<Browser> {
  if (!browser) {
    logger.info('Launching Playwright Chromium browser');
    browser = await chromium.launch({ headless: true });
  }
  return browser;
}

export async function closeBrowser(): Promise<void> {
  if (browser) {
    logger.info('Closing Playwright browser');
    await browser.close();
    browser = null;
  }
}
