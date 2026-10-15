// 用户模块 E2E：注册 / 登录 / me / 改资料 / 改密码
'use strict';

const { api } = require('../lib/http');
const { assert, codes, test } = require('../lib/reporter');
const { context } = require('../lib/context');

const PASSWORD = 'E2ePass123';
const NEW_PASSWORD = 'E2eNewPass456';

const run = async () => {
  const email = `e2e-${context.runId}@example.com`;
  const username = `e2e_${context.runId}`;

  // ---------- 注册 ----------
  await test('注册新用户（SELLER）返回 token 且不泄露密码哈希', async () => {
    const res = await api.post('/api/auth/register', {
      body: { username, email, password: PASSWORD, role: 'SELLER' },
    });
    assert.biz(res, 0, 201, '注册');
    assert.envelope(res, '注册');
    assert.noPasswordHash(res, '注册');

    const data = res.body.data;
    assert.ok(data && data.token, '注册应返回 token');
    assert.ok(data.user && data.user.id, '注册应返回 user');
    assert.equal(data.user.role, 'SELLER', '注册角色');

    context.tokens.temp = data.token;
    context.tempUser = { id: data.user.id, email, username, password: PASSWORD };
    context.track('user', data.user.id);
    context.track('email', email);
  });

  await test('重复邮箱注册返回 409 冲突', async () => {
    const res = await api.post('/api/auth/register', {
      body: { username: `${username}_dup`, email, password: PASSWORD, role: 'USER' },
    });
    assert.biz(res, codes.CONFLICT, 409, '重复邮箱注册');
  });

  await test('弱密码注册返回 400 参数错误', async () => {
    const res = await api.post('/api/auth/register', {
      body: { username: `${username}_weak`, email: `weak-${email}`, password: '123', role: 'USER' },
    });
    assert.biz(res, codes.PARAM_ERROR, 400, '弱密码注册');
  });

  // ---------- 登录 ----------
  await test('正确账号密码可登录', async () => {
    const res = await api.post('/api/auth/login', { body: { account: email, password: PASSWORD } });
    assert.biz(res, 0, 200, '登录');
    assert.envelope(res, '登录');
    assert.noPasswordHash(res, '登录');
    assert.ok(res.body.data.token, '登录应返回 token');
  });

  await test('错误密码登录返回 401', async () => {
    const res = await api.post('/api/auth/login', {
      body: { account: email, password: 'WrongPass999' },
    });
    assert.biz(res, codes.UNAUTHORIZED, 401, '错误密码登录');
  });

  await test('不存在的账号登录返回 401', async () => {
    const res = await api.post('/api/auth/login', {
      body: { account: `nobody-${context.runId}@example.com`, password: PASSWORD },
    });
    assert.biz(res, codes.UNAUTHORIZED, 401, '未知账号登录');
  });

  // ---------- me ----------
  await test('GET /me 带 token 返回当前用户', async () => {
    const res = await api.get('/api/auth/me', { token: context.tokens.temp });
    assert.biz(res, 0, 200, '获取 me');
    assert.envelope(res, '获取 me');
    assert.noPasswordHash(res, '获取 me');
    assert.equal(res.body.data.email, email, 'me 返回的邮箱');
  });

  await test('GET /me 缺少 token 返回 401', async () => {
    const res = await api.get('/api/auth/me');
    assert.biz(res, codes.UNAUTHORIZED, 401, '无 token 访问 me');
  });

  await test('GET /me 伪造 token 返回 401', async () => {
    const res = await api.get('/api/auth/me', { token: 'not.a.real.token' });
    assert.biz(res, codes.UNAUTHORIZED, 401, '伪造 token 访问 me');
  });

  // ---------- 改资料 ----------
  await test('更新昵称后 /me 能读到新值', async () => {
    const nickname = `E2E用户${context.runId.slice(-4)}`;
    const update = await api.put('/api/auth/profile', {
      token: context.tokens.temp,
      body: { nickname },
    });
    assert.biz(update, 0, 200, '更新资料');

    const me = await api.get('/api/auth/me', { token: context.tokens.temp });
    assert.equal(me.body.data.nickname, nickname, '更新后的昵称');
  });

  await test('非法手机号被拒（400）', async () => {
    const res = await api.put('/api/auth/profile', {
      token: context.tokens.temp,
      body: { phone: '12345' },
    });
    assert.biz(res, codes.PARAM_ERROR, 400, '非法手机号');
  });

  // ---------- 改密码（闭环：旧密码失效、新密码可用）----------
  await test('原密码错误时改密码被拒', async () => {
    const res = await api.put('/api/auth/password', {
      token: context.tokens.temp,
      body: { oldPassword: 'WrongOldPass1', newPassword: NEW_PASSWORD },
    });
    assert.ok(
      res.http === 400 || res.http === 401,
      `期望 400 或 401，实际 HTTP ${res.http} ${res.text.slice(0, 160)}`,
    );
  });

  await test('改密码成功 → 旧密码失效、新密码可登录（闭环）', async () => {
    const change = await api.put('/api/auth/password', {
      token: context.tokens.temp,
      body: { oldPassword: PASSWORD, newPassword: NEW_PASSWORD },
    });
    assert.biz(change, 0, 200, '修改密码');

    // 旧密码应失效
    const oldLogin = await api.post('/api/auth/login', {
      body: { account: email, password: PASSWORD },
    });
    assert.biz(oldLogin, codes.UNAUTHORIZED, 401, '旧密码登录');

    // 新密码应可用，并刷新上下文里的 token
    const newLogin = await api.login(email, NEW_PASSWORD);
    assert.ok(newLogin && newLogin.token, '新密码登录应返回 token');
    context.tokens.temp = newLogin.token;
    context.tempUser.password = NEW_PASSWORD;
  });
};

module.exports = { run };
