/* ---------------------------------------------------------------------------
   Awards & Engraving — transactional email templates.

   One shell, used by both the internal notification and the visitor receipt.
   Table-based and inline-styled on purpose: Outlook strips flex, grid and most
   <style> blocks, and Gmail's clipping favours small documents. No web fonts,
   no background images, nothing that breaks when images are blocked.

   Palette is taken from the site's own CSS so the email matches the site.
--------------------------------------------------------------------------- */

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

const BRAND = {
    "name": "Awards & Engraving",
    "site": "awardsandengraving.com",
    "wordmark": "AWARDS &amp; ENGRAVING",
    "wordmarkTracking": ".11em",
    "headerBg": "#132038",
    "headerInk": "#F0E7D3",
    "headerSub": "#D3B878",
    "accent": "#D3B878",
    "linkOnLight": "#8A6D2F",
    "page": "#F0E7D3",
    "card": "#FFFFFF",
    "tint": "#FAF6EC",
    "ink": "#1A2740",
    "body": "#4A5468",
    "muted": "#8A8578",
    "btnBg": "#132038",
    "btnInk": "#F0E7D3",
    "footerBg": "#E9DCC0",
    "footerInk": "#6B6555",
    "footerLink": "#8A6D2F",
    "radius": 10,
    "btnRadius": 8,
    "footer": [
      "333 N Milwaukee Ave, Libertyville, IL 60048",
      "Mon&ndash;Fri 11am&ndash;5pm &middot; Sat &amp; Sun by appointment"
    ]
  };

function escapeEmail(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* Hidden line the inbox shows next to the subject. */
function preheader(text) {
  return '<div style="display:none;font-size:1px;color:' + BRAND.card + ';line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">' + escapeEmail(text) +
    '</div><div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">' +
    '&#8199;&#65279;&#847;'.repeat(8) + '</div>';
}

/* Stacked label/value rows — a two-column table would crush the value column
   on a phone, and these are read on phones more often than not. */
function detailRows(rows) {
  return rows
    .filter((r) => r && r[1])
    .map((r) => {
      const [label, value, href] = r
      const shown = href
        ? '<a href="' + href + '" style="color:' + BRAND.linkOnLight + ';text-decoration:none;font-weight:600;">' + escapeEmail(value) + '</a>'
        : escapeEmail(value)
      return '<tr><td style="padding:0 0 12px;">' +
        '<div style="font-family:' + FONT + ';font-size:11px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:' + BRAND.muted + ';padding-bottom:3px;">' + escapeEmail(label) + '</div>' +
        '<div style="font-family:' + FONT + ';font-size:15px;line-height:1.55;color:' + BRAND.ink + ';">' + shown + '</div>' +
        '</td></tr>'
    })
    .join('');
}

/* The visitor's own words, set apart. */
function quoteBlock(label, bodyText) {
  if (!bodyText) return '';
  return '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;margin:4px 0 26px;">' +
    '<tr><td bgcolor="' + BRAND.tint + '" style="background-color:' + BRAND.tint + ';border-left:3px solid ' + BRAND.accent + ';border-radius:0 8px 8px 0;padding:16px 20px;">' +
    '<div style="font-family:' + FONT + ';font-size:11px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:' + BRAND.muted + ';padding-bottom:6px;">' + escapeEmail(label) + '</div>' +
    '<div style="font-family:' + FONT + ';font-size:15px;line-height:1.65;color:' + BRAND.ink + ';white-space:pre-wrap;">' + escapeEmail(bodyText) + '</div>' +
    '</td></tr></table>';
}

/* Padded anchor inside a table cell — the shape that survives Outlook. */
function button(label, href) {
  if (!href) return '';
  return '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;margin:0 0 4px;">' +
    '<tr><td align="center" bgcolor="' + BRAND.btnBg + '" style="background-color:' + BRAND.btnBg + ';border-radius:' + BRAND.btnRadius + 'px;">' +
    '<a href="' + href + '" style="display:inline-block;padding:14px 30px;font-family:' + FONT + ';font-size:15px;font-weight:700;line-height:1;color:' + BRAND.btnInk + ';text-decoration:none;border-radius:' + BRAND.btnRadius + 'px;">' + escapeEmail(label) + '</a>' +
    '</td></tr></table>';
}

function emailShell(parts) {
  const { preview, eyebrow, heading, intro, body = '', cta, outro } = parts;
  return '<!doctype html><html lang="en"><head>' +
    '<meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="x-apple-disable-message-reformatting">' +
    '<meta name="color-scheme" content="light">' +
    '<meta name="supported-color-schemes" content="light">' +
    '<title>' + escapeEmail(heading) + '</title>' +
    '</head><body style="margin:0;padding:0;background-color:' + BRAND.page + ';">' +
    preheader(preview) +
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="' + BRAND.page + '" style="background-color:' + BRAND.page + ';border-collapse:collapse;">' +
    '<tr><td align="center" style="padding:28px 12px 40px;">' +
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:100%;max-width:600px;border-collapse:collapse;">' +

    '<tr><td bgcolor="' + BRAND.headerBg + '" style="background-color:' + BRAND.headerBg + ';padding:26px 34px;border-radius:' + (BRAND.radius + 4) + 'px ' + (BRAND.radius + 4) + 'px 0 0;">' +
    '<div style="font-family:' + FONT + ';font-size:18px;font-weight:800;letter-spacing:' + BRAND.wordmarkTracking + ';color:' + BRAND.headerInk + ';line-height:1.2;">' + BRAND.wordmark + '</div>' +
    '<div style="font-family:' + FONT + ';font-size:11px;font-weight:700;letter-spacing:.13em;text-transform:uppercase;color:' + BRAND.headerSub + ';padding-top:6px;">' + escapeEmail(eyebrow) + '</div>' +
    '</td></tr>' +
    '<tr><td bgcolor="' + BRAND.accent + '" style="background-color:' + BRAND.accent + ';font-size:0;line-height:0;height:3px;">&nbsp;</td></tr>' +

    '<tr><td bgcolor="' + BRAND.card + '" style="background-color:' + BRAND.card + ';padding:32px 34px 30px;">' +
    '<h1 style="margin:0 0 12px;font-family:' + FONT + ';font-size:21px;line-height:1.3;font-weight:700;color:' + BRAND.ink + ';">' + heading + '</h1>' +
    '<p style="margin:0 0 22px;font-family:' + FONT + ';font-size:15px;line-height:1.7;color:' + BRAND.body + ';">' + intro + '</p>' +
    body +
    (cta ? button(cta.label, cta.href) : '') +
    (outro ? '<p style="margin:22px 0 0;font-family:' + FONT + ';font-size:15px;line-height:1.7;color:' + BRAND.body + ';">' + outro + '</p>' : '') +
    '</td></tr>' +

    '<tr><td bgcolor="' + BRAND.footerBg + '" style="background-color:' + BRAND.footerBg + ';padding:20px 34px 24px;border-radius:0 0 ' + (BRAND.radius + 4) + 'px ' + (BRAND.radius + 4) + 'px;text-align:center;">' +
    '<div style="font-family:' + FONT + ';font-size:12px;line-height:1.75;color:' + BRAND.footerInk + ';">' + BRAND.footer.join('<br>') + '</div>' +
    '<div style="font-family:' + FONT + ';font-size:12px;line-height:1.75;padding-top:6px;">' +
    '<a href="https://' + BRAND.site + '" style="color:' + BRAND.footerLink + ';text-decoration:none;font-weight:600;">' + BRAND.site + '</a></div>' +
    '</td></tr>' +

    '</table></td></tr></table></body></html>';
}

module.exports = { emailShell, detailRows, quoteBlock, escapeEmail, BRAND };
