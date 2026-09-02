#!/usr/bin/env python3
"""Scrape the 7 Premier Line (JDS) vendor catalogs into one clean JSON dataset."""
import re, json, sys, time, html as htmllib, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36"

SITES = [
    # key, collection label, home url, engine ("next"|"php")
    ("crystal",      "Crystal & Glass Awards", "https://premiercrystal.com/",          "next"),
    ("sport",        "Sport Awards",           "https://premiersportawards.com/",      "next"),
    ("acrylic",      "Acrylic Awards",         "https://premieracrylic.com/",          "next"),
    ("drinkware",    "Drinkware",              "https://premierdrinkware.com/home?prices=NO&cust=NO",       "php"),
    ("leather",      "Lasered Leatherette",    "https://premierleathergifts.com/home?prices=NO&cust=NO",    "php"),
    ("personalized", "Personalized Gifts",     "https://premierpersonalizedgifts.com/",                     "php"),
    ("corporate",    "Corporate Collection",   "https://premiercorporateawards.com/",                       "php"),
]

def fetch(url, tries=3):
    for t in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=45) as r:
                return r.read().decode("utf-8", "replace")
        except Exception as e:
            if t == tries - 1:
                print(f"    FETCH FAIL {url}: {e}", file=sys.stderr)
                return ""
            time.sleep(1.5 * (t + 1))
    return ""

def clean(s):
    return re.sub(r"\s+", " ", htmllib.unescape(s or "")).strip()

# ---- nav parsing: build the group -> category list per site --------------

def parse_nav_next(home_html, home_url):
    """Next sites: <label ...>GROUP</label><ul ...> ... <a href="/categories/N/products">NAME</a>"""
    cats = []
    # Split by group labels to attach group names
    # Find every <label ...>text</label> that precedes a dropdown-content
    for m in re.finditer(r'<label[^>]*>([^<]+)</label>\s*<ul[^>]*dropdown-content(.*?)</ul>', home_html, re.S):
        group = clean(m.group(1))
        block = m.group(2)
        for a in re.finditer(r'<a[^>]+href="(/categories/(\d+)/products)"[^>]*>(.*?)</a>', block, re.S):
            url = urllib.parse.urljoin(home_url, a.group(1))
            name = clean(re.sub(r"<[^>]+>", "", a.group(3)))
            cats.append({"group": group, "name": name, "url": url})
    # de-dupe by url, keep first
    seen, out = set(), []
    for c in cats:
        if c["url"] in seen: continue
        seen.add(c["url"]); out.append(c)
    return out

def parse_nav_php(home_html, home_url):
    """PHP sites, two nav flavors:
       (A) <a class="toggle">GROUP</a><ul class="dropdown" id="N"> <a href="...subId=..">NAME</a>
       (B) bootstrap: <a class="...dropdown-toggle">GROUP</a><ul class="dropdown-menu"> <a class="dropdown-item" href="...subId=..">NAME</a>
    """
    cats = []
    patterns = [
        r'class="toggle"[^>]*>(.*?)</a>\s*<ul class="dropdown"[^>]*>(.*?)</ul>',
        r'dropdown-toggle[^>]*>(.*?)</a>\s*<ul class="dropdown-menu"[^>]*>(.*?)</ul>',
    ]
    for pat in patterns:
        for m in re.finditer(pat, home_html, re.S):
            group = clean(re.sub(r"<[^>]+>", "", m.group(1)))
            block = m.group(2)
            for a in re.finditer(r'<a[^>]+href="([^"]*(?:view=category|subId=)[^"]*)"[^>]*>(.*?)</a>', block, re.S):
                href = htmllib.unescape(a.group(1))
                url = urllib.parse.urljoin(home_url, href)
                name = clean(re.sub(r"<[^>]+>", "", a.group(2)))
                if name:
                    cats.append({"group": group, "name": name, "url": url})
    seen, out = set(), []
    for c in cats:
        if c["url"] in seen: continue
        seen.add(c["url"]); out.append(c)
    return out

# ---- product parsing -----------------------------------------------------

CLOUD_RE = re.compile(r'res\.cloudinary\.com/business-products/image/upload/[^"\'\s)]*products/images/large/[A-Za-z0-9_\-.]+', re.I)

def norm_image(cloud_path):
    """Return a clean, sized cloudinary URL from any matched cloudinary substring."""
    # cloud_path like: res.cloudinary.com/business-products/image/upload/<transforms>/v123/products/images/large/FILE
    m = re.search(r'(v\d+/products/images/large/[A-Za-z0-9_\-.]+)', cloud_path)
    if not m:
        return "https://" + cloud_path
    tail = m.group(1)
    if not re.search(r'\.(png|jpg|jpeg|webp)$', tail, re.I):
        tail += ".png"
    return f"https://res.cloudinary.com/business-products/image/upload/q_auto,f_auto,w_600/{tail}"

def sku_from_tail(url):
    fn = url.rsplit("/", 1)[-1]
    fn = re.sub(r'\.(png|jpg|jpeg|webp)$', "", fn, flags=re.I)
    fn = re.sub(r'--[0-9a-f]{6,}$', "", fn)  # strip PHP hash suffix
    return fn

def _field_after(text, label):
    """Pull the text that follows a `<span>Label:</span>` marker in a PHP detail block."""
    m = re.search(re.escape(label) + r'\s*(?:&nbsp;)?\s*</span>\s*(?:<br\s*/?>)?\s*(.*?)(?:<br|<span|</div|</li)', text, re.S | re.I)
    return clean(re.sub(r'<[^>]+>', '', m.group(1))) if m else ""

def parse_products(page_html):
    """Engines expose products two ways:
       - img alt (Next sites + drinkware/leather/personalized): <img alt="NAME" ...products/images/large/SKU...>
       - structured block (corporate): image + `Part Number:`/`Description:`/`Size:` spans, no alt.
       Keyed off each product cloudinary image; name falls back img-alt -> Description field.
    """
    products = []
    seen = set()
    for img in re.finditer(r'<img\b[^>]*>', page_html, re.S):
        tag = img.group(0)
        decoded = tag
        um = re.search(r'/_next/image\?url=([^&"\']+)', tag)
        if um:
            decoded = tag + " " + urllib.parse.unquote(um.group(1))
        cm = CLOUD_RE.search(decoded)
        if not cm:
            continue
        image = norm_image(cm.group(0))
        sku = sku_from_tail(image)
        if sku in seen:
            continue
        alt = re.search(r'\balt="([^"]*)"', tag)
        name = clean(alt.group(1)) if alt else ""
        size = ""
        if not name:
            # structured PHP format: read Description/Size from the window after this img
            window = page_html[img.end():img.end() + 700]
            name = _field_after(window, "Description:")
            size = _field_after(window, "Size:")
        seen.add(sku)
        rec = {"sku": sku, "name": name, "image": image}
        if size:
            rec["size"] = size
        products.append(rec)
    return products

# ---- run -----------------------------------------------------------------

def build_manifest():
    manifest = []  # (site_key, collection, group, name, url)
    for key, coll, home, engine in SITES:
        h = fetch(home)
        cats = parse_nav_next(h, home) if engine == "next" else parse_nav_php(h, home)
        print(f"{key:12s} {coll:26s} categories={len(cats)}", file=sys.stderr)
        for c in cats:
            manifest.append((key, coll, engine, c["group"], c["name"], c["url"]))
    return manifest

def scrape_category(entry):
    key, coll, engine, group, name, url = entry
    page = fetch(url)
    prods = parse_products(page) if page else []
    return (key, coll, group, name, url, prods)

def main():
    man = build_manifest()
    print(f"\nTOTAL categories to scrape: {len(man)}\n", file=sys.stderr)

    results = []
    with ThreadPoolExecutor(max_workers=6) as ex:
        futs = {ex.submit(scrape_category, e): e for e in man}
        done = 0
        for f in as_completed(futs):
            r = f.result(); done += 1
            print(f"  [{done}/{len(man)}] {r[0]:12s} {r[3][:40]:40s} products={len(r[5])}", file=sys.stderr)
            results.append(r)

    # assemble clean nested structure
    catalog = {}
    for key, coll, group, name, url, prods in results:
        c = catalog.setdefault(coll, {"collection": coll, "site": key, "groups": {}})
        g = c["groups"].setdefault(group, {"group": group, "categories": []})
        g["categories"].append({"name": name, "source_url": url, "product_count": len(prods), "products": prods})

    # to lists, sorted, with counts
    out = {"generated": time.strftime("%Y-%m-%d %H:%M"), "collections": []}
    tot_prod = 0
    for coll_name, c in catalog.items():
        groups = []
        for gname, g in c["groups"].items():
            n = sum(cat["product_count"] for cat in g["categories"])
            groups.append({"group": gname, "product_count": n, "categories": g["categories"]})
            tot_prod += n
        out["collections"].append({
            "collection": coll_name, "site": c["site"],
            "product_count": sum(g["product_count"] for g in groups),
            "groups": groups,
        })
    out["total_products"] = tot_prod
    out["total_collections"] = len(out["collections"])

    with open("catalog.json", "w") as f:
        json.dump(out, f, indent=2, ensure_ascii=False)
    print(f"\nDONE. collections={len(out['collections'])} total_products={tot_prod}", file=sys.stderr)
    print("wrote catalog.json", file=sys.stderr)

if __name__ == "__main__":
    main()
