// 云服务客户端：全项目唯一实例
// endpoint / publishableKey 来自 WorkBuddy 云服务 publicConfig。
// 公开仓库中已替换为占位符：部署时换成你自己应用的值（云服务面板 → 应用 → 接口配置）。
const { createMiniProgramWorkBuddyCloud } = require('@tencent-ai/workbuddy-cloud-sdk/miniprogram');
const { createDiagnosticWx } = require('./workbuddy-cloud-diagnostics');

const cloud = createMiniProgramWorkBuddyCloud({
  endpoint: 'https://mp-api.app.workbuddy.host',
  publishableKey: 'wbpk_REPLACE_WITH_YOUR_OWN_KEY',
  wx: createDiagnosticWx(wx)
});

module.exports = { cloud };
