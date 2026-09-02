#!/usr/bin/env python3
"""Split the monolithic catalog.json into a light index + per-collection product files.

Output (written into the project's /catalog/ dir):
  index.json            collections -> groups -> categories (names + counts + stable ids). Small.
  <key>.json            { "<cid>": [ {sku,name,image,size?}, ... ] }  products for one collection.

Stable category id (cid):
  Next sites  /categories/2/products          -> "crystal:2"
  PHP sites   ...id=2&subId=1                  -> "drinkware:2-1"
These ids are what the admin's hide/feature overrides reference, so they must stay stable
across re-scrapes.
"""
import json, re, os, sys, urllib.parse

SRC = sys.argv[1] if len(sys.argv) > 1 else "catalog.json"
OUT = sys.argv[2] if len(sys.argv) > 2 else "assets/catalog"

def cid_for(site, url):
    m = re.search(r'/categories/(\d+)/products', url)
    if m:
        return f"{site}:{m.group(1)}"
    q = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)
    return f"{site}:{q.get('id',['0'])[0]}-{q.get('subId',['0'])[0]}"

def main():
    data = json.load(open(SRC))
    os.makedirs(OUT, exist_ok=True)
    index = {"generated": data["generated"], "total_products": data["total_products"], "collections": []}

    for coll in data["collections"]:
        site = coll["site"]
        products_by_cid = {}
        idx_groups = []
        for g in coll["groups"]:
            idx_cats = []
            for cat in g["categories"]:
                cid = cid_for(site, cat["source_url"])
                products_by_cid[cid] = cat["products"]
                idx_cats.append({"id": cid, "name": cat["name"], "count": cat["product_count"]})
            idx_groups.append({"name": g["group"], "count": g["product_count"], "categories": idx_cats})
        index["collections"].append({
            "key": site, "label": coll["collection"], "count": coll["product_count"],
            "groups": idx_groups,
        })
        with open(os.path.join(OUT, f"{site}.json"), "w") as f:
            json.dump(products_by_cid, f, ensure_ascii=False, separators=(",", ":"))
        print(f"  {site}.json  categories={sum(len(g['categories']) for g in idx_groups)}  products={coll['product_count']}")

    with open(os.path.join(OUT, "index.json"), "w") as f:
        json.dump(index, f, ensure_ascii=False, indent=1)
    sz = os.path.getsize(os.path.join(OUT, "index.json"))
    print(f"\nindex.json  {sz/1024:.1f} KB  collections={len(index['collections'])}  total={index['total_products']}")

if __name__ == "__main__":
    main()
