# FlowPortal

Interactive diagram tool for **technology architecture** (on-prem, cloud, hybrid), **workflows**, and **UML**, with a design reviewer and a scale advisor. No build step and no dependencies: open `index.html`, or host the folder on GitHub Pages.

## What it does
- **Architecture palette**: users/edge, network & security, compute, data, ops. Zones (on-prem DC, DMZ, cloud region, VPC, AZ, rack, Kubernetes, SaaS) colour every component by where it runs. The status chip reports On-prem / Cloud / Hybrid.
- **Workflow and UML palettes**: flowchart shapes and swimlanes; class, interface, component, deployment node, actor, use case, state, lifeline (sequence messages stack in creation order).
- **Review tab**: single points of failure, data stores exposed to users, on-prem to cloud links without a VPN or gateway, single failure domain, missing observability.
- **Scale tab**: enter users, request rate, availability target and venue. Get peak req/s, scale tier, instance counts, data-tier pattern and storage, then draw a reference diagram.
- **Learn tab**: on-prem vs cloud vs hybrid, scale tiers, design checklist.
- 9 templates, undo/redo, autosave, SVG/PNG/JSON export and JSON import.

Shortcuts: Del, Ctrl+D, Ctrl+Z / Ctrl+Shift+Z, arrows, F (fit), Space+drag (pan), Alt+drag zone (move without contents).

The sizing numbers are planning heuristics (60% target utilisation, N-1 failure-domain headroom, 80% cache hit), not guarantees. Validate with load tests.

## Layout
`js/data.js` catalogs · `js/templates.js` builder, generator, templates · `js/analysis.js` review and advisor · `js/app.js` editor.
