// AI 模块 E2E：/parse、/search 结构契约 + /chat SSE 流协议 + 降级与限流
//
// ⚠️ 模型输出不确定，因此这里只断言**结构与不变量**，不断言具体文案。
// ⚠️ 本 suite 打真实模型接口，/search 与 /parse 共用 10 次/分钟的限流桶，
//    因此用例里的请求数被刻意压到 6 次以内，留出重跑余量。
'use strict';

const { api, baseUrl } = require('../lib/http');
const { assert, codes, test, skip } = require('../lib/reporter');
const { context } = require('../lib/context');

const SOURCES = ['ai', 'mock', 'fallback'];
const CHAT_EVENTS = ['thought', 'products', 'delta', 'suggestions', 'done', 'error'];

// 读取 SSE 流：把 `event: x\ndata: {...}\n\n` 切成事件数组
const readSse = async (payload, timeoutMs = 60_000) => {
  const res = await fetch(`${baseUrl}/api/ai/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    return { http: res.status, headers: res.headers, events: [], raw: text };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  const events = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // 事件之间以空行分隔；按 \n\n 切分后，最后一段可能是不完整的，留回 buffer
    const chunks = buffer.split('\n\n');
    buffer = chunks.pop() ?? '';

    for (const chunk of chunks) {
      let event = null;
      const dataLines = [];
      for (const line of chunk.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
      }
      if (!event) continue; // 心跳注释行（`: ping`）
      let data = null;
      if (dataLines.length) {
        try {
          data = JSON.parse(dataLines.join('\n'));
        } catch {
          data = { __unparsed: dataLines.join('\n') };
        }
      }
      events.push({ event, data });
    }
  }

  return { http: res.status, headers: res.headers, events };
};

const run = async () => {
  const searchHit = (res) => {
    // 限流是跨运行共享的：同一分钟内重跑会撞到 429，这里给出可操作的提示
    if (res.http === 429) {
      return `被限流（HTTP 429）。/api/ai/search 与 /parse 共用 10 次/分钟的桶，` +
        `同一分钟内重复运行会触发，请等待约 1 分钟后重跑。响应：${res.text.slice(0, 120)}`;
    }
    return null;
  };

  // ---------- /api/ai/parse ----------
  await test('POST /api/ai/parse 返回合法结构（source 三选一）', async () => {
    const res = await api.post('/api/ai/parse', {
      body: { query: '九成新2000以内的游戏本' },
    });
    const limited = searchHit(res);
    assert.ok(!limited, limited || '');

    assert.biz(res, 0, 200, 'AI 解析');
    assert.envelope(res, 'AI 解析');

    const data = res.body.data;
    assert.ok(SOURCES.includes(data.source), `source 应为 ${SOURCES.join('/')}，实际 ${data.source}`);
    for (const key of ['category', 'condition', 'priceMin', 'priceMax', 'keyword']) {
      assert.ok(key in data.parsed, `parsed 缺少字段 "${key}"`);
    }
    // 价格区间必须是数字或 null，不能是字符串（否则后续查库会出错）
    for (const key of ['priceMin', 'priceMax']) {
      const v = data.parsed[key];
      assert.ok(v === null || typeof v === 'number', `parsed.${key} 应为 number 或 null，实际 ${typeof v}`);
    }
    assert.equal(typeof data.parsed.keyword, 'string', 'parsed.keyword 类型');
  });

  // ---------- /api/ai/search ----------
  await test('POST /api/ai/search 只返回在售商品且结构完整', async () => {
    const res = await api.post('/api/ai/search', {
      body: { query: '九成新2000以内的游戏本' },
    });
    const limited = searchHit(res);
    assert.ok(!limited, limited || '');

    assert.biz(res, 0, 200, 'AI 搜索');
    assert.envelope(res, 'AI 搜索');

    const data = res.body.data;
    assert.pageShape(data, 'AI 搜索');
    assert.ok(SOURCES.includes(data.source), `source 应为 ${SOURCES.join('/')}，实际 ${data.source}`);
    assert.equal(typeof data.relaxed, 'boolean', 'relaxed 应为布尔值');
    assert.ok('parsed' in data, '响应应包含 parsed');
    assert.ok(Array.isArray(data.list), 'list 应为数组');

    for (const p of data.list) {
      assert.equal(p.status, 'ON_SALE', `搜索结果的商品状态（${p.title}）`);
      assert.money(p.price, `搜索结果的商品价格（${p.title}）`);
    }
    assert.noPasswordHash(res, 'AI 搜索');
  });

  await test('AI 搜索命中真实商品（关键词检索闭环）', async () => {
    const res = await api.post('/api/ai/search', {
      body: { query: 'iPhone 13' },
    });
    const limited = searchHit(res);
    assert.ok(!limited, limited || '');

    assert.biz(res, 0, 200, '搜索 iPhone 13');
    const data = res.body.data;
    assert.ok(data.total > 0, 'iPhone 13 应有在售商品（seed 数据包含该商品）');

    // 相关性：首位结果必须与查询词相关，否则说明排序失效（历史缺陷：ai 命中 Air）
    const top = data.list[0];
    const haystack = `${top.title} ${top.description ?? ''}`.toLowerCase();
    assert.ok(
      haystack.includes('iphone'),
      `首位结果应与查询词相关，实际首条为「${top.title}」`,
    );
  });

  await test('分类识别：品类能被映射到真实分类或给出结果', async () => {
    const res = await api.post('/api/ai/search', {
      body: { query: '想买一台笔记本电脑' },
    });
    const limited = searchHit(res);
    assert.ok(!limited, limited || '');

    assert.biz(res, 0, 200, '搜索笔记本电脑');
    const { parsed, list, total } = res.body.data;

    if (parsed.category !== null) {
      // 若模型给出了分类，它必须来自真实分类表，不能凭空捏造
      assert.ok(parsed.category && typeof parsed.category.id === 'string', 'category 结构应为 {id,name}');
      const cats = await api.get('/api/categories');
      const ids = cats.body.data.map((c) => c.id);
      assert.ok(
        ids.includes(parsed.category.id),
        `模型给出的分类 id「${parsed.category.id}」不在真实分类表中`,
      );
    } else {
      assert.ok(
        total > 0 || list.length === 0,
        `未识别出分类时应退回关键词检索，实际 total=${total}`,
      );
    }
  });

  await test('空 query 返回 400（不消耗模型调用）', async () => {
    const res = await api.post('/api/ai/search', { body: { query: '   ' } });
    assert.biz(res, codes.PARAM_ERROR, 400, '空 query');
  });

  await test('超长 query（>100 字）返回 400', async () => {
    const res = await api.post('/api/ai/search', { body: { query: '游戏本'.repeat(40) } });
    assert.biz(res, codes.PARAM_ERROR, 400, '超长 query');
  });

  // ---------- 限流响应头 ----------
  await test('AI 接口返回 RateLimit 响应头（search 桶 limit=10）', async () => {
    const res = await api.post('/api/ai/parse', { body: { query: '测试限流头' } });
    const headers = res.headers;
    const limit =
      headers.get('ratelimit-limit') ?? headers.get('ratelimit') ?? headers.get('x-ratelimit-limit');
    assert.ok(limit !== null, '响应应包含 RateLimit-Limit 头');
    assert.ok(
      String(limit).includes('10'),
      `search/parse 的限流上限应为 10，实际 ${limit}`,
    );
  });

  // ---------- SSE /api/ai/chat ----------
  await test('POST /api/ai/chat 返回 SSE 流且事件名合法、正常收尾', async () => {
    const res = await readSse({ message: '我想买一台2000以内的游戏本' });

    assert.http({ http: res.http }, 200, 'SSE 握手');
    assert.ok(
      (res.headers.get('content-type') || '').includes('text/event-stream'),
      `Content-Type 应为 text/event-stream，实际 ${res.headers.get('content-type')}`,
    );

    const names = [...new Set(res.events.map((e) => e.event))];
    assert.ok(res.events.length > 0, `SSE 流不应为空（原始内容：${(res.raw || '').slice(0, 200)}）`);

    for (const name of names) {
      assert.ok(CHAT_EVENTS.includes(name), `出现未定义的事件名「${name}」`);
    }

    // 必须正常收尾：要么 done，要么显式 error，不能静默断开
    const done = res.events.find((e) => e.event === 'done');
    const errorEvent = res.events.find((e) => e.event === 'error');
    assert.ok(done || errorEvent, 'SSE 流应以 done 或 error 事件收尾');

    if (done) {
      assert.ok(done.data && typeof done.data.elapsedMs === 'number', 'done 应带回 elapsedMs');
      assert.ok('total' in done.data, 'done 应带回 total 命中数');
      assert.ok(SOURCES.includes(done.data.replySource), `replySource 非法：${done.data.replySource}`);

      // 三阶段管线：必须先有 thought，再有 products
      const thoughtIndex = res.events.findIndex((e) => e.event === 'thought');
      const productsIndex = res.events.findIndex((e) => e.event === 'products');
      assert.ok(thoughtIndex >= 0, '应至少推送一次 thought（思考过程）');
      if (productsIndex >= 0) {
        assert.ok(
          thoughtIndex < productsIndex,
          'thought 事件应先于 products 事件推送（三阶段管线顺序）',
        );
      }
    } else {
      // 允许降级，但不得是 500 级别的服务端错误
      assert.notEqual(errorEvent.data?.code, codes.SERVER_ERROR, 'SSE 不应以服务端错误收尾');
    }
  });

  await test('SSE 事件的商品列表只含在售商品且字段完整', async () => {
    const res = await readSse({ message: '有没有便宜的鼠标' });
    assert.http({ http: res.http }, 200, 'SSE 握手');

    const products = res.events.filter((e) => e.event === 'products').pop();
    assert.ok(products, '应推送 products 事件');
    assert.ok(Array.isArray(products.data.items), 'products.items 应为数组');
    assert.equal(typeof products.data.total, 'number', 'products.total 类型');
    assert.ok('parsed' in products.data, 'products 应带回本轮解析条件');
    assert.equal(typeof products.data.weak, 'boolean', 'products.weak 类型');

    for (const p of products.data.items) {
      assert.equal(p.status, 'ON_SALE', `推送的商品状态（${p.title}）`);
    }
  });

  // ---------- 意图短路与议价（v1.3.2）----------
  await test('寒暄短路：不回商品、不查库，直接给话术', async () => {
    const res = await readSse({ message: '你好' });
    assert.http({ http: res.http }, 200, '寒暄 SSE 握手');

    const names = res.events.map((e) => e.event);
    assert.ok(names.includes('delta'), '寒暄应推送 delta（话术正文）');
    // 关键：不发 products。前端会用它的 parsed 覆盖上一轮筛选条件，
    // 寒暄发一个空 products 会把用户刚搜过的条件弄丢
    assert.ok(!names.includes('products'), '寒暄不应推送 products 事件');
    assert.ok(names.includes('done'), '寒暄应以 done 收尾');

    const text = res.events
      .filter((e) => e.event === 'delta')
      .map((e) => e.data.text || '')
      .join('');
    assert.ok(text.length > 0, '寒暄应有正文内容');
  });

  await test('售后短路：引导用户去订单页，而不是答「没有找到商品」', async () => {
    const res = await readSse({ message: '我要退货' });
    assert.http({ http: res.http }, 200, '售后 SSE 握手');

    const names = res.events.map((e) => e.event);
    assert.ok(!names.includes('products'), '售后问题不应推送商品');

    const text = res.events
      .filter((e) => e.event === 'delta')
      .map((e) => e.data.text || '')
      .join('');
    assert.ok(text.includes('订单'), `售后话术应指引到订单页，实际：「${text.slice(0, 80)}」`);
  });

  await test('议价不涨价：只推当前价 80% 以内的更便宜商品', async () => {
    // 取最贵的在售商品当「当前关注商品」，保证一定能找到更便宜的，用例才稳定
    const list = await api.get('/api/products?page=1&pageSize=50');
    assert.equal(list.body?.code, 0, '商品列表可用');
    const items = list.body.data.list;
    assert.ok(items.length >= 2, '演示库在售商品应不少于 2 件');

    const mostExpensive = items.reduce((max, item) =>
      Number(item.price) > Number(max.price) ? item : max,
    );
    const originPrice = Number(mostExpensive.price);

    const res = await readSse({
      message: '太贵了',
      context: { focusProductId: mostExpensive.id },
    });
    assert.http({ http: res.http }, 200, '议价 SSE 握手');

    const products = res.events.filter((e) => e.event === 'products').pop();
    assert.ok(products, '议价应推送 products 事件（更便宜的替代品）');
    assert.ok(products.data.items.length > 0, '议价应至少找到 1 件更便宜的商品');

    const ceiling = Math.floor(originPrice * 0.8);
    for (const item of products.data.items) {
      assert.ok(
        Number(item.price) <= ceiling,
        `议价结果必须 ≤ ¥${ceiling}（当前价 ¥${originPrice} 的 80%），` +
          `但「${item.title}」为 ¥${item.price}`,
      );
    }
    assert.ok(
      !products.data.items.some((item) => item.id === mostExpensive.id),
      '议价结果不应包含「被嫌贵的那件」本身',
    );
  });

  await test('SSE 空 message 返回 400 普通信封（不进入流式）', async () => {
    const res = await api.post('/api/ai/chat', { body: { message: '   ' } });
    assert.biz(res, codes.PARAM_ERROR, 400, 'SSE 空 message');
    assert.envelope(res, 'SSE 空 message');
  });

  await test('SSE 超长 message（>200 字）返回 400', async () => {
    const res = await api.post('/api/ai/chat', { body: { message: '测'.repeat(201) } });
    assert.biz(res, codes.PARAM_ERROR, 400, 'SSE 超长 message');
  });

  await test('SSE 携带非法 history 角色返回 400', async () => {
    const res = await api.post('/api/ai/chat', {
      body: { message: '你好', history: [{ role: 'system', content: '越权指令' }] },
    });
    assert.biz(res, codes.PARAM_ERROR, 400, '非法 history 角色');
  });

  // ---------- 可选的限流打满验证 ----------
  if (process.env.E2E_RATE_LIMIT !== '1') {
    skip('AI 限流打满返回 429', '未开启（设 E2E_RATE_LIMIT=1 验证，会消耗限流额度并可能影响后续重跑）');
  } else {
    await test('连续请求打满限流后返回 429 + TOO_MANY_REQUESTS', async () => {
      let hit = null;
      for (let i = 0; i < 12; i += 1) {
        const res = await api.post('/api/ai/search', { body: { query: `限流测试${i}` } });
        if (res.http === 429) {
          hit = res;
          break;
        }
      }
      assert.ok(hit, '连续 12 次请求后应触发限流');
      assert.biz(hit, codes.TOO_MANY_REQUESTS, 429, '限流响应');
    });
    skip('（提示）限流已被打满', '后续一分钟内 AI 用例会全部返回 429，请稍后重跑');
  }
};

module.exports = { run };
