# Article maintenance

Articles are maintained in `content/articles.yaml`. They are not managed by the workshop Google Sheet.

Each article requires:

- a unique lowercase ASCII `slug`;
- a stable editorial `order`;
- `published: null` until the owner supplies a real publication date;
- complete `he`, `en`, and `ru` values for the title, SEO title, description, every heading, and every paragraph;
- a valid `service_anchor` matching a rendered service on the home page.

Use `h2` blocks for section headings and `p` blocks for paragraphs. Keep the source paragraph order. A paragraph may use `link_slug` to link its full supplied text to another article.

After editing, regenerate the checked-in sitemap and run the build and tests:

```bash
node scripts/build-pages.mjs --write-sitemap
node scripts/build-pages.mjs /tmp/katya-pages-review
node --test test/*.test.mjs
```

## Service pages

Each enabled item in `services.items` of `content/content.yaml` is published at `/services/<slug>/`, `/en/services/<slug>/` and `/ru/services/<slug>/`, and is listed in the Services menu of the top navigation. The page reuses the card text, modal points and WhatsApp `contact_cta` of that item. A `slug` is a public URL: do not rename it after release. An article's related-service link opens the service page whose `anchor` matches its `service_anchor`. After enabling, disabling or adding a service, regenerate the sitemap and run the same build and tests.

Do not add publication or modification dates unless the owner supplies them. Do not add legal, social-profile, address, result, or certification claims without an approved source.
