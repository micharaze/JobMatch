import * as cheerio from 'cheerio';

/**
 * Converts raw HTML to clean plain text suitable for skill extraction.
 *
 * - Removes <script>, <style>, and their content
 * - Converts <li> elements to "- " bullet lines
 * - Preserves paragraph/block breaks as \n\n
 * - Strips all remaining HTML tags
 * - Collapses excessive whitespace
 */
export function cleanHtml(html: string): string {
  if (!html.trim()) return '';

  const $ = cheerio.load(html);

  // Remove scripts and styles entirely
  $('script, style, noscript').remove();

  // Convert list items to "- " bullets before stripping tags
  $('li').each((_i, el) => {
    const text = $(el).text().trim();
    $(el).replaceWith(`\n- ${text}`);
  });

  // Convert block elements to paragraph breaks
  $('p, div, br, h1, h2, h3, h4, h5, h6, section, article').each((_i, el) => {
    const inner = $(el).html() ?? '';
    $(el).replaceWith(`\n\n${inner}\n\n`);
  });

  // Extract text (strips remaining tags)
  let text = $.root().text();

  // Normalize line endings and collapse excess blank lines
  text = text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')           // collapse horizontal whitespace
    .replace(/\n[ \t]+/g, '\n')        // remove leading spaces on lines
    .replace(/[ \t]+\n/g, '\n')        // remove trailing spaces on lines
    .replace(/\n{3,}/g, '\n\n')        // at most two consecutive newlines
    .trim();

  return text;
}
