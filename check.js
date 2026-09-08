/**
 * 六道轮回·领奖提醒检查脚本
 * 由GitHub Actions每10分钟运行一次
 * 读取data.json，检查到期账号，通过WxPusher推送微信提醒
 */

const fs = require('fs');
const https = require('https');

// 读取数据文件
if (!fs.existsSync('data.json')) {
  console.log('未找到data.json，跳过检查');
  process.exit(0);
}

let data;
try {
  data = JSON.parse(fs.readFileSync('data.json', 'utf-8'));
} catch (e) {
  console.error('data.json解析失败:', e.message);
  process.exit(1);
}

if (!data.groups || !data.groups.length) {
  console.log('无账号数据，跳过检查');
  process.exit(0);
}

// 检查账号状态
function getStatus(acc) {
  if (!acc.lastClaimTime) return 'claim';
  const diff = Date.now() - acc.lastClaimTime;
  const ms = (acc.timerHours || 24) * 3600000;
  if (diff >= ms + 3600000) return 'over';
  if (diff >= ms) return 'claim';
  return 'wait';
}

// 收集可领取账号
const claimable = [];
for (const g of data.groups) {
  for (const a of g.accounts) {
    const st = getStatus(a);
    if (st === 'claim' || st === 'over') {
      claimable.push({ ...a, status: st, groupName: g.name });
    }
  }
}

console.log(`检查完成: 共${data.groups.reduce((s,g)=>s+g.accounts.length,0)}个账号, ${claimable.length}个可领取`);

if (claimable.length === 0) {
  console.log('无可领取账号，不推送');
  process.exit(0);
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
function sendWxPusher(content) {
  return new Promise((resolve, reject) => {
    const spt = process.env.WXPUSHER_SPT;
    const appToken = process.env.WXPUSHER_APP_TOKEN;
    const uids = process.env.WXPUSHER_UIDS;

    let body;
    if (spt) {
      // 极简推送
      body = JSON.stringify({ spt, content, contentType: 1 });
    } else if (appToken && uids) {
      // 标准推送
      const uidList = uids.split(/[,，\s]+/).filter(u => u.trim());
      body = JSON.stringify({ appToken, content, contentType: 1, uids: uidList });
    } else {
      console.log('未配置WxPusher，跳过推送');
      return resolve(false);
    }

    const options = {
      hostname: 'wxpusher.zjiecode.com',
      path: '/api/send/message',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };

    const req = https.request(options, (res) => {
      let result = '';
      res.on('data', chunk => result += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(result);
          if (json.code === 1000) {
            console.log('推送成功:', json.data);
            resolve(true);
          } else {
            console.error('推送失败:', json.msg);
            resolve(false);
          }
        } catch (e) {
          console.error('解析推送结果失败:', e.message);
          resolve(false);
        }
      });
    });

    req.on('error', (e) => {
      console.error('推送请求失败:', e.message);
      resolve(false);
    });

    req.write(body);
    req.end();
  });
}

// 执行推送
sendWxPusher(msg).then(ok => {
  if (ok) console.log('✅ 微信推送完成');
  else console.log('❌ 微信推送未完成');
});