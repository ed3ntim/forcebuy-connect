# ForceBuy Connect

Browser extension for [ForceBuy](https://forcebuy.net). It keeps the Steam
access you gave ForceBuy fresh, so you do not have to paste a cookie again
after Steam signs you in anew. If you turn it on in ForceBuy, it does the same
for your Buff163 sign-in.

Install it from the
[Chrome Web Store](https://chromewebstore.google.com/detail/aopdpdengffimalmmfmolfceglbnecge)
(Chrome and Edge) or from
[Firefox Add-ons](https://addons.mozilla.org/firefox/addon/connect@forcebuy.net/).

This repository is a read-only mirror. It is generated from the ForceBuy
source on every release and holds exactly the code that goes into the store
package, so you can read what the extension does before you install it.

## What it reads

Two Steam cookies and, only after you opted in, one Buff163 cookie, through the
browser's `cookies` interface, and nothing else:

| Cookie | Site | Used for |
| --- | --- | --- |
| `steamRefresh_steam` | `login.steampowered.com` | renewal token, preferred |
| `steamLoginSecure` | `steamcommunity.com` | session, only when no renewal token can be delivered |
| `session` | `buff.163.com` | Buff163 sign-in, only after you turned it on in ForceBuy and allowed the site in this browser |

Buff163 is off by default. `buff.163.com` is an optional host: the browser asks
for it only when you click "Allow Buff163" in the popup, and nothing on
Buff163 is read before that. The sibling cookie `csrf_token` is not read.

The list lives in one file, `apps/extension/src/cookie-read.ts`, and a test
(`apps/extension/src/rules.test.ts`) fails if any other file touches
`chrome.cookies` or calls `fetch`.

## What it does with them

- It sends them only to `https://forcebuy.net/api/ext/*`, from one file,
  `apps/extension/src/forcebuy-api.ts`. There is no other network call.
- It never sets or removes a cookie and never talks to Steam, Buff163 or any
  other service.
- It sends a value only after you connected the extension to your ForceBuy
  account on forcebuy.net, and only when the value changed.
- It keeps no cookie value. Local storage holds the connection, the account
  name and a hash of the last value sent.
- "Disconnect" in the popup or in ForceBuy's settings ends the connection and,
  by default, removes the access it delivered.

## Permissions

| Permission | Why |
| --- | --- |
| `cookies` | read the three cookies above (the Buff163 one only after you opted in) |
| `storage` | remember the connection |
| `alarms` | retry a delivery that failed, and check once a day whether a cookie changed unnoticed |
| host `login.steampowered.com`, `steamcommunity.com` | the sites the two cookies belong to |
| host `forcebuy.net` | deliver to ForceBuy and talk to the connect page |
| optional host `buff.163.com` | requested at runtime only when you turn on Buff163, to read its one cookie |

## Build it yourself

Node.js 24 or newer.

```
npm install
npm test
npm run typecheck
npm run build
```

`dist/extension/chrome/` is the folder to load with "Load unpacked" in
`chrome://extensions` (developer mode), `dist/extension/forcebuy-extension-chrome.zip`
the package that goes to the store. The build refuses bundles that pull in
anything beyond these sources or grow over 50 KB of script.

## License

PolyForm Noncommercial License 1.0.0, see `LICENSE.md` and `COMMERCIAL.md`.
Questions and commercial use: contact@ed3n.gallery.
