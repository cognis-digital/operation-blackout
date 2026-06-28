<div align="center">

# operation-blackout

### Operation Blackout — a fast browser FPS.

[![▶ Play Now](https://img.shields.io/badge/%E2%96%B6%20PLAY-in%20your%20browser-6b46c1?style=for-the-badge)](https://cognis-digital.github.io/operation-blackout/)
[![License: COCL 1.0](https://img.shields.io/badge/License-COCL%201.0-2b6cb0.svg)](LICENSE)

**▶ Play instantly: https://cognis-digital.github.io/operation-blackout/**  · no install, runs in any modern browser.

</div>


<!-- cognis:example:start -->
## 🔎 Example output

**Sample result format** _(illustrative values — run on your own data for real findings):_

```
{
  "id": "1234567890",
  "status": "success",
  "results": [
    {
      "device_id": "ABC123",
      "name": "Example Device",
      "location": "Room 101",
      "result_code": "OK"
    },
    {
      "device_id": "DEF456",
      "name": "Another Example Device",
      "location": "Room 202",
      "result_code": "WARNING"
    }
  ]
}
```

<!-- cognis:example:end -->

## Usage — step by step

1. Play instantly in any modern browser — no install: <https://cognis-digital.github.io/operation-blackout/>
2. To run locally, clone the repo:
   ```bash
   git clone https://github.com/cognis-digital/operation-blackout.git && cd operation-blackout
   ```
3. Serve the static files (it is a self-contained HTML5 + JS canvas/WebGL FPS):
   ```bash
   python -m http.server 8000
   ```
4. Open the game and play by browsing to <http://localhost:8000>.
5. Host your own copy — any static host works (the repo is GitHub Pages-ready via `index.html` + `.nojekyll`); push to a gh-pages-enabled repo, or drop `index.html` on any CDN/static bucket.

## About
Operation Blackout — a fast browser FPS. Built as a self-contained browser experience (HTML5 + JS canvas/WebGL). Part of the [Cognis Digital](https://cognis.digital) labs.

`mermaid
flowchart LR
  P[Player] --> B[Browser / GitHub Pages]
  B --> E[HTML5 + JS engine]
  E --> R[Render loop · input · audio]
`

## Run locally
```bash
git clone https://github.com/cognis-digital/operation-blackout.git && cd operation-blackout
python -m http.server 8000   # then open http://localhost:8000
```

## Interoperability

`operation-blackout` composes with the 300+ tool Cognis suite — JSON in/out and a shared
OpenAI-compatible `/v1` backbone. See **[INTEROP.md](INTEROP.md)** for the
suite map, composition patterns, and reference stacks.

## Integrations

Forward `operation-blackout`'s findings to STIX/MISP/Sigma/Splunk/Elastic/Slack/webhooks via
[`cognis-connect`](https://github.com/cognis-digital/cognis-connect). See **[INTEGRATIONS.md](INTEGRATIONS.md)**.

## License
COCL v1.0 — see [LICENSE](LICENSE).
