/* Shared list schema — the single source of truth for every managed list.
 *
 * Loaded by both the public site (site-content.js renders from it) and the
 * admin panel (which builds its editor from it). Adding a new managed list
 * means adding a block here: no migration, no new admin screen, no new
 * renderer. That is the whole point — the first five lists each cost their own
 * table, manager and renderer, which is why the site still had nine hardcoded
 * ones months later.
 *
 * field types: text | textarea | tags | image | link | check
 */
window.AE_LISTS = {
  machines: {
    label: 'The machines',
    blurb: 'The machines on your Our Shop page.',
    page: '/our-shop',
    mount: 'machines',
    itemLabel: 'machine',
    title: 'name',
    fields: [
      { key: 'numeral', type: 'text', label: 'Number shown beside it', width: 'half' },
      { key: 'name', type: 'text', label: 'Machine name', width: 'half' },
      { key: 'body', type: 'textarea', label: 'What it does' },
      { key: 'tags', type: 'tags', label: 'Materials it handles' },
      { key: 'image', type: 'image', label: 'Photo', aspect: 4 / 3 },
      { key: 'alt', type: 'text', label: 'Photo description' },
    ],
  },

  client_logos: {
    label: 'Client logos',
    blurb: 'The logo wall on your homepage and About page.',
    page: '/about',
    mount: 'client-logos',
    itemLabel: 'client',
    title: 'name',
    fields: [
      { key: 'name', type: 'text', label: 'Company name', width: 'half' },
      { key: 'category', type: 'text', label: 'What they do', width: 'half' },
      { key: 'logo', type: 'image', label: 'Logo', svg: true },
      { key: 'alt', type: 'text', label: 'Logo description' },
      { key: 'on_light', type: 'check', label: 'Logo is white — render it dark on the cream band' },
    ],
  },

  faqs: {
    label: 'Questions',
    blurb: 'The questions and answers on your Contact page.',
    page: '/contact',
    mount: 'faqs',
    itemLabel: 'question',
    title: 'question',
    fields: [
      { key: 'question', type: 'text', label: 'Question' },
      { key: 'answer', type: 'textarea', label: 'Answer' },
    ],
  },

  reels: {
    label: 'Instagram posts',
    blurb: 'The Instagram posts shown on your homepage and Portfolio page.',
    page: '/portfolio',
    mount: 'reels',
    itemLabel: 'post',
    title: 'url',
    fields: [
      { key: 'url', type: 'link', label: 'Link to the post' },
      { key: 'thumb', type: 'image', label: 'Thumbnail', aspect: 1 },
    ],
  },

  process_steps: {
    label: 'How it works',
    blurb: 'The numbered steps on your Services page.',
    page: '/services',
    mount: 'process',
    itemLabel: 'step',
    title: 'title',
    fields: [
      { key: 'step', type: 'text', label: 'Step label', width: 'half' },
      { key: 'title', type: 'text', label: 'Heading', width: 'half' },
      { key: 'body', type: 'textarea', label: 'Description' },
    ],
  },

  materials: {
    label: 'Materials',
    blurb: 'The materials you work with, on the Our Shop page.',
    page: '/our-shop',
    mount: 'materials',
    itemLabel: 'material',
    title: 'title',
    fields: [
      { key: 'step', type: 'text', label: 'Material', width: 'half' },
      { key: 'title', type: 'text', label: 'Heading', width: 'half' },
      { key: 'body', type: 'textarea', label: 'Description' },
    ],
  },

  award_band: {
    label: 'What we make',
    blurb: 'The band of categories on your homepage.',
    page: '/',
    mount: 'award-band',
    itemLabel: 'category',
    title: 'title',
    fields: [
      { key: 'numeral', type: 'text', label: 'Number', width: 'half' },
      { key: 'title', type: 'text', label: 'Heading', width: 'half' },
      { key: 'body', type: 'textarea', label: 'Description' },
    ],
  },

  timeline: {
    label: 'Our story',
    blurb: 'The dated milestones on your About page.',
    page: '/about',
    mount: 'timeline',
    itemLabel: 'milestone',
    title: 'title',
    fields: [
      { key: 'year', type: 'text', label: 'Year', width: 'half' },
      { key: 'title', type: 'text', label: 'Heading', width: 'half' },
      { key: 'body', type: 'textarea', label: 'What happened' },
    ],
  },

  values: {
    label: 'What we stand for',
    blurb: 'The three value cards on your About page.',
    page: '/about',
    mount: 'values',
    itemLabel: 'value',
    title: 'title',
    fields: [
      { key: 'title', type: 'text', label: 'Heading' },
      { key: 'body', type: 'textarea', label: 'Description' },
    ],
  },

  trust_strip: {
    label: 'Trust strip',
    blurb: 'The short claims under your homepage hero.',
    page: '/',
    mount: 'trust-strip',
    itemLabel: 'claim',
    title: 'title',
    fields: [
      { key: 'title', type: 'text', label: 'Bold text', width: 'half' },
      { key: 'body', type: 'text', label: 'Text after it', width: 'half' },
    ],
  },
};
