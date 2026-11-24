/* FlowPortal – placement analysis, design review (lint), and scale advisor. Pure functions over the model. */
(function () {
  const FP = (window.FP = window.FP || {});

  /* ---------- placement ---------- */
  FP.zoneOf = function (model, n) {
    const cx = n.x + n.w / 2, cy = n.y + n.h / 2; let best = null;
    model.items.forEach((z) => {
      if (z.cat !== 'zone' || !FP.ZONES[z.type] || FP.ZONES[z.type].deploy === 'none') return;
      if (cx >= z.x && cx <= z.x + z.w && cy >= z.y && cy <= z.y + z.h) {
        if (!best || z.w * z.h < best.w * best.h) best = z;
      }
    });
    return best;
  };
  FP.deployOf = function (model, n) {
    if (n.deploy && n.deploy !== 'auto') return n.deploy;
    const z = FP.zoneOf(model, n);
    return z ? FP.ZONES[z.type].deploy : 'none';
  };
  FP.topology = function (model) {
    const c = { onprem: 0, cloud: 0, edge: 0, dmz: 0, saas: 0, none: 0 };
    const archNodes = model.items.filter((n) => n.cat === 'node' && FP.TYPES[n.type] && FP.TYPES[n.type].icon);
    archNodes.forEach((n) => { c[FP.deployOf(model, n)]++; });
    let label = 'No architecture components yet';
    if (archNodes.length) {
      if (c.onprem + c.dmz && c.cloud) label = 'Hybrid';
      else if (c.onprem + c.dmz) label = 'On-prem';
      else if (c.cloud) label = 'Cloud';
      else label = 'Unplaced: drop components into zones';
    }
    return { counts: c, label, total: archNodes.length };
  };

  /* ---------- design review ---------- */
  const BOUNDARY_OK = { vpn: 1, firewall: 1, apigw: 1, lb: 1, cdn: 1, dns: 1, idp: 1 };
  const DATA = { db: 1, nosql: 1, storage: 1, lake: 1, queue: 1, stream: 1 };
  const SPOF_TYPES = { db: 'database', app: 'app service', web: 'web server', lb: 'load balancer', cache: 'cache', apigw: 'API gateway', vpn: 'private link', firewall: 'firewall' };

  FP.review = function (model) {
    const out = []; const byId = {}; model.items.forEach((i) => (byId[i.id] = i));
    const nodes = model.items.filter((n) => n.cat === 'node' && FP.TYPES[n.type] && FP.TYPES[n.type].icon);
    if (!nodes.length) return [{ level: 'info', text: 'Review runs on architecture components (the Architecture palette). Add some, or load a template.', ids: [] }];

    // Single points of failure: look at replicas, but allow redundancy modelled as sibling nodes of one type in different zones.
    nodes.forEach((n) => {
      if (!SPOF_TYPES[n.type]) return;
      if ((n.replicas || 1) >= 2) return;
      const siblings = nodes.filter((m) => m.type === n.type && m.id !== n.id && FP.zoneOf(model, m) !== FP.zoneOf(model, n));
      if (siblings.length) return;
      if (/replica|standby/i.test(n.label)) return;
      if (model.edges.some((e) => e.kind === 'repl' && (e.from === n.id || e.to === n.id))) return;
      out.push({ level: 'warn', ids: [n.id], text: `${n.label || FP.TYPES[n.type].name} is a single point of failure (${SPOF_TYPES[n.type]}, 1 instance). Set replicas to 2+ or place a second copy in another zone.` });
    });

    // Public exposure of data stores.
    model.edges.forEach((e) => {
      const a = byId[e.from], b = byId[e.to]; if (!a || !b) return;
      const pub = (t) => t === 'user' || t === 'client';
      if ((pub(a.type) && DATA[b.type]) || (pub(b.type) && DATA[a.type]))
        out.push({ level: 'error', ids: [e.from, e.to], text: `${pub(a.type) ? b.label : a.label} is reachable straight from users. Put an app tier (and a firewall or gateway) in between.` });
    });

    // Boundary crossings.
    const seen = {};
    model.edges.forEach((e) => {
      const a = byId[e.from], b = byId[e.to]; if (!a || !b || !FP.TYPES[a.type].icon || !FP.TYPES[b.type].icon) return;
      if (BOUNDARY_OK[a.type] || BOUNDARY_OK[b.type]) return;
      const da = FP.deployOf(model, a), db = FP.deployOf(model, b);
      const grp = (d) => (d === 'onprem' || d === 'dmz' ? 'onprem' : d);
      if (da === 'none' || db === 'none' || grp(da) === grp(db)) return;
      if (grp(da) === 'edge' || grp(db) === 'edge') return;
      if (grp(da) === 'saas' || grp(db) === 'saas') return;
      const key = [grp(da), grp(db)].sort().join('|');
      if (seen[key]) { seen[key].ids.push(e.from, e.to); return; }
      seen[key] = { level: 'warn', ids: [e.from, e.to], text: `${a.label} (${FP.DEPLOY[da].name}) talks directly to ${b.label} (${FP.DEPLOY[db].name}). Route it through a VPN / private link or gateway, and mind the latency and egress cost.` };
      out.push(seen[key]);
    });

    // Chatty hybrid: app on one side, its database on the other.
    // (informational: covered by boundary rule; add latency hint once if a VPN exists)
    const vpns = nodes.filter((n) => n.type === 'vpn');
    vpns.forEach((v) => { if ((v.replicas || 1) < 2) out.push({ level: 'info', ids: [v.id], text: 'The private link between sites is one circuit. Order a second, diverse path; it is the usual hybrid outage.' }); });

    // Failure domains.
    const cloudNodes = nodes.filter((n) => FP.deployOf(model, n) === 'cloud');
    const azCount = model.items.filter((z) => z.cat === 'zone' && z.type === 'az').length;
    const regions = model.items.filter((z) => z.cat === 'zone' && z.type === 'region').length;
    if (cloudNodes.length > 2 && azCount < 2 && regions < 2)
      out.push({ level: 'info', ids: [], text: 'All cloud components share one failure domain. Add a second availability zone (or region) to survive a zone outage.' });
    const opNodes = nodes.filter((n) => FP.deployOf(model, n) === 'onprem');
    const rackCount = model.items.filter((z) => z.cat === 'zone' && (z.type === 'rack' || z.type === 'onprem')).length;
    if (opNodes.length > 3 && rackCount < 2)
      out.push({ level: 'info', ids: [], text: 'All on-prem components sit in one rack, room or site. Add a second to survive a power, cooling or network failure.' });

    // Load balancer in front of several app instances.
    const apps = nodes.filter((n) => n.type === 'app' || n.type === 'web');
    const instances = apps.reduce((s, n) => s + (n.replicas || 1), 0);
    if (instances > 1 && !nodes.some((n) => n.type === 'lb' || n.type === 'apigw'))
      out.push({ level: 'warn', ids: apps.map((a) => a.id), text: 'Several app instances but no load balancer or gateway to spread traffic.' });

    // Observability, orphans, cache/queue hints.
    if (nodes.length >= 5 && !nodes.some((n) => n.type === 'monitor'))
      out.push({ level: 'info', ids: [], text: 'No observability component. Add metrics, logs and traces before you need them.' });
    const connected = new Set(); model.edges.forEach((e) => { connected.add(e.from); connected.add(e.to); });
    nodes.filter((n) => !connected.has(n.id) && nodes.length > 1).forEach((n) =>
      out.push({ level: 'info', ids: [n.id], text: `${n.label || FP.TYPES[n.type].name} is not connected to anything.` }));
    if (nodes.some((n) => n.type === 'db' || n.type === 'nosql') && nodes.some((n) => n.type === 'app') && !nodes.some((n) => n.type === 'cache') && instances >= 6)
      out.push({ level: 'info', ids: [], text: 'Six or more app instances all hit the database. A cache usually removes most read load.' });

    if (!out.length) out.push({ level: 'ok', text: 'No issues found by these checks. They are rules of thumb, not a substitute for a design review.', ids: [] });
    return out;
  };

  /* ---------- scale advisor ---------- */
  FP.TIERS = [
    { max: 10,     name: 'Tier 0 · Prototype', summary: 'Under ~10 req/s peak. One box does the job.',
      pattern: ['Single app server and database on one or two machines', 'Daily backups and a restore you have actually tested', 'Simple deploy script; no orchestration needed yet'] },
    { max: 100,    name: 'Tier 1 · Small production', summary: '~10 to 100 req/s. First real availability needs.',
      pattern: ['Two stateless app instances behind a load balancer', 'Database primary with a standby', 'Managed services where available (less to operate)', 'Basic metrics and alerts'] },
    { max: 1000,   name: 'Tier 2 · Growing service', summary: '~100 to 1,000 req/s. Remove obvious bottlenecks.',
      pattern: ['Autoscaled stateless app tier across failure domains', 'Cache in front of hot reads; CDN for static content', 'Read replicas; move slow work onto a queue', 'CI/CD with automated rollbacks'] },
    { max: 10000,  name: 'Tier 3 · Scaled service', summary: '~1k to 10k req/s. Data layer design dominates.',
      pattern: ['Many app instances over three zones, capacity for losing one', 'Multi-layer caching and several read replicas', 'Async pipelines and event streams for non-critical work', 'Split into services along data ownership lines where teams need it', 'Capacity and load testing become routine'] },
    { max: 100000, name: 'Tier 4 · High scale', summary: '~10k to 100k req/s. Partition everything.',
      pattern: ['Partitioned (sharded) or distributed data stores', 'Multi-region deployment, often active-active for reads', 'Cell-based design: independent copies of the stack, each serving a slice of users', 'Per-tenant rate limiting, backpressure, graceful degradation', 'Dedicated platform and SRE practice'] },
    { max: Infinity, name: 'Tier 5 · Hyperscale', summary: 'Over 100k req/s. Custom engineering territory.',
      pattern: ['Cell-based, multi-region active-active', 'Purpose-built storage and traffic layers', 'Continuous chaos and failure testing', 'Cost engineering is a first-class concern'] },
  ];

  FP.AVAIL = {
    '99':    { azs: 1, dr: false, text: 'Single failure domain is acceptable. Rely on backups and fast restore.' },
    '99.9':  { azs: 2, dr: false, text: 'Two failure domains, automatic failover for the data tier.' },
    '99.95': { azs: 3, dr: false, text: 'Three failure domains; survive losing any one with no manual action.' },
    '99.99': { azs: 3, dr: true,  text: 'Three failure domains plus a second region or site with tested failover.' },
  };

  const fmt = (n) => (n >= 100 ? Math.round(n).toLocaleString() : n >= 10 ? n.toFixed(0) : n.toFixed(1));
  const fmtMin = (m) => (m >= 120 ? (m / 60).toFixed(1) + ' hours' : m >= 1 ? m.toFixed(0) + ' min' : (m * 60).toFixed(0) + ' sec');

  FP.advise = function (i) {
    const avg = (i.dau * i.reqPerUser) / 86400;
    const peak = avg * i.peakFactor;
    const peakRead = peak * i.readPct, peakWrite = peak - peakRead;
    const tier = FP.TIERS.findIndex((t) => peak < t.max);
    const av = FP.AVAIL[i.avail];
    const azs = av.azs;

    // App tier: size to 60% utilisation, then survive losing one failure domain.
    let need = Math.max(1, Math.ceil(peak / (i.rpsPerInstance * 0.6)));
    let total = azs > 1 ? Math.ceil((need * azs) / (azs - 1)) : need + (i.avail === '99' ? 0 : 1);
    total = Math.max(total, azs);
    const perAz = Math.ceil(total / azs);
    total = perAz * azs;

    // Data tier.
    const cache = peakRead > 500 || tier >= 2;
    const dbRead = cache ? peakRead * 0.2 : peakRead;
    const readReplicas = Math.max(0, Math.ceil(dbRead / 5000) - 1);
    let dbMode, dbText;
    if (peakWrite < 500 && dbRead < 4000) { dbMode = 'single primary'; dbText = 'One relational primary sized vertically, with a synchronous standby for failover.'; }
    else if (peakWrite < 3000 && dbRead < 40000) { dbMode = 'primary + replicas'; dbText = `Primary with ${Math.max(1, readReplicas)} read replica(s) and a standby. Plan the sharding strategy before you need it.`; }
    else { dbMode = 'partitioned'; dbText = 'Beyond one writer: partition the data (sharding, or a distributed SQL / NoSQL store) and design access patterns around the partition key.'; }

    const totalUsers = i.dau * 3;
    const storageGB = (totalUsers * i.mbPerUser) / 1024;
    const downtimeYr = (1 - parseFloat(i.avail) / 100) * 525600;

    const cdn = i.staticHeavy || i.global || peak > 1000;
    const queue = i.async || peak > 1000;
    const dr = av.dr;

    const cards = [];
    cards.push({ title: 'Load', text: `${fmt(avg)} req/s average, ${fmt(peak)} req/s at peak (${fmt(peakRead)} reads, ${fmt(peakWrite)} writes).` });
    cards.push({ title: FP.TIERS[tier].name, text: FP.TIERS[tier].summary, list: FP.TIERS[tier].pattern });
    cards.push({ title: 'App tier', text: `${total} instances in total (${perAz} per ${i.deploy === 'onprem' ? 'rack/room' : 'zone'} × ${azs}). Sized to run at about 60% busy at peak, and to carry peak load even if one failure domain is lost.` });
    cards.push({ title: 'Data tier: ' + dbMode, text: dbText + (cache ? ' A cache absorbing ~80% of reads cuts database reads to about ' + fmt(dbRead) + '/s.' : '') });
    cards.push({ title: 'Availability ' + i.avail + '%', text: `Allows about ${fmtMin(downtimeYr)} of downtime a year (${fmtMin(downtimeYr / 12)} a month). ${av.text}` });
    cards.push({ title: 'Storage', text: `About ${storageGB >= 1024 ? (storageGB / 1024).toFixed(1) + ' TB' : fmt(storageGB) + ' GB'} of user data for ${fmt(totalUsers)} total users, before replicas and backups (plan on 3 to 4× raw).` });
    const extras = [];
    if (cdn) extras.push('CDN for static and cacheable content');
    if (queue) extras.push('queue for background and spiky work');
    if (cache) extras.push('cache for hot reads');
    if (dr) extras.push('DNS failover to a second ' + (i.deploy === 'onprem' ? 'site' : 'region'));
    if (extras.length) cards.push({ title: 'Also recommended', text: extras.join('; ') + '.' });

    const venue = {
      cloud: ['Cloud', ['Use autoscaling groups and managed load balancers and databases, and set budgets and alerts.', 'Commit to baseline capacity (reserved / savings plans) and leave the peak on demand.', 'Check cross-zone and egress data charges for chatty tiers.']],
      onprem: ['On-prem', ['Buy for roughly 12 to 18 months of growth plus 40% headroom; hardware lead time is the real constraint.', 'Model each rack or room as a failure domain; keep power, cooling and network paths separate.', 'Budget staff time for patching, firmware and DR drills, not only hardware.']],
      hybrid: ['Hybrid', ['Keep chatty pairs (app and its database) on the same side of the link; a WAN hop adds milliseconds to every query.', 'Use two diverse private circuits; the link is the new single point of failure.', 'Burst the stateless tier into the cloud and keep data where compliance or gravity needs it.']],
    }[i.deploy];
    cards.push({ title: venue[0] + ' notes', text: '', list: venue[1] });

    const gen = { deploy: i.deploy, azs, appPerAz: perAz, cache, queue, cdn, dr, dbReplicas: Math.max(1, readReplicas), dbMode: dbMode === 'partitioned' ? 'nosql' : 'sql' };
    return { cards, gen, peak, tier };
  };
})();
