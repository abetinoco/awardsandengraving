# Awards & Engraving — meeting prep

**For the follow-up with Daniel** · checked against live DNS and config on 2026-08-19

---

## 🔴 Three things not on your list that should be

### 1. His email will break if the Cloudflare migration is done wrong

This is the single biggest risk on the agenda and it isn't on it.

```
Nameservers : ns1–ns4.carrierzone.com      (EarthLink / Newfold reseller)
MX          : mx1–mx4c38.carrierzone.com   ← his mailbox lives here
SPF         : v=spf1 include:spfc38.carrierzone.com ~all
```

**His mail is hosted on the same platform as his DNS.** Move the nameservers to
Cloudflare without copying the MX and SPF records across first and
`daniel@awardsandengraving.com` stops receiving mail — silently, and possibly
for a day or more while it propagates.

**Before you touch anything:** export every existing DNS record. Recreate them
in Cloudflare *before* changing the nameservers at the registrar, then cut over.

Also on that domain and easy to lose:
```
google-site-verification=x2R958WSgHK6ustAPvzqdPgAQEX7W3khMiqrz9gOG_U
```
That's Search Console. Drop it and he loses his search analytics and indexing
controls.

The site itself is the easy part — apex already points at Vercel
(`216.198.79.1`) and `www` is a Vercel CNAME. That's a copy-paste.

### 2. Daniel may not be receiving his own quote requests

```
QUOTE_TO = aelibertyvilledev@outlook.com, abe@haloweb.agency
```

That first address looks like a **development placeholder**, and his own
address isn't on the list at all. Worth confirming out loud — if that Outlook
inbox isn't one he actually checks, then every quote request since launch has
been reaching you and a test mailbox, and this is exactly the gap behind
"have the leads been followed up with".

**Ask:** which inbox does he want quotes in? Then fix `QUOTE_TO`.

### 3. Quote emails are sending from an unverified address

```
QUOTE_FROM = "Awards & Engraving <onboarding@resend.dev>"
```

That's Resend's shared testing sender. It works, but it hurts deliverability
and looks wrong on any confirmation the customer receives.

**Fix:** verify `awardsandengraving.com` in Resend, then switch to something
like `quotes@awardsandengraving.com`. This adds DKIM/SPF records — so do it
**as part of the Cloudflare migration**, not separately. One DNS visit, not two.

---

## Access to collect while you're there

- **Registrar login** — who actually controls the domain? If it's inside an
  EarthLink/Newfold account, you need it to change nameservers at all. Confirm
  the domain is in **Daniel's** name, not a former web guy's.
- **Current DNS zone export** — before anything changes.
- **Google Business Profile** — for a local shop this drives more traffic than
  the website. Confirm he has admin, and that you can be added.
- **Google Search Console** — tied to that verification record.
- **Existing email** — how many mailboxes, and does Bailey have one? This
  decides the scope of any future Workspace migration.
- **Photos** — you'll be standing in the shop. Shoot a batch for the portfolio
  while you're there; it makes the new manager immediately useful instead of
  theoretical.

---

## What to explain

**Bailey's login** — hand her `Rubies3110`, then have her hit *Forgot your
password?* in front of you. Demonstrates the new reset feature on a real
account and means neither of you knows her password afterwards.

**Portfolio self-management** — the walkthrough in
`PORTFOLIO-SELF-MANAGEMENT.md`, Part 2.

**Storage, honestly** — he is currently using **zero**. All 54 photos on the
site ship with the code. Storage only grows when he uploads. Don't quote a
quota number; you haven't confirmed the plan tier.

**Services and logo wall** — name these yourself before he finds them. He can
reword them but not add, remove or reorder. Same fix as the portfolio, already
scoped in Part 4 of the other doc.

---

## Two things to sanity-check before you promise them

**"Your photos are on your own account."** I suggested this line earlier — make
sure it's true first. The Supabase project (`yyxbvuyxkgbeatyrfsro`) is not
under the account connected here, so confirm whose it actually is before
telling him he owns it. If it's under a Halo account, either move it or change
the wording.

**Google Drive as "final hosting."** Worth a straight conversation rather than
a plan. Drive isn't an image host — Google rate-limits and rewrites direct
links, they break without notice, there's no CDN, and it would replace a
one-click upload with a multi-step workflow. The Supabase bucket is already
doing this job for zero cost at his volume. If the goal behind Drive is
*"Daniel wants his photos somewhere he recognises"*, that's worth solving
directly — but hosting the live site's images from Drive will cost you a
support call every time a link rots.

The **embed system** for Instagram and YouTube Shorts is a different matter and
a good idea — embeds pull from the platform, so there's genuinely no storage
cost and nothing to rot.
