// ===== 全局配置：换站点只需改这一个文件 =====
module.exports = {
  // 你的 Typecho 站点地址（结尾不要带 /）
  apiBase: 'https://www.xiehongwei.cn',

  // 本地联调地址：填了则优先于 apiBase，正式发布前请置空
  // 用途：QQ 开发者工具模拟器以 XHR 发请求，若服务端未返回 CORS 头会被拦截，
  // 可指向本地代理（见部署说明「模拟器跨域」一节）
  devBase: '',

  // 与 Typecho 后台「MiniAppApi 插件设置」里的接口密钥一致
  // 插件端留空则此处也留空；公开仓库里请勿提交真实密钥
  token: '',

  // 站点未开启伪静态（URL 形如 /index.php/api/posts）时改为 true
  useIndexPhp: false,

  // 每页文章数（接口上限 30）
  pageSize: 12,

  // 站点信息拉取失败时的兜底标题
  fallbackTitle: '我的博客',

  // 海报上显示的作者名（接口不返回作者字段，这里手填）
  author: 'xiehongwei',

  // 请求超时（毫秒）
  timeout: 15000
};
