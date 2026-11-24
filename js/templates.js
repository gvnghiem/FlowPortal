/* FlowPortal – spec builder, reference-architecture generator, and example templates. */
(function () {
  const FP = (window.FP = window.FP || {});

  FP.uid = () => Math.random().toString(36).slice(2, 9);

  /* spec = { nodes:[[key,type,x,y,label,extra]], zones:[[key,type,x,y,w,h,label]], edges:[[a,b,label,kind,route]] } */
  FP.build = function (spec, ox, oy) {
    ox = ox || 0; oy = oy || 0;
    const ids = {}; const items = []; const edges = [];
    (spec.zones || []).forEach(([key, type, x, y, w, h, label]) => {
      const id = (ids[key] = FP.uid());
      items.push({ id, cat: 'zone', type, x: x + ox, y: y + oy, w, h, label: label || FP.ZONES[type].name });
    });
    (spec.nodes || []).forEach(([key, type, x, y, label, extra]) => {
      const t = FP.TYPES[type]; const id = (ids[key] = FP.uid());
      items.push(Object.assign({ id, cat: 'node', type, x: x + ox, y: y + oy, w: t.w, h: t.h, label: label == null ? t.name : label, deploy: 'auto', replicas: 1, notes: '', attrs: '', methods: '' }, extra || {}));
    });
    (spec.edges || []).forEach(([a, b, label, kind, route]) => {
      edges.push({ id: FP.uid(), from: ids[a], to: ids[b], label: label || '', kind: kind || 'flow', route: route || 'elbow' });
    });
    return { items, edges };
  };

  /* ---------- reference architecture generator ----------
     p = { deploy:'cloud'|'onprem'|'hybrid', azs:1-3, appPerAz, cache, queue, cdn, dr, dbReplicas, dbMode } */
  FP.generate = function (p) {
    const n = Math.max(1, Math.min(3, p.azs || 1));
    const nodes = [], zones = [], edges = [];
    const onprem = p.deploy === 'onprem', hybrid = p.deploy === 'hybrid';
    const rowH = 215, top = 40, azX = 490, azW = 560;
    const bodyH = n * rowH + 110;
    const cy = top + bodyH / 2 - 36;
    let prevFront = 'users';
    nodes.push(['users', 'user', 30, cy, 'Users']);
    if (p.dr) { nodes.push(['dns', 'dns', 30, cy - 130, 'DNS / GSLB (health-checked)']); edges.push(['users', 'dns', 'resolve', 'flow']); }
    if (p.cdn) { nodes.push(['cdn', 'cdn', 170, cy, 'CDN + WAF']); edges.push(['users', 'cdn', '', 'flow']); prevFront = 'cdn'; }

    const outerType = onprem ? 'onprem' : 'region';
    const outerLabel = onprem ? 'On-prem data center (primary site)' : 'Cloud region (primary)';
    const outerW = hybrid ? azX - 320 + azW - 80 : azX - 320 + azW + 30; // cloud-side width
    zones.push(['main', outerType, 320, top - 20, outerW, bodyH + 20, outerLabel]);

    if (onprem) {
      zones.push(['dmz', 'dmz', 332, top + 34, 140, bodyH - 60, 'DMZ']);
      nodes.push(['fw', 'firewall', 347, cy - 70, 'Firewall / WAF', { replicas: 2 }]);
      nodes.push(['lb', 'lb', 347, cy + 20, 'Load balancer (HA pair)', { replicas: 2 }]);
      edges.push([prevFront, 'fw', '', 'flow'], ['fw', 'lb', '', 'flow']);
    } else {
      nodes.push(['lb', 'lb', 347, cy, 'Load balancer (managed)', { replicas: n > 1 ? n : 1 }]);
      edges.push([prevFront, 'lb', '', 'flow']);
    }
    if (p.dr) edges.push(['dns', 'lb', 'primary', 'flow']);

    const azType = onprem ? 'rack' : 'az';
    const azWidth = hybrid ? azW - 110 : azW;
    for (let i = 0; i < n; i++) {
      const y = top + i * rowH;
      const lab = onprem ? ['Rack / room A', 'Rack / room B', 'Rack / room C'][i] : 'Availability zone ' + 'abc'[i];
      zones.push(['az' + i, azType, azX, y, azWidth, rowH - 20, lab]);
      nodes.push(['app' + i, 'app', azX + 25, y + 30, 'App service', { replicas: p.appPerAz || 2 }]);
      if (p.cache) { nodes.push(['cache' + i, 'cache', azX + 25, y + 112, 'Cache', { replicas: 2 }]); edges.push(['app' + i, 'cache' + i, '', 'flow']); }
      if (!hybrid) {
        const dbLabel = i === 0 ? 'DB primary' : 'DB replica';
        nodes.push(['db' + i, p.dbMode === 'nosql' ? 'nosql' : 'db', azX + 385, y + 30, dbLabel, { replicas: i === 0 ? 1 : Math.max(1, p.dbReplicas || 1) }]);
        edges.push(['app' + i, 'db0', i === 0 ? 'writes + reads' : 'writes', 'flow']);
        if (i > 0) edges.push(['db0', 'db' + i, 'sync repl', 'repl']);
      }
      edges.push([onprem ? 'lb' : 'lb', 'app' + i, '', 'flow']);
    }
    const lastY = top + n * rowH;
    if (p.queue) {
      nodes.push(['q', 'queue', azX + 25, lastY - 6, 'Job queue']);
      nodes.push(['worker', 'app', azX + 205, lastY - 6, 'Background workers', { replicas: 2 }]);
      edges.push(['app0', 'q', 'enqueue', 'async'], ['q', 'worker', '', 'async']);
    }
    nodes.push(['mon', 'monitor', azX + (hybrid ? 345 : 385), lastY - 6, 'Metrics, logs, traces']);
    edges.push(['app0', 'mon', '', 'async']);

    if (hybrid) {
      const rx = 320 + outerW + 20;
      nodes.push(['vpn', 'vpn', rx, cy, 'VPN / Direct link (redundant)', { replicas: 2 }]);
      const ox = rx + 150;
      zones.push(['dc', 'onprem', ox, top - 20, 200, bodyH + 20 > 340 ? bodyH + 20 : 340, 'On-prem data center']);
      nodes.push(['db0', p.dbMode === 'nosql' ? 'nosql' : 'db', ox + 45, top + 30, 'Core database']);
      nodes.push(['db1', p.dbMode === 'nosql' ? 'nosql' : 'db', ox + 45, top + 130, 'DB standby / replica', { replicas: Math.max(1, p.dbReplicas || 1) }]);
      for (let i = 0; i < n; i++) edges.push(['app' + i, 'vpn', i === 0 ? 'private link' : '', 'secure']);
      edges.push(['vpn', 'db0', 'SQL', 'secure'], ['db0', 'db1', 'sync repl', 'repl']);
    }

    if (p.dr) {
      const dy = top + bodyH + 30;
      const dbT = p.dbMode === 'nosql' ? 'nosql' : 'db';
      if (hybrid) {
        zones.push(['dr', 'onprem', 320 + outerW + 170, dy, 200, 190, 'DR data center (secondary site)']);
        nodes.push(['dbB', dbT, 320 + outerW + 215, dy + 60, 'DB replica (async)']);
        edges.push(['db0', 'dbB', 'async repl', 'repl']);
      } else {
        zones.push(['dr', onprem ? 'onprem' : 'region', 320, dy, 740, 190, onprem ? 'DR data center (secondary site)' : 'Cloud region (disaster recovery)']);
        nodes.push(['appB', 'app', 520, dy + 60, 'App (warm standby)', { replicas: 2 }]);
        nodes.push(['dbB', dbT, 880, dy + 60, 'DB replica (async)']);
        edges.push(['dns', 'appB', 'failover', 'async'], ['appB', 'dbB', '', 'flow'], ['db0', 'dbB', 'async repl', 'repl']);
      }
    }
    return { spec: { nodes, zones, edges } };
  };

  /* ---------- hand-written examples ---------- */
  const T = {};

  T.cloud3 = {
    group: 'Reference architectures', name: 'Cloud 3-tier, multi-AZ', mode: 'arch',
    blurb: 'The common starting point: stateless app tier across two availability zones, replicated database, managed load balancer.',
    make: () => FP.generate({ deploy: 'cloud', azs: 2, appPerAz: 2, cache: true, queue: false, cdn: true, dr: false, dbReplicas: 1 }).spec,
  };
  T.onprem3 = {
    group: 'Reference architectures', name: 'On-prem 3-tier, HA racks', mode: 'arch',
    blurb: 'Same idea in your own data center: firewall and HA load balancer in a DMZ, apps spread over two racks or rooms.',
    make: () => FP.generate({ deploy: 'onprem', azs: 2, appPerAz: 2, cache: true, queue: true, cdn: false, dr: false, dbReplicas: 1 }).spec,
  };
  T.hybrid = {
    group: 'Reference architectures', name: 'Hybrid: cloud front, on-prem data', mode: 'arch',
    blurb: 'Elastic web/app tier in the cloud, regulated system-of-record database on-prem, joined by redundant private links.',
    make: () => FP.generate({ deploy: 'hybrid', azs: 2, appPerAz: 2, cache: true, queue: true, cdn: true, dr: false, dbReplicas: 1 }).spec,
  };
  T.dr = {
    group: 'Reference architectures', name: 'Cloud with DR region (99.99%)', mode: 'arch',
    blurb: 'Three AZs plus a warm-standby second region and DNS failover, for very high availability targets.',
    make: () => FP.generate({ deploy: 'cloud', azs: 3, appPerAz: 3, cache: true, queue: true, cdn: true, dr: true, dbReplicas: 2 }).spec,
  };

  T.micro = {
    group: 'Reference architectures', name: 'Microservices + event stream', mode: 'arch',
    blurb: 'Services on Kubernetes behind an API gateway, each owning its data; services communicate through an event stream.',
    make: () => ({
      zones: [
        ['edge', 'edge', 190, 60, 150, 230, 'Edge'],
        ['reg', 'region', 380, 20, 900, 560, 'Cloud region'],
        ['k8s', 'k8s', 400, 150, 640, 390, 'Kubernetes cluster'],
        ['ext', 'saas', 1320, 290, 150, 160, 'External'],
      ],
      nodes: [
        ['users', 'user', 30, 170, 'Customers'],
        ['cdn', 'cdn', 210, 170, 'CDN + WAF'],
        ['idp', 'idp', 420, 50, 'Identity (OIDC)'],
        ['gw', 'apigw', 420, 290, 'API gateway', { replicas: 3 }],
        ['ord', 'app', 610, 190, 'Orders service', { replicas: 3 }],
        ['cat', 'app', 610, 290, 'Catalog service', { replicas: 3 }],
        ['pay', 'app', 610, 400, 'Payments service', { replicas: 2 }],
        ['str', 'stream', 810, 290, 'Event stream', { replicas: 3 }],
        ['odb', 'db', 1080, 190, 'Orders DB', { replicas: 2 }],
        ['cdb', 'nosql', 1080, 290, 'Catalog store', { replicas: 3 }],
        ['cch', 'cache', 1080, 400, 'Catalog cache', { replicas: 2 }],
        ['mon', 'monitor', 1080, 50, 'Observability'],
        ['psp', 'saas', 1340, 330, 'Payment provider'],
        ['n1', 'note', 800, 476, 'Each service owns its data. No shared database.', { w: 210, h: 50 }],
      ],
      edges: [
        ['users', 'cdn', '', 'flow'], ['cdn', 'gw', '', 'flow'], ['gw', 'idp', 'authn', 'flow'],
        ['gw', 'ord', '', 'flow'], ['gw', 'cat', '', 'flow'],
        ['ord', 'odb', '', 'flow'], ['cat', 'cdb', '', 'flow'], ['cat', 'cch', '', 'flow'],
        ['ord', 'str', 'OrderPlaced', 'async'], ['str', 'pay', '', 'async'], ['pay', 'psp', 'charge', 'flow'],
        ['gw', 'mon', 'telemetry', 'async'],
      ],
    }),
  };

  T.uml_class = {
    group: 'UML', name: 'UML class diagram: orders', mode: 'uml',
    blurb: 'Domain model with association, composition, dependency and an interface realized by a concrete class.',
    make: () => ({
      nodes: [
        ['cust', 'class', 40, 60, 'Customer', { attrs: '-id: UUID\n-name: String\n-email: String', methods: '+placeOrder(): Order' }],
        ['ord', 'class', 330, 60, 'Order', { attrs: '-id: UUID\n-status: OrderStatus\n-total: Money', methods: '+addLine(p: Product, qty: int)\n+pay(g: PaymentGateway): Receipt' }],
        ['line', 'class', 720, 60, 'OrderLine', { attrs: '-quantity: int\n-unitPrice: Money', methods: '+subtotal(): Money' }],
        ['prod', 'class', 720, 290, 'Product', { attrs: '-sku: String\n-title: String\n-price: Money', methods: '' }],
        ['gw', 'iface', 330, 300, 'PaymentGateway', { attrs: '', methods: '+charge(amount: Money): Receipt' }],
        ['stripe', 'class', 330, 450, 'CardGateway', { attrs: '-apiKey: String', methods: '+charge(amount: Money): Receipt' }],
      ],
      edges: [
        ['cust', 'ord', '1  places  0..*', 'assoc', 'straight'],
        ['ord', 'line', '1  contains  1..*', 'compose', 'straight'],
        ['line', 'prod', '*  refers to  1', 'assoc', 'straight'],
        ['ord', 'gw', 'uses', 'dep', 'straight'],
        ['stripe', 'gw', '', 'realize', 'straight'],
      ],
    }),
  };

  T.uml_seq = {
    group: 'UML', name: 'UML sequence: login', mode: 'uml',
    blurb: 'Messages are drawn top to bottom in the order they were created. Add lifelines, then connect them in sequence.',
    make: () => ({
      nodes: [
        ['b', 'lifeline', 40, 40, 'Browser'], ['w', 'lifeline', 280, 40, 'Web app'],
        ['a', 'lifeline', 520, 40, 'Auth service'], ['d', 'lifeline', 760, 40, 'User DB'],
      ],
      edges: [
        ['b', 'w', '1: POST /login', 'msg', 'straight'], ['w', 'a', '2: authenticate(creds)', 'msg', 'straight'],
        ['a', 'd', '3: findUser(email)', 'msg', 'straight'], ['d', 'a', '4: user + password hash', 'ret', 'straight'],
        ['a', 'w', '5: signed token', 'ret', 'straight'], ['w', 'b', '6: 200 OK + session cookie', 'ret', 'straight'],
      ],
    }),
  };

  T.uml_usecase = {
    group: 'UML', name: 'UML use cases: shop', mode: 'uml',
    blurb: 'Actors outside the boundary, goals inside it, include relationships as dashed dependencies.',
    make: () => ({
      zones: [['sys', 'pkg', 220, 20, 460, 470, 'Online shop']],
      nodes: [
        ['c', 'actor', 60, 120, 'Customer'], ['ad', 'actor', 60, 380, 'Admin'], ['psp', 'actor', 760, 220, 'Payment provider'],
        ['u1', 'usecase', 300, 60, 'Browse catalog'], ['u2', 'usecase', 300, 170, 'Place order'],
        ['u3', 'usecase', 300, 290, 'Pay'], ['u4', 'usecase', 300, 400, 'Manage catalog', { w: 170 }],
      ],
      edges: [
        ['c', 'u1', '', 'assoc', 'straight'], ['c', 'u2', '', 'assoc', 'straight'],
        ['u2', 'u3', '«include»', 'dep', 'straight'], ['u3', 'psp', '', 'assoc', 'straight'],
        ['ad', 'u4', '', 'assoc', 'straight'],
      ],
    }),
  };

  T.flow_incident = {
    group: 'Workflow', name: 'Flow: incident response', mode: 'flow',
    blurb: 'A swimlane process with decisions and a retry loop; typical of an on-call runbook.',
    make: () => ({
      zones: [['l1', 'lane', 20, 20, 1220, 120, 'Monitoring'], ['l2', 'lane', 20, 150, 1220, 340, 'On-call engineer']],
      nodes: [
        ['s', 'start', 50, 58, 'Start'], ['al', 'process', 200, 52, 'Alert fires'],
        ['imp', 'decision', 210, 190, 'Customer impact?'],
        ['dec', 'process', 420, 202, 'Declare incident, page team'],
        ['mit', 'process', 620, 202, 'Mitigate: rollback or fail over'],
        ['ok', 'decision', 880, 190, 'Service healthy?'],
        ['pm', 'process', 1070, 202, 'Write post-mortem', { w: 130 }],
        ['tk', 'process', 200, 370, 'Open ticket for next business day'],
        ['e1', 'end', 420, 376, 'End'], ['e2', 'end', 1085, 360, 'End'],
      ],
      edges: [
        ['s', 'al'], ['al', 'imp'], ['imp', 'dec', 'Yes'], ['imp', 'tk', 'No'], ['tk', 'e1'],
        ['dec', 'mit'], ['mit', 'ok'], ['ok', 'pm', 'Yes'], ['ok', 'mit', 'No'], ['pm', 'e2'],
      ].map((e) => [e[0], e[1], e[2] || '', 'flow', 'elbow']),
    }),
  };


  /* ---------- industry & data examples ---------- */
  T.stream_web = {
    name: 'Web streaming: live + on-demand video', mode: 'arch', group: 'Data & streaming',
    blurb: 'Viewers pull segments from a CDN; the origin packages live and VOD content. Upload and live paths are separate pipelines that meet at the origin.',
    make: () => ({
      zones: [['edge', 'edge', 470, 40, 180, 360, 'Edge'], ['reg', 'region', 700, 20, 1000, 560, 'Cloud region: media platform']],
      nodes: [
        ['users', 'user', 30, 240, 'Viewers'], ['cli', 'client', 170, 240, 'Player app (HLS / DASH)'], ['enc', 'client', 30, 440, 'Live encoder'],
        ['dns', 'dns', 500, 100, 'DNS / GSLB'], ['cdn', 'cdn', 500, 240, 'CDN edge cache', { replicas: 20 }],
        ['api', 'apigw', 730, 80, 'Upload API', { replicas: 3 }], ['q', 'queue', 900, 80, 'Transcode jobs'],
        ['tr', 'container', 1070, 80, 'Transcoder workers', { replicas: 8 }], ['vod', 'storage', 1240, 80, 'VOD library'], ['cat', 'db', 1410, 80, 'Catalog + metadata', { replicas: 2 }],
        ['org', 'web', 1240, 240, 'Origin + packager', { replicas: 4 }], ['strm', 'stream', 1410, 240, 'Playback telemetry', { replicas: 3 }], ['mon', 'monitor', 1580, 240, 'QoE monitoring'],
        ['ing', 'lb', 730, 400, 'Live ingest (RTMP / SRT)', { replicas: 2 }], ['ltr', 'container', 900, 400, 'Live transcoder', { replicas: 4 }], ['lpk', 'app', 1070, 400, 'Live packager', { replicas: 4 }],
        ['drm', 'idp', 1410, 400, 'DRM + token auth', { replicas: 2 }],
      ],
      edges: [
        ['users', 'cli'], ['cli', 'dns', 'resolve'], ['cli', 'cdn', 'segments'], ['cdn', 'org', 'cache miss'], ['org', 'vod', '', 'flow'], ['org', 'drm', 'token check'],
        ['api', 'q', 'job', 'async'], ['q', 'tr', '', 'async'], ['tr', 'vod'], ['vod', 'cat', 'metadata'],
        ['enc', 'ing', 'live feed'], ['ing', 'ltr'], ['ltr', 'lpk'], ['lpk', 'org'],
        ['org', 'strm', 'access logs', 'async'], ['strm', 'mon', '', 'async'],
      ],
    }),
  };

  T.stream_multi = {
    name: 'Connected data streams (multi-source)', mode: 'arch', group: 'Data & streaming',
    blurb: 'Devices, an on-prem database and a SaaS app feed one event backbone. Processing enriches events for real-time serving, while the lake and warehouse keep history.',
    make: () => ({
      zones: [['op', 'onprem', 10, 170, 190, 160, 'On-prem'], ['sa', 'saas', 10, 380, 190, 150, 'SaaS'], ['reg', 'region', 350, 20, 1130, 520, 'Cloud region: streaming platform']],
      nodes: [
        ['iot', 'client', 30, 70, 'IoT + web clickstream'], ['db', 'db', 30, 215, 'Orders DB', { replicas: 2 }], ['crm', 'saas', 30, 420, 'SaaS CRM'],
        ['vpn', 'vpn', 215, 215, 'Private link', { replicas: 2 }],
        ['gwy', 'apigw', 380, 70, 'Ingest gateway', { replicas: 3 }], ['cdc', 'app', 380, 215, 'CDC connector', { replicas: 2 }], ['sc', 'function', 380, 420, 'SaaS connector'],
        ['raw', 'stream', 580, 215, 'Raw topics', { replicas: 3 }], ['lake', 'lake', 580, 420, 'Data lake (raw archive)'],
        ['proc', 'container', 780, 100, 'Stream processor', { replicas: 6 }], ['mon', 'monitor', 780, 300, 'Pipeline monitoring'],
        ['enr', 'stream', 970, 100, 'Enriched topics', { replicas: 3 }], ['wh', 'lake', 970, 420, 'Warehouse / marts'],
        ['fs', 'nosql', 1160, 100, 'Feature store', { replicas: 3 }], ['cch', 'cache', 1160, 260, 'Serving cache', { replicas: 2 }],
        ['ml', 'app', 1340, 100, 'ML scoring', { replicas: 4 }], ['bi', 'client', 1340, 420, 'Dashboards / BI'],
      ],
      edges: [
        ['iot', 'gwy', 'events'], ['gwy', 'raw', '', 'async'], ['db', 'vpn', 'change log', 'secure'], ['vpn', 'cdc', '', 'secure'], ['cdc', 'raw', '', 'async'],
        ['crm', 'sc', 'webhooks'], ['sc', 'raw', '', 'async'],
        ['raw', 'proc', '', 'async'], ['raw', 'lake', 'archive', 'async'], ['proc', 'enr', '', 'async'], ['proc', 'mon', 'lag + errors', 'async'],
        ['enr', 'wh', '', 'async'], ['lake', 'wh', 'batch backfill'], ['enr', 'fs', '', 'async'], ['enr', 'cch', '', 'async'],
        ['fs', 'ml'], ['cch', 'ml'], ['wh', 'bi'],
      ],
    }),
  };

  T.data_lakehouse = {
    name: 'Data solution: lakehouse platform', mode: 'arch', group: 'Data & streaming',
    blurb: 'On-prem and SaaS sources land in cloud storage, are transformed into a curated lakehouse, and serve BI, ML and APIs under shared governance.',
    make: () => ({
      zones: [['op', 'onprem', 10, 40, 190, 330, 'On-prem sources'], ['sa', 'saas', 10, 400, 190, 150, 'SaaS sources'], ['reg', 'region', 360, 20, 870, 520, 'Cloud region: data platform']],
      nodes: [
        ['erp', 'db', 40, 90, 'ERP database', { replicas: 2 }], ['files', 'storage', 40, 230, 'File drops + logs'], ['crm', 'saas', 40, 430, 'SaaS apps'],
        ['vpn', 'vpn', 215, 40, 'Private link', { replicas: 2 }],
        ['etl', 'container', 390, 100, 'Batch ETL / CDC', { replicas: 4 }], ['land', 'storage', 560, 100, 'Raw landing zone'], ['trf', 'container', 730, 100, 'Transform (SQL / Spark)', { replicas: 6 }],
        ['lh', 'lake', 900, 100, 'Curated lakehouse'], ['wh', 'lake', 1070, 100, 'Serving warehouse'],
        ['mon', 'monitor', 390, 260, 'Data quality monitor'], ['orc', 'app', 560, 260, 'Orchestrator', { replicas: 2 }], ['cat', 'idp', 730, 260, 'Catalog + governance'],
        ['ml', 'container', 900, 260, 'ML platform'], ['bi', 'client', 1070, 260, 'BI dashboards'], ['api', 'apigw', 900, 420, 'Data API', { replicas: 2 }],
      ],
      edges: [
        ['erp', 'vpn', 'extracts + CDC', 'secure'], ['files', 'vpn', '', 'secure'], ['vpn', 'etl', '', 'secure'], ['crm', 'etl', 'API pulls'],
        ['etl', 'land'], ['land', 'trf'], ['trf', 'lh'], ['lh', 'wh'], ['wh', 'bi'], ['lh', 'ml'], ['ml', 'api'],
        ['orc', 'trf', 'schedules', 'async'], ['orc', 'mon', 'run status', 'async'], ['cat', 'lh', 'policies', 'async'],
      ],
    }),
  };

  T.bank = {
    name: 'Banking: digital channels + core', mode: 'arch', group: 'Industry examples',
    blurb: 'Customer channels run in the cloud; the ledger and payment hub stay in a controlled data center behind a private link. Fraud scoring listens to the event bus.',
    make: () => ({
      zones: [
        ['edge', 'edge', 170, 60, 170, 400, 'Edge + fraud perimeter'], ['reg', 'region', 380, 20, 520, 500, 'Cloud region: digital channels'],
        ['op', 'onprem', 1080, 20, 420, 520, 'Core banking data center'], ['ext', 'saas', 1530, 200, 190, 200, 'Payment networks'],
      ],
      nodes: [
        ['users', 'user', 30, 250, 'Customers'], ['cdn', 'cdn', 200, 120, 'CDN + WAF'], ['bot', 'firewall', 200, 300, 'Bot + DDoS defense', { replicas: 2 }],
        ['gw', 'apigw', 410, 100, 'API gateway', { replicas: 3 }], ['app', 'app', 590, 100, 'Digital banking services', { replicas: 6 }], ['cch', 'cache', 760, 100, 'Session cache', { replicas: 2 }],
        ['idp', 'idp', 410, 260, 'Identity + MFA', { replicas: 2 }], ['bus', 'stream', 590, 260, 'Event bus', { replicas: 3 }],
        ['fraud', 'function', 590, 400, 'Real-time fraud scoring'], ['view', 'nosql', 760, 400, 'Transaction view store', { replicas: 3 }],
        ['vpn', 'vpn', 930, 260, 'Private link to core', { replicas: 2 }],
        ['core', 'mainframe', 1110, 110, 'Core banking', { replicas: 2 }], ['led', 'db', 1280, 110, 'Ledger DB', { replicas: 2 }],
        ['hub', 'app', 1110, 260, 'Payment hub', { replicas: 3 }], ['aud', 'monitor', 1280, 400, 'Audit + SIEM'], ['net', 'saas', 1560, 260, 'ACH / cards / wires'],
      ],
      edges: [
        ['users', 'cdn'], ['cdn', 'bot'], ['bot', 'gw'], ['gw', 'app'], ['gw', 'idp', 'authn'], ['app', 'cch'],
        ['app', 'bus', 'events', 'async'], ['bus', 'fraud', '', 'async'], ['bus', 'view', '', 'async'], ['bus', 'vpn', 'postings', 'secure'], ['vpn', 'hub', '', 'secure'],
        ['hub', 'core'], ['core', 'led'], ['hub', 'net', 'settlement'], ['hub', 'aud', 'audit trail', 'async'],
      ],
    }),
  };

  T.health = {
    name: 'Healthcare: patient portal + EHR', mode: 'arch', group: 'Industry examples',
    blurb: 'Patient and clinician access runs through a FHIR API tier. The hospital EHR, imaging and devices stay on-prem. PHI is audited and de-identified before analytics.',
    make: () => ({
      zones: [
        ['reg', 'region', 200, 20, 700, 520, 'Cloud region: patient + API tier (PHI-eligible)'], ['op', 'onprem', 1070, 20, 430, 520, 'Hospital data center'], ['ext', 'saas', 1530, 260, 190, 170, 'External'],
      ],
      nodes: [
        ['pat', 'user', 30, 80, 'Patients'], ['cli', 'client', 30, 300, 'Clinicians'],
        ['portal', 'app', 230, 80, 'Patient portal', { replicas: 4 }], ['idp', 'idp', 230, 300, 'Identity + consent', { replicas: 2 }],
        ['gw', 'apigw', 410, 190, 'FHIR API gateway', { replicas: 3 }], ['aud', 'monitor', 590, 40, 'PHI access audit'],
        ['fhir', 'db', 590, 190, 'FHIR store (PHI)', { replicas: 3 }], ['lake', 'lake', 770, 190, 'De-identified analytics'],
        ['integ', 'app', 410, 380, 'Integration engine (HL7 / FHIR)', { replicas: 2 }],
        ['vpn', 'vpn', 940, 300, 'Private link', { replicas: 2 }],
        ['pacs', 'storage', 1100, 100, 'Imaging (PACS)'], ['ehr', 'app', 1270, 100, 'EHR system', { replicas: 2 }],
        ['ifc', 'app', 1100, 300, 'Hospital interface engine', { replicas: 2 }], ['dev', 'vm', 1270, 300, 'Lab + bedside devices'],
        ['payer', 'saas', 1560, 300, 'Payer / clearinghouse'],
      ],
      edges: [
        ['pat', 'portal'], ['cli', 'idp', 'SSO'], ['portal', 'idp'], ['portal', 'gw'], ['gw', 'idp', 'token'], ['gw', 'fhir'], ['gw', 'aud', 'access log', 'async'],
        ['fhir', 'lake', 'de-identify', 'async'], ['integ', 'fhir'], ['integ', 'vpn', 'HL7 v2 / FHIR', 'secure'], ['vpn', 'ifc', '', 'secure'],
        ['dev', 'ifc', 'device feeds'], ['ifc', 'ehr'], ['pacs', 'ehr', 'DICOM'], ['ehr', 'payer', 'claims (X12)'],
      ],
    }),
  };

  T.airline = {
    name: 'Airline: shopping, booking + operations', mode: 'arch', group: 'Industry examples',
    blurb: 'Elastic, read-heavy shopping in the cloud; the reservation system and flight operations stay in the core data center. Booking events drive notifications.',
    make: () => ({
      zones: [
        ['edge', 'edge', 300, 170, 150, 200, 'Edge'], ['reg', 'region', 480, 20, 640, 600, 'Cloud region: digital + shopping'],
        ['op', 'onprem', 1290, 20, 430, 560, 'Core airline data center'], ['ext', 'saas', 1750, 60, 190, 170, 'Distribution partners'], ['pz', 'saas', 480, 650, 300, 150, 'Payments'],
      ],
      nodes: [
        ['users', 'user', 30, 240, 'Travelers'], ['cli', 'client', 170, 240, 'Web + mobile app'], ['cdn', 'cdn', 320, 240, 'CDN + WAF'],
        ['gw', 'apigw', 510, 230, 'API gateway', { replicas: 4 }], ['shop', 'app', 680, 100, 'Shopping + offers', { replicas: 8 }], ['cch', 'cache', 850, 100, 'Fare + availability cache', { replicas: 4 }],
        ['off', 'nosql', 850, 230, 'Offer + pricing store', { replicas: 3 }], ['book', 'app', 680, 380, 'Booking service', { replicas: 6 }],
        ['evt', 'stream', 850, 380, 'Flight + booking events', { replicas: 3 }], ['not', 'function', 850, 500, 'Notifications'],
        ['vpn', 'vpn', 1160, 230, 'Private link to DC', { replicas: 2 }],
        ['pss', 'mainframe', 1320, 100, 'Reservation system (PSS)', { replicas: 2 }], ['inv', 'db', 1490, 100, 'PNR + inventory DB', { replicas: 2 }],
        ['dcs', 'app', 1320, 230, 'Departure control', { replicas: 2 }], ['ops', 'app', 1490, 230, 'Flight ops control', { replicas: 2 }],
        ['crew', 'app', 1320, 400, 'Crew management'], ['mro', 'app', 1490, 400, 'Maintenance (MRO)'],
        ['gds', 'saas', 1780, 100, 'GDS / travel agencies'], ['pay', 'saas', 580, 690, 'Payment gateway'],
      ],
      edges: [
        ['users', 'cli'], ['cli', 'cdn'], ['cdn', 'gw'], ['gw', 'shop'], ['shop', 'cch'], ['shop', 'off'], ['gw', 'book'],
        ['book', 'evt', 'confirmed', 'async'], ['evt', 'not', '', 'async'], ['book', 'vpn', 'reserve + ticket', 'secure'], ['vpn', 'pss', '', 'secure'],
        ['pss', 'inv'], ['pss', 'dcs', 'check-in'], ['dcs', 'ops'], ['ops', 'mro'], ['crew', 'dcs', 'assignments'], ['inv', 'gds', 'inventory feed', 'async'], ['book', 'pay', 'authorize'],
      ],
    }),
  };

  T.pm_flow = {
    name: 'Project management: idea to release', mode: 'flow', group: 'Workflow',
    blurb: 'Swimlanes show who owns each step: sponsor, product owner, delivery team. Two decision loops: sponsor approval and sprint acceptance.',
    make: () => ({
      zones: [['l1', 'lane', 20, 20, 1560, 120, 'Sponsor / stakeholders'], ['l2', 'lane', 20, 150, 1560, 170, 'Product owner'], ['l3', 'lane', 20, 330, 1560, 270, 'Delivery team']],
      nodes: [
        ['s', 'start', 50, 55, 'Start'], ['req', 'process', 190, 48, 'Request / idea'],
        ['int', 'process', 190, 187, 'Intake + triage'], ['fit', 'decision', 380, 165, 'Fits strategy?'], ['park', 'end', 405, 262, 'Parked'],
        ['scope', 'process', 560, 187, 'Scope + business case'], ['ok', 'decision', 770, 40, 'Sponsor approves?'],
        ['plan', 'process', 500, 370, 'Sprint planning'], ['build', 'process', 690, 370, 'Build + test'], ['rev', 'process', 880, 370, 'Sprint review'],
        ['acc', 'decision', 885, 465, 'Accepted?'], ['rew', 'process', 690, 480, 'Rework / re-plan'], ['rel', 'process', 1090, 480, 'Release'],
        ['rep', 'process', 1090, 48, 'Status + release notes', { w: 160 }], ['ret', 'process', 1290, 480, 'Retro + metrics'], ['e', 'end', 1470, 488, 'Done'],
      ],
      edges: [
        ['s', 'req'], ['req', 'int'], ['int', 'fit'], ['fit', 'park', 'No'], ['fit', 'scope', 'Yes'], ['scope', 'ok'], ['ok', 'scope', 'No, revise'], ['ok', 'plan', 'Yes'],
        ['plan', 'build'], ['build', 'rev'], ['rev', 'acc'], ['acc', 'rew', 'No'], ['rew', 'plan'], ['acc', 'rel', 'Yes'], ['rel', 'rep'], ['rel', 'ret'], ['ret', 'e'],
      ].map((e) => [e[0], e[1], e[2] || '', 'flow', 'elbow']),
    }),
  };

  FP.TEMPLATES = T;
})();
