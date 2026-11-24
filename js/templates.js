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
    name: 'Cloud 3-tier, multi-AZ', mode: 'arch',
    blurb: 'The common starting point: stateless app tier across two availability zones, replicated database, managed load balancer.',
    make: () => FP.generate({ deploy: 'cloud', azs: 2, appPerAz: 2, cache: true, queue: false, cdn: true, dr: false, dbReplicas: 1 }).spec,
  };
  T.onprem3 = {
    name: 'On-prem 3-tier, HA racks', mode: 'arch',
    blurb: 'Same idea in your own data center: firewall and HA load balancer in a DMZ, apps spread over two racks or rooms.',
    make: () => FP.generate({ deploy: 'onprem', azs: 2, appPerAz: 2, cache: true, queue: true, cdn: false, dr: false, dbReplicas: 1 }).spec,
  };
  T.hybrid = {
    name: 'Hybrid: cloud front, on-prem data', mode: 'arch',
    blurb: 'Elastic web/app tier in the cloud, regulated system-of-record database on-prem, joined by redundant private links.',
    make: () => FP.generate({ deploy: 'hybrid', azs: 2, appPerAz: 2, cache: true, queue: true, cdn: true, dr: false, dbReplicas: 1 }).spec,
  };
  T.dr = {
    name: 'Cloud with DR region (99.99%)', mode: 'arch',
    blurb: 'Three AZs plus a warm-standby second region and DNS failover, for very high availability targets.',
    make: () => FP.generate({ deploy: 'cloud', azs: 3, appPerAz: 3, cache: true, queue: true, cdn: true, dr: true, dbReplicas: 2 }).spec,
  };

  T.micro = {
    name: 'Microservices + event stream', mode: 'arch',
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
    name: 'UML class diagram: orders', mode: 'uml',
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
    name: 'UML sequence: login', mode: 'uml',
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
    name: 'UML use cases: shop', mode: 'uml',
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
    name: 'Flow: incident response', mode: 'flow',
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

  FP.TEMPLATES = T;
})();
