import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd(), 'data');
mkdirSync(root, {recursive:true});
const db = new DatabaseSync(path.join(root, 'tabarato.sqlite'));
db.exec(`PRAGMA journal_mode=WAL;
  CREATE TABLE IF NOT EXISTS offers (
    id TEXT PRIMARY KEY, marketplace TEXT NOT NULL, external_id TEXT NOT NULL,
    product_key TEXT NOT NULL, title TEXT NOT NULL, variant TEXT NOT NULL DEFAULT '',
    price REAL NOT NULL CHECK(price>0), shipping REAL NOT NULL DEFAULT 0,
    original_price REAL, url TEXT NOT NULL, affiliate_url TEXT, image_url TEXT,
    coupon_code TEXT, coupon_discount REAL, coupon_min REAL,
    verified_at TEXT NOT NULL, source TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_offer_ext ON offers(marketplace, external_id);
  CREATE INDEX IF NOT EXISTS idx_offer_key ON offers(product_key);
  CREATE TABLE IF NOT EXISTS snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT, offer_id TEXT NOT NULL,
    product_key TEXT NOT NULL, price REAL NOT NULL, shipping REAL NOT NULL DEFAULT 0,
    observed_at TEXT NOT NULL, source TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_snapshot_key ON snapshots(product_key, observed_at);
  CREATE TABLE IF NOT EXISTS aggregates (
    event_type TEXT NOT NULL, marketplace TEXT NOT NULL,
    day TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (event_type, marketplace, day)
  );`);

export function getOffer(marketplace,id) { return db.prepare('SELECT * FROM offers WHERE marketplace=? AND external_id=? AND active=1').get(marketplace,id) || null; }
export function relatedOffers(key) { return db.prepare('SELECT * FROM offers WHERE product_key=? AND active=1 ORDER BY price+shipping ASC').all(key); }
export function recentHistory(key) { return db.prepare("SELECT price+shipping AS total, observed_at, source FROM snapshots WHERE product_key=? AND observed_at>=datetime('now','-30 days') ORDER BY observed_at ASC LIMIT 300").all(key); }
export function recordEvent(type,marketplace) { db.prepare(`INSERT INTO aggregates(event_type, marketplace, day, count) VALUES (?,?,date('now'),1) ON CONFLICT(event_type, marketplace, day) DO UPDATE SET count=count+1`).run(type,marketplace); }

export function saveOffer(o) {
  const id = `${o.marketplace}:${o.externalId}`;
  const now = new Date().toISOString();
  const row = {
    id, marketplace:o.marketplace, external_id:o.externalId, product_key:o.productKey || id,
    title:o.title, variant:o.variant || '', price:o.price, shipping:o.shipping ?? 0,
    original_price:o.originalPrice ?? null, url:o.url,
    affiliate_url:o.affiliateUrl || null, image_url:o.imageUrl || null,
    coupon_code:o.couponCode || null, coupon_discount:o.couponDiscount ?? null,
    coupon_min:o.couponMin ?? null, verified_at:now,
    source:o.source || 'curadoria', active:1
  };
  const stmt=db.prepare(`INSERT INTO offers(id, marketplace, external_id, product_key, title, variant, price, shipping, original_price, url, affiliate_url, image_url, coupon_code, coupon_discount, coupon_min, verified_at, source, active)
  VALUES (@id,@marketplace,@external_id,@product_key,@title,@variant,@price,@shipping,@original_price,@url,@affiliate_url,@image_url,@coupon_code,@coupon_discount,@coupon_min,@verified_at,@source,@active)
  ON CONFLICT(id) DO UPDATE SET product_key=excluded.product_key, title=excluded.title, variant=excluded.variant, price=excluded.price, shipping=excluded.shipping, original_price=excluded.original_price, url=excluded.url, affiliate_url=COALESCE(excluded.affiliate_url,offers.affiliate_url), image_url=COALESCE(excluded.image_url,offers.image_url), coupon_code=excluded.coupon_code, coupon_discount=excluded.coupon_discount, coupon_min=excluded.coupon_min, verified_at=excluded.verified_at, source=excluded.source, active=1`);
  stmt.run(row);
  db.prepare('INSERT INTO snapshots(offer_id,product_key,price,shipping,observed_at,source) VALUES(?,?,?,?,?,?)').run(id,row.product_key,row.price,row.shipping,now,row.source);
  return getOffer(o.marketplace,o.externalId);
}
export function countOffers(){return db.prepare('SELECT COUNT(*) AS n FROM offers').get().n;}
