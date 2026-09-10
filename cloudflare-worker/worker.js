/**
 * 六道轮回·领奖提醒 Cloudflare Worker
 * 使用 Cron Triggers 每10分钟准时检查，比GitHub Actions可靠得多
 * 
 * 部署步骤：
 * 1. npm install -g wrangler
 * 2. wrangler login
 * 3. cd cloudflare-worker && wrangler deploy
 * 4. wrangler secret put WXPUSHER_SPT
 * 5. wrangler secret put DATA_URL (可选，默认从GitHub读取)
 */

export default {
  // Cron定时触发（Cloudflare Cron，备用）
  async scheduled(event, env, ctx) {
    console.log('[Cron] 定时检查触发，时间:', new Date().toISOString());
    const result = await checkAndNotify(env);
    console.log('[Cron] 检查结果:', JSON.stringify(result));
  },

  // HTTP手动触发（用于测试）
  async fetch(request, env, ctx) {
    if (request.method === 'GET') {
      const result = await checkAndNotify(env);
      return new Response(JSON.stringify(result, null, 2), {
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
      });
    }
    return new Response('Method not allowed', { status: 405 });
  }
};

async function checkAndNotify(env) {
  // 获取数据
  const dataUrl = env.DATA_URL || 'https://raw.githubusercontent.com/anjathomas17077-svg/liudao-reward/main/data.json';
  
  let data;
  try {
    const resp = await fetch(dataUrl, { headers: { 'User-Agent': 'Cloudflare-Worker' } });
    if (!resp.ok) return { error: '获取数据失败', status: resp.status };
    data = await resp.json();
  } catch (e) {
    return { error: '获取数据异常', message: e.message };
  }

  if (!data.groups || !data.groups.length) {
    return { message: '无账号数据', claimable: 0 };
  }

  // 检查账号状态
  function getStatus(acc) {
    if (!acc.lastClaimTime) return 'new';
    const diff = Date.now() - acc.lastClaimTime;
    const ms = (acc.timerHours || 24) * 3600000;
    if (diff >= ms + 3600000) return 'over';
    if (diff >= ms) return 'claim';
    return 'wait';
  }

  const claimable = [];
  let totalAccounts = 0;
  for (const g of data.groups) {
    for (const a of g.accounts) {
      totalAccounts++;
      const st = getStatus(a);
      if (st === 'claim' || st === 'over') {
        claimable.push({ ...a, status: st, groupName: g.name });
      }
    }
  }

  const result = { 
    checkedAt: new Date().toISOString(),
    totalAccounts,
    claimable: claimable.length,
    accounts: claimable.map(a => ({ phone: a.phone, ninja: a.ninja, status: a.status }))
  };

  if (claimable.length === 0) {
    return { ...result, message: '无可领取账号，不推送' };
  }

  // 构建推送内容
  let msg = '🔔 六道轮回·领奖提醒\n\n';
  msg += '以下账号可领取银锭：\n\n';
  claimable.forEach((a, i) => {
    const prefix = a.status === 'over' ? '⚠️过期' : '✅可领';
    msg += `${i + 1}. ${prefix} ${a.phone} ${a.ninja}\n`;
    if (a.dailySilver) msg += `   🪙${a.dailySilver}银锭/日\n`;
  });
  msg += `\n⏰ 共${claimable.length}个账号待领取`;

  // 发送WxPusher推送
  const pushResult = await sendWxPusher(env, msg);
  return { ...result, pushResult };
}

async function sendWxPusher(env, content) {
  const spt = env.WXPUSHER_SPT;
  const appToken = env.WXPUSHER_APP_TOKEN;
  const uids = env.WXPUSHER_UIDS;

  let body, apiPath;
  if (spt) {
    apiPath = '/api/send/message/simple-push';
    body = JSON.stringify({ spt, content, summary: '六道轮回领奖提醒', contentType: 1 });
  } else if (appToken && uids) {
    apiPath = '/api/send/message';
    const uidList = uids.split(/[,，\s]+/).filter(u => u.trim());
    body = JSON.stringify({ appToken, content, contentType: 1, uids: uidList });
  } else {
    return { error: '未配置WxPusher' };
  }

  try {
    const resp = await fetch('https://wxpusher.zjiecode.com' + apiPath, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body
    });
    const json = await resp.json();
    if (json.code === 1000) {
      return { success: true, data: json.data };
    } else {
      return { success: false, error: json.msg };
    }
  } catch (e) {
    return { success: false, error: e.message };
  }
}