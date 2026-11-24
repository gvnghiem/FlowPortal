/* FlowPortal – static catalogs: component types, zones, edge kinds, deployment colours. */
(function () {
  const FP = (window.FP = window.FP || {});

  // Deployment venues (derived from the zone a node sits in, or set manually).
  FP.DEPLOY = {
    none:   { name: 'Unplaced',   color: '#94a3b8' },
    onprem: { name: 'On-prem',    color: '#b45309' },
    cloud:  { name: 'Cloud',      color: '#2563eb' },
    edge:   { name: 'Edge / CDN', color: '#7c3aed' },
    dmz:    { name: 'DMZ',        color: '#ea580c' },
    saas:   { name: 'SaaS / 3rd party', color: '#0d9488' },
  };

  // Zones (containers drawn behind nodes).
  FP.ZONES = {
    onprem: { name: 'On-prem data center', deploy: 'onprem', fill: '#fdf6ec', stroke: '#b45309', dash: '', about: 'Hardware you own or colocate. You control everything, and you also carry capacity planning, hardware lead time, patching and DR. Failure domains are racks, rooms, and sites.' },
    dmz:    { name: 'DMZ',                 deploy: 'dmz',    fill: '#fff4ea', stroke: '#ea580c', dash: '6 4', about: 'Network segment between the internet and the internal network. Only reverse proxies, gateways and load balancers should live here, never data stores.' },
    edge:   { name: 'Edge / CDN',          deploy: 'edge',   fill: '#f6f3ff', stroke: '#7c3aed', dash: '', about: 'Points of presence close to users: CDN, WAF, DNS, edge compute. Absorbs traffic spikes and cuts latency before requests reach your origin.' },
    region: { name: 'Cloud region',        deploy: 'cloud',  fill: '#eef5ff', stroke: '#2563eb', dash: '', about: 'A geographic cloud location made of several isolated availability zones. Region-level failure is rare but real; multi-region is the next step up in availability and cost.' },
    vpc:    { name: 'VPC / VNet',          deploy: 'cloud',  fill: '#e8f3fd', stroke: '#0284c7', dash: '8 4', about: 'Your private virtual network inside a region. Split it into public and private subnets. Only load balancers and NAT belong in public ones.' },
    az:     { name: 'Availability zone',   deploy: 'cloud',  fill: '#f3f8ff', stroke: '#60a5fa', dash: '3 4', about: 'One or more discrete data centers inside a region with independent power and networking. Spread replicas across at least two, ideally three, for high availability.' },
    k8s:    { name: 'Kubernetes cluster',  deploy: 'cloud',  fill: '#eef2ff', stroke: '#4f46e5', dash: '6 3', about: 'A scheduling boundary for containers. Works the same on-prem or in the cloud, which makes it a common portability layer in hybrid designs.' },
    rack:   { name: 'Rack / room / site', deploy: 'onprem', fill: '#fffaf2', stroke: '#d49a52', dash: '3 4', about: 'A physical failure domain inside your data center: a rack, a room or a whole site. Spread replicas across them the way you would across cloud availability zones.' },
    saas:   { name: 'SaaS / external',     deploy: 'saas',   fill: '#effbf9', stroke: '#0d9488', dash: '', about: 'Systems run by someone else (payments, email, identity). You depend on their SLA and rate limits, so design timeouts and fallbacks.' },
    lane:   { name: 'Swimlane / actor',    deploy: 'none',   fill: '#f8fafc', stroke: '#94a3b8', dash: '', about: 'Groups steps by who or what performs them. Use in flow diagrams to show hand-offs.' },
    pkg:    { name: 'Package / boundary',  deploy: 'none',   fill: '#fbfbf4', stroke: '#8b8b5c', dash: '', about: 'UML package or system boundary. Groups related classes or use cases.' },
  };

  // Edge kinds.
  FP.EDGES = {
    flow:      { name: 'Request / data flow', dash: '',    end: 'arrow',   start: '',        color: '#334155' },
    async:     { name: 'Async / event',       dash: '7 4', end: 'arrow',   start: '',        color: '#7c3aed' },
    repl:      { name: 'Replication',         dash: '2 4', end: 'arrow',   start: '',        color: '#0d9488' },
    secure:    { name: 'VPN / private link',  dash: '',    end: 'arrow',   start: 'arrow',   color: '#b45309', width: 2.6 },
    assoc:     { name: 'Association',         dash: '',    end: '',        start: '',        color: '#334155' },
    dep:       { name: 'Dependency',          dash: '6 4', end: 'open',    start: '',        color: '#334155' },
    inherit:   { name: 'Inheritance',         dash: '',    end: 'tri',     start: '',        color: '#334155' },
    realize:   { name: 'Realization',         dash: '6 4', end: 'tri',     start: '',        color: '#334155' },
    compose:   { name: 'Composition',         dash: '',    end: '',        start: 'diamondF',color: '#334155' },
    aggregate: { name: 'Aggregation',         dash: '',    end: '',        start: 'diamondE',color: '#334155' },
    msg:       { name: 'Sync message',        dash: '',    end: 'arrow',   start: '',        color: '#334155' },
    ret:       { name: 'Return message',      dash: '6 4', end: 'open',    start: '',        color: '#64748b' },
  };

  // Component catalog. group decides palette section; modes decides which palette tabs show it.
  // shape: how it is drawn. icon: key in FP.ICONS.
  FP.TYPES = {
    // ---- Architecture: users & edge
    user:      { name: 'Users',            group: 'Edge & users',  modes: ['arch'], icon: 'user',     w: 110, h: 72, about: 'People or systems that call you. Estimate concurrent users and peak requests per second first; every scaling decision follows from it.' },
    client:    { name: 'Web / mobile app', group: 'Edge & users',  modes: ['arch'], icon: 'browser',  w: 110, h: 72, about: 'The client. Push work here when you can (caching, validation) and treat everything it sends as untrusted.' },
    dns:       { name: 'DNS / GSLB',       group: 'Edge & users',  modes: ['arch'], icon: 'globe',    w: 110, h: 72, about: 'Name resolution and global traffic steering. Health-checked DNS is the simplest way to fail over between sites or regions.' },
    cdn:       { name: 'CDN',              group: 'Edge & users',  modes: ['arch'], icon: 'globe',    w: 110, h: 72, about: 'Caches static and cacheable responses near users. Often the cheapest 10x reduction in origin load.' },
    // ---- Network & security
    lb:        { name: 'Load balancer',    group: 'Network & security', modes: ['arch'], icon: 'lb',  w: 110, h: 72, about: 'Spreads traffic over healthy instances and removes failed ones. Itself needs redundancy (an HA pair on-prem, a managed multi-AZ service in the cloud).' },
    apigw:     { name: 'API gateway',      group: 'Network & security', modes: ['arch'], icon: 'gate', w: 110, h: 72, about: 'Single front door for APIs: authentication, rate limits, routing, versioning.' },
    firewall:  { name: 'Firewall / WAF',   group: 'Network & security', modes: ['arch'], icon: 'wall', w: 110, h: 72, about: 'Filters traffic between zones. Expect a default-deny rule set and an explicit allow-list per tier.' },
    vpn:       { name: 'VPN / Direct link', group: 'Network & security', modes: ['arch'], icon: 'lock', w: 110, h: 72, about: 'Encrypted or private connectivity between on-prem and cloud (IPsec VPN, or a dedicated circuit such as Direct Connect / ExpressRoute). Plan for two links.' },
    idp:       { name: 'Identity provider', group: 'Network & security', modes: ['arch'], icon: 'key', w: 110, h: 72, about: 'Central authentication and SSO (OIDC/SAML). Keep it out of your critical data path where possible, and cache tokens.' },
    // ---- Compute
    web:       { name: 'Web server',       group: 'Compute', modes: ['arch'], icon: 'server', w: 110, h: 72, about: 'Serves pages and terminates requests. Keep it stateless so you can add or remove instances freely.' },
    app:       { name: 'App service',      group: 'Compute', modes: ['arch'], icon: 'server', w: 110, h: 72, about: 'Business logic. Scale horizontally behind a load balancer and keep session state outside the process.' },
    container: { name: 'Container service', group: 'Compute', modes: ['arch'], icon: 'cube',  w: 110, h: 72, about: 'Packaged workload (Docker image) run by an orchestrator. Gives repeatable deploys and fast scale-out.' },
    k8s:       { name: 'Kubernetes',       group: 'Compute', modes: ['arch'], icon: 'hex',    w: 110, h: 72, about: 'Orchestrator that schedules containers, restarts failures and rolls out updates. Runs on-prem or in any cloud.' },
    function:  { name: 'Serverless function', group: 'Compute', modes: ['arch'], icon: 'lambda', w: 110, h: 72, about: 'Event-driven code with no servers to manage, billed per use. Great for spiky load; watch cold starts and concurrency limits.' },
    vm:        { name: 'Virtual machine',  group: 'Compute', modes: ['arch'], icon: 'vm',     w: 110, h: 72, about: 'Classic virtual server. Most flexible, most to patch.' },
    mainframe: { name: 'Mainframe / legacy', group: 'Compute', modes: ['arch'], icon: 'frame', w: 110, h: 72, about: 'Long-lived core system of record. Usually wrapped by an API or integration layer rather than rewritten.' },
    // ---- Data
    db:        { name: 'Relational DB',    group: 'Data', modes: ['arch'], icon: 'db',     w: 110, h: 72, about: 'Strong consistency and transactions. Scale reads with replicas; scale writes by vertical sizing first, sharding last.' },
    nosql:     { name: 'NoSQL store',      group: 'Data', modes: ['arch'], icon: 'doc',    w: 110, h: 72, about: 'Partitioned key-value or document store for very high write volume and simple access patterns. Model data around queries.' },
    cache:     { name: 'Cache',            group: 'Data', modes: ['arch'], icon: 'bolt',   w: 110, h: 72, about: 'In-memory store (Redis, Memcached) that absorbs hot reads. Define invalidation and what happens on a cold cache.' },
    queue:     { name: 'Message queue',    group: 'Data', modes: ['arch'], icon: 'queue',  w: 110, h: 72, about: 'Buffers work between producers and consumers to smooth bursts and decouple failures. Plan retries and a dead-letter queue.' },
    stream:    { name: 'Event stream',     group: 'Data', modes: ['arch'], icon: 'stream', w: 110, h: 72, about: 'Ordered, replayable log of events (Kafka-style). Backbone of event-driven designs and analytics feeds.' },
    storage:   { name: 'Object storage',   group: 'Data', modes: ['arch'], icon: 'bucket', w: 110, h: 72, about: 'Cheap, durable storage for files, backups and static assets.' },
    lake:      { name: 'Data lake / warehouse', group: 'Data', modes: ['arch'], icon: 'waves', w: 110, h: 72, about: 'Analytical store kept apart from the transactional database so reports never slow customers down.' },
    // ---- Ops & external
    monitor:   { name: 'Observability',    group: 'Ops & external', modes: ['arch'], icon: 'chart', w: 110, h: 72, about: 'Metrics, logs and traces plus alerting. If you cannot see it you cannot run it at scale.' },
    saas:      { name: 'SaaS / 3rd party', group: 'Ops & external', modes: ['arch'], icon: 'cloud', w: 110, h: 72, about: 'External service you depend on. Design for its outages with timeouts, circuit breakers and fallbacks.' },

    // ---- Flow
    start:     { name: 'Start',            group: 'Flow', modes: ['flow', 'uml'], shape: 'pill',    w: 100, h: 44, fill: '#dcfce7', stroke: '#16a34a', about: 'Where the process begins.' },
    end:       { name: 'End',              group: 'Flow', modes: ['flow', 'uml'], shape: 'pill',    w: 100, h: 44, fill: '#fee2e2', stroke: '#dc2626', about: 'Where the process finishes.' },
    process:   { name: 'Process step',     group: 'Flow', modes: ['flow'], shape: 'rect',    w: 140, h: 56, fill: '#ffffff', stroke: '#334155', about: 'One action performed by a person or system.' },
    decision:  { name: 'Decision',         group: 'Flow', modes: ['flow', 'uml'], shape: 'diamond', w: 130, h: 80, fill: '#fef9c3', stroke: '#ca8a04', about: 'A yes/no or multi-way branch. Label every outgoing arrow.' },
    io:        { name: 'Input / output',   group: 'Flow', modes: ['flow'], shape: 'para',    w: 140, h: 56, fill: '#e0f2fe', stroke: '#0284c7', about: 'Data entering or leaving the process.' },
    subprocess:{ name: 'Sub-process',      group: 'Flow', modes: ['flow'], shape: 'sub',     w: 140, h: 56, fill: '#ede9fe', stroke: '#7c3aed', about: 'A step defined in more detail in another diagram.' },
    document:  { name: 'Document',         group: 'Flow', modes: ['flow'], shape: 'doc',     w: 130, h: 60, fill: '#ffffff', stroke: '#475569', about: 'A report, ticket, contract or file produced or consumed.' },

    // ---- UML
    class:     { name: 'Class',            group: 'UML structure', modes: ['uml'], shape: 'class', w: 170, h: 90, fill: '#fffdf5', stroke: '#8a6d1d', about: 'Name, attributes and operations. Prefix with + (public), - (private), # (protected).' },
    iface:     { name: 'Interface',        group: 'UML structure', modes: ['uml'], shape: 'class', w: 170, h: 70, fill: '#f4faff', stroke: '#2563eb', stereotype: 'interface', about: 'A contract of operations without implementation. Use a realization arrow from the implementing class.' },
    component: { name: 'Component',        group: 'UML structure', modes: ['uml'], shape: 'component', w: 150, h: 60, fill: '#ffffff', stroke: '#334155', about: 'A replaceable unit with defined interfaces; maps well to a deployable service.' },
    unode:     { name: 'Deployment node',  group: 'UML structure', modes: ['uml'], shape: 'box3d', w: 150, h: 80, fill: '#f1f5f9', stroke: '#334155', about: 'A server, device or runtime environment in a UML deployment diagram.' },
    note:      { name: 'Note',             group: 'UML structure', modes: ['uml', 'flow', 'arch'], shape: 'note', w: 150, h: 70, fill: '#fef9c3', stroke: '#ca8a04', about: 'Free-form annotation. Good for assumptions, SLAs and "why we did it this way".' },
    actor:     { name: 'Actor',            group: 'UML behaviour', modes: ['uml'], shape: 'actor', w: 70, h: 100, fill: '#ffffff', stroke: '#334155', about: 'A person or external system that interacts with the system.' },
    usecase:   { name: 'Use case',         group: 'UML behaviour', modes: ['uml'], shape: 'ellipse', w: 160, h: 70, fill: '#fff7ed', stroke: '#ea580c', about: 'A goal an actor wants to achieve, written as a verb phrase.' },
    state:     { name: 'State',            group: 'UML behaviour', modes: ['uml'], shape: 'round', w: 130, h: 56, fill: '#f0fdf4', stroke: '#16a34a', about: 'A condition an object stays in until an event triggers a transition.' },
    initial:   { name: 'Initial',          group: 'UML behaviour', modes: ['uml'], shape: 'initial', w: 26, h: 26, fill: '#111827', stroke: '#111827', about: 'Start node of an activity or state diagram.' },
    final:     { name: 'Final',            group: 'UML behaviour', modes: ['uml'], shape: 'final', w: 30, h: 30, fill: '#ffffff', stroke: '#111827', about: 'End node of an activity or state diagram.' },
    lifeline:  { name: 'Lifeline',         group: 'UML behaviour', modes: ['uml'], shape: 'lifeline', w: 130, h: 340, fill: '#ffffff', stroke: '#334155', about: 'A participant in a sequence diagram. Messages between lifelines stack top to bottom in the order you create them.' },
  };

  // Icon glyph markup, 24x24 viewBox, stroked.
  FP.ICONS = {
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/>',
    browser: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/><circle cx="6" cy="6.5" r=".6"/>',
    globe: '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
    lb: '<path d="M12 3v6M12 9 5 15v6M12 9l7 6v6"/><circle cx="12" cy="3" r="1.2"/><circle cx="5" cy="21" r="1.2"/><circle cx="19" cy="21" r="1.2"/>',
    gate: '<path d="M3 4v16M21 4v16M7 12h10M13 8l4 4-4 4"/>',
    wall: '<rect x="3" y="4" width="18" height="16"/><path d="M3 9.5h18M3 14.5h18M9 4v5.5M15 9.5v5M9 14.5V20"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M16 7l3 3"/>',
    server: '<rect x="3" y="3" width="18" height="7" rx="1.5"/><rect x="3" y="14" width="18" height="7" rx="1.5"/><circle cx="7" cy="6.5" r=".7"/><circle cx="7" cy="17.5" r=".7"/>',
    cube: '<path d="m12 2 9 5v10l-9 5-9-5V7z"/><path d="m3 7 9 5 9-5M12 12v10"/>',
    hex: '<path d="m12 2 8.5 5v10L12 22l-8.5-5V7z"/><circle cx="12" cy="12" r="3"/>',
    lambda: '<path d="m7 4 10 16M12 12 6 20"/>',
    vm: '<rect x="3" y="5" width="18" height="14" rx="2"/><rect x="7" y="9" width="10" height="6" rx="1"/>',
    frame: '<rect x="5" y="2" width="14" height="20" rx="1"/><path d="M5 8h14M5 14h14"/><circle cx="8.5" cy="5" r=".6"/><circle cx="8.5" cy="11" r=".6"/><circle cx="8.5" cy="17" r=".6"/>',
    db: '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
    doc: '<path d="M5 3h10l4 4v14H5z"/><path d="M8 11h8M8 15h6"/>',
    bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
    queue: '<rect x="2" y="8" width="5" height="8"/><rect x="9.5" y="8" width="5" height="8"/><rect x="17" y="8" width="5" height="8"/>',
    stream: '<path d="M2 7h16M14 3l4 4-4 4M22 17H6M10 13l-4 4 4 4"/>',
    bucket: '<ellipse cx="12" cy="7" rx="8" ry="2.5"/><path d="m4 7 2 13h12l2-13"/>',
    waves: '<path d="M3 8c3-3 6 3 9 0s6 3 9 0M3 14c3-3 6 3 9 0s6 3 9 0M3 20c3-3 6 3 9 0s6 3 9 0"/>',
    chart: '<rect x="3" y="4" width="18" height="13" rx="1"/><path d="m6 14 3-3 3 2 5-5M8 21h8M12 17v4"/>',
    cloud: '<path d="M7 18a4 4 0 0 1-.5-7.97A6 6 0 0 1 18 9a4.5 4.5 0 0 1-.5 9z"/>',
  };

  FP.ESC = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  };
})();
